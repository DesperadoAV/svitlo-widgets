package ua.svitlo.widget;

import android.content.Context;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Налаштування кожного віджета: які черги показувати і які картки розкриті. */
final class Prefs {
    private Prefs() {}
    /** null — показувати всі черги. */
    static List<String> selected(Context c, int id) {
        String s = Data.prefs(c).getString("q_" + id, "");
        return s.isEmpty() ? null : new ArrayList<>(Arrays.asList(s.split(",")));
    }
    static void setSelected(Context c, int id, List<String> qs) { Data.prefs(c).edit().putString("q_" + id, qs == null ? "" : join(qs)).apply(); }
    static List<String> expanded(Context c, int id) {
        String s = Data.prefs(c).getString("x_" + id, "");
        return s.isEmpty() ? new ArrayList<String>() : new ArrayList<>(Arrays.asList(s.split(",")));
    }
    static void toggleExpanded(Context c, int id, String q) {
        List<String> x = expanded(c, id);
        if (x.contains(q)) x.remove(q); else x.add(q);
        Data.prefs(c).edit().putString("x_" + id, join(x)).apply();
    }
    /** Темний фон під картками (інакше — прозорий). */
    static boolean dark(Context c, int id) { return Data.prefs(c).getBoolean("bg_" + id, false); }
    static void setDark(Context c, int id, boolean v) { Data.prefs(c).edit().putBoolean("bg_" + id, v).apply(); }
    static void forget(Context c, int id) { Data.prefs(c).edit().remove("q_" + id).remove("x_" + id).remove("bg_" + id).apply(); }
    static String join(List<String> l) { StringBuilder b = new StringBuilder(); for (String s : l) { if (b.length() > 0) b.append(','); b.append(s); } return b.toString(); }
}
