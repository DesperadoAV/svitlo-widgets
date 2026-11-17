package ua.svitlo.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

/** Віджет на робочий стіл: картки черг (є світло чи ні, з якого часу; натиснути — графік на сьогодні й завтра). */
public class CardsWidget extends AppWidgetProvider {
    static final String A_REFRESH = "ua.svitlo.widget.REFRESH", A_TOGGLE = "ua.svitlo.widget.TOGGLE", EXTRA_Q = "q";
    private static final long FRESH_MS = 5 * 60000L;       // свіжі дані не перезавантажуємо частіше, ніж раз на 5 хв

    static int immutable() { return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }
    static int mutable() { return Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0; }

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id, false));
        long tried = Data.prefs(c).getLong("tried", 0);
        if (System.currentTimeMillis() - tried > FRESH_MS) fetchAsync(c, goAsync());
    }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String a = i.getAction();
        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (A_REFRESH.equals(a)) {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            for (int w : ids(c)) m.updateAppWidget(w, build(c, w, true));
            fetchAsync(c, goAsync());
        } else if (A_TOGGLE.equals(a) && id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            String q = i.getStringExtra(EXTRA_Q);
            if (q != null) { Prefs.toggleExpanded(c, id, q); AppWidgetManager.getInstance(c).notifyAppWidgetViewDataChanged(id, R.id.list); }
        }
    }

    @Override public void onDeleted(Context c, int[] ids) { for (int id : ids) Prefs.forget(c, id); }

    static int[] ids(Context c) { return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, CardsWidget.class)); }

    /** Оновити всі віджети (після завантаження даних або зміни налаштувань). */
    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = ids(c);
        for (int id : ids) m.updateAppWidget(id, build(c, id, false));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    static void fetchAsync(final Context c0, final PendingResult pr) {
        final Context c = c0.getApplicationContext();
        new Thread(new Runnable() { @Override public void run() {
            try { Data.fetch(c); updateAll(c); } catch (Exception ignored) { }
            finally { if (pr != null) pr.finish(); }
        } }).start();
    }

    static RemoteViews build(Context c, int id, boolean loading) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget);
        Data d = Data.cached(c);
        String up;
        if (loading) up = "оновлюю…";
        else if (d == null) up = Data.prefs(c).getString("error", null) != null ? "немає зв'язку" : "завантаження…";
        else up = (d.error != null ? "⚠ дані на " : "оновлено ") + d.hm(d.fetchedAt > 0 ? d.fetchedAt : d.now);
        rv.setTextViewText(R.id.updated, up);
        rv.setTextViewText(R.id.empty, d == null ? (Data.prefs(c).getString("error", null) != null ? "Немає зв'язку з сервером.\nНатисніть ↻, щоб спробувати ще раз." : "Завантаження…") : "Немає вибраних черг — натисніть ⚙");

        Intent svc = new Intent(c, CardsService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.list, svc);
        rv.setEmptyView(R.id.list, R.id.empty);

        Intent t = new Intent(c, CardsWidget.class).setAction(A_TOGGLE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        rv.setPendingIntentTemplate(R.id.list, PendingIntent.getBroadcast(c, id * 10 + 1, t, PendingIntent.FLAG_UPDATE_CURRENT | mutable()));

        Intent r = new Intent(c, CardsWidget.class).setAction(A_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        rv.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, id * 10 + 2, r, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));

        Intent s = new Intent(c, ConfigActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).setData(Uri.parse("svitlo://cfg/" + id));
        rv.setOnClickPendingIntent(R.id.settings, PendingIntent.getActivity(c, id * 10 + 3, s, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));

        Intent open = new Intent(c, MainActivity.class);
        rv.setOnClickPendingIntent(R.id.title, PendingIntent.getActivity(c, id * 10 + 4, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));

        String map = d != null ? d.map : Data.DEFAULT_MAP, site = d != null ? d.site : Data.DEFAULT_SITE;
        rv.setOnClickPendingIntent(R.id.map, PendingIntent.getActivity(c, id * 10 + 5, new Intent(Intent.ACTION_VIEW, Uri.parse(map)), PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        rv.setOnClickPendingIntent(R.id.site, PendingIntent.getActivity(c, id * 10 + 6, new Intent(Intent.ACTION_VIEW, Uri.parse(site)), PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        return rv;
    }
}
