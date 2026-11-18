package ua.svitlo.widget;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Повідомлення від бота через Firebase: показати сповіщення і одразу оновити віджет. */
public class PushService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String kind = d.get("kind"), q = d.get("q"), title = d.get("title"), body = d.get("body");
        if (title == null && m.getNotification() != null) { title = m.getNotification().getTitle(); body = m.getNotification().getBody(); }
        if (title == null) return;
        if (q != null && !q.isEmpty() && !Notify.queues(this).contains(q)) return;   // відписались, а повідомлення ще йшло
        if ("warn".equals(kind) && !Notify.warn(this)) return;
        Notify.show(this, kind, q == null ? "" : q, title, body == null ? "" : body);
        try { Data.fetch(this); CardsWidget.updateAll(this); } catch (Exception ignored) { }   // віджет — одразу зі свіжим станом
    }

    @Override public void onNewToken(String token) { Notify.apply(this); }
}
