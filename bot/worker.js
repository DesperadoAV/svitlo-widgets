// =============================================================================
// 💡 Світло В Славутичі — бот для мешканців і дані для віджета на телефоні.
//
//  • Telegram: людина пише боту — отримує «живу картку» (віджет Telegram, Bot API 10.4) з усіма чергами:
//    є світло чи ні, з якого часу, графік на сьогодні й завтра. Картки розкриваються, можна вибрати свої черги.
//    Картка одна на всіх (спільний віджет): бот оновлює її раз — і вона змінюється в усіх чатах.
//  • /status.json — ті самі дані для віджета на робочий стіл Android (застосунок «Світло В Славутичі»).
//
// Дані бере в основного бота (svitlo51, адреса /api/status — з версії 4.0.5): раз на хвилину, а не на кожен запит,
// тож скільки б людей не користувалося ботом і віджетом, основний бот отримує ≈1440 запитів на добу.
// Має свою базу D1 (svitlo-public): таблиці kv (pub:*) і pub_users. До бази основного бота доступу не має.
// Секрет у Cloudflare: BOT_TOKEN (токен бота від @BotFather). Необов'язково: MAIN_URL, SITE_URL.
// =============================================================================
import { WIDGET_HTML, WIDGET_VER } from "./widget.js";

const MAIN = env => String(env.MAIN_URL || "https://svitlo51.a-m-vasylets.workers.dev").replace(/\/+$/, "");
const MAP_DEFAULT = "https://desperadoav.github.io/Svitlo_in_Slavutych/";
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS subs (chat_id INTEGER, queue TEXT, PRIMARY KEY (chat_id, queue))"),        // хто на які черги підписаний
    env.DB.prepare("CREATE TABLE IF NOT EXISTS notif (chat_id INTEGER PRIMARY KEY, warn INTEGER DEFAULT 1)"),             // попередження за 10 хв: 1 так, 0 ні
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, text TEXT, at INTEGER, claim INTEGER DEFAULT 0, tries INTEGER DEFAULT 0)"),   // черга сповіщень
  ]);
  INIT = true;
}
async function kvGet(env, k) { const r = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first(); return r ? r.v : null; }
async function kvSet(env, k, v) { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }

// Знімок стану всіх черг — те саме, що показує сайт. Береться в основного бота й зберігається у своїй базі:
// свіжий (до 90 с) — з бази; старіший — новий запит до основного бота; той недоступний — останній збережений.
let SNAP = null, SNAP_TS = 0;
function fromMain(env, j) {
  if (!j || j.v !== 1 || !Array.isArray(j.queues) || !j.now) throw new Error("основний бот надіслав незрозумілі дані");
  const st = x => x === "on" ? 1 : x === "off" ? 0 : -1, ok = l => Array.isArray(l) ? merge(l.filter(x => Array.isArray(x) && x.length === 2)) : null;
  return {
    now: +j.now, d0: String(j.today || fmtDate(j.now)), d1: String(j.tomorrow || nextDayOf(j.now)), off: Number.isFinite(+j.kyiv_offset_min) ? +j.kyiv_offset_min : kyivOffMin(j.now),
    map: j.map || MAP_DEFAULT, site: String(env.SITE_URL || j.site || MAIN(env) + "/"),
    queues: j.queues.filter(q => q && q.name).map(q => ({ name: String(q.name), state: st(q.state), since: +q.since || 0, today: ok(q.today), tomorrow: ok(q.tomorrow) })),
  };
}
async function pull(env) {                              // запит до основного бота (≤ 10 с)
  const r = await fetch(MAIN(env) + "/api/status", { headers: { "user-agent": "svitlo-public" }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) throw new Error("на основному боті вимкнена публічна сторінка або версія старіша за 4.0.5");
  if (!r.ok) throw new Error("основний бот відповів " + r.status);
  return fromMain(env, await r.json());
}
async function snapshot(env, fresh) {
  const t = Date.now();
  if (!fresh && SNAP && t - SNAP_TS < 30000) return SNAP;
  await init(env);
  let saved = null;
  try { saved = JSON.parse(await kvGet(env, "pub:snap") || "null"); } catch (e) {}
  if (!fresh && saved && saved.S && t - saved.at < 90000) { SNAP = saved.S; SNAP_TS = t; return SNAP; }
  try {
    SNAP = await pull(env); SNAP_TS = t;
    await kvSet(env, "pub:snap", JSON.stringify({ at: t, S: SNAP }));
    return SNAP;
  } catch (e) {
    const msg = String(e && e.message || e);
    if (saved && saved.S) {                             // показуємо останнє, що знаємо (у картці видно, о котрій оновлено)
      await kvSet(env, "pub:snap", JSON.stringify({ ...saved, err: { at: t, msg } })).catch(() => {});
      SNAP = saved.S; SNAP_TS = t; return SNAP;
    }
    await kvSet(env, "pub:snap", JSON.stringify({ at: 0, S: null, err: { at: t, msg } })).catch(() => {});
    throw new Error("немає даних від основного бота: " + msg);
  }
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
  let j;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    j = await r.json();
  } catch (e) { j = { ok: false, description: String(e && e.message || e) }; }
  if (!j.ok && !/not modified/i.test(String(j.description || ""))) await logErr(env, method, j).catch(() => {});
  return j;
}
// Останні 10 помилок Telegram — видно на головній сторінці бота (без токенів і тексту повідомлень)
async function logErr(env, method, j) {
  let l = []; try { l = JSON.parse(await kvGet(env, "pub:tgerr") || "[]"); } catch (e) {}
  l.push({ at: Date.now(), m: method, c: j.error_code || 0, d: String(j.description || "").slice(0, 300) });
  await kvSet(env, "pub:tgerr", JSON.stringify(l.slice(-10)));
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? `${d} д ${h} год` : h ? `${h} год ${m % 60} хв` : `${m % 60} хв`; };
// Стан черг повідомленням із кнопками (поки Telegram не дозволяє картки-віджети): натиснути чергу — розкрити графік, 🔄 — оновити
function statusView(S, open, mine) {
  const ivs = l => l === null ? "графіка ще немає" : l.length ? l.map(([a, b]) => hm(a) + "–" + hm(b)).join(", ") : "відключень немає";
  const now = S.now;
  const lines = S.queues.map(q => {
    const icon = q.state === 1 ? "🟢" : q.state === 0 ? "🔴" : "⚪️";
    const st = q.state === 1 ? "світло є" : q.state === 0 ? "світла немає" : "немає даних";
    const since = q.state >= 0 && q.since ? ` з ${fmtTime(q.since)}${fmtDate(q.since) !== S.d0 ? " " + fmtDate(q.since).slice(0, 5) : ""} · ${dur(now - q.since)}` : "";
    let t = `${icon} <b>Черга ${q.name}</b> — ${st}${since}`;
    if (open.includes(q.name)) {
      t += `\n      сьогодні: ${ivs(q.today)}` + (q.tomorrow ? `\n      завтра: ${ivs(q.tomorrow)}` : "");
      const cur = inOutage(q, S, now), nx = nextOutage(q, S, now);
      if (cur) t += `\n      ⏳ за графіком відключення до ${at(cur, S)}`;
      else if (nx) t += `\n      ⏭ наступне відключення: ${at(nx.start, S)} (через ${dur(nx.start - now)})`;
    }
    return t;
  });
  const text = `💡 <b>Світло В Славутичі</b> · дані на ${fmtTime(now)}\n\n${lines.join("\n")}\n\n<i>Натисніть на чергу — покажу графік.</i>`;
  const qb = S.queues.map(q => ({ text: (open.includes(q.name) ? "▾ " : "▸ ") + q.name + (mine.includes(q.name) ? " 🔔" : ""), callback_data: "e:" + q.name }));
  const rows = [];
  for (let i = 0; i < qb.length; i += 3) rows.push(qb.slice(i, i + 3));
  rows.push([{ text: "🔄 Оновити", callback_data: "r" }, { text: "🔔 Сповіщення", callback_data: "n" }]);
  rows.push([{ text: "🗺 Мапа черг", url: S.map }, { text: "🌐 Сайт", url: S.site }]);
  return { text, reply_markup: { inline_keyboard: rows } };
}
const myQueues = async (env, chat) => (await env.DB.prepare("SELECT queue FROM subs WHERE chat_id=?").bind(chat).all()).results.map(r => r.queue);
async function sendStatus(env, chat, pin) {
  const S = await snapshot(env), v = statusView(S, [], await myQueues(env, chat));
  const r = await tg(env, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true, ...v });
  if (pin && r.ok) await tg(env, "pinChatMessage", { chat_id: chat, message_id: r.result.message_id, disable_notification: true });   // закріплюємо лише перший раз (кнопка 🔄 оновлює його)
  return r;
}
async function secret(env) {                            // секрет вебхука — з токена, щоб нічого окремо не налаштовувати
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("svitlo-pub:" + env.BOT_TOKEN));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const keyboard = S => ({ inline_keyboard: [[{ text: "🗺 Мапа черг", url: S.map }, { text: "🌐 Сайт", url: S.site }], [{ text: "🔔 Сповіщення про світло", callback_data: "n" }]] });

// Список спільних віджетів: [{id, ver}] — оновлюємо всі (старі версії теж, щоб у людей не «застигали» картки)
async function widgets(env) { try { return JSON.parse(await kvGet(env, "pub:widgets") || "[]"); } catch (e) { return []; } }

async function sendCard(env, chat, first) {
  // 13.11.2026 Telegram вимкнув картки-віджети для всіх ботів. Поки так — стан черг повідомленням із кнопками;
  // раз на 6 год пробуємо знову, і щойно Telegram дозволить — бот сам почне надсилати картки.
  const off = +(await kvGet(env, "pub:wdg_off") || 0);
  if (off && Date.now() - off < 6 * 3600000) return sendStatus(env, chat, first);
  const S = await snapshot(env), data = compact(S), list = await widgets(env), cur = list.find(w => w.ver === WIDGET_VER);
  let r;
  if (cur) r = await tg(env, "sendSharedWidget", { chat_id: chat, widget_id: cur.id, caption: CAPTION, reply_markup: keyboard(S) });
  if (!cur || (!r.ok && /widget/i.test(String(r.description || "")) && /not found|invalid|expired/i.test(String(r.description || "")))) {
    r = await tg(env, "sendWidget", { chat_id: chat, html: WIDGET_HTML, public_data: data, is_shared: true, caption: CAPTION, reply_markup: keyboard(S) });
    const id = r.ok && r.result && r.result.widget && r.result.widget.id;
    if (id) { await kvSet(env, "pub:widgets", JSON.stringify([...list.filter(w => w.id !== id), { id, ver: WIDGET_VER, at: Date.now() }].slice(-5))); await kvSet(env, "pub:last", data); }
  }
  if (r && r.ok && r.result && r.result.message_id) {   // картку — нагору чату (закріпити), щоб завжди була під рукою
    if (first) await tg(env, "pinChatMessage", { chat_id: chat, message_id: r.result.message_id, disable_notification: true });
    if (off) await kvSet(env, "pub:wdg_off", "0");
  } else if (r && !r.ok) {
    if (/NOT_ALLOWED/i.test(String(r.description || ""))) await kvSet(env, "pub:wdg_off", String(Date.now()));
    return sendStatus(env, chat, first);
  }
  return r;
}
async function onUpdate(env, u) {
  const m = u.message;                                  // змінені повідомлення не обробляємо
  if (m && m.chat && m.chat.type === "private") {
    // ⚠️ відповідаємо лише на повідомлення людини: службові («прикріплює…»), від ботів і без тексту — пропускаємо,
    // інакше закріплення стану породжує нове оновлення → новий стан → нове закріплення… (так було 17.11 о 20:07)
    if ((m.from && m.from.is_bot) || m.pinned_message || typeof m.text !== "string") return;
    const now = Date.now();
    const prev = await env.DB.prepare("SELECT last_ts, n FROM pub_users WHERE chat_id=?").bind(m.chat.id).first();
    await env.DB.prepare("INSERT INTO pub_users(chat_id,first_ts,last_ts,n) VALUES(?,?,?,1) ON CONFLICT(chat_id) DO UPDATE SET last_ts=excluded.last_ts, n=n+1").bind(m.chat.id, now, now).run();
    if (prev && now - prev.last_ts < 2000) return;      // запобіжник: не частіше ніж раз на 2 с
    const first = !prev;
    const t = String(m.text || "");
    if (/^\/(notify|alerts?)\b/.test(t)) return tg(env, "sendMessage", { chat_id: m.chat.id, parse_mode: "HTML", ...(await notifyMenu(env, m.chat.id)) });
    if (/^\/status\b/.test(t)) return sendStatus(env, m.chat.id, false);
    if (/^\/help/.test(t)) {
      const S = await snapshot(env);
      return tg(env, "sendMessage", { chat_id: m.chat.id, parse_mode: "HTML", reply_markup: keyboard(S),
        text: "💡 <b>Світло В Славутичі</b>\n\nПовідомлення зі станом черг показує, де є світло, а де немає, і графік відключень.\n• Натисніть на чергу — покажу графік на сьогодні й завтра і коли наступне відключення.\n• 🔄 — оновити стан у тому самому повідомленні.\n• /notify — 🔔 сповіщення: світло зникло, з'явилось і за 10 хв до планового відключення.\n• /status або /start — надіслати стан ще раз.\n\nСтан визначають пристрої в будинках кожної черги — це факт, а не графік." });
    }
    return sendCard(env, m.chat.id, first);
  }
  if (u.callback_query) return onCallback(env, u.callback_query);
  if (u.widget_query) return tg(env, "answerWidgetQuery", { widget_query_id: u.widget_query.id });   // віджет запитів не надсилає — про всяк випадок відповідаємо
}

// Раз на хвилину: свіжі дані → оновити спільні картки, знайти події (світло зникло/з'явилось, скоро відключення) і розіслати сповіщення
async function tick(env) {
  await init(env);
  const list = await widgets(env);
  const subs = await env.DB.prepare("SELECT 1 FROM subs LIMIT 1").first();
  const pending = await env.DB.prepare("SELECT 1 FROM outbox LIMIT 1").first();
  if (!list.length && !subs && !env.FCM_SA && !pending) return { skipped: "нікому нічого не потрібно" };   // основний бот не смикаємо
  const out = {};
  if (list.length || subs || env.FCM_SA) {
    const S = await snapshot(env, true);
    if (list.length) out.cards = await refresh(env, S, list);
    out.events = await events(env, S);
  }
  if (pending || (out.events && out.events.length)) out.sent = await drainAll(env);
  return out;
}
async function refresh(env, S, list) {
  const data = compact(S), last = await kvGet(env, "pub:last");
  const prev = (() => { try { return JSON.parse(last || "null"); } catch (e) { return null; } })();
  // «оновлено о…» змінюється щохвилини; без змін стану картку оновлюємо раз на 10 хв, щоб не смикати Telegram
  const same = prev && JSON.stringify(prev.q) === JSON.stringify(JSON.parse(data).q) && Math.floor(Date.now() / 60000) - prev.t < 10;
  if (same) return { skipped: "без змін" };
  const res = [];
  for (const w of list) res.push((await tg(env, "editSharedWidgetData", { widget_id: w.id, public_data: data, cache_time: 60 })).ok);
  await kvSet(env, "pub:last", data);
  return { updated: res };
}

// ------------------------- 🔔 Сповіщення -------------------------
// Підписки в Telegram (таблиця subs) і теми Firebase для застосунку: q_<черга> — світло зникло/з'явилось, w_<черга> — за 10 хв до відключення.
const topic = (kind, q) => (kind === "warn" ? "w_" : "q_") + String(q).replace(/[^A-Za-z0-9\-_.~]/g, "_");
async function notifyMenu(env, chat) {
  const S = await snapshot(env);
  const mine = (await env.DB.prepare("SELECT queue FROM subs WHERE chat_id=?").bind(chat).all()).results.map(r => r.queue);
  const w = await env.DB.prepare("SELECT warn FROM notif WHERE chat_id=?").bind(chat).first();
  const warn = !w || w.warn !== 0;
  const qs = S.queues.map(q => q.name), rows = [];
  for (let i = 0; i < qs.length; i += 3) rows.push(qs.slice(i, i + 3).map(n => ({ text: (mine.includes(n) ? "✅ " : "▫️ ") + n, callback_data: "nq:" + n })));
  rows.push([{ text: (warn ? "✅" : "▫️") + " ⏰ За 10 хв до відключення", callback_data: "nw" }]);
  rows.push([{ text: "Готово", callback_data: "nd" }]);
  const text = "🔔 <b>Сповіщення про світло</b>\n\nПозначте свої черги — бот напише, коли світло <b>зникне</b> чи <b>з'явиться</b>" + (warn ? ", і <b>за 10 хв</b> до планового відключення" : "") + ".\n\n" +
    (mine.length ? "Зараз: " + mine.sort().map(n => "черга " + n).join(", ") : "Зараз сповіщень немає.");
  return { text, reply_markup: { inline_keyboard: rows } };
}
async function onCallback(env, cq) {
  const chat = cq.message && cq.message.chat && cq.message.chat.id, d = String(cq.data || "");
  if (!chat) return tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  let note = "";
  if (d === "r" || d.startsWith("e:")) {                // розкрити/згорнути чергу або оновити — у тому самому повідомленні
    const kb = (cq.message.reply_markup && cq.message.reply_markup.inline_keyboard) || [];
    const open = kb.flat().filter(b => /^▾ /.test(b.text || "") && /^e:/.test(b.callback_data || "")).map(b => b.callback_data.slice(2));
    if (d.startsWith("e:")) { const q = d.slice(2); const i = open.indexOf(q); if (i >= 0) open.splice(i, 1); else open.push(q); }
    const S = await snapshot(env), v = statusView(S, open, await myQueues(env, chat));
    const e = await tg(env, "editMessageText", { chat_id: chat, message_id: cq.message.message_id, parse_mode: "HTML", disable_web_page_preview: true, ...v });
    return tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: d === "r" ? (e.ok ? `Оновлено: дані на ${fmtTime(S.now)}` : `Без змін: дані на ${fmtTime(S.now)}`) : "" });
  }
  if (d === "n") { await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }); return tg(env, "sendMessage", { chat_id: chat, parse_mode: "HTML", ...(await notifyMenu(env, chat)) }); }
  if (d.startsWith("nq:")) {
    const q = d.slice(3).slice(0, 20);
    const del = await env.DB.prepare("DELETE FROM subs WHERE chat_id=? AND queue=?").bind(chat, q).run();
    if (!del.meta.changes) { await env.DB.prepare("INSERT OR IGNORE INTO subs(chat_id,queue) VALUES(?,?)").bind(chat, q).run(); note = `🔔 Черга ${q}: сповіщення увімкнено`; }
    else note = `🔕 Черга ${q}: сповіщення вимкнено`;
  } else if (d === "nw") {
    const w = await env.DB.prepare("SELECT warn FROM notif WHERE chat_id=?").bind(chat).first();
    const nv = w && w.warn === 0 ? 1 : 0;
    await env.DB.prepare("INSERT INTO notif(chat_id,warn) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET warn=excluded.warn").bind(chat, nv).run();
    note = nv ? "⏰ Попередження за 10 хв увімкнено" : "Попередження за 10 хв вимкнено";
  } else if (d === "nd") {
    const mine = (await env.DB.prepare("SELECT queue FROM subs WHERE chat_id=?").bind(chat).all()).results.map(r => r.queue).sort();
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    return tg(env, "editMessageText", { chat_id: chat, message_id: cq.message.message_id, parse_mode: "HTML",
      text: mine.length ? `🔔 Готово! Сповіщення: ${mine.map(n => "черга " + n).join(", ")}.\nЗмінити — /notify` : "🔕 Сповіщень немає. Увімкнути — /notify" });
  }
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: note });
  return tg(env, "editMessageText", { chat_id: chat, message_id: cq.message.message_id, parse_mode: "HTML", ...(await notifyMenu(env, chat)) });
}

// Події: порівнюємо з попереднім знімком (pub:prev); попередження — раз на кожне відключення (pub:warned)
function kyivMidnight(S) { const [d, m, y] = S.d0.split(".").map(Number); return Date.UTC(y, m - 1, d) - S.off * 60000; }
function nextOutage(q, S, now) {                        // найближчий початок відключення за графіком: {start, end} (мс)
  const base = kyivMidnight(S), all = [];
  for (const [a, b] of q.today || []) all.push([base + a * 60000, base + b * 60000]);
  for (const [a, b] of q.tomorrow || []) all.push([base + (1440 + a) * 60000, base + (1440 + b) * 60000]);
  all.sort((x, y) => x[0] - y[0]);
  for (let i = 0; i < all.length; i++) {
    if (i && all[i - 1][1] >= all[i][0]) continue;     // продовження попереднього (через північ) — не новий початок
    if (all[i][0] > now) { let e = all[i][1]; for (let j = i + 1; j < all.length && all[j][0] <= e; j++) e = Math.max(e, all[j][1]); return { start: all[i][0], end: e }; }
  }
  return null;
}
function inOutage(q, S, now) {                           // чи зараз відключення за графіком: кінець (мс) або 0
  const base = kyivMidnight(S);
  for (const [a, b] of q.today || []) if (base + a * 60000 <= now && now < base + b * 60000) return base + b * 60000;
  return 0;
}
const at = (ms, S) => fmtTime(ms) + (fmtDate(ms) !== fmtDate(S.now) ? " (" + fmtDate(ms).slice(0, 5) + ")" : "");
function evLost(q, p, S) {
  const t = q.since || S.now, end = inOutage(q, S, t + 60000);
  const plan = end ? `🗓 За графіком відключення до ${at(end, S)}` : "🗓 Позапланово (за графіком світло мало бути)";
  const was = p[1] ? `\n☀️ Світло було: ${dur(t - p[1])}` : "";
  return { kind: "lost", q: q.name, title: `🔴 Черга ${q.name}: світло зникло`, body: `о ${fmtTime(t)}` + (p[1] ? ` · було ${dur(t - p[1])}` : "") + (end ? ` · за графіком до ${at(end, S)}` : " · позапланово"),
    text: `🔴 <b>Черга ${q.name}: світло зникло</b>\n🕓 о ${fmtTime(t)}${was}\n${plan}` };
}
function evBack(q, p, S) {
  const t = q.since || S.now, nx = nextOutage(q, S, t);
  const was = p[1] ? `\n🌑 Світла не було: ${dur(t - p[1])}` : "";
  const next = nx ? `\n🗓 Наступне відключення за графіком: ${at(nx.start, S)}–${at(nx.end, S)}` : "";
  return { kind: "back", q: q.name, title: `🟢 Черга ${q.name}: світло з'явилось`, body: `о ${fmtTime(t)}` + (p[1] ? ` · не було ${dur(t - p[1])}` : "") + (nx ? ` · далі за графіком ${at(nx.start, S)}` : ""),
    text: `🟢 <b>Черга ${q.name}: світло з'явилось</b>\n🕓 о ${fmtTime(t)}${was}${next}` };
}
function evWarn(q, nx, S, now) {
  const m = Math.max(1, Math.round((nx.start - now) / 60000));
  return { kind: "warn", q: q.name, title: `⏰ Черга ${q.name}: за ${m} хв відключення`, body: `за графіком ${at(nx.start, S)}–${at(nx.end, S)}`,
    text: `⏰ <b>Черга ${q.name}: за ${m} хв відключення за графіком</b>\n🕓 ${at(nx.start, S)}–${at(nx.end, S)}` };
}
async function events(env, S) {
  const now = Date.now(), evs = [];
  let prev = null, warned = {};
  try { prev = JSON.parse(await kvGet(env, "pub:prev") || "null"); } catch (e) {}
  try { warned = JSON.parse(await kvGet(env, "pub:warned") || "{}"); } catch (e) {}
  const cur = {};
  for (const q of S.queues) cur[q.name] = [q.state, q.since || 0];
  if (prev && prev.t === S.now) return [];               // ті самі дані, що й минулого разу (основний бот недоступний)
  if (prev) for (const q of S.queues) {
    const p = prev.q[q.name];
    if (!p) continue;
    if (p[0] === 1 && q.state === 0) evs.push(evLost(q, p, S));
    else if (p[0] === 0 && q.state === 1) evs.push(evBack(q, p, S));
  }
  let wch = false;
  for (const q of S.queues) {
    if (q.state === 0) continue;                         // світла вже немає — попереджати нема про що
    const nx = nextOutage(q, S, now);
    if (!nx || nx.start - now > 10.5 * 60000 || warned[q.name] === nx.start) continue;
    evs.push(evWarn(q, nx, S, now)); warned[q.name] = nx.start; wch = true;
  }
  if (!prev || JSON.stringify(prev.q) !== JSON.stringify(cur) || evs.length) await kvSet(env, "pub:prev", JSON.stringify({ t: S.now, q: cur }));
  if (wch) await kvSet(env, "pub:warned", JSON.stringify(warned));
  for (const ev of evs) await deliver(env, ev);
  return evs.map(e => e.kind + ":" + e.q);
}
async function deliver(env, ev) {
  const sql = ev.kind === "warn"
    ? "INSERT INTO outbox(chat_id,text,at) SELECT s.chat_id, ?, ? FROM subs s LEFT JOIN notif n ON n.chat_id=s.chat_id WHERE s.queue=? AND COALESCE(n.warn,1)=1"
    : "INSERT INTO outbox(chat_id,text,at) SELECT chat_id, ?, ? FROM subs WHERE queue=?";
  await env.DB.prepare(sql).bind(ev.text, Date.now(), ev.q).run();
  if (env.FCM_SA) await fcmSend(env, topic(ev.kind, ev.q), { kind: ev.kind, q: ev.q, title: ev.title, body: ev.body, at: String(Date.now()) }, ev.kind === "warn" ? "600s" : "3600s").catch(e => fcmErr(env, String(e && e.message || e)));
}
// Розсилка в Telegram: до 40 повідомлень за раз; більше — кличемо самого себе (SELF) ще кілька разів паралельно
async function drain(env, max) {
  const now = Date.now();
  const rows = (await env.DB.prepare("UPDATE outbox SET claim=?, tries=tries+1 WHERE id IN (SELECT id FROM outbox WHERE claim < ? ORDER BY id LIMIT ?) RETURNING id, chat_id, text, tries").bind(now, now - 120000, max).all()).results;
  const done = [], gone = [], back = [];
  let stop = false;
  for (const r of rows) {
    if (stop) { back.push(r.id); continue; }
    const j = await tg(env, "sendMessage", { chat_id: r.chat_id, text: r.text, parse_mode: "HTML", disable_web_page_preview: true });
    if (j.ok) done.push(r.id);
    else if (j.error_code === 429) { stop = true; back.push(r.id); }                     // Telegram просить пригальмувати — решта наступного разу
    else if (j.error_code === 403 || /chat not found|deactivated|blocked/i.test(String(j.description || ""))) { done.push(r.id); gone.push(r.chat_id); }
    else if (r.tries >= 3) done.push(r.id);
    else back.push(r.id);
  }
  const ids = l => l.join(",");
  if (done.length) await env.DB.prepare(`DELETE FROM outbox WHERE id IN (${ids(done)})`).run();
  if (back.length) await env.DB.prepare(`UPDATE outbox SET claim=0 WHERE id IN (${ids(back)})`).run();
  if (gone.length) await env.DB.prepare(`DELETE FROM subs WHERE chat_id IN (${ids([...new Set(gone)])})`).run();   // заблокували бота — більше не пишемо
  return { sent: done.length - gone.length, left: back.length, slow: stop };
}
async function drainAll(env) {
  const r = await drain(env, 15);
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM outbox WHERE claim < ?").bind(Date.now() - 120000).first()).n;
  if (!n || r.slow || !env.SELF) return r.sent;
  const k = Math.min(6, Math.ceil(n / 40)), key = await secret(env);
  const res = await Promise.all(Array.from({ length: k }, () => env.SELF.fetch("https://svitlo-public/drain", { method: "POST", headers: { "x-drain": key } }).then(x => x.json()).catch(() => ({ sent: 0 }))));
  return r.sent + res.reduce((a, x) => a + (x.sent || 0), 0);
}

// Firebase Cloud Messaging (застосунок на телефоні): ключ сервісного акаунта — секрет FCM_SA (JSON)
let FCM_TOK = null;
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = s => b64u(new TextEncoder().encode(s));
async function fcmToken(env, force) {
  const now = Date.now();
  if (!force && FCM_TOK && FCM_TOK.exp > now + 60000) return FCM_TOK.t;
  if (!force) { try { const s = JSON.parse(await kvGet(env, "pub:fcmtok") || "null"); if (s && s.exp > now + 60000) { FCM_TOK = s; return s.t; } } catch (e) {} }
  let sa; try { sa = JSON.parse(env.FCM_SA); } catch (e) { throw new Error("FCM_SA — не JSON (вставте вміст файлу ключа повністю)"); }
  if (!sa.private_key || !sa.client_email || !sa.project_id) throw new Error("у FCM_SA немає private_key / client_email / project_id — це не той файл?");
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000), aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud, iat, exp: iat + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch(aud, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + b64u(sig) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("Google не видав доступ: " + (j.error_description || j.error || r.status));
  FCM_TOK = { t: j.access_token, exp: now + (Math.min(+j.expires_in || 3600, 3600) - 120) * 1000 };
  await kvSet(env, "pub:fcmtok", JSON.stringify(FCM_TOK));
  return FCM_TOK.t;
}
async function fcmSend(env, tpc, data, ttl, again) {
  const sa = JSON.parse(env.FCM_SA), tok = await fcmToken(env, again);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ message: { topic: tpc, data, android: { priority: "HIGH", ttl } } }) });
  if (r.status === 401 && !again) return fcmSend(env, tpc, data, ttl, true);
  if (!r.ok) { const t = await r.text().catch(() => ""); await fcmErr(env, `${tpc}: ${r.status} ${t.slice(0, 200)}`); return false; }
  return true;
}
async function fcmErr(env, d) {
  let l = []; try { l = JSON.parse(await kvGet(env, "pub:fcmerr") || "[]"); } catch (e) {}
  l.push({ at: Date.now(), d: String(d).slice(0, 300) });
  await kvSet(env, "pub:fcmerr", JSON.stringify(l.slice(-10)));
}

async function setup(env, origin) {
  const out = [];
  if (!env.BOT_TOKEN) return "❌ Немає секрету BOT_TOKEN. Cloudflare → цей воркер → Settings → Variables and Secrets → Add → Secret: BOT_TOKEN = токен від @BotFather.";
  await init(env);
  const me = await tg(env, "getMe", {});
  if (!me.ok) return "❌ Токен не підходить: " + (me.description || "") + "\nПеревірте BOT_TOKEN (копіюйте повністю, разом із двокрапкою).";
  const wh = await tg(env, "setWebhook", { url: `${origin}/tg`, secret_token: await secret(env), allowed_updates: ["message", "edited_message", "callback_query", "widget_query"], drop_pending_updates: false });
  out.push(wh.ok ? `✅ Вебхук встановлено: ${origin}/tg` : "❌ Вебхук: " + wh.description);
  await tg(env, "setMyCommands", { commands: [{ command: "start", description: "Показати картку зі станом черг" }, { command: "notify", description: "🔔 Сповіщення про світло" }, { command: "status", description: "Стан черг текстом" }, { command: "help", description: "Як користуватися" }] });
  await tg(env, "setMyDescription", { description: "💡 Світло В Славутичі: наживо — де є світло, а де немає, і графік відключень по чергах. Натисніть «Почати»." });
  await tg(env, "setMyShortDescription", { short_description: "Наживо: де є світло в Славутичі, і графік відключень" });
  out.push(`🤖 Бот: @${me.result.username}`);
  let S = null;
  try { S = await pull(env); await kvSet(env, "pub:snap", JSON.stringify({ at: Date.now(), S })); SNAP = S; SNAP_TS = Date.now(); } catch (e) { out.push("❌ " + (e && e.message || e) + `\nПеревірте: ${MAIN(env)}/api/status має відкриватися (основний бот 4.0.5+, увімкнена публічна сторінка).`); }
  if (S) out.push(`📊 Дані з основного бота (${MAIN(env)}): черг ${S.queues.length}; для картки ${compact(S).length} байт (межа 1024)`);
  out.push(`🧩 Віджет: ${new TextEncoder().encode(WIDGET_HTML).length} байт`);
  if (env.FCM_SA) { try { await fcmToken(env, true); out.push(`📲 Firebase: ✅ (проєкт ${JSON.parse(env.FCM_SA).project_id})`); } catch (e) { out.push("📲 Firebase: ❌ " + (e && e.message || e)); } }
  else out.push("📲 Firebase: ще не налаштовано (секрет FCM_SA) — сповіщення лише в Telegram");
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
        const H = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=60" };
        try { return new Response(JSON.stringify(statusJson(await snapshot(env))), { headers: H }); }
        catch (e) { return new Response(JSON.stringify({ v: 1, error: String(e && e.message || e) }), { status: 503, headers: { ...H, "cache-control": "no-store" } }); }
      }
      if (p === "/drain" && req.method === "POST") {                 // помічник розсилки (виклик самого себе, щоб розіслати швидше)
        await init(env);
        if (req.headers.get("x-drain") !== await secret(env)) return new Response("forbidden", { status: 403 });
        return new Response(JSON.stringify(await drain(env, 40)), { headers: { "content-type": "application/json" } });
      }
      if (p === "/setup") return new Response(await setup(env, u.origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (p === "/widget-preview") return new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="max-width:420px;margin:20px auto;background:#17212b;color:#fff;--tg-theme-text-color:#fff;--tg-theme-hint-color:#8b9bb4;--tg-theme-button-color:#5288c1"><script>window.TelegramWidget={publicData:${JSON.stringify(compact(await snapshot(env)))},onEvent(){},ready(){}}</script>${WIDGET_HTML}`, { headers: { "content-type": "text/html; charset=utf-8" } });
      await init(env);
      let sn = null; try { sn = JSON.parse(await kvGet(env, "pub:snap") || "null"); } catch (e) {}
      const st = !sn ? "даних ще не було (вони з'являться після першого звернення)" : (sn.S ? `дані від ${fmtTime(sn.S.now)}, ${fmtDate(sn.S.now)}` : "даних немає") + (sn.err && sn.err.at > (sn.at || 0) ? `\n⚠️ Останнє звернення до основного бота (${fmtTime(sn.err.at)}): ${sn.err.msg}` : "");
      let errs = []; try { errs = JSON.parse(await kvGet(env, "pub:tgerr") || "[]"); } catch (e) {}
      const el = errs.length ? "\n\nОстанні помилки Telegram:\n" + errs.slice().reverse().map(e => `${fmtDate(e.at)} ${fmtTime(e.at)}  ${e.m}: ${e.c} ${e.d}`).join("\n") : "";
      let fe = []; try { fe = JSON.parse(await kvGet(env, "pub:fcmerr") || "[]"); } catch (e) {}
      const ns = await env.DB.prepare("SELECT (SELECT COUNT(DISTINCT chat_id) FROM subs) s, (SELECT COUNT(*) FROM outbox) o, (SELECT COUNT(*) FROM pub_users) u").first();
      const fl = `\nКористувачів: ${ns.u}; підписаних на сповіщення: ${ns.s}; у черзі на надсилання: ${ns.o}\nFirebase: ${env.FCM_SA ? "налаштовано" : "не налаштовано"}` + (fe.length ? "\nОстанні помилки Firebase:\n" + fe.slice().reverse().map(e => `${fmtDate(e.at)} ${fmtTime(e.at)}  ${e.d}`).join("\n") : "");
      return new Response(`💡 Світло В Славутичі — бот для мешканців працює.\nДжерело: ${MAIN(env)}/api/status — ${st}\nДані для віджета: /status.json\nНалаштування бота: /setup${fl}${el}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      return new Response("Помилка: " + (e && e.message || e), { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.BOT_TOKEN) return;
    ctx.waitUntil(tick(env).catch(e => console.error("tick", e)));
  },
};
