package ua.svitlo.widget;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Перегляд віджета всередині застосунку — для автоматичних тестів на емуляторі (там немає робочого стола, на який можна
 * перетягнути віджет). Малює ті самі картки тим самим кодом, що й справжній віджет (CardsService), лише без робочого стола.
 * Запуск: adb shell am start -n ua.svitlo.widget/.PreviewActivity [--es toggle 3.2] [--es queues 3.2,6.1]
 */
public class PreviewActivity extends Activity {
    static final int ID = 424242;                                  // окремі налаштування для перегляду

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        String sel = getIntent().getStringExtra("queues");
        if (sel != null) Prefs.setSelected(this, ID, sel.isEmpty() ? null : java.util.Arrays.asList(sel.split(",")));
        String tog = getIntent().getStringExtra("toggle");
        if (tog != null) Prefs.toggleExpanded(this, ID, tog);

        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(0xFF3B4A5A);
        int pad = Ui.dp(this, 12);
        View w = LayoutInflater.from(this).inflate(R.layout.widget, root, false);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 540)); lp.setMargins(pad, pad * 3, pad, pad);
        root.addView(w, lp);
        Data d = Data.cached(this);
        ((TextView) w.findViewById(R.id.updated)).setText(d == null ? "немає даних" : "оновлено " + d.hm(d.fetchedAt > 0 ? d.fetchedAt : d.now));

        // замість списку робочого стола — ті самі картки від CardsService
        ListView lv = (ListView) w.findViewById(R.id.list);
        ViewGroup box = (ViewGroup) lv.getParent();
        box.removeAllViews();
        ScrollView sv = new ScrollView(this); LinearLayout items = new LinearLayout(this); items.setOrientation(LinearLayout.VERTICAL);
        sv.addView(items); box.addView(sv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        CardsService.Factory f = new CardsService.Factory(getApplicationContext(), ID);
        f.onDataSetChanged();
        for (int i = 0; i < f.getCount(); i++) items.addView(f.getViewAt(i).apply(this, items));
        if (f.getCount() == 0) { TextView t = new TextView(this); t.setText("Немає карток (дані ще не завантажено?)"); t.setTextColor(0xFFFFFFFF); items.addView(t); }
        Ui.insets(root, root.getPaddingLeft(), root.getPaddingTop(), root.getPaddingRight(), root.getPaddingBottom());
        setContentView(root);
        Log.i("SvitloPreview", "cards " + f.getCount() + " expanded " + Prefs.expanded(this, ID));
    }
}
