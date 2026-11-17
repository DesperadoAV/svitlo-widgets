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
 * Сповіщення: вибрані черги → теми Firebase (як у бота: q_<черга> — світло зникло/з'явилось, w_<черга> — за 10 хв до відключення)
 * і показ сповіщень на телефоні.
 */
final class Notify {
    private Notify() {}
    static final String CH_EVENTS = "events", CH_WARN = "warn", TAG = "SvitloNotify";

    static String topic(boolean warn, String q) { return (warn ? "w_" : "q_") + q.replaceAll("[^A-Za-z0-9\\-_.~]", "_"); }

    // ---------- налаштування ----------
    static List<String> queues(Context c) {
        String s = Data.prefs(c).getString("nq", "");
        return s.isEmpty() ? new ArrayList<String>() : new ArrayList<>(Arrays.asList(s.split(",")));
    }
    static boolean warn(Context c) { return Data.prefs(c).getBoolean("nw", true); }

    /** Чи працюють сповіщення на цьому телефоні: null — так, інакше — чому ні. */
    static String unavailable(Context c) {
        if (!BuildConfig.HAS_FCM) return "у цій збірці застосунку сповіщення ще не налаштовані";
        try { c.getPackageManager().getPackageInfo("com.google.android.gms", 0); }
        catch (Exception e) { return "на телефоні немає сервісів Google"; }
        try { if (FirebaseApp.getApps(c).isEmpty() && FirebaseApp.initializeApp(c) == null) return "на телефоні немає сервісів Google"; }
        catch (Exception e) { return "на телефоні немає сервісів Google"; }
        return null;
    }

    static void save(Context c, List<String> qs, boolean warn) {
        Data.prefs(c).edit().putString("nq", Prefs.join(qs)).putBoolean("nw", warn).apply();
        apply(c);
    }

    /** Підписатися на потрібні теми і відписатися від непотрібних (і ще раз — коли Firebase видав телефону новий ідентифікатор). */
    static void apply(Context c) {
        if (unavailable(c) != null) return;
        SharedPreferences p = Data.prefs(c);
        Set<String> want = new HashSet<>();
        for (String q : queues(c)) { want.add(topic(false, q)); if (warn(c)) want.add(topic(true, q)); }
        Set<String> had = new HashSet<>(p.getStringSet("ntopics", new HashSet<String>()));
        try {
            FirebaseMessaging fm = FirebaseMessaging.getInstance();
            for (String t : want) fm.subscribeToTopic(t);
            for (String t : had) if (!want.contains(t)) fm.unsubscribeFromTopic(t);
            p.edit().putStringSet("ntopics", want).apply();
            Log.i(TAG, "topics " + want);
        } catch (Exception e) { Log.w(TAG, "topics", e); }
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
        nm.createNotificationChannel(a); nm.createNotificationChannel(b);
    }

    @SuppressWarnings("deprecation")
    static void show(Context c, String kind, String q, String title, String body) {
        channels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        boolean w = "warn".equals(kind);
        int color = w ? 0xFFF39C12 : "lost".equals(kind) ? 0xFFE74C3C : 0xFF2ECC71;
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | CardsWidget.immutable());
        Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, w ? CH_WARN : CH_EVENTS) : new Notification.Builder(c);
        nb.setSmallIcon(R.drawable.ic_stat).setColor(color).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pi)
            .setWhen(System.currentTimeMillis()).setShowWhen(true).setCategory(Notification.CATEGORY_EVENT);
        if (Build.VERSION.SDK_INT < 26) nb.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        nm.notify(("svitlo:" + q + ":" + (w ? "w" : "e")).hashCode(), nb.build());   // одна черга — одне сповіщення кожного виду (нове замінює старе)
        Log.i(TAG, "shown " + kind + " " + q + " | " + title);
    }
}
