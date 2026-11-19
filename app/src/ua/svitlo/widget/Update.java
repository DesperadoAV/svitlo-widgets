package ua.svitlo.widget;

import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 📲 Самооновлення: опис останньої версії лежить на GitHub (latest.json — його пише збірка, коли всі тести пройшли).
 * Новіша за цю — смужка «Доступна нова версія» на головному екрані і сповіщення; «Оновити» — завантажити й відкрити встановлення.
 */
final class Update {
    private Update() {}
    static final String LATEST = "https://raw.githubusercontent.com/DesperadoAV/svitlo-widgets/app-build/latest.json", TAG = "SvitloUpdate", CH = "update";

    static final class Info { int code; String name, url, notes; }

    static String latestUrl(Context c) { return Data.prefs(c).getString("update_url", LATEST); }   // для тестів — тестовий сервер

    /** Відома новіша версія (з минулої перевірки чи з push) — або null. */
    static Info known(Context c) {
        SharedPreferences p = Data.prefs(c);
        int code = p.getInt("upd_code", 0);
        if (code <= BuildConfig.VERSION_CODE) return null;
        Info i = new Info(); i.code = code; i.name = p.getString("upd_name", ""); i.url = p.getString("upd_url", ""); i.notes = p.getString("upd_notes", "");
        return i.url.startsWith("https://") || i.url.startsWith("http://10.0.2.2") ? i : null;
    }
    static void remember(Context c, int code, String name, String url, String notes) {
        Data.prefs(c).edit().putInt("upd_code", code).putString("upd_name", name == null ? "" : name).putString("upd_url", url == null ? "" : url)
            .putString("upd_notes", notes == null ? "" : notes).apply();
    }

    /** Перевірити на GitHub (не частіше ніж раз на 6 год, якщо не force). Лише з фонового потоку. Повертає новішу версію або null. */
    static Info check(Context c, boolean force) {
        SharedPreferences p = Data.prefs(c);
        long now = System.currentTimeMillis();
        if (!force && now - p.getLong("upd_checked", 0) < 6 * 3600000L) return known(c);
        try {
            HttpURLConnection con = (HttpURLConnection) new URL(latestUrl(c) + "?t=" + now / 60000).openConnection();
            con.setConnectTimeout(10000); con.setReadTimeout(15000); con.setUseCaches(false);
            if (con.getResponseCode() != 200) return known(c);
            InputStream in = con.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[4096]; int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            JSONObject j = new JSONObject(bo.toString("UTF-8"));
            p.edit().putLong("upd_checked", now).apply();
            int code = j.optInt("code", 0);
            if (code > 0) remember(c, code, j.optString("name"), j.optString("url"), j.optString("notes"));
            Info i = known(c);
            Log.i(TAG, i != null ? "update available " + i.name + " (" + i.code + ")" : "up to date " + BuildConfig.VERSION_NAME);
            return i;
        } catch (Exception e) { Log.w(TAG, "check: " + e); return known(c); }
    }

    /** Push «нова версія» (від бота для мешканців): лише якщо вона справді новіша — запам'ятати і показати сповіщення. */
    static void onPush(Context c, String code, String name, String url) {
        int k; try { k = Integer.parseInt(code); } catch (Exception e) { return; }
        if (k <= BuildConfig.VERSION_CODE) { Log.i(TAG, "push: already " + BuildConfig.VERSION_NAME); return; }
        remember(c, k, name, url, "");
        notifyNew(c, known(c));
    }

    static void notifyNew(Context c, Info i) {
        if (i == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CH, "Нова версія застосунку", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Коли виходить нова версія «Світло В Славутичі»"); nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).putExtra("update", true).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 7, open, PendingIntent.FLAG_UPDATE_CURRENT | CardsWidget.immutable());
        @SuppressWarnings("deprecation") Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH) : new Notification.Builder(c);
        nb.setSmallIcon(R.drawable.ic_stat).setColor(0xFF3498DB).setContentTitle("📲 Нова версія застосунку " + i.name)
            .setContentText("Натисніть, щоб завантажити й встановити оновлення.").setAutoCancel(true).setContentIntent(pi);
        nm.notify("svitlo:update".hashCode(), nb.build());
        Log.i(TAG, "notified " + i.name);
    }

    /** Завантажити APK (системний завантажувач — видно хід у шторці). Готово — UpdateReceiver відкриє встановлення. */
    static long download(Context c, Info i) {
        DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
        String file = "svitlo-" + i.name + ".apk";
        File dir = c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir != null) { File old = new File(dir, file); if (old.exists()) old.delete(); }
        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(i.url))
            .setTitle("💡 Світло В Славутичі " + i.name).setDescription("Нова версія застосунку")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(c, Environment.DIRECTORY_DOWNLOADS, file);
        long id = dm.enqueue(r);
        Data.prefs(c).edit().putLong("upd_dl", id).apply();
        Log.i(TAG, "download " + id + " " + i.url);
        return id;
    }

    /** Завантаження завершилось: якщо це наше і вдале — відкрити системне встановлення. */
    static void downloaded(Context c, long id) {
        if (id != Data.prefs(c).getLong("upd_dl", -1)) return;
        DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
        Cursor q = dm.query(new DownloadManager.Query().setFilterById(id));
        boolean ok = false;
        if (q != null) { if (q.moveToFirst()) ok = q.getInt(q.getColumnIndex(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL; q.close(); }
        Log.i(TAG, "downloaded " + id + " " + (ok ? "ok" : "fail"));
        if (ok) install(c, dm.getUriForDownloadedFile(id));
    }

    static void install(Context c, Uri apk) {
        if (apk == null) return;
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(apk, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); Log.i(TAG, "install " + apk); } catch (Exception e) { Log.w(TAG, "install: " + e); }
    }
}
