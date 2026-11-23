package ua.svitlo.widget;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Головний екран — сайт: назва, «➕ Віджет», час оновлення й ↻, черги, перетини, сповіщення, мапа (вкладки внизу).
 * Своєї панелі вгорі немає — лише смужка «📲 Доступна нова версія», коли вона є. Сайт кличе застосунок через SvitloApp:
 * додати віджет, оновити дані віджета, сповіщення (Firebase) і вигляд смужок.
 */
public class MainActivity extends Activity {
    WebView web; String testSite; TextView upd; Update.Info newer;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        String u = getIntent().getStringExtra("data_url");                    // для автоматичних тестів: інша адреса даних
        if (u != null) { Data.prefs(this).edit().putString("data_url", u).remove("data").apply(); }
        String uu = getIntent().getStringExtra("update_url");                  // для тестів: опис нової версії з тестового сервера
        if (uu != null) Data.prefs(this).edit().putString("update_url", uu).putLong("upd_checked", 0).apply();
        testSite = getIntent().getStringExtra("site_url");                    // для тестів: тестовий сайт замість справжнього

        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Ui.BG);
        Ui.insets(root, 0, 0, 0, 0);                                           // не залазити під рядок стану (Android 15+)
        // 📲 смужка «Доступна нова версія» (з'являється, лише коли є новіша)
        upd = Ui.text(this, root, "", 15, 0xFFFFFFFF, true);
        android.graphics.drawable.GradientDrawable ug = new android.graphics.drawable.GradientDrawable(); ug.setColor(0xFF2980B9); ug.setCornerRadius(Ui.dp(this, 10));
        upd.setBackgroundDrawable(ug); upd.setPadding(Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 12), Ui.dp(this, 10));
        ((LinearLayout.LayoutParams) upd.getLayoutParams()).setMargins(Ui.dp(this, 10), Ui.dp(this, 8), Ui.dp(this, 10), Ui.dp(this, 4));
        upd.setVisibility(android.view.View.GONE);
        upd.setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View v) { startUpdate(); } });
        web = new WebView(this);
        web.setBackgroundColor(Ui.BG);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " SvitloApp/" + BuildConfig.VERSION_NAME);   // сайт знає: оновлення — справа застосунку
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {   // у застосунку — без підпису під картками сайту
                v.evaluateJavascript("(function(){var e=document.querySelector('.ft');if(e)e.style.display='none';})()", null);
                v.evaluateJavascript("window.svSetBars&&svSetBars('" + (Bars.old(MainActivity.this) ? "old" : "new") + "')", null);   // 🎨 сайт — у тому ж вигляді, що й застосунок
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith(site(false))) return false;                // сторінки сайту — тут
                open(url); return true;                                        // інші (мапа окремо, Telegram) — у браузері
            }
        });
        web.addJavascriptInterface(new Bridge(), "SvitloApp");             // сайт кличе застосунок: віджет, ↻, сповіщення, вигляд смужок
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        web.postDelayed(new Runnable() { @Override public void run() {     // для тестів: сайт (з назвою) не залазить на рядок стану
            int[] l = new int[2]; web.getLocationOnScreen(l);
            int id = getResources().getIdentifier("status_bar_height", "dimen", "android"), sb = id > 0 ? getResources().getDimensionPixelSize(id) : 0;
            android.util.Log.i("SvitloMain", "web_y " + l[1] + " statusbar " + sb + (l[1] >= sb ? " OK" : " OVERLAP"));
        } }, 2000);
        web.loadUrl(site(false));
        CardsWidget.fetchAsync(this, null);
        Notify.channels(this);
        Notify.apply(this);                                                    // підписки на сповіщення — відновити, якщо злетіли
        if (getIntent().getBooleanExtra("test_refresh", false)) web.postDelayed(new Runnable() { @Override public void run() { widgetRefresh(); } }, 3000);
        checkUpdate(getIntent());
    }

    /** Що сайт може попросити в застосунку (кнопки сайту на головному екрані). */
    final class Bridge {
        @android.webkit.JavascriptInterface public void bars(String v) { setBars(getApplicationContext(), "old".equals(v)); }
        @android.webkit.JavascriptInterface public void addWidget() { runOnUiThread(new Runnable() { @Override public void run() { MainActivity.this.addWidget(); } }); }
        @android.webkit.JavascriptInterface public void refresh() { widgetRefresh(); }
        @android.webkit.JavascriptInterface public String notifyGet() { return notifyState(); }
        @android.webkit.JavascriptInterface public void notifySave(String json) { notifySaveJs(json); }
        @android.webkit.JavascriptInterface public void notifyTest() { runOnUiThread(new Runnable() { @Override public void run() { notifyTestJs(); } }); }
    }

    /** ↻ на сайті: сайт оновлює себе сам, а застосунок — дані віджета. */
    void widgetRefresh() {
        android.util.Log.i("SvitloMain", "refresh widget");
        new Thread(new Runnable() { @Override public void run() {
            boolean ok = false;
            try { ok = Data.fetch(MainActivity.this); CardsWidget.updateAll(MainActivity.this); } catch (Exception ignored) { }
            android.util.Log.i("SvitloMain", "refresh widget " + (ok ? "ok" : "fail"));
        } }).start();
    }

    // ---------- 🔔 сповіщення (вкладка «Сповіщення» сайту; ті самі налаштування, що й у NotifyActivity) ----------
    String notifyState() {
        try {
            List<String> q = Notify.queues(this); String why = Notify.unavailable(this);
            return new JSONObject().put("on", !q.isEmpty()).put("queues", new JSONArray(q)).put("warn", Notify.warn(this)).put("sched", Notify.sched(this)).put("why", why == null ? "" : why).toString();
        } catch (Exception e) { return "{}"; }
    }
    void notifySaveJs(String json) {
        try {
            JSONObject o = new JSONObject(json); JSONArray a = o.optJSONArray("queues"); List<String> qs = new ArrayList<>();
            if (a != null) for (int i = 0; i < a.length(); i++) qs.add(a.getString(i));
            Notify.save(this, qs, o.optBoolean("warn", true), o.optBoolean("sched", true));
            android.util.Log.i("SvitloMain", "notify save " + qs + " warn " + o.optBoolean("warn", true) + " sched " + o.optBoolean("sched", true));
            if (!qs.isEmpty() && Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(new Runnable() { @Override public void run() { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 6); } });
                return;                                                        // відповідь сайту — після дозволу (onRequestPermissionsResult)
            }
            notifyDone(null);
        } catch (Exception e) { notifyDone(String.valueOf(e.getMessage())); }
    }
    void notifyDone(String err) {
        try {
            JSONObject r = err == null ? new JSONObject().put("ok", true).put("perm", allowed() ? "granted" : "denied") : new JSONObject().put("ok", false).put("error", err);
            js("window.svNotifyDone&&svNotifyDone(" + JSONObject.quote(r.toString()) + ")");
        } catch (Exception ignored) { }
    }
    boolean allowed() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return nm == null || Build.VERSION.SDK_INT < 24 || nm.areNotificationsEnabled();
    }
    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) { if (code == 6) notifyDone(null); }
    /** «Пробне»: справжнє сповіщення через сервер і Firebase; не вийшло — показуємо, як виглядатиме, і чому. */
    void notifyTestJs() {
        String why = Notify.unavailable(this);
        if (why != null) { notifyLocal(why); return; }
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(new com.google.android.gms.tasks.OnCompleteListener<String>() {
                @Override public void onComplete(com.google.android.gms.tasks.Task<String> t) {
                    if (!t.isSuccessful() || t.getResult() == null) { notifyLocal("Firebase не видав телефону ідентифікатор"); return; }
                    final String tok = t.getResult();
                    new Thread(new Runnable() { @Override public void run() {
                        String err = Notify.pushTest(MainActivity.this, tok);
                        if (err == null) notifyMsg("✅ Сервер надіслав пробне сповіщення — воно має з'явитися за кілька секунд.", true); else notifyLocal(err);
                    } }).start();
                }
            });
        } catch (Exception e) { notifyLocal(String.valueOf(e.getMessage())); }
    }
    void notifyLocal(String why) {
        List<String> sel = Notify.queues(this); String q = sel.isEmpty() ? "3.2" : sel.get(0);
        Notify.show(this, "warn", q, "⏰ Черга " + q + ": за 10 хв відключення", "Так виглядатиме сповіщення (це перевірка)");
        notifyMsg("Показано, як виглядатиме сповіщення. Через сервер не вийшло: " + why, false);
    }
    void notifyMsg(String text, boolean ok) { js("window.svNotifyMsg&&svNotifyMsg(" + JSONObject.quote(text) + "," + ok + ")"); }
    void js(final String code) { runOnUiThread(new Runnable() { @Override public void run() { if (web != null) web.evaluateJavascript(code, null); } }); }

    /** 🎨 «Вигляд смужок» вибирають на сайті; так само малюються віджет і «Перетини». */
    static void setBars(final android.content.Context c, boolean old) {
        boolean same = Bars.old(c) == old;
        android.util.Log.i("SvitloMain", "bars " + (old ? "old" : "new") + (same ? " (same)" : ""));
        if (same) return;
        Data.prefs(c).edit().putBoolean("bars_old", old).apply();
        new Thread(new Runnable() { @Override public void run() { try { CardsWidget.updateAll(c); } catch (Exception ignored) { } } }).start();
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); checkUpdate(i); }

    /** 📲 Чи є новіша версія (раз на 6 год; зі сповіщення — одразу). Натиснули сповіщення «нова версія» — одразу завантажуємо. */
    void checkUpdate(Intent it) {
        final boolean fromPush = it != null && (it.getBooleanExtra("update", false) || it.getBooleanExtra("test_update", false));
        new Thread(new Runnable() { @Override public void run() {
            final Update.Info i = Update.check(MainActivity.this, fromPush);
            runOnUiThread(new Runnable() { @Override public void run() { showUpdate(i); if (fromPush && i != null) startUpdate(); } });
        } }).start();
    }
    void showUpdate(Update.Info i) {
        newer = i;
        if (i == null) { upd.setVisibility(android.view.View.GONE); return; }
        upd.setText("📲 Доступна нова версія " + i.name + " — натисніть, щоб оновити");
        upd.setVisibility(android.view.View.VISIBLE);
    }
    void startUpdate() {
        if (newer == null) return;
        Update.download(this, newer);
        upd.setText("⏳ Завантажую версію " + newer.name + "… Коли завантажиться — відкриється встановлення");
        android.widget.Toast.makeText(this, "Завантажую нову версію — хід видно в шторці", android.widget.Toast.LENGTH_LONG).show();
    }

    String site(boolean map) {
        if (testSite != null) return map ? testSite + "map" : testSite;
        Data d = Data.cached(this);
        if (map) return d != null ? d.map : Data.DEFAULT_MAP;
        return d != null ? d.site : Data.DEFAULT_SITE;
    }
    void open(String url) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { } }

    void addWidget() {
        if (Build.VERSION.SDK_INT >= 26) {
            AppWidgetManager m = getSystemService(AppWidgetManager.class);
            if (m != null && m.isRequestPinAppWidgetSupported()) { android.util.Log.i("SvitloMain", "addWidget pin"); m.requestPinAppWidget(new ComponentName(this, CardsWidget.class), null, null); return; }
        }
        android.util.Log.i("SvitloMain", "addWidget dialog");
        new AlertDialog.Builder(this).setTitle("Як додати віджет")
            .setMessage("1. Затисніть пальцем порожнє місце на робочому столі.\n2. Виберіть «Віджети».\n3. Знайдіть «Світло В Славутичі» і перетягніть на стіл.\n4. Позначте свої черги і натисніть «Зберегти».")
            .setPositiveButton("Зрозуміло", null).show();
    }

    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
