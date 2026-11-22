package ua.svitlo.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/**
 * Смужка графіка на добу: жовте — світло є, сірі відрізки — планові відключення (графіка немає — темна смужка), біла риска — «зараз»,
 * під смужкою — риски щогодини (біля 0·6·12·18·24 — довші) і години 0·6·12·18·24.
 * Малюється в розмір, у якому її покаже віджет (ширина картки × 18 dp), — щоб цифри не розтягувались і не розмивались.
 */
final class Bars {
    private Bars() {}
    static final int H_DP = 18;
    static final int YELLOW = 0xFFE3B81F, GREY = 0xFF5E6B78;      // світло є / відключення — як на сайті

    /** wDp — ширина смужки в dp, dens — щільність екрана. */
    static Bitmap draw(int[][] iv, int nowMin, float wDp, float dens) {
        int W = Math.max(200, Math.min(1400, Math.round(wDp * dens))), H = Math.max(24, Math.round(H_DP * dens));
        float d = H / (float) H_DP;                                   // пікселів на dp у самій картинці
        Bitmap b = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float top = 1f * d, bh = 6f * d, r = bh / 2;
        RectF track = new RectF(0, top, W, top + bh);
        p.setColor(iv != null ? YELLOW : 0xFF2B3A48);                // графік відомий — увесь день жовтий (світло), інакше — нейтральна
        c.drawRoundRect(track, r, r, p);
        c.save();
        Path clip = new Path(); clip.addRoundRect(track, r, r, Path.Direction.CW); c.clipPath(clip);
        if (iv != null) {
            p.setColor(GREY);
            for (int[] x : iv) c.drawRect(x[0] * W / 1440f, top, Math.min(1440, x[1]) * W / 1440f, top + bh, p);
        }
        p.setColor(iv != null ? 0x38000000 : 0x44FFFFFF);             // ледь помітні позначки 6, 12, 18
        for (int h = 6; h < 24; h += 6) c.drawRect(h * W / 24f - 0.5f * d, top, h * W / 24f + 0.5f * d, top + bh, p);
        c.restore();
        p.setColor(0xFF8B9BB4);                                       // риски годин: щогодини коротка, біля підписів — довша
        float ty = top + bh + 0.4f * d;
        for (int h = 0; h <= 24; h++) {
            boolean big = h % 6 == 0; float tw = (big ? 1.1f : 0.8f) * d, x = Math.max(tw / 2, Math.min(W - tw / 2, h * W / 24f));
            p.setAlpha(big ? 255 : 150);
            c.drawRect(x - tw / 2, ty, x + tw / 2, ty + (big ? 2.3f : 1.6f) * d, p);   // не торкаються цифр
        }
        p.setAlpha(255);
        if (nowMin >= 0) {                                            // «зараз»: біла риска з темною облямівкою — видно і на жовтому, і на сірому
            float x = nowMin * W / 1440f;
            p.setColor(0xFF17212B); c.drawRoundRect(new RectF(x - 2.3f * d, 0, x + 2.3f * d, top + bh + 1.9f * d), 1.4f * d, 1.4f * d, p);
            p.setColor(0xFFFFFFFF); c.drawRoundRect(new RectF(x - 1.3f * d, 0.4f * d, x + 1.3f * d, top + bh + 1.3f * d), d, d, p);
        }
        p.setColor(0xFF8B9BB4); p.setTextSize(9f * d);
        for (int h = 0; h <= 24; h += 6) {                            // 0 — з лівого краю, 24 — з правого, решта — по центру позначки
            String t = String.valueOf(h);
            float tw = p.measureText(t), x = h * W / 24f - tw / 2;
            c.drawText(t, Math.max(0, Math.min(W - tw, x)), H - 0.8f * d, p);
        }
        return b;
    }
}
