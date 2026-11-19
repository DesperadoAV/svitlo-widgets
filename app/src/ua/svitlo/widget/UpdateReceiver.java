package ua.svitlo.widget;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Системний завантажувач закінчив — якщо це нова версія застосунку, відкриваємо встановлення. */
public class UpdateReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(i.getAction())) Update.downloaded(c, i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1));
    }
}
