package ua.svitlo.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

/** Смужка графіка відключень на добу (як на сайті): помаранчеві відрізки — планові відключення, біла риска — «зараз», підписи 0–6–12–18–24. */
final class Bars {
    private Bars() {}
    static final int W = 480, H = 32;

    static Bitmap draw(int[][] iv, int nowMin) {
        Bitmap b = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float top = 2, bh = 12, r = 6;
        p.setColor(0xFF2B3A48);
        c.drawRoundRect(new RectF(0, top, W, top + bh), r, r, p);
        if (iv != null) {
            p.setColor(0xFFE8A33D);
            c.save();
            android.graphics.Path clip = new android.graphics.Path();
            clip.addRoundRect(new RectF(0, top, W, top + bh), r, r, android.graphics.Path.Direction.CW);
            c.clipPath(clip);
            for (int[] x : iv) c.drawRect(x[0] * W / 1440f, top, Math.min(1440, x[1]) * W / 1440f, top + bh, p);
            c.restore();
        }
        if (nowMin >= 0) { p.setColor(0xFFFFFFFF); c.drawRect(nowMin * W / 1440f - 2, 0, nowMin * W / 1440f + 2, top + bh + 2, p); }
        p.setColor(0xFF8B9BB4); p.setTextSize(13);
        for (int h = 0; h <= 24; h += 6) {
            String t = String.valueOf(h);
            float x = h * W / 24f, w = p.measureText(t);
            c.drawText(t, Math.max(0, Math.min(W - w, x - w / 2)), H - 2, p);
        }
        return b;
    }
}
