package ua.svitlo.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/** Тонка смужка графіка на добу: помаранчеві відрізки — планові відключення, біла риска — «зараз», ледь помітні позначки 6–12–18. */
final class Bars {
    private Bars() {}
    static final int W = 480, H = 16;

    static Bitmap draw(int[][] iv, int nowMin) {
        Bitmap b = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float top = 3, bh = 10, r = 5;
        RectF track = new RectF(0, top, W, top + bh);
        p.setColor(0xFF2B3A48);
        c.drawRoundRect(track, r, r, p);
        c.save();
        Path clip = new Path(); clip.addRoundRect(track, r, r, Path.Direction.CW); c.clipPath(clip);
        if (iv != null) {
            p.setColor(0xFFE8A33D);
            for (int[] x : iv) c.drawRect(x[0] * W / 1440f, top, Math.min(1440, x[1]) * W / 1440f, top + bh, p);
        }
        p.setColor(0x55FFFFFF);                                       // позначки 6, 12, 18 год
        for (int h = 6; h < 24; h += 6) c.drawRect(h * W / 24f - 1, top, h * W / 24f + 1, top + bh, p);
        c.restore();
        if (nowMin >= 0) { p.setColor(0xFFFFFFFF); float x = nowMin * W / 1440f; c.drawRoundRect(new RectF(x - 3, 0, x + 3, H), 3, 3, p); }
        return b;
    }
}
