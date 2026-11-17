package ua.svitlo.widget;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Дані про черги з сервера (бот «Світло В Славутичі», /status.json) і їх кеш у пам'яті телефона. */
final class Data {
    static final String DEFAULT_URL = "https://svitlo-public.a-m-vasylets.workers.dev/status.json";
    static final String DEFAULT_SITE = "https://svitlo51.a-m-vasylets.workers.dev/";
    static final String DEFAULT_MAP = "https://desperadoav.github.io/Svitlo_in_Slavutych/";
    static final String[] DEFAULT_QUEUES = {"1.1", "2.1", "3.1", "3.2", "4.1", "6.1"};

    static final class Q {
        String name; int state; long since;        // state: 1 є світло, 0 немає, -1 немає даних
        int[][] today, tomorrow;                    // хвилини від початку доби; null — графіка немає
    }

    long now; int off = 120; String map = DEFAULT_MAP, site = DEFAULT_SITE;
    final List<Q> qs = new ArrayList<>();
    long fetchedAt; String error;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("svitlo", Context.MODE_PRIVATE); }
    static String url(Context c) { return prefs(c).getString("data_url", DEFAULT_URL); }

    static Data parse(String json) throws Exception {
        JSONObject o = new JSONObject(json);
        Data d = new Data();
        d.now = o.optLong("now", System.currentTimeMillis());
        d.off = o.optInt("kyiv_offset_min", 120);
        d.map = o.optString("map", DEFAULT_MAP);
        d.site = o.optString("site", DEFAULT_SITE);
        JSONArray a = o.getJSONArray("queues");
        for (int i = 0; i < a.length(); i++) {
            JSONObject x = a.getJSONObject(i);
            Q q = new Q();
            q.name = x.getString("name");
            String s = x.optString("state", "unknown");
            q.state = "on".equals(s) ? 1 : "off".equals(s) ? 0 : -1;
            q.since = x.isNull("since") ? 0 : x.optLong("since", 0);
            q.today = iv(x.optJSONArray("today"));
            q.tomorrow = iv(x.optJSONArray("tomorrow"));
            d.qs.add(q);
        }
        return d;
    }
    private static int[][] iv(JSONArray a) throws Exception {
        if (a == null) return null;
        int[][] r = new int[a.length()][2];
        for (int i = 0; i < a.length(); i++) { JSONArray p = a.getJSONArray(i); r[i][0] = min(p.getString(0)); r[i][1] = min(p.getString(1)); }
        return r;
    }
    private static int min(String s) { String[] p = s.split(":"); return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]); }

    /** Останні отримані дані (або null, якщо ще нічого не завантажували). */
    static Data cached(Context c) {
        SharedPreferences p = prefs(c);
        String j = p.getString("data", null);
        Data d = null;
        if (j != null) { try { d = parse(j); } catch (Exception ignored) { } }
        if (d != null) { d.fetchedAt = p.getLong("fetched", 0); d.error = p.getString("error", null); }
        return d;
    }

    /** Завантажити свіжі дані з сервера. Повертає true, якщо вдалося. */
    static boolean fetch(Context c) {
        Net.Res r = Net.get(c, url(c));
        SharedPreferences.Editor e = prefs(c).edit();
        boolean ok = false;
        if (r.ok && r.body != null) {
            try { parse(r.body); e.putString("data", r.body).putLong("fetched", System.currentTimeMillis()).remove("error"); ok = true; }
            catch (Exception x) { e.putString("error", "сервер надіслав незрозумілі дані"); }
        } else e.putString("error", r.msg);
        e.putLong("tried", System.currentTimeMillis()).apply();
        return ok;
    }

    // ---------- час за Києвом (зсув приходить із сервера — працює навіть на старих телефонах без нових часових поясів) ----------
    int kyivMin(long ms) { long m = ms / 60000 + off; return (int) (((m % 1440) + 1440) % 1440); }
    long kyivDay(long ms) { long m = ms / 60000 + off; return m >= 0 ? m / 1440 : (m - 1439) / 1440; }
    String hm(long ms) { return hm(kyivMin(ms)); }
    static String hm(int m) { if (m >= 1440) return "24:00"; return (m / 60 < 10 ? "0" : "") + (m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60); }
    String ddmm(long ms) {
        java.util.Calendar cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        cal.setTimeInMillis(ms + off * 60000L);
        int d = cal.get(java.util.Calendar.DAY_OF_MONTH), mo = cal.get(java.util.Calendar.MONTH) + 1;
        return (d < 10 ? "0" : "") + d + "." + (mo < 10 ? "0" : "") + mo;
    }
    /** Скільки діб минуло від моменту даних (після півночі «завтра» стає «сьогодні»). */
    int dayShift(long nowMs) { return (int) (kyivDay(nowMs) - kyivDay(now)); }

    static String list(int[][] iv) {
        if (iv == null) return "графіка ще немає";
        if (iv.length == 0) return "відключень немає";
        StringBuilder b = new StringBuilder();
        for (int[] x : iv) { if (b.length() > 0) b.append(", "); b.append(hm(x[0])).append("–").append(hm(x[1])); }
        return b.toString();
    }
}
