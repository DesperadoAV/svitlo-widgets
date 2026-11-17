package ua.svitlo.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

/** Постачає картки черг у список віджета. */
public class CardsService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent i) {
        return new Factory(getApplicationContext(), i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    static final class Factory implements RemoteViewsFactory {
        final Context c; final int id;
        Data d; final List<Data.Q> rows = new ArrayList<>(); List<String> open = new ArrayList<>();
        Factory(Context c, int id) { this.c = c; this.id = id; }

        @Override public void onCreate() { }
        @Override public void onDestroy() { }
        @Override public void onDataSetChanged() {
            rows.clear();
            d = Data.cached(c);
            open = Prefs.expanded(c, id);
            if (d == null) return;
            List<String> sel = Prefs.selected(c, id);
            for (Data.Q q : d.qs) if (sel == null || sel.contains(q.name)) rows.add(q);
        }
        @Override public int getCount() { return rows.size(); }
        @Override public long getItemId(int p) { return p < rows.size() ? rows.get(p).name.hashCode() : p; }
        @Override public boolean hasStableIds() { return true; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public RemoteViews getLoadingView() { return null; }

        @Override public RemoteViews getViewAt(int p) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item);
            if (p >= rows.size() || d == null) return v;
            Data.Q q = rows.get(p);
            long now = System.currentTimeMillis();
            v.setTextViewText(R.id.name, "Черга " + q.name);
            String st = q.state > 0 ? "Світло є" : q.state == 0 ? "Світла немає" : "Немає даних";
            v.setTextViewText(R.id.status, st);
            v.setTextColor(R.id.status, q.state > 0 ? 0xFF2ECC71 : q.state == 0 ? 0xFFFF6B6B : 0xFF9AA5B1);
            v.setInt(R.id.card, "setBackgroundResource", q.state > 0 ? R.drawable.card_on : q.state == 0 ? R.drawable.card_off : R.drawable.card_na);
            String since = "";
            if (q.state >= 0 && q.since > 0) since = "з " + d.hm(q.since) + (d.kyivDay(q.since) != d.kyivDay(now) ? " (" + d.ddmm(q.since) + ")" : "");
            v.setTextViewText(R.id.since, since);
            v.setViewVisibility(R.id.since, since.isEmpty() ? View.GONE : View.VISIBLE);

            boolean ex = open.contains(q.name);
            v.setViewVisibility(R.id.more, ex ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.hint, ex ? View.GONE : View.VISIBLE);
            if (ex) {
                int sh = d.dayShift(now);                   // після півночі «завтра» стає «сьогодні»
                int[][] a = sh <= 0 ? q.today : sh == 1 ? q.tomorrow : null, b = sh <= 0 ? q.tomorrow : null;
                v.setTextViewText(R.id.t1, "Сьогодні: " + Data.list(a));
                v.setImageViewBitmap(R.id.b1, Bars.draw(a, d.kyivMin(now)));
                v.setViewVisibility(R.id.b1, a == null ? View.GONE : View.VISIBLE);
                boolean hasB = b != null;
                v.setViewVisibility(R.id.t2, hasB ? View.VISIBLE : View.GONE);
                v.setViewVisibility(R.id.b2, hasB ? View.VISIBLE : View.GONE);
                if (hasB) { v.setTextViewText(R.id.t2, "Завтра: " + Data.list(b)); v.setImageViewBitmap(R.id.b2, Bars.draw(b, -1)); }
            }
            v.setOnClickFillInIntent(R.id.card, new Intent().putExtra(CardsWidget.EXTRA_Q, q.name));
            return v;
        }
    }
}
