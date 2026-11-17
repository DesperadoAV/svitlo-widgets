package ua.svitlo.widget;

import android.app.Activity;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.FrameLayout;

/**
 * Перегляд віджета всередині застосунку (для автоматичних тестів на емуляторі: там немає робочого стола, на який можна
 * перетягнути віджет). Запуск: adb shell cmd appwidget grantbind --package ua.svitlo.widget; am start -n ua.svitlo.widget/.PreviewActivity
 */
public class PreviewActivity extends Activity {
    AppWidgetHost host;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(0xFF3B4A5A);
        setContentView(root);
        host = new AppWidgetHost(this, 4242);
        AppWidgetManager m = AppWidgetManager.getInstance(this);
        int id = Data.prefs(this).getInt("preview_id", -1);
        ComponentName cn = new ComponentName(this, CardsWidget.class);
        if (id < 0) {
            id = host.allocateAppWidgetId();
            if (!m.bindAppWidgetIdIfAllowed(id, cn)) { Log.w("SvitloPreview", "bind not allowed"); finish(); return; }
            Data.prefs(this).edit().putInt("preview_id", id).apply();
        }
        String sel = getIntent().getStringExtra("queues");
        if (sel != null) Prefs.setSelected(this, id, sel.isEmpty() ? null : java.util.Arrays.asList(sel.split(",")));
        String tog = getIntent().getStringExtra("toggle");
        if (tog != null) Prefs.toggleExpanded(this, id, tog);
        AppWidgetProviderInfo info = m.getAppWidgetInfo(id);
        AppWidgetHostView v = host.createView(this, id, info);
        int w = Ui.dp(this, 340), h = Ui.dp(this, 520), pad = Ui.dp(this, 10);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, h); lp.setMargins(pad, pad * 4, pad, pad);
        root.addView(v, lp);
        Log.i("SvitloPreview", "widget id " + id);
        sendBroadcast(new Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).setComponent(cn).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[]{id}));
        m.notifyAppWidgetViewDataChanged(id, R.id.list);
    }
    @Override protected void onStart() { super.onStart(); if (host != null) host.startListening(); }
    @Override protected void onStop() { super.onStop(); if (host != null) try { host.stopListening(); } catch (Exception ignored) { } }
}
