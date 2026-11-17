package ua.svitlo.widget;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** 🔔 Сповіщення: вибір черг і попередження за 10 хв. Для тестів: --ez test_notify true — показати пробне сповіщення. */
public class NotifyActivity extends Activity {
    LinearLayout list; final List<CheckBox> boxes = new ArrayList<>(); CheckBox warn; TextView note;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView sv = new ScrollView(this); sv.setBackgroundColor(Ui.BG); Ui.insets(sv, 0, 0, 0, 0);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 16); root.setPadding(p, p, p, p);
        sv.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        Ui.text(this, root, "🔔 Сповіщення", 22, Ui.ACCENT, true);
        Ui.text(this, root, "Позначте свої черги — телефон повідомить, коли світло зникне чи з'явиться.", 15, Ui.TEXT, false).setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 6));
        String why = Notify.unavailable(this);
        android.util.Log.i(Notify.TAG, "fcm " + (why == null ? "ok" : why));
        if (why != null) Ui.text(this, root, "⚠️ Сповіщення на цьому телефоні не працюватимуть: " + why + ". Скористайтеся ботом у Telegram: @svitlo_in_slavutych_bot → /notify.", 14, 0xFFFF9F43, false).setPadding(0, 0, 0, Ui.dp(this, 8));
        list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); root.addView(list);
        warn = new CheckBox(this); warn.setText("⏰ Попереджати за 10 хв до планового відключення"); warn.setTextSize(16); warn.setTextColor(Ui.TEXT);
        warn.setChecked(Notify.warn(this)); warn.setPadding(Ui.dp(this, 6), Ui.dp(this, 10), 0, Ui.dp(this, 6)); root.addView(warn);
        note = Ui.text(this, root, "", 13, Ui.HINT, false);
        LinearLayout row = new LinearLayout(this); root.addView(row);
        Ui.button(this, row, "Пробне", 0xFF3A3A3A, 1).setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { test(); } });
        Ui.button(this, row, "Зберегти", 0xFF2980B9, 2).setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { save(); } });
        Ui.text(this, root, "«Пробне» — показати, як виглядатиме сповіщення. Сповіщення надходять миттєво, навіть коли застосунок закритий.", 13, Ui.HINT, false).setPadding(0, Ui.dp(this, 12), 0, 0);
        setContentView(sv);
        fill();
        if (getIntent().getBooleanExtra("test_notify", false)) test();
    }

    void fill() {
        list.removeAllViews(); boxes.clear();
        Data d = Data.cached(this);
        List<String> names = new ArrayList<>();
        if (d != null) for (Data.Q q : d.qs) names.add(q.name); else for (String s : Data.DEFAULT_QUEUES) names.add(s);
        List<String> sel = Notify.queues(this);
        for (String n : names) {
            CheckBox cb = new CheckBox(this); cb.setText("Черга " + n); cb.setTag(n); cb.setTextSize(18); cb.setTextColor(Ui.TEXT);
            cb.setChecked(sel.contains(n));
            int pad = Ui.dp(this, 6); cb.setPadding(pad, pad, pad, pad);
            list.addView(cb); boxes.add(cb);
        }
    }

    boolean askPermission() {                                       // Android 13+: дозвіл показувати сповіщення
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 5);
            return false;
        }
        return true;
    }

    void save() {
        List<String> sel = new ArrayList<>();
        for (CheckBox x : boxes) if (x.isChecked()) sel.add((String) x.getTag());
        Notify.save(this, sel, warn.isChecked());
        if (!sel.isEmpty()) askPermission();
        String msg = sel.isEmpty() ? "Сповіщення вимкнено" : "Сповіщення: черга " + Prefs.join(sel).replace(",", ", ");
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        note.setText(msg);
        if (sel.isEmpty() || Build.VERSION.SDK_INT < 33 || checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) finish();
    }

    void test() {
        askPermission();
        List<String> sel = Notify.queues(this);
        String q = sel.isEmpty() ? "3.2" : sel.get(0);
        Notify.show(this, "warn", q, "⏰ Черга " + q + ": за 10 хв відключення", "Так виглядатиме сповіщення (це перевірка)");
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (res.length > 0 && res[0] != PackageManager.PERMISSION_GRANTED) note.setText("Без дозволу на сповіщення телефон їх не покаже. Дозвольте в налаштуваннях телефона → Застосунки → Світло В Славутичі → Сповіщення.");
        else if (!Notify.queues(this).isEmpty()) finish();
    }
}
