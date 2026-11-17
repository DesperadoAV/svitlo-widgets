// =============================================================================
// 💡 Світло В Славутичі — бот для мешканців і дані для віджета на телефоні.
//
//  • Telegram: людина пише боту — отримує «живу картку» (віджет Telegram, Bot API 10.4) з усіма чергами:
//    є світло чи ні, з якого часу, графік на сьогодні й завтра. Картки розкриваються, можна вибрати свої черги.
//    Картка одна на всіх (спільний віджет): бот оновлює її раз — і вона змінюється в усіх чатах.
//  • /status.json — ті самі дані для віджета на робочий стіл Android (застосунок «Світло В Славутичі»).
//
// Дані бере з тієї самої бази D1, що й основний бот (svitlo51): таблиці queues і schedule — лише читає.
// Свої записи тримає в таблиці kv (ключі pub:*) і pub_users.
// Секрет у Cloudflare: BOT_TOKEN (токен бота від @BotFather). Необов'язково: SITE_URL.
// =============================================================================
import { WIDGET_HTML, WIDGET_VER } from "./widget.js";

const SITE = env => String(env.SITE_URL || "https://svitlo51.a-m-vasylets.workers.dev/");
const MAP_DEFAULT = "https://desperadoav.github.io/Svitlo_in_Slavutych/";
const DEVS = ["esp1", "esp2", "esp3", "esp4", "esp5", "esp6", "router"];
const CAPTION = "💡 Світло В Славутичі — стан черг наживо. Натисніть на чергу, щоб побачити графік; «⚙️» — вибрати свої черги.";

// ------------------------- час (Київ) -------------------------
const FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function kp(ms) { const o = {}; for (const p of FMT.formatToParts(new Date(ms))) o[p.type] = p.value; return o; }
function kyivOffMin(ms) { const p = kp(ms); return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000); }
const fmtDate = ms => { const p = kp(ms); return `${p.day}.${p.month}.${p.year}`; };
const fmtTime = ms => { const p = kp(ms); return `${p.hour}:${p.minute}`; };
const nextDayOf = ms => { const p = kp(ms); return fmtDate(Date.UTC(+p.year, +p.month - 1, +p.day + 1, 12)); };   // завтра за Києвом (без помилок на переході часу)
function merge(rows) {                                  // [["08:00","12:00"],…] → [[480,720],…] (злиті, відсортовані)
  const m = rows.map(([a, b]) => [toMin(a), b === "23:59" || b === "24:00" ? 1440 : toMin(b)]).filter(x => x[1] > x[0]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const x of m) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([...x]); }
  return out;
}
const toMin = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
const ivStr = l => l.map(x => x[0] + "-" + x[1]).join(",");
const hm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// ------------------------- база -------------------------
let INIT = false;
async function init(env) {
  if (INIT) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pub_users (chat_id INTEGER PRIMARY KEY, first_ts INTEGER, last_ts INTEGER, n INTEGER DEFAULT 0)"),
  ]);
  INIT = true;
}
async function kvGet(env, k) { const r = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first(); return r ? r.v : null; }
async function kvSet(env, k, v) { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }

// Знімок стану всіх черг — те саме, що показує сайт
let SNAP = null, SNAP_TS = 0;
async function snapshot(env) {
  if (SNAP && Date.now() - SNAP_TS < 30000) return SNAP;
  await init(env);
  const now = Date.now(), d0 = fmtDate(now), d1 = nextDayOf(now);
  const qs = (await env.DB.prepare("SELECT * FROM queues ORDER BY name").all()).results;
  const rows = (await env.DB.prepare("SELECT queue,day,start,end FROM schedule WHERE day IN (?,?)").bind(d0, d1).all()).results;
  const mapRow = await env.DB.prepare("SELECT v FROM kv WHERE k='set:map_url'").first().catch(() => null);
  SNAP = {
    now, d0, d1, off: kyivOffMin(now), map: (mapRow && mapRow.v) || MAP_DEFAULT, site: SITE(env),
    queues: qs.map(q => {
      const last = Math.max(0, ...DEVS.map(d => +q["last_" + d] || 0)), live = !q.paused && last > 0 && now - last < 86400000;
      const of = d => rows.filter(r => r.queue === q.name && r.day === d).map(r => [r.start, r.end]);
      return { name: q.name, state: live ? (q.state !== "Offline" ? 1 : 0) : -1, since: +q.state_ts || 0,
        today: rows.some(r => r.queue === q.name && r.day === d0) ? merge(of(d0)) : null,
        tomorrow: rows.some(r => r.queue === q.name && r.day === d1) ? merge(of(d1)) : null };
    }),
  };
  SNAP_TS = now;
  return SNAP;
}
// Стислі дані для віджета Telegram (≤ 1024 байти): {"t":хвилини,"o":зсув Києва,"q":[[черга,стан,з якої хвилини,"сьогодні","завтра"|null],…]}
function compact(S) {
  const q = S.queues.map(x => [x.name, x.state, x.since ? Math.floor(x.since / 60000) : 0, x.today ? ivStr(x.today) : null, x.tomorrow ? ivStr(x.tomorrow) : null]);
  let s = JSON.stringify({ t: Math.floor(S.now / 60000), o: S.off, q });
  for (let i = q.length - 1; i >= 0 && s.length > 1000; i--) { q[i][4] = null; s = JSON.stringify({ t: Math.floor(S.now / 60000), o: S.off, q }); }   // не влазить — без «завтра»
  for (let i = q.length - 1; i >= 0 && s.length > 1000; i--) { q[i][3] = null; s = JSON.stringify({ t: Math.floor(S.now / 60000), o: S.off, q }); }
  return s;
}
// Дані для застосунку на телефоні (читабельний JSON)
function statusJson(S) {
  return {
    v: 1, now: S.now, today: S.d0, tomorrow: S.d1, kyiv_offset_min: S.off, map: S.map, site: S.site,
    queues: S.queues.map(x => ({ name: x.name, state: x.state === 1 ? "on" : x.state === 0 ? "off" : "unknown", since: x.since || null,
      today: x.today && x.today.map(([a, b]) => [hm(a), b >= 1440 ? "24:00" : hm(b)]), tomorrow: x.tomorrow && x.tomorrow.map(([a, b]) => [hm(a), b >= 1440 ? "24:00" : hm(b)]) })),
  };
}

// ------------------------- Telegram -------------------------
async function tg(env, method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, description: String(e && e.message || e) }; }
}
async function secret(env) {                            // секрет вебхука — з токена, щоб нічого окремо не налаштовувати
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("svitlo-pub:" + env.BOT_TOKEN));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const keyboard = S => ({ inline_keyboard: [[{ text: "🗺 Мапа черг", url: S.map }, { text: "🌐 Сайт", url: S.site }]] });

// Список спільних віджетів: [{id, ver}] — оновлюємо всі (старі версії теж, щоб у людей не «застигали» картки)
async function widgets(env) { try { return JSON.parse(await kvGet(env, "pub:widgets") || "[]"); } catch (e) { return []; } }

async function sendCard(env, chat) {
  const S = await snapshot(env), data = compact(S), list = await widgets(env), cur = list.find(w => w.ver === WIDGET_VER);
  let r;
  if (cur) r = await tg(env, "sendSharedWidget", { chat_id: chat, widget_id: cur.id, caption: CAPTION, reply_markup: keyboard(S) });
  if (!cur || (!r.ok && /widget/i.test(String(r.description || "")) && /not found|invalid|expired/i.test(String(r.description || "")))) {
    r = await tg(env, "sendWidget", { chat_id: chat, html: WIDGET_HTML, public_data: data, is_shared: true, caption: CAPTION, reply_markup: keyboard(S) });
    const id = r.ok && r.result && r.result.widget && r.result.widget.id;
    if (id) { await kvSet(env, "pub:widgets", JSON.stringify([...list.filter(w => w.id !== id), { id, ver: WIDGET_VER, at: Date.now() }].slice(-5))); await kvSet(env, "pub:last", data); }
  }
  if (r && r.ok && r.result && r.result.message_id) {   // картку — нагору чату (закріпити), щоб завжди була під рукою
    await tg(env, "unpinAllChatMessages", { chat_id: chat });
    await tg(env, "pinChatMessage", { chat_id: chat, message_id: r.result.message_id, disable_notification: true });
  } else if (r && !r.ok) {
    await tg(env, "sendMessage", { chat_id: chat, text: "Не вдалося показати картку 😕 Оновіть Telegram до останньої версії і напишіть /start ще раз.\nА поки — стан черг на сайті:", reply_markup: keyboard(S) });
  }
  return r;
}
async function onUpdate(env, u) {
  const m = u.message || u.edited_message;
  if (m && m.chat && m.chat.type === "private") {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO pub_users(chat_id,first_ts,last_ts,n) VALUES(?,?,?,1) ON CONFLICT(chat_id) DO UPDATE SET last_ts=excluded.last_ts, n=n+1").bind(m.chat.id, now, now).run();
    const t = String(m.text || "");
    if (/^\/help/.test(t)) {
      const S = await snapshot(env);
      return tg(env, "sendMessage", { chat_id: m.chat.id, parse_mode: "HTML", reply_markup: keyboard(S),
        text: "💡 <b>Світло В Славутичі</b>\n\nКартка вище показує наживо, де є світло, а де немає, і графік відключень.\n• Натисніть на чергу — розкриється графік на сьогодні й завтра.\n• «⚙️ Вибрати черги» — залиште лише свої.\n• /start — надіслати картку ще раз.\n\nСтан визначають пристрої в будинках кожної черги — це факт, а не графік." });
    }
    return sendCard(env, m.chat.id);
  }
  if (u.widget_query) return tg(env, "answerWidgetQuery", { widget_query_id: u.widget_query.id });   // віджет запитів не надсилає — про всяк випадок відповідаємо
}

// Раз на хвилину: змінилися дані — оновлюємо спільні картки в усіх чатах
async function refresh(env) {
  const list = await widgets(env);
  if (!list.length) return { skipped: "ще немає картки" };
  SNAP = null;
  const data = compact(await snapshot(env)), last = await kvGet(env, "pub:last");
  const prev = (() => { try { return JSON.parse(last || "null"); } catch (e) { return null; } })();
  // «оновлено о…» змінюється щохвилини; без змін стану картку оновлюємо раз на 10 хв, щоб не смикати Telegram
  const same = prev && JSON.stringify(prev.q) === JSON.stringify(JSON.parse(data).q) && Math.floor(Date.now() / 60000) - prev.t < 10;
  if (same) return { skipped: "без змін" };
  const res = [];
  for (const w of list) res.push((await tg(env, "editSharedWidgetData", { widget_id: w.id, public_data: data, cache_time: 60 })).ok);
  await kvSet(env, "pub:last", data);
  return { updated: res };
}

async function setup(env, origin) {
  const out = [];
  if (!env.BOT_TOKEN) return "❌ Немає секрету BOT_TOKEN. Cloudflare → цей воркер → Settings → Variables and Secrets → Add → Secret: BOT_TOKEN = токен від @BotFather.";
  await init(env);
  const me = await tg(env, "getMe", {});
  if (!me.ok) return "❌ Токен не підходить: " + (me.description || "") + "\nПеревірте BOT_TOKEN (копіюйте повністю, разом із двокрапкою).";
  const wh = await tg(env, "setWebhook", { url: `${origin}/tg`, secret_token: await secret(env), allowed_updates: ["message", "edited_message", "widget_query"], drop_pending_updates: false });
  out.push(wh.ok ? `✅ Вебхук встановлено: ${origin}/tg` : "❌ Вебхук: " + wh.description);
  await tg(env, "setMyCommands", { commands: [{ command: "start", description: "Показати картку зі станом черг" }, { command: "help", description: "Як користуватися" }] });
  await tg(env, "setMyDescription", { description: "💡 Світло В Славутичі: наживо — де є світло, а де немає, і графік відключень по чергах. Натисніть «Почати»." });
  await tg(env, "setMyShortDescription", { short_description: "Наживо: де є світло в Славутичі, і графік відключень" });
  out.push(`🤖 Бот: @${me.result.username}`);
  const S = await snapshot(env);
  out.push(`📊 Черг у базі: ${S.queues.length}; дані для картки: ${compact(S).length} байт (межа 1024)`);
  out.push(`🧩 Віджет: ${new TextEncoder().encode(WIDGET_HTML).length} байт`);
  out.push("Далі: відкрийте бота в Telegram і натисніть «Почати» — прийде картка.");
  return out.join("\n");
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url), p = u.pathname;
    try {
      if (p === "/tg" && req.method === "POST") {
        await init(env);
        if (req.headers.get("x-telegram-bot-api-secret-token") !== await secret(env)) return new Response("forbidden", { status: 403 });
        const upd = await req.json();
        ctx.waitUntil(onUpdate(env, upd).catch(e => console.error("update", e)));
        return new Response("ok");
      }
      if (p === "/status.json") {
        return new Response(JSON.stringify(statusJson(await snapshot(env))), { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } });
      }
      if (p === "/setup") return new Response(await setup(env, u.origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (p === "/widget-preview") return new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="max-width:420px;margin:20px auto;background:#17212b;color:#fff;--tg-theme-text-color:#fff;--tg-theme-hint-color:#8b9bb4;--tg-theme-button-color:#5288c1"><script>window.TelegramWidget={publicData:${JSON.stringify(compact(await snapshot(env)))},onEvent(){},ready(){}}</script>${WIDGET_HTML}`, { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response("💡 Світло В Славутичі — бот для мешканців працює.\nДані для віджета: /status.json\nНалаштування бота: /setup", { headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      return new Response("Помилка: " + (e && e.message || e), { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.BOT_TOKEN) return;
    ctx.waitUntil(refresh(env).catch(e => console.error("refresh", e)));
  },
};
