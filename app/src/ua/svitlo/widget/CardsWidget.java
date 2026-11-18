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
    static int heightDp(Context c, int id) { return opt(c, id, false, 260); }
    static int widthDp(Context c, int id) { return opt(c, id, true, 320); }
    /** Розмір із налаштувань робочого стола: вертикально — ширина MIN, висота MAX; горизонтально — навпаки. */
    static int opt(Context c, int id, boolean width, int def) {
        try {
            Bundle o = AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
            boolean land = c.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
            String k = width ? (land ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
                             : (land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
            int v = o == null ? 0 : o.getInt(k);
            return v > 0 ? v : def;
        } catch (Exception e) { return def; }
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
        // картка: відступи 11 + рядок ~22·шрифт; день графіка: відступи 4 + рядок ~19·шрифт + смужка з годинами 18; «ще N»: 2 + ~16·шрифт
        return p.rows.size() * (11 + 22 * fs) + (p.open.size() + p.open2.size()) * (4 + Bars.H_DP + 19 * fs) + (p.rows.size() < total ? 2 + 16 * fs : 0);
    }
    /** Сховати нижню картку (спершу — нерозкриту). false — ховати нічого. */
    static boolean hideOne(Plan p, boolean keepOpen) {
        for (int i = p.rows.size() - 1; i >= 0; i--) if (!p.open.contains(p.rows.get(i).name)) { p.rows.remove(i); return true; }
        if (keepOpen || p.rows.size() <= 1) return false;
        Data.Q q = p.rows.remove(p.rows.size() - 1); p.open.remove(q.name); return true;
    }

    /**
     * Android 12+: картки — у списку, що сам гортається (нічого не ховається і не згортається саме, розкривати можна скільки завгодно).
     * Список передається разом із віджетом (RemoteCollectionItems) — без окремої служби, тож смужки завжди від своєї черги.
     * Старіші Android: картки одним блоком — стільки, скільки влазить (hDp > 0 — висота задана, для перегляду в застосунку).
     */
    static RemoteViews build(Context c, int id, boolean loading, int hDp) {
        if (hDp > 0) { android.util.DisplayMetrics dm = c.getResources().getDisplayMetrics(); return buildSized(c, id, loading, Math.round(dm.widthPixels / dm.density) - 24, hDp); }
        if (Build.VERSION.SDK_INT >= 31) {                          // точні розміри від робочого стола (вертикально й горизонтально) — вигляд для кожного
            try {
                Bundle o = AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
                java.util.ArrayList<android.util.SizeF> sizes = o == null ? null : o.<android.util.SizeF>getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
                if (sizes != null && !sizes.isEmpty()) {
                    java.util.Map<android.util.SizeF, RemoteViews> m = new java.util.HashMap<>();
                    for (android.util.SizeF s : sizes) if (m.size() < 16 && !m.containsKey(s)) m.put(s, buildSized(c, id, loading, Math.round(s.getWidth()), Math.round(s.getHeight())));
                    return m.size() == 1 ? m.values().iterator().next() : new RemoteViews(m);
                }
            } catch (Exception ignored) { }
        }
        return buildSized(c, id, loading, widthDp(c, id), heightDp(c, id));
    }

    /**
     * Вигляд за розміром: один ряд на всю ширину (≥250 dp) — смужка-картка без заголовка (сьогодні; гортання — завтра);
     * менше — кольорові плитки; два ряди й більше з однією чергою — велика картка (сьогодні й завтра); кілька черг — картки.
     */
    static final int M_TILES = 0, M_STRIP = 1, M_BIG = 2, M_CARDS = 3;
    static int mode(int count, int wDp, int hDp) {
        if (hDp < 100) return wDp >= 250 ? M_STRIP : M_TILES;
        if (wDp < 200) return M_TILES;
        return count == 1 ? M_BIG : M_CARDS;
    }
    static String modeName(int m) { return m == M_TILES ? "tiles" : m == M_STRIP ? "strip" : m == M_BIG ? "big" : listMode() ? "list" : "fit"; }
    static boolean tiles(int wDp, int hDp) { return hDp < 100 && wDp < 250 || hDp >= 100 && wDp < 200; }
    static RemoteViews buildSized(Context c, int id, boolean loading, int wDp, int hDp) {
        int m = mode(chosen(c, Data.cached(c), id).size(), wDp, hDp);
        if (m == M_TILES) return buildTiles(c, id, wDp, hDp);
        if (m == M_STRIP) return buildStrip(c, id, wDp);
        if (m == M_BIG) return buildBig(c, id, loading, wDp, hDp);
        return listMode() ? buildList(c, id, loading, wDp) : buildFor(c, id, loading, hDp, wDp);
    }

    // ---------- картка «один день»: смужка в один ряд і велика картка однієї черги ----------
    static RemoteViews dayCard(Context c, Data d, Data.Q q, boolean today, boolean both, boolean big, float barW, float dens, long now) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_day);
        v.setTextViewText(R.id.name, "Черга " + q.name);
        v.setTextViewText(R.id.status, q.state > 0 ? "Світло є" : q.state == 0 ? "Світла немає" : "Немає даних");
        v.setTextColor(R.id.status, q.state > 0 ? 0xFF2ECC71 : q.state == 0 ? 0xFFFF6B6B : 0xFF9AA5B1);
        v.setInt(R.id.card, "setBackgroundResource", q.state > 0 ? R.drawable.card_on : q.state == 0 ? R.drawable.card_off : R.drawable.card_na);
        v.setTextViewText(R.id.since, q.state >= 0 && q.since > 0 ? "з " + d.hm(q.since) + (d.kyivDay(q.since) != d.kyivDay(now) ? " " + d.ddmm(q.since) : "") : "");
        int[][][] dd = days(d, q, now);
        int[][] a = today ? dd[0] : dd[1];
        v.setTextViewText(R.id.t1, (today ? "Сьогодні: " : "Завтра: ") + Data.list(a));
        v.setViewVisibility(R.id.b1, a == null ? View.GONE : View.VISIBLE);
        if (a != null) v.setImageViewBitmap(R.id.b1, Bars.draw(a, today ? d.kyivMin(now) : -1, barW, dens));
        boolean two = both && today && dd[1] != null;
        v.setViewVisibility(R.id.t2, two ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.b2, two ? View.VISIBLE : View.GONE);
        if (two) { v.setTextViewText(R.id.t2, "Завтра: " + Data.list(dd[1])); v.setImageViewBitmap(R.id.b2, Bars.draw(dd[1], -1, barW, dens)); }
        if (big) {                                                  // одна черга на весь віджет — шрифт більший
            int sp = android.util.TypedValue.COMPLEX_UNIT_SP;
            v.setTextViewTextSize(R.id.name, sp, 20); v.setTextViewTextSize(R.id.since, sp, 14); v.setTextViewTextSize(R.id.status, sp, 18);
            v.setTextViewTextSize(R.id.t1, sp, 15); v.setTextViewTextSize(R.id.t2, sp, 15);
        }
        return v;
    }

    /** Один ряд на всю ширину: без заголовка; спершу «сьогодні» (видно одразу), гортанням — «завтра» та інші черги. */
    static RemoteViews buildStrip(Context c, int id, int wDp) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.strip);
        Data d = Data.cached(c);
        List<Data.Q> all = chosen(c, d, id);
        rv.setInt(R.id.sroot, "setBackgroundResource", Prefs.dark(c, id) ? R.drawable.bg_widget : 0);
        PendingIntent open = PendingIntent.getActivity(c, id * 10 + 4, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | immutable());
        rv.setViewVisibility(R.id.sempty, all.isEmpty() ? View.VISIBLE : View.GONE);
        rv.setOnClickPendingIntent(R.id.sempty, open);
        rv.removeAllViews(R.id.sstatic);
        if (d == null || all.isEmpty()) { rv.setViewVisibility(R.id.slist, View.GONE); return rv; }
        long now = System.currentTimeMillis();
        float barW = barWidth(c, wDp) + 8, dens = c.getResources().getDisplayMetrics().density;   // без полів заголовка
        if (listMode()) {
            RemoteViews.RemoteCollectionItems.Builder b = new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1);
            for (Data.Q q : all) {
                RemoteViews t = dayCard(c, d, q, true, false, false, barW, dens, now); t.setOnClickFillInIntent(R.id.card, new Intent());
                b.addItem(q.name.hashCode() * 2L, t);
                if (days(d, q, now)[1] != null) {
                    RemoteViews m = dayCard(c, d, q, false, false, false, barW, dens, now); m.setOnClickFillInIntent(R.id.card, new Intent());
                    b.addItem(q.name.hashCode() * 2L + 1, m);
                }
            }
            rv.setRemoteAdapter(R.id.slist, b.build());
            rv.setPendingIntentTemplate(R.id.slist, PendingIntent.getActivity(c, id * 10 + 8, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
            rv.setViewVisibility(R.id.slist, View.VISIBLE);
            rv.setViewVisibility(R.id.sstatic, View.GONE);
        } else {                                                    // Android 5–11: без гортання — перша черга, сьогодні
            RemoteViews t = dayCard(c, d, all.get(0), true, false, false, barW, dens, now);
            t.setOnClickPendingIntent(R.id.card, open);
            rv.addView(R.id.sstatic, t);
            rv.setViewVisibility(R.id.slist, View.GONE);
        }
        return rv;
    }

    /** Одна черга, два ряди й більше: заголовок і велика картка — сьогодні й (якщо влазить) завтра. */
    static RemoteViews buildBig(Context c, int id, boolean loading, int wDp, int hDp) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget);
        Data d = Data.cached(c);
        List<Data.Q> all = chosen(c, d, id);
        header(c, rv, id, loading, d, all.isEmpty());
        rv.removeAllViews(R.id.cards);
        rv.setViewVisibility(R.id.list, View.GONE);
        rv.setViewVisibility(R.id.overflow, View.GONE);
        if (d == null || all.isEmpty()) return rv;
        long now = System.currentTimeMillis();
        RemoteViews v = dayCard(c, d, all.get(0), true, hDp >= 165, true, barWidth(c, wDp), c.getResources().getDisplayMetrics().density, now);
        v.setOnClickPendingIntent(R.id.card, PendingIntent.getActivity(c, id * 10 + 4, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        rv.addView(R.id.cards, v);
        return rv;
    }

    // ---------- плитки ----------
    /** Скільки плиток і як: {стовпців, рядків, плиток, вид: 0 — квадратик (💡 і номер), 1 — плитка з часом, 2 — широка з подробицями}. */
    static int[] tileGrid(int count, int wDp, int hDp) {
        int cols = Math.max(1, (wDp - 4) / 62), rows = hDp < 100 ? 1 : Math.max(1, (hDp - 4) / 62);
        int n = Math.max(1, Math.min(count, cols * rows));
        int c2 = Math.min(cols, n), r2 = (n + c2 - 1) / c2;
        float tw = (wDp - 4) / (float) c2, th = (hDp - 4) / (float) r2;
        int kind = tw >= 130 && th >= 50 ? 2 : (n == 1 && tw < 100) || th < 60 ? 0 : 1;
        return new int[]{c2, r2, n, kind};
    }

    static RemoteViews buildTiles(Context c, int id, int wDp, int hDp) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.tiles);
        Data d = Data.cached(c);
        List<Data.Q> all = chosen(c, d, id);
        PendingIntent open = PendingIntent.getActivity(c, id * 10 + 4, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | immutable());
        rv.setViewVisibility(R.id.tempty, all.isEmpty() ? View.VISIBLE : View.GONE);
        rv.setOnClickPendingIntent(R.id.tempty, open);
        rv.removeAllViews(R.id.tgrid);                              // ⚠️ інакше при кожному оновленні додавалися б нові плитки до старих
        if (all.isEmpty()) return rv;
        int[] g = tileGrid(all.size(), wDp, hDp);
        long now = System.currentTimeMillis();
        for (int r = 0, i = 0; r < g[1] && i < g[2]; r++) {
            RemoteViews row = new RemoteViews(c.getPackageName(), R.layout.tile_row);
            for (int k = 0; k < g[0]; k++, i++) {
                if (i >= g[2]) { RemoteViews blank = new RemoteViews(c.getPackageName(), R.layout.tile); blank.setViewVisibility(R.id.tile, View.INVISIBLE); row.addView(R.id.row, blank); continue; }
                row.addView(R.id.row, tile(c, d, all.get(i), g[3], now, open));
            }
            rv.addView(R.id.tgrid, row);
        }
        return rv;
    }

    static RemoteViews tile(Context c, Data d, Data.Q q, int kind, long now, PendingIntent open) {
        int bg = q.state > 0 ? R.drawable.tile_on : q.state == 0 ? R.drawable.tile_off : R.drawable.tile_na;
        RemoteViews v;
        if (kind == 2) {
            v = new RemoteViews(c.getPackageName(), R.layout.tile_wide);
            v.setTextViewText(R.id.w2, q.name);
            v.setTextViewText(R.id.w3, q.state > 0 ? "Світло є" : q.state == 0 ? "Світла немає" : "Немає даних");
            v.setTextViewText(R.id.w4, tileDetail(d, q, now));
        } else {
            v = new RemoteViews(c.getPackageName(), R.layout.tile);   // 💡, номер черги і (крім квадратика) час
            v.setTextViewText(R.id.tl1, q.name);
            v.setViewVisibility(R.id.tl2, kind == 0 ? View.GONE : View.VISIBLE);
            if (kind != 0) v.setTextViewText(R.id.tl2, tileTime(d, q, now));
        }
        v.setInt(R.id.tile, "setBackgroundResource", bg);
        v.setOnClickPendingIntent(R.id.tile, open);
        return v;
    }

    // ---------- час для плиток: за графіком ----------
    /** [поточне відключення: кінець] або -1; хвилини від початку сьогоднішньої доби (за північ — 1440+). */
    static int outageEnd(int[][] a, int[][] b, int m) {
        if (a != null) for (int[] x : a) if (x[0] <= m && m < x[1]) {
            int e = x[1];
            if (e >= 1440 && b != null) for (int[] y : b) if (y[0] == 0) e = 1440 + y[1];
            return e;
        }
        return -1;
    }
    /** Наступний початок відключення після m (сьогодні або завтра; продовження через північ — не початок) або -1. */
    static int nextStart(int[][] a, int[][] b, int m) {
        boolean endsAtMidnight = false;
        if (a != null) for (int[] x : a) { if (x[0] > m) return x[0]; if (x[1] >= 1440) endsAtMidnight = true; }
        if (b != null) for (int[] y : b) { if (y[0] == 0 && endsAtMidnight) continue; return 1440 + y[0]; }
        return -1;
    }
    static int[][][] days(Data d, Data.Q q, long now) {
        int sh = d.dayShift(now);
        return new int[][][]{ sh <= 0 ? q.today : sh == 1 ? q.tomorrow : null, sh <= 0 ? q.tomorrow : null };
    }
    /** Коротко: світла немає — «до 17:00» (коли за графіком увімкнуть); є — «відкл 20:30»; інакше — «з 18:30». */
    static String tileTime(Data d, Data.Q q, long now) {
        if (d == null || q.state < 0) return "немає даних";
        int[][][] dd = days(d, q, now); int m = d.kyivMin(now);
        int t = q.state == 0 ? outageEnd(dd[0], dd[1], m) : nextStart(dd[0], dd[1], m);
        if (t >= 0) return (q.state == 0 ? "до " : "відкл ") + Data.hm(t % 1440);
        return q.since > 0 ? "з " + d.hm(q.since) : "";
    }
    /** Докладніше (широка плитка): з якого часу + графік. */
    static String tileDetail(Data d, Data.Q q, long now) {
        if (d == null || q.state < 0) return "";
        int[][][] dd = days(d, q, now); int m = d.kyivMin(now);
        String since = q.since > 0 ? "з " + d.hm(q.since) + (d.kyivDay(q.since) != d.kyivDay(now) ? " " + d.ddmm(q.since) : "") : "";
        String plan;
        if (q.state == 0) {
            int e = outageEnd(dd[0], dd[1], m);
            plan = e >= 0 ? "увімкнуть ~" + Data.hm(e % 1440) + (e >= 1440 ? " завтра" : "") : dd[0] != null ? "позапланово" : "";
        } else {
            int s = nextStart(dd[0], dd[1], m);
            plan = s >= 0 ? "відкл. " + (s >= 1440 ? "завтра " : "о ") + Data.hm(s % 1440) : dd[0] != null ? "відключень немає" : "";
        }
        return since + (since.length() > 0 && plan.length() > 0 ? "\n" : "") + plan;            // два короткі рядки
    }

    static List<Data.Q> chosen(Context c, Data d, int id) {
        List<Data.Q> all = new ArrayList<>();
        if (d != null) { List<String> sel = Prefs.selected(c, id); for (Data.Q q : d.qs) if (sel == null || sel.contains(q.name)) all.add(q); }
        return all;
    }

    /** Для списку: усі вибрані черги; розкриті — як натиснули; «завтра» — для кожної розкритої, якщо графік є. */
    static Plan listPlan(Context c, Data d, int id, List<Data.Q> all) {
        Plan p = new Plan();
        p.rows.addAll(all);
        List<String> ex = Prefs.expanded(c, id);
        int sh = d.dayShift(System.currentTimeMillis());
        for (int i = ex.size() - 1; i >= 0; i--) for (Data.Q q : all) if (q.name.equals(ex.get(i))) {
            p.open.add(q.name);
            if (sh <= 0 && q.tomorrow != null) p.open2.add(q.name);
        }
        return p;
    }
    static boolean listMode() { return Build.VERSION.SDK_INT >= 31; }
    static Plan planFor(Context c, Data d, int id, List<Data.Q> all, int hDp) { return listMode() ? listPlan(c, d, id, all) : plan(c, d, id, all, hDp); }

    /** Заголовок (оновлено…, ↻, ⚙, назва → застосунок) і напис, коли карток немає. */
    static void header(Context c, RemoteViews rv, int id, boolean loading, Data d, boolean none) {
        rv.setInt(R.id.root, "setBackgroundResource", Prefs.dark(c, id) ? R.drawable.bg_widget : 0);   // фон: прозорий (типово) або темний
        String err = Data.prefs(c).getString("error", null);
        String up;
        if (loading) up = "оновлюю…";
        else if (d == null) up = err != null ? "немає зв'язку" : "завантаження…";
        else up = (err != null ? "⚠ дані на " : "оновлено ") + d.hm(d.now);
        rv.setTextViewText(R.id.updated, up);
        rv.setViewVisibility(R.id.spin, loading ? View.VISIBLE : View.GONE);           // оновлюється — крутиться значок замість ↻
        rv.setTextViewText(R.id.refresh, loading ? "" : "↻");
        rv.setViewVisibility(R.id.empty, none ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.empty, d == null ? (err != null ? "Немає зв'язку з сервером.\nНатисніть ↻, щоб спробувати ще раз." : "Завантаження…") : "Немає вибраних черг — натисніть ⚙");
        Intent r = new Intent(c, CardsWidget.class).setAction(A_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        rv.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, id * 10 + 2, r, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        Intent s = new Intent(c, ConfigActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).setData(Uri.parse("svitlo://cfg/" + id));
        rv.setOnClickPendingIntent(R.id.settings, PendingIntent.getActivity(c, id * 10 + 3, s, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        rv.setOnClickPendingIntent(R.id.title, PendingIntent.getActivity(c, id * 10 + 4, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
    }

    static float barWidth(Context c, int wDp) {
        android.util.DisplayMetrics dm = c.getResources().getDisplayMetrics();
        if (wDp <= 0) wDp = Math.round(dm.widthPixels / dm.density) - 24;
        return wDp - 12 - 20;                                       // поля віджета і картки
    }

    @android.annotation.TargetApi(31)
    static RemoteViews buildList(Context c, int id, boolean loading, int wDp) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget);
        Data d = Data.cached(c);
        List<Data.Q> all = chosen(c, d, id);
        header(c, rv, id, loading, d, all.isEmpty());
        rv.setViewVisibility(R.id.cards, View.GONE);
        rv.setViewVisibility(R.id.overflow, View.GONE);
        rv.setViewVisibility(R.id.list, all.isEmpty() ? View.GONE : View.VISIBLE);
        if (d != null && !all.isEmpty()) {
            Plan p = listPlan(c, d, id, all);
            long now = System.currentTimeMillis();
            float barW = barWidth(c, wDp), dens = c.getResources().getDisplayMetrics().density;
            RemoteViews.RemoteCollectionItems.Builder b = new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1);
            for (int i = 0; i < p.rows.size(); i++) {
                Data.Q q = p.rows.get(i);
                b.addItem(q.name.hashCode(), card(c, d, id, i, q, p.open.contains(q.name), p.open2.contains(q.name), now, barW, dens, true));
            }
            rv.setRemoteAdapter(R.id.list, b.build());
            Intent t = new Intent(c, CardsWidget.class).setAction(A_TOGGLE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).setData(Uri.parse("svitlo://list/" + id));
            rv.setPendingIntentTemplate(R.id.list, PendingIntent.getBroadcast(c, id * 10 + 7, t, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        }
        return rv;
    }

    /** wDp — ширина віджета (0 — на всю ширину екрана, для перегляду в застосунку). */
    static RemoteViews buildFor(Context c, int id, boolean loading, int hDp, int wDp) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget);
        Data d = Data.cached(c);
        rv.removeAllViews(R.id.cards);
        List<Data.Q> all = chosen(c, d, id);
        Plan p = d == null ? new Plan() : plan(c, d, id, all, hDp);
        header(c, rv, id, loading, d, p.rows.isEmpty());
        long now = System.currentTimeMillis();
        float barW = barWidth(c, wDp), dens = c.getResources().getDisplayMetrics().density;
        for (int i = 0; i < p.rows.size(); i++) rv.addView(R.id.cards, card(c, d, id, i, p.rows.get(i), p.open.contains(p.rows.get(i).name), p.open2.contains(p.rows.get(i).name), now, barW, dens, false));
        rv.setViewVisibility(R.id.overflow, p.hidden > 0 ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.overflow, "ще " + p.hidden + " " + (p.hidden == 1 ? "черга" : p.hidden < 5 ? "черги" : "черг") + " — збільште віджет або виберіть менше (⚙)");
        return rv;
    }

    /** inList — картка в списку (Android 12+): натискання — через спільний шаблон списку. */
    static RemoteViews card(Context c, Data d, int id, int pos, Data.Q q, boolean ex, boolean ex2, long now, float barW, float dens, boolean inList) {
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
            if (a != null) v.setImageViewBitmap(R.id.b1, Bars.draw(a, d.kyivMin(now), barW, dens));
            boolean hasB = ex2 && b != null;
            v.setViewVisibility(R.id.t2, hasB ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.b2, hasB ? View.VISIBLE : View.GONE);
            if (hasB) { v.setTextViewText(R.id.t2, "Завтра: " + Data.list(b)); v.setImageViewBitmap(R.id.b2, Bars.draw(b, -1, barW, dens)); }
        }
        if (inList) { v.setOnClickFillInIntent(R.id.card, new Intent().putExtra(EXTRA_Q, q.name)); return v; }
        Intent t = new Intent(c, CardsWidget.class).setAction(A_TOGGLE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_Q, q.name)
            .setData(Uri.parse("svitlo://toggle/" + id + "/" + Uri.encode(q.name)));
        v.setOnClickPendingIntent(R.id.card, PendingIntent.getBroadcast(c, (id * 31 + pos) & 0x7fffffff, t, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        return v;
    }
}
