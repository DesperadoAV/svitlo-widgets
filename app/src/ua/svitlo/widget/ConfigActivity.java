package ua.svitlo.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** Вибір черг для віджета: відкривається, коли віджет додають на робочий стіл, і з кнопки ⚙ на віджеті. */
public class ConfigActivity extends Activity {
    int id = AppWidgetManager.INVALID_APPWIDGET_ID;
    LinearLayout list; final List<CheckBox> boxes = new ArrayList<>(); TextView note;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setResult(RESULT_CANCELED);
        id = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        ScrollView sv = new ScrollView(this); sv.setBackgroundColor(Ui.BG);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 16); root.setPadding(p, p, p, p);
        sv.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        Ui.text(this, root, "💡 Світло В Славутичі", 22, Ui.ACCENT, true);
        Ui.text(this, root, "Які черги показувати у віджеті?", 17, Ui.TEXT, false).setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 6));
        list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); root.addView(list);
        note = Ui.text(this, root, "", 13, Ui.HINT, false);
        LinearLayout row = new LinearLayout(this); root.addView(row);
        Ui.button(this, row, "Усі", 0xFF3A3A3A, 1).setOnClickListener(v -> { for (CheckBox x : boxes) x.setChecked(true); });
        Ui.button(this, row, "Зберегти", 0xFF2980B9, 2).setOnClickListener(v -> save());
        Ui.text(this, root, "Порада: на віджеті натисніть на чергу — розкриється графік на сьогодні й завтра. Розмір віджета можна змінити, затиснувши його пальцем.", 13, Ui.HINT, false).setPadding(0, Ui.dp(this, 12), 0, 0);
        setContentView(sv);
        fill(Data.cached(this));
        if (Data.cached(this) == null) new Thread(() -> { Data.fetch(this); runOnUiThread(() -> fill(Data.cached(this))); }).start();
    }

    void fill(Data d) {
        list.removeAllViews(); boxes.clear();
        List<String> names = new ArrayList<>();
        if (d != null) for (Data.Q q : d.qs) names.add(q.name);
        else for (String s : Data.DEFAULT_QUEUES) names.add(s);
        note.setText(d == null ? "Список черг — стандартний (немає зв'язку з сервером)." : "");
        List<String> sel = Prefs.selected(this, id);
        for (String n : names) {
            CheckBox cb = new CheckBox(this); cb.setText("Черга " + n); cb.setTag(n); cb.setTextSize(18); cb.setTextColor(Ui.TEXT);
            cb.setChecked(sel == null || sel.contains(n));
            int pad = Ui.dp(this, 6); cb.setPadding(pad, pad, pad, pad);
            list.addView(cb); boxes.add(cb);
        }
    }

    void save() {
        List<String> sel = new ArrayList<>();
        for (CheckBox x : boxes) if (x.isChecked()) sel.add((String) x.getTag());
        if (sel.isEmpty()) { note.setText("Виберіть хоча б одну чергу."); return; }
        Prefs.setSelected(this, id, sel.size() == boxes.size() ? null : sel);
        CardsWidget.updateAll(this);
        if (Data.cached(this) == null) CardsWidget.fetchAsync(this, null);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id));
        finish();
    }
}
