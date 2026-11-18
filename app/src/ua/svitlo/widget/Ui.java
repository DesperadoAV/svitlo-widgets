package ua.svitlo.widget;

import android.app.Activity;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Дрібні помічники для екранів (без бібліотек — працює й на Android 4.4). */
final class Ui {
    private Ui() {}
    static final int BG = 0xFF121212, CARD = 0xFF1E1E1E, ACCENT = 0xFFF39C12, TEXT = 0xFFE8E8E8, HINT = 0xFF9A9A9A;
    /** Android 15+: вікно на весь екран — додаємо до відступів висоту рядка стану й кнопок унизу (на старих Android вони 0). */
    static void insets(android.view.View v, final int l, final int t, final int r, final int b) {
        v.setPadding(l, t, r, b);
        if (android.os.Build.VERSION.SDK_INT < 20) return;
        v.setOnApplyWindowInsetsListener(new android.view.View.OnApplyWindowInsetsListener() {
            @Override public android.view.WindowInsets onApplyWindowInsets(android.view.View x, android.view.WindowInsets in) {
                x.setPadding(l + in.getSystemWindowInsetLeft(), t + in.getSystemWindowInsetTop(), r + in.getSystemWindowInsetRight(), b + in.getSystemWindowInsetBottom());
                return in.consumeSystemWindowInsets();
            }
        });
    }
    /** Текст кнопки — в один рядок: не влазить — шрифт дрібнішає (до 9 sp), а не обрізається. Працює на всіх Android. */
    static void fit(final TextView b, final float sp) {
        b.setMaxLines(1); b.setTextSize(sp);
        b.post(new Runnable() { @Override public void run() {
            float w = b.getWidth() - b.getPaddingLeft() - b.getPaddingRight(), dens = b.getResources().getDisplayMetrics().scaledDensity;
            if (w <= 0) return;
            android.text.TextPaint p = new android.text.TextPaint(b.getPaint());
            float s = sp;
            for (; s > 9; s -= 0.5f) { p.setTextSize(s * dens); if (p.measureText(b.getText().toString()) <= w) break; }
            if (s != sp) b.setTextSize(s);
        } });
    }
    static int dp(Activity a, float v) { return Math.round(v * a.getResources().getDisplayMetrics().density); }
    static TextView text(Activity a, ViewGroup parent, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(a); t.setText(s); t.setTextSize(sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        parent.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return t;
    }
    static Button button(Activity a, ViewGroup parent, String s, int color, float weight) {
        Button b = new Button(a); b.setText(s); b.setTextColor(0xFFFFFFFF); b.setTextSize(15); b.setAllCaps(false); b.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(dp(a, 10)); b.setBackgroundDrawable(g);
        int p = dp(a, 10); b.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = weight > 0 ? new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight) : new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(a, 4), dp(a, 4), dp(a, 4), dp(a, 4));
        parent.addView(b, lp);
        return b;
    }
}
