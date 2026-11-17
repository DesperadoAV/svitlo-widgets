package ua.svitlo.widget;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;

/**
 * Перегляд віджета всередині застосунку — для автоматичних тестів на емуляторі (там немає робочого стола, на який можна
 * перетягнути віджет). Малює той самий віджет тим самим кодом (CardsWidget.build), лише без робочого стола.
 * Запуск: adb shell am start -n ua.svitlo.widget/.PreviewActivity [--es toggle 3.2] [--es queues 3.2,6.1] [--ei h 200]
 */
public class PreviewActivity extends Activity {
    static final int ID = 424242;                                  // окремі налаштування для перегляду

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        String sel = getIntent().getStringExtra("queues");
        if (sel != null) Prefs.setSelected(this, ID, sel.isEmpty() || sel.equals("all") ? null : java.util.Arrays.asList(sel.split(",")));
        String tog = getIntent().getStringExtra("toggle");
        if (tog != null) for (String q : tog.split(",")) Prefs.toggleExpanded(this, ID, q);
        int h = getIntent().getIntExtra("h", 300);                 // висота віджета в dp (як на робочому столі 4×3)
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = getIntent().getIntExtra("w", Math.round(dm.widthPixels / dm.density) - 24);   // ширина (менша — плитки)

        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(0xFF3B4A5A);
        int pad = Ui.dp(this, 12);
        RemoteViews rv = CardsWidget.buildSized(this, ID, false, w, h);
        // та сама оболонка, що й на робочому столі: без неї Android не показує список карток (Android 12+)
        final android.appwidget.AppWidgetHostView host = new android.appwidget.AppWidgetHostView(this);
        View w = rv.apply(this, host);
        host.addView(w, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Ui.dp(this, w), Ui.dp(this, h)); lp.setMargins(pad, pad * 3, pad, pad);
        root.addView(host, lp);
        host.postDelayed(new Runnable() { @Override public void run() {   // для тестів: скільки карток справді намальовано
            View l = host.findViewById(R.id.list), cs = host.findViewById(R.id.cards), tr = host.findViewById(R.id.troot);
            int n = -1;
            if (tr != null) { n = 0; ViewGroup g = (ViewGroup) tr; for (int i = 0; i < g.getChildCount(); i++) if (g.getChildAt(i) instanceof ViewGroup) { ViewGroup r = (ViewGroup) g.getChildAt(i); for (int k = 0; k < r.getChildCount(); k++) if (r.getChildAt(k).getVisibility() == View.VISIBLE) n++; } }
            else if (l != null && l.getVisibility() == View.VISIBLE) n = ((ViewGroup) l).getChildCount();
            else if (cs != null) n = ((ViewGroup) cs).getChildCount();
            Log.i("SvitloPreview", "drawn " + n);
        } }, 2500);
        Ui.insets(root, 0, 0, 0, 0);
        setContentView(root);

        Data d = Data.cached(this);
        java.util.List<Data.Q> all = new java.util.ArrayList<>();
        java.util.List<String> s = Prefs.selected(this, ID);
        if (d != null) for (Data.Q q : d.qs) if (s == null || s.contains(q.name)) all.add(q);
        if (CardsWidget.tiles(w, h)) {
            int[] g = CardsWidget.tileGrid(all.size(), w, h);
            Log.i("SvitloPreview", "mode tiles " + w + "x" + h + " cols " + g[0] + " rows " + g[1] + " n " + g[2] + " kind " + g[3]
                + (all.isEmpty() ? "" : " first " + all.get(0).name + " time «" + CardsWidget.tileTime(d, all.get(0), System.currentTimeMillis()) + "»"));
            return;
        }
        CardsWidget.Plan p = d == null ? new CardsWidget.Plan() : CardsWidget.planFor(this, d, ID, all, h);
        Log.i("SvitloPreview", "mode " + (CardsWidget.listMode() ? "list" : "fit") + " cards " + all.size() + " shown " + p.rows.size() + " hidden " + p.hidden + " expanded " + p.open + " tomorrow " + p.open2);
    }
}
