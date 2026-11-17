package ua.svitlo.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.util.ArrayList;
import java.util.List;

/**
 * Віджет на робочий стіл: картки черг (є світло чи ні, з якого часу; натиснути — графік на сьогодні й завтра).
 * Картки малюються одним махом (без списку з прокруткою) і рівно стільки, скільки влазить у розмір віджета —
 * тож нічого не обрізається і смужки графіка завжди від своєї черги.
 */
public class CardsWidget extends AppWidgetProvider {
    static final String A_REFRESH = "ua.svitlo.widget.REFRESH", A_RETRY = "ua.svitlo.widget.RETRY", A_TOGGLE = "ua.svitlo.widget.TOGGLE", EXTRA_Q = "q";
    private static final long FRESH_MS = 5 * 60000L;       // свіжі дані не перезавантажуємо частіше, ніж раз на 5 хв

    static int immutable() { return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id, false, 0));
        long tried = Data.prefs(c).getLong("tried", 0);
        if (System.currentTimeMillis() - tried > FRESH_MS) fetchAsync(c, goAsync());
    }

    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle o) {
        m.updateAppWidget(id, build(c, id, false, 0));     // змінили розмір — перераховуємо, скільки карток влазить
    }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String a = i.getAction();
        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (A_REFRESH.equals(a)) {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            for (int w : ids(c)) m.updateAppWidget(w, build(c, w, true, 0));
            fetchAsync(c, goAsync());
        } else if (A_RETRY.equals(a)) {
            fetchAsync(c, goAsync());
        } else if (A_TOGGLE.equals(a) && id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            String q = i.getStringExtra(EXTRA_Q);
            if (q != null) { Prefs.toggleExpanded(c, id, q); AppWidgetManager.getInstance(c).updateAppWidget(id, build(c, id, false, 0)); }
        }
    }

    @Override public void onDeleted(Context c, int[] ids) { for (int id : ids) Prefs.forget(c, id); }

    static int[] ids(Context c) { return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, CardsWidget.class)); }

    /** Оновити всі віджети (після завантаження даних або зміни налаштувань). */
    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : ids(c)) m.updateAppWidget(id, build(c, id, false, 0));
    }

    static void fetchAsync(final Context c0, final PendingResult pr) {
        final Context c = c0.getApplicationContext();
        new Thread(new Runnable() { @Override public void run() {
            boolean ok = false;
            try { ok = Data.fetch(c); } catch (Exception ignored) { }
            finally {
                try { updateAll(c); retry(c, ok); } catch (Exception ignored) { }   // «оновлюю…» не залишиться, що б не сталося
                if (pr != null) pr.finish();
            }
        } }).start();
    }

    /** Не вдалося завантажити (телефон щойно увімкнувся, немає мережі) — спробуємо ще раз: через 3, 6, 12… хв, але не рідше ніж раз на 30 хв. */
    static void retry(Context c, boolean ok) {
        android.content.SharedPreferences p = Data.prefs(c);
        if (ok) { p.edit().putInt("fails", 0).apply(); return; }
        if (ids(c).length == 0) return;
        int n = Math.min(p.getInt("fails", 0) + 1, 10);
        p.edit().putInt("fails", n).apply();
        long delay = Math.min(30L, 3L << Math.min(n - 1, 4)) * 60000L;
        android.app.AlarmManager am = (android.app.AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 7, new Intent(c, CardsWidget.class).setAction(A_RETRY), PendingIntent.FLAG_UPDATE_CURRENT | immutable());
        if (am != null) am.set(android.app.AlarmManager.RTC, System.currentTimeMillis() + delay, pi);   // без пробудження телефона
    }

    // ---------- скільки місця: висота віджета в dp (з налаштувань робочого стола) ----------
    static int heightDp(Context c, int id) {
        try {
            Bundle o = AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
            boolean land = c.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
            int h = o == null ? 0 : o.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
            return h > 0 ? h : 260;
        } catch (Exception e) { return 260; }
    }

    /**
     * Що показати: які черги, які з них розкриті і чи є «завтра»; решта — «ще N».
     * Розкриті (останні натиснуті — першими) мають перевагу: щоб графік уліз, нижні нерозкриті картки ховаються.
     * Висоти — приблизні, із запасом на великий шрифт.
     */
    static final class Plan { final List<Data.Q> rows = new ArrayList<>(); final List<String> open = new ArrayList<>(); final List<String> open2 = new ArrayList<>(); int hidden; }

    static Plan plan(Context c, Data d, int id, List<Data.Q> all, int hDp) {
        float fs = Math.max(1f, c.getResources().getConfiguration().fontScale);
        final float avail = hDp - 12 - Math.max(28, 20 * fs) - 2;   // поля і заголовок (кнопок унизу немає)
        Plan p = new Plan();
        p.rows.addAll(all);
        List<String> ex = Prefs.expanded(c, id), names = new ArrayList<>();
        for (Data.Q q : all) names.add(q.name);
        for (int i = ex.size() - 1; i >= 0; i--) {          // останні натиснуті — першими
            String q = ex.get(i);
            boolean shown = false; for (Data.Q y : p.rows) if (y.name.equals(q)) shown = true;
            if (!shown) continue;                           // сховали, щоб уліз новіший розкритий
            List<Data.Q> before = new ArrayList<>(p.rows);
            p.open.add(q);
            while (cost(p, all.size(), fs) > avail && hideOne(p, true)) { }
            if (cost(p, all.size(), fs) > avail) { p.open.remove(q); p.rows.clear(); p.rows.addAll(before); break; }   // не влазить навіть так — лишаємо як було
        }
        while (cost(p, all.size(), fs) > avail && p.rows.size() > 1 && hideOne(p, false)) { }
        int sh = d.dayShift(System.currentTimeMillis());
        for (String q : new ArrayList<>(p.open)) {
            Data.Q x = null; for (Data.Q y : all) if (y.name.equals(q)) x = y;
            if (x == null || sh > 0 || x.tomorrow == null) continue;
            p.open2.add(q);
            if (cost(p, all.size(), fs) > avail) p.open2.remove(q);
        }
        p.hidden = all.size() - p.rows.size();
        return p;
    }
    static float cost(Plan p, int total, float fs) {
        // картка: відступи 11 + рядок ~22·шрифт; день графіка: відступи 4 + рядок ~19·шрифт + смужка 8; «ще N»: 2 + ~16·шрифт
        return p.rows.size() * (11 + 22 * fs) + (p.open.size() + p.open2.size()) * (12 + 19 * fs) + (p.rows.size() < total ? 2 + 16 * fs : 0);
    }
    /** Сховати нижню картку (спершу — нерозкриту). false — ховати нічого. */
    static boolean hideOne(Plan p, boolean keepOpen) {
        for (int i = p.rows.size() - 1; i >= 0; i--) if (!p.open.contains(p.rows.get(i).name)) { p.rows.remove(i); return true; }
        if (keepOpen || p.rows.size() <= 1) return false;
        Data.Q q = p.rows.remove(p.rows.size() - 1); p.open.remove(q.name); return true;
    }

    /**
     * hDp > 0 — висота задана (перегляд у застосунку). Інакше — з робочого стола: на Android 12+ робочий стіл
     * повідомляє точні розміри віджета (вертикально й горизонтально) — готуємо вигляд для кожного, і він сам бере потрібний.
     */
    static RemoteViews build(Context c, int id, boolean loading, int hDp) {
        if (hDp > 0) return buildFor(c, id, loading, hDp);
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                Bundle o = AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
                java.util.ArrayList<android.util.SizeF> sizes = o == null ? null : o.<android.util.SizeF>getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
                if (sizes != null && !sizes.isEmpty()) {
                    java.util.Map<android.util.SizeF, RemoteViews> m = new java.util.HashMap<>();
                    for (android.util.SizeF s : sizes) if (m.size() < 16 && !m.containsKey(s)) m.put(s, buildFor(c, id, loading, Math.round(s.getHeight())));
                    return new RemoteViews(m);
                }
            } catch (Exception ignored) { }
        }
        return buildFor(c, id, loading, heightDp(c, id));
    }

    static RemoteViews buildFor(Context c, int id, boolean loading, int hDp) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget);
        Data d = Data.cached(c);
        String err = Data.prefs(c).getString("error", null);
        String up;
        if (loading) up = "оновлюю…";
        else if (d == null) up = err != null ? "немає зв'язку" : "завантаження…";
        else up = (err != null ? "⚠ дані на " : "оновлено ") + d.hm(d.now);
        rv.setTextViewText(R.id.updated, up);

        rv.removeAllViews(R.id.cards);
        List<Data.Q> all = new ArrayList<>();
        if (d != null) { List<String> sel = Prefs.selected(c, id); for (Data.Q q : d.qs) if (sel == null || sel.contains(q.name)) all.add(q); }
        Plan p = d == null ? new Plan() : plan(c, d, id, all, hDp);
        long now = System.currentTimeMillis();
        for (int i = 0; i < p.rows.size(); i++) rv.addView(R.id.cards, card(c, d, id, i, p.rows.get(i), p.open.contains(p.rows.get(i).name), p.open2.contains(p.rows.get(i).name), now));
        rv.setViewVisibility(R.id.empty, p.rows.isEmpty() ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.empty, d == null ? (err != null ? "Немає зв'язку з сервером.\nНатисніть ↻, щоб спробувати ще раз." : "Завантаження…") : "Немає вибраних черг — натисніть ⚙");
        rv.setViewVisibility(R.id.overflow, p.hidden > 0 ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.overflow, "ще " + p.hidden + " " + (p.hidden == 1 ? "черга" : p.hidden < 5 ? "черги" : "черг") + " — збільште віджет або виберіть менше (⚙)");

        Intent r = new Intent(c, CardsWidget.class).setAction(A_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        rv.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, id * 10 + 2, r, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        Intent s = new Intent(c, ConfigActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).setData(Uri.parse("svitlo://cfg/" + id));
        rv.setOnClickPendingIntent(R.id.settings, PendingIntent.getActivity(c, id * 10 + 3, s, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        rv.setOnClickPendingIntent(R.id.title, PendingIntent.getActivity(c, id * 10 + 4, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        return rv;
    }

    static RemoteViews card(Context c, Data d, int id, int pos, Data.Q q, boolean ex, boolean ex2, long now) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item);
        v.setTextViewText(R.id.name, "Черга " + q.name);
        v.setTextViewText(R.id.status, q.state > 0 ? "Світло є" : q.state == 0 ? "Світла немає" : "Немає даних");
        v.setTextColor(R.id.status, q.state > 0 ? 0xFF2ECC71 : q.state == 0 ? 0xFFFF6B6B : 0xFF9AA5B1);
        v.setInt(R.id.card, "setBackgroundResource", q.state > 0 ? R.drawable.card_on : q.state == 0 ? R.drawable.card_off : R.drawable.card_na);
        String since = "";
        if (q.state >= 0 && q.since > 0) since = "з " + d.hm(q.since) + (d.kyivDay(q.since) != d.kyivDay(now) ? " " + d.ddmm(q.since) : "");
        v.setTextViewText(R.id.since, since);
        v.setViewVisibility(R.id.more, ex ? View.VISIBLE : View.GONE);
        if (ex) {
            int sh = d.dayShift(now);                      // після півночі «завтра» стає «сьогодні»
            int[][] a = sh <= 0 ? q.today : sh == 1 ? q.tomorrow : null, b = sh <= 0 ? q.tomorrow : null;
            v.setTextViewText(R.id.t1, "Сьогодні: " + Data.list(a));
            v.setViewVisibility(R.id.b1, a == null ? View.GONE : View.VISIBLE);
            if (a != null) v.setImageViewBitmap(R.id.b1, Bars.draw(a, d.kyivMin(now)));
            boolean hasB = ex2 && b != null;
            v.setViewVisibility(R.id.t2, hasB ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.b2, hasB ? View.VISIBLE : View.GONE);
            if (hasB) { v.setTextViewText(R.id.t2, "Завтра: " + Data.list(b)); v.setImageViewBitmap(R.id.b2, Bars.draw(b, -1)); }
        }
        Intent t = new Intent(c, CardsWidget.class).setAction(A_TOGGLE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_Q, q.name)
            .setData(Uri.parse("svitlo://toggle/" + id + "/" + Uri.encode(q.name)));
        v.setOnClickPendingIntent(R.id.card, PendingIntent.getBroadcast(c, (id * 31 + pos) & 0x7fffffff, t, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        return v;
    }
}
