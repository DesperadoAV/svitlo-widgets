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

        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(0xFF3B4A5A);
        int pad = Ui.dp(this, 12);
        RemoteViews rv = CardsWidget.build(this, ID, false, h);
        // та сама оболонка, що й на робочому столі: без неї Android не показує список карток (Android 12+)
        final android.appwidget.AppWidgetHostView host = new android.appwidget.AppWidgetHostView(this);
        View w = rv.apply(this, host);
        host.addView(w, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, h)); lp.setMargins(pad, pad * 3, pad, pad);
        root.addView(host, lp);
        host.postDelayed(new Runnable() { @Override public void run() {   // для тестів: скільки карток справді намальовано
            View l = host.findViewById(R.id.list), cs = host.findViewById(R.id.cards);
            int n = l != null && l.getVisibility() == View.VISIBLE ? ((ViewGroup) l).getChildCount() : cs != null ? ((ViewGroup) cs).getChildCount() : -1;
            Log.i("SvitloPreview", "drawn " + n);
        } }, 2500);
        Ui.insets(root, 0, 0, 0, 0);
        setContentView(root);

        Data d = Data.cached(this);
        java.util.List<Data.Q> all = new java.util.ArrayList<>();
        java.util.List<String> s = Prefs.selected(this, ID);
        if (d != null) for (Data.Q q : d.qs) if (s == null || s.contains(q.name)) all.add(q);
        CardsWidget.Plan p = d == null ? new CardsWidget.Plan() : CardsWidget.planFor(this, d, ID, all, h);
        Log.i("SvitloPreview", "mode " + (CardsWidget.listMode() ? "list" : "fit") + " cards " + all.size() + " shown " + p.rows.size() + " hidden " + p.hidden + " expanded " + p.open + " tomorrow " + p.open2);
    }
}
