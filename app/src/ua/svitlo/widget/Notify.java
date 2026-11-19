package ua.svitlo.widget;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Сповіщення: вибрані черги → теми Firebase (як у бота: q_<черга> — світло зникло/з'явилось, w_<черга> — за 10 хв до відключення,
 * s_<черга> — з'явився чи змінився графік) і показ сповіщень на телефоні.
 */
final class Notify {
    private Notify() {}
    static final String CH_EVENTS = "events", CH_WARN = "warn", CH_SCHED = "sched", CH_NEWS = "news", TAG = "SvitloNotify";

    static String topic(String pre, String q) { return pre + q.replaceAll("[^A-Za-z0-9\\-_.~]", "_"); }

    // ---------- налаштування ----------
    static List<String> queues(Context c) {
        String s = Data.prefs(c).getString("nq", "");
        return s.isEmpty() ? new ArrayList<String>() : new ArrayList<>(Arrays.asList(s.split(",")));
    }
    static boolean warn(Context c) { return Data.prefs(c).getBoolean("nw", true); }
    static boolean sched(Context c) { return Data.prefs(c).getBoolean("nsc", true); }

    /** Чи працюють сповіщення на цьому телефоні: null — так, інакше — чому ні. */
    static String unavailable(Context c) {
        if (!BuildConfig.HAS_FCM) return "у цій збірці застосунку сповіщення ще не налаштовані";
        try { c.getPackageManager().getPackageInfo("com.google.android.gms", 0); }
        catch (Exception e) { return "на телефоні немає сервісів Google"; }
        try { if (FirebaseApp.getApps(c).isEmpty() && FirebaseApp.initializeApp(c) == null) return "на телефоні немає сервісів Google"; }
        catch (Exception e) { return "на телефоні немає сервісів Google"; }
        return null;
    }

    static void save(Context c, List<String> qs, boolean warn, boolean sched) {
        setPrefs(c, qs, warn, sched);
        apply(c);
    }
    /** Лише запам'ятати (без підписки в Firebase) — для тестів на емуляторі. */
    static void setPrefs(Context c, List<String> qs, boolean warn, boolean sched) {
        Data.prefs(c).edit().putString("nq", Prefs.join(qs)).putBoolean("nw", warn).putBoolean("nsc", sched).commit();
    }

    /** Підписатися на потрібні теми і відписатися від непотрібних (і ще раз — коли Firebase видав телефону новий ідентифікатор). */
    static void apply(Context c) {
        if (unavailable(c) != null) return;
        SharedPreferences p = Data.prefs(c);
        Set<String> want = new HashSet<>();
        want.add("news");                                                     // 📢 оголошення й 📲 нова версія — усім
        for (String q : queues(c)) { want.add(topic("q_", q)); if (warn(c)) want.add(topic("w_", q)); if (sched(c)) want.add(topic("s_", q)); }
        Set<String> had = new HashSet<>(p.getStringSet("ntopics", new HashSet<String>()));
        try {
            FirebaseMessaging fm = FirebaseMessaging.getInstance();
            for (String t : want) fm.subscribeToTopic(t);
            for (String t : had) if (!want.contains(t)) fm.unsubscribeFromTopic(t);
            p.edit().putStringSet("ntopics", want).apply();
            Log.i(TAG, "topics " + want);
        } catch (Exception e) { Log.w(TAG, "topics", e); }
    }

    /** Попросити сервер (бот для мешканців) надіслати пробне через Firebase на цей телефон. null — надіслано, інакше — чому ні. */
    static String pushTest(Context c, String token) {
        String base = Data.url(c).replaceAll("/(status\\.json|api/status)$", "");
        try {
            java.net.HttpURLConnection con = (java.net.HttpURLConnection) new java.net.URL(base + "/push-test").openConnection();
            con.setConnectTimeout(10000); con.setReadTimeout(15000); con.setDoOutput(true); con.setRequestMethod("POST");
            con.setRequestProperty("content-type", "application/json");
            con.getOutputStream().write(("{\"token\":\"" + token.replace("\"", "") + "\"}").getBytes("UTF-8"));
            int code = con.getResponseCode();
            if (code != 200) return "сервер відповів " + code;
            java.io.InputStream in = con.getInputStream(); java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            org.json.JSONObject j = new org.json.JSONObject(bo.toString("UTF-8"));
            return j.optBoolean("ok") ? null : j.optString("error", "невідома помилка");
        } catch (Exception e) { return "немає зв'язку з сервером"; }
    }

    // ---------- показ ----------
    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel a = new NotificationChannel(CH_EVENTS, "Світло зникло / з'явилось", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Коли у вибраних чергах зникає або з'являється світло");
        NotificationChannel b = new NotificationChannel(CH_WARN, "За 10 хв до відключення", NotificationManager.IMPORTANCE_HIGH);
        b.setDescription("Попередження перед плановим відключенням за графіком");
        NotificationChannel s = new NotificationChannel(CH_SCHED, "Графік відключень", NotificationManager.IMPORTANCE_DEFAULT);
        s.setDescription("Коли з'являється графік на завтра або графік змінюється");
        NotificationChannel n = new NotificationChannel(CH_NEWS, "Оголошення", NotificationManager.IMPORTANCE_HIGH);
        n.setDescription("Важливі повідомлення від «Світло В Славутичі»");
        nm.createNotificationChannel(a); nm.createNotificationChannel(b); nm.createNotificationChannel(s); nm.createNotificationChannel(n);
    }

    /** Повідомлення від сервера: показати, якщо людина його хоче (черга серед вибраних, вид не вимкнено). true — показано. */
    static boolean handle(Context c, String kind, String q, String title, String body) {
        if (title == null) return false;
        String why = q != null && !q.isEmpty() && !queues(c).contains(q) ? "черга не вибрана"                // відписались, а повідомлення ще йшло
            : "warn".equals(kind) && !warn(c) ? "попередження вимкнено" : "sched".equals(kind) && !sched(c) ? "графік вимкнено" : null;
        if (why != null) { Log.i(TAG, "skip " + kind + " " + q + ": " + why); return false; }
        show(c, kind, q == null ? "" : q, title, body == null ? "" : body);
        return true;
    }

    @SuppressWarnings("deprecation")
    static void show(Context c, String kind, String q, String title, String body) {
        channels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        boolean w = "warn".equals(kind), s = "sched".equals(kind), nw = "news".equals(kind);
        int color = w || nw ? 0xFFF39C12 : s ? 0xFF3498DB : "lost".equals(kind) ? 0xFFE74C3C : 0xFF2ECC71;
        Intent open = s ? new Intent(c, CompareActivity.class).putExtra("queues", q).putExtra("day", title.contains("завтра") ? 1 : 0)   // графік — одразу на екран графіка/перетинів
                        : new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, s ? 2 : 1, open, PendingIntent.FLAG_UPDATE_CURRENT | CardsWidget.immutable());
        Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, w ? CH_WARN : s ? CH_SCHED : nw ? CH_NEWS : CH_EVENTS) : new Notification.Builder(c);
        nb.setSmallIcon(R.drawable.ic_stat).setColor(color).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pi)
            .setWhen(System.currentTimeMillis()).setShowWhen(true).setCategory(Notification.CATEGORY_EVENT);
        if (Build.VERSION.SDK_INT < 26) nb.setPriority(s ? Notification.PRIORITY_DEFAULT : Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        nm.notify(("svitlo:" + q + ":" + (w ? "w" : s ? "s" : nw ? "n" : "e")).hashCode(), nb.build());   // одна черга — одне сповіщення кожного виду (нове замінює старе)
        Log.i(TAG, "shown " + kind + " " + q + " | " + title);
    }
}
