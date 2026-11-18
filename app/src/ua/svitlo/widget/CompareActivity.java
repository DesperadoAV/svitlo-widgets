package ua.svitlo.widget;

import android.app.Activity;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TreeSet;

/**
 * 🗓 Перетини (як в адмін-боті): кілька черг одна під одною — смужки графіка на добу, а нижче — відрізки дня:
 * де світло є всюди, де ніде, і в яких чергах немає. Вибір черг запам'ятовується.
 * Для тестів: --es queues 3.2,6.1 --ei day 0|1.
 */
public class CompareActivity extends Activity {
    static final String TAG = "SvitloCompare";
    LinearLayout qgrid, out; Button bToday, bTomorrow;
    final List<String> sel = new ArrayList<>(); int day;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView sv = new ScrollView(this); sv.setBackgroundColor(Ui.BG);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 12); Ui.insets(sv, 0, 0, 0, 0); root.setPadding(p, p, p, p);
        sv.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        Ui.text(this, root, "🗓 Перетини", 22, Ui.ACCENT, true).setPadding(Ui.dp(this, 4), 0, 0, 0);
        Ui.text(this, root, "Позначте черги — побачите, коли де є світло, а де немає.", 15, Ui.TEXT, false).setPadding(Ui.dp(this, 4), Ui.dp(this, 6), 0, Ui.dp(this, 4));
        qgrid = new LinearLayout(this); qgrid.setOrientation(LinearLayout.VERTICAL); root.addView(qgrid);
        LinearLayout days = new LinearLayout(this); root.addView(days);
        bToday = Ui.button(this, days, "Сьогодні", 0xFF3A3A3A, 1);
        bTomorrow = Ui.button(this, days, "Завтра", 0xFF3A3A3A, 1);
        bToday.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { day = 0; render(); } });
        bTomorrow.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { day = 1; render(); } });
        out = new LinearLayout(this); out.setOrientation(LinearLayout.VERTICAL); root.addView(out);
        setContentView(sv);

        String qs = getIntent().getStringExtra("queues");
        if (qs == null || qs.isEmpty()) qs = Data.prefs(this).getString("cmp_q", null);
        if (qs == null || qs.isEmpty()) qs = Prefs.join(Notify.queues(this));
        if (!qs.isEmpty()) sel.addAll(Arrays.asList(qs.split(",")));
        day = getIntent().getIntExtra("day", 0);
        render();
        if (Data.cached(this) == null) CardsWidget.fetchAsync(this, null);
    }

    static int[][] dayList(Data d, Data.Q q, int day) {           // після півночі «завтра» з даних стає «сьогодні»
        int sh = d.dayShift(System.currentTimeMillis()), k = day + sh;
        return k == 0 ? q.today : k == 1 ? q.tomorrow : null;
    }

    void render() {
        Data d = Data.cached(this);
        qgrid.removeAllViews(); out.removeAllViews();
        if (d == null) { Ui.text(this, out, "Ще немає даних. Перевірте інтернет і відкрийте цей екран ще раз.", 15, Ui.HINT, false); return; }
        List<String> names = new ArrayList<>(); for (Data.Q q : d.qs) names.add(q.name);
        sel.retainAll(names);
        LinearLayout row = null;                                     // черги кнопками по 3 в ряд: синя — вибрана
        for (int i = 0; i < names.size(); i++) {
            if (i % 3 == 0) { row = new LinearLayout(this); qgrid.addView(row); }
            final String n = names.get(i); boolean on = sel.contains(n);
            Button bt = Ui.button(this, row, (on ? "✓ " : "") + n, on ? 0xFF2980B9 : 0xFF2E2E2E, 1);
            bt.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) {
                if (sel.contains(n)) sel.remove(n); else sel.add(n);
                Data.prefs(CompareActivity.this).edit().putString("cmp_q", Prefs.join(sel)).apply();
                render();
            } });
        }
        if (row != null) for (int k = names.size() % 3; k > 0 && k < 3; k++) { View sp = new View(this); row.addView(sp, new LinearLayout.LayoutParams(0, 1, 1)); }
        long now = System.currentTimeMillis();
        paint(bToday, "Сьогодні " + d.ddmm(now), day == 0); paint(bTomorrow, "Завтра " + d.ddmm(now + 86400000L), day == 1);

        List<Data.Q> qs = new ArrayList<>();
        for (String n : names) if (sel.isEmpty() || sel.contains(n)) for (Data.Q q : d.qs) if (q.name.equals(n)) qs.add(q);
        if (sel.isEmpty()) Ui.text(this, out, "Нічого не вибрано — показую всі черги.", 13, Ui.HINT, false).setPadding(Ui.dp(this, 4), Ui.dp(this, 4), 0, 0);

        // смужки графіка — одна під одною, щоб було видно, де відключення збігаються
        LinearLayout card = card(out);
        float dens = getResources().getDisplayMetrics().density;
        float barW = getResources().getDisplayMetrics().widthPixels / dens - 110;   // ширина екрана мінус відступи й підпис черги
        int nowMin = day == 0 ? d.kyivMin(now) : -1;
        List<Data.Q> known = new ArrayList<>(); List<String> miss = new ArrayList<>();
        for (Data.Q q : qs) {
            int[][] iv = dayList(d, q, day);
            LinearLayout r = new LinearLayout(this); r.setGravity(Gravity.CENTER_VERTICAL); r.setPadding(0, Ui.dp(this, 3), 0, Ui.dp(this, 3));
            TextView l = new TextView(this); l.setText(q.name); l.setTextColor(Ui.TEXT); l.setTextSize(15); l.setTypeface(Typeface.DEFAULT_BOLD);
            r.addView(l, new LinearLayout.LayoutParams(Ui.dp(this, 56), ViewGroup.LayoutParams.WRAP_CONTENT));
            if (iv == null) {
                TextView t = new TextView(this); t.setText("графіка ще немає"); t.setTextColor(Ui.HINT); t.setTextSize(14);
                r.addView(t); miss.add(q.name);
            } else {
                ImageView im = new ImageView(this); im.setImageBitmap(Bars.draw(iv, nowMin, barW, dens)); im.setAdjustViewBounds(true);
                r.addView(im, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                known.add(q);
            }
            card.addView(r);
        }

        // відрізки дня, де в кожній черзі стан той самий (точно до хвилини)
        int segs = 0, allOff = 0;
        if (known.isEmpty()) Ui.text(this, out, "Графіка на цей день ще немає.", 15, Ui.HINT, false).setPadding(Ui.dp(this, 4), Ui.dp(this, 10), 0, 0);
        else {
            TreeSet<Integer> pts = new TreeSet<>(Arrays.asList(0, 1440));
            for (Data.Q q : known) for (int[] x : dayList(d, q, day)) { pts.add(Math.max(0, Math.min(1440, x[0]))); pts.add(Math.max(0, Math.min(1440, x[1]))); }
            Integer[] P = pts.toArray(new Integer[0]);
            String prev = null; int a = 0;
            LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); list.setPadding(Ui.dp(this, 4), Ui.dp(this, 6), Ui.dp(this, 4), 0); out.addView(list);
            for (int i = 0; i + 1 < P.length; i++) {
                String sig = sig(d, known, P[i]);
                if (prev != null && !sig.equals(prev)) { allOff += seg(list, known, a, P[i], prev); segs++; a = P[i]; }
                if (prev == null) a = P[i];
                prev = sig;
            }
            allOff += seg(list, known, a, 1440, prev); segs++;
        }
        if (!miss.isEmpty() && !known.isEmpty()) Ui.text(this, out, "Без графіка: " + Prefs.join(miss).replace(",", ", "), 13, Ui.HINT, false).setPadding(Ui.dp(this, 4), Ui.dp(this, 6), 0, 0);
        List<String> qn = new ArrayList<>(); for (Data.Q q : qs) qn.add(q.name);
        android.util.Log.i(TAG, "compare d" + day + " " + qn + " segs " + segs + " alloff " + allOff + " known " + known.size());
    }

    String sig(Data d, List<Data.Q> known, int m) {
        StringBuilder b = new StringBuilder();
        for (Data.Q q : known) { boolean off = false; for (int[] x : dayList(d, q, day)) if (x[0] <= m && m < x[1]) off = true; b.append(off ? '1' : '0'); }
        return b.toString();
    }
    /** Один відрізок дня: час і хто без світла. Повертає 1, якщо світла немає ніде. */
    int seg(LinearLayout list, List<Data.Q> known, int a, int b, String sig) {
        List<String> off = new ArrayList<>(), on = new ArrayList<>();
        for (int i = 0; i < known.size(); i++) (sig.charAt(i) == '1' ? off : on).add(known.get(i).name);
        SpannableStringBuilder s = new SpannableStringBuilder();
        String t = Data.hm(a) + " – " + Data.hm(b);
        s.append(t); s.setSpan(new StyleSpan(Typeface.BOLD), 0, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        int bg;
        if (off.isEmpty()) { add(s, "\n🟡 Світло є всюди", 0xFFFFD866); bg = 0xFF1F2A1C; }
        else if (on.isEmpty()) { add(s, "\n⚫ Відключено: " + join(off), 0xFFE8A33D); if (known.size() > 1) add(s, "\n⚠️ Немає світла ніде", 0xFFFF7B6B); bg = 0xFF2E1F1F; }
        else { add(s, "\n⚫ Відключено: " + join(off), 0xFFE8A33D); add(s, "\n🟡 Світло є: " + join(on), 0xFFFFD866); bg = 0xFF262626; }
        TextView tv = new TextView(this); tv.setText(s); tv.setTextSize(15); tv.setTextColor(Ui.TEXT); tv.setLineSpacing(0, 1.1f);
        GradientDrawable g = new GradientDrawable(); g.setColor(bg); g.setCornerRadius(Ui.dp(this, 8)); tv.setBackgroundDrawable(g);
        int p = Ui.dp(this, 10); tv.setPadding(p, Ui.dp(this, 7), p, Ui.dp(this, 7));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, Ui.dp(this, 3), 0, Ui.dp(this, 3));
        list.addView(tv, lp);
        return on.isEmpty() && known.size() > 1 ? 1 : 0;
    }
    static void add(SpannableStringBuilder s, String t, int color) { int st = s.length(); s.append(t); s.setSpan(new ForegroundColorSpan(color), st, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE); }
    static String join(List<String> l) { return Prefs.join(l).replace(",", ", "); }

    LinearLayout card(LinearLayout parent) {
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable g = new GradientDrawable(); g.setColor(Ui.CARD); g.setCornerRadius(Ui.dp(this, 12)); c.setBackgroundDrawable(g);
        int p = Ui.dp(this, 10); c.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(Ui.dp(this, 4), Ui.dp(this, 8), Ui.dp(this, 4), 0);
        parent.addView(c, lp);
        return c;
    }
    void paint(Button b, String t, boolean on) {
        b.setText((on ? "✓ " : "") + t);
        GradientDrawable g = new GradientDrawable(); g.setColor(on ? 0xFFF39C12 : 0xFF3A3A3A); g.setCornerRadius(Ui.dp(this, 10)); b.setBackgroundDrawable(g);
        b.setTextColor(on ? 0xFF1A1A1A : 0xFFFFFFFF);
    }
}
