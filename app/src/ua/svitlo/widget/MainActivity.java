package ua.svitlo.widget;

import android.app.Activity;
import android.app.AlertDialog;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Головний екран: сайт із картками черг і мапою + кнопки «Мапа» і «Додати віджет». */
public class MainActivity extends Activity {
    WebView web; String testSite;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        String u = getIntent().getStringExtra("data_url");                    // для автоматичних тестів: інша адреса даних
        if (u != null) { Data.prefs(this).edit().putString("data_url", u).remove("data").apply(); }
        testSite = getIntent().getStringExtra("site_url");                    // для тестів: тестовий сайт замість справжнього

        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Ui.BG);
        int p = Ui.dp(this, 8); Ui.insets(root, p, p, p, 0);                  // не залазити під рядок стану (Android 15+)
        final TextView title = Ui.text(this, root, "💡 Світло В Славутичі", 20, Ui.ACCENT, true);
        title.setPadding(Ui.dp(this, 4), 0, 0, Ui.dp(this, 4));
        title.setOnLongClickListener(new android.view.View.OnLongClickListener() { @Override public boolean onLongClick(android.view.View v) { askUrl(); return true; } });
        LinearLayout row = new LinearLayout(this); root.addView(row);
        small(Ui.button(this, row, "🗺 Мапа", 0xFF3A3A3A, 1)).setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View v) { open(site(true)); } });
        small(Ui.button(this, row, "🗓 Перетини", 0xFF3A3A3A, 1.6f)).setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View v) { startActivity(new Intent(MainActivity.this, CompareActivity.class)); } });
        small(Ui.button(this, row, "➕ Віджет", 0xFF2980B9, 1.25f)).setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View v) { addWidget(); } });
        small(Ui.button(this, row, "🔔", 0xFF3A3A3A, 0.55f)).setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View v) { startActivity(new Intent(MainActivity.this, NotifyActivity.class)); } });
        small(Ui.button(this, row, "↻", 0xFF3A3A3A, 0.55f)).setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View v) { web.reload(); CardsWidget.fetchAsync(MainActivity.this, null); } });
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {   // у застосунку — без підпису під картками сайту
                v.evaluateJavascript("(function(){var e=document.querySelector('.ft');if(e)e.style.display='none';})()", null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith(site(false))) return false;                // сторінки сайту — тут
                open(url); return true;                                        // інші (мапа, Telegram) — у браузері
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        title.postDelayed(new Runnable() { @Override public void run() {   // для тестів: назва не залазить на рядок стану
            int[] l = new int[2]; title.getLocationOnScreen(l);
            int id = getResources().getIdentifier("status_bar_height", "dimen", "android"), sb = id > 0 ? getResources().getDimensionPixelSize(id) : 0;
            android.util.Log.i("SvitloMain", "title_y " + l[1] + " statusbar " + sb + (l[1] >= sb ? " OK" : " OVERLAP"));
        } }, 2000);
        web.loadUrl(site(false));
        CardsWidget.fetchAsync(this, null);
        Notify.channels(this);
        Notify.apply(this);                                                    // підписки на сповіщення — відновити, якщо злетіли
    }

    /** Кнопки верхнього ряду — в один рядок (на вузьких екранах текст зменшується, а не обрізається). */
    android.widget.Button small(android.widget.Button b) {
        int p = Ui.dp(this, 5); b.setPadding(p, Ui.dp(this, 9), p, Ui.dp(this, 9));
        b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(0); b.setMinimumHeight(0);
        Ui.fit(b, 14);
        android.widget.LinearLayout.LayoutParams lp = (android.widget.LinearLayout.LayoutParams) b.getLayoutParams(); lp.setMargins(Ui.dp(this, 3), Ui.dp(this, 4), Ui.dp(this, 3), Ui.dp(this, 4));
        return b;
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
            if (m != null && m.isRequestPinAppWidgetSupported()) { m.requestPinAppWidget(new ComponentName(this, CardsWidget.class), null, null); return; }
        }
        new AlertDialog.Builder(this).setTitle("Як додати віджет")
            .setMessage("1. Затисніть пальцем порожнє місце на робочому столі.\n2. Виберіть «Віджети».\n3. Знайдіть «Світло В Славутичі» і перетягніть на стіл.\n4. Позначте свої черги і натисніть «Зберегти».")
            .setPositiveButton("Зрозуміло", null).show();
    }

    void askUrl() {                                                            // приховане налаштування: адреса даних
        final EditText e = new EditText(this); e.setText(Data.url(this));
        new AlertDialog.Builder(this).setTitle("Адреса даних").setView(e)
            .setPositiveButton("Зберегти", new android.content.DialogInterface.OnClickListener() { @Override public void onClick(android.content.DialogInterface d, int w) { Data.prefs(MainActivity.this).edit().putString("data_url", e.getText().toString().trim()).apply(); CardsWidget.fetchAsync(MainActivity.this, null); } })
            .setNeutralButton("Стандартна", new android.content.DialogInterface.OnClickListener() { @Override public void onClick(android.content.DialogInterface d, int w) { Data.prefs(MainActivity.this).edit().remove("data_url").apply(); CardsWidget.fetchAsync(MainActivity.this, null); } })
            .setNegativeButton("Скасувати", null).show();
    }

    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
