// =============================================================================
// 💡 Світло В Славутичі — бот для мешканців і дані для застосунку на телефоні.
//
//  • Telegram: усе на кнопках. Спершу людина обирає свої черги (одну чи кілька), далі — кнопки внизу екрана:
//      💡 Стан      — чи є зараз світло у своїх чергах, з якого часу, коли наступне відключення;
//      📅 Графік    — на сьогодні й завтра, кожен проміжок окремим рядком;
//      🗓 Перетини  — порівняти кілька черг (як в адмін-боті): коли де є світло, а де немає;
//      🔔 Сповіщення — світло зникло / з'явилось, ⏰ за 10 хв до відключення, 📅 з'явився чи змінився графік;
//      ⚙️ Мої черги  — які черги показувати.
//    Нічого не закріплює.
//  • /status.json — дані для застосунку «Світло В Славутичі» (віджет на робочий стіл Android).
//  • Firebase — ті самі сповіщення в застосунок: теми q_<черга> (зникло/з'явилось), w_<черга> (за 10 хв), s_<черга> (графік).
//  • Web Push — ті самі сповіщення в браузер (сайт «Світло В Славутичі»): /wp/key, /wp/sub, /wp/unsub, /wp/get, /wp/test.
//
// Дані бере в основного бота (svitlo51, /api/status — з версії 4.0.5) раз на хвилину, а не на кожен запит.
// Своя база D1 (svitlo-public); до бази основного бота доступу не має.
// Секрети в Cloudflare: BOT_TOKEN (токен бота від @BotFather), FCM_SA (ключ Firebase). Необов'язково: MAIN_URL, SITE_URL.
// =============================================================================

import { genVapid, validSub, webPush } from "./webpush.js";

const MAIN = env => String(env.MAIN_URL || "https://svitlo51.a-m-vasylets.workers.dev").replace(/\/+$/, "");
const MAP_DEFAULT = "https://desperadoav.github.io/Svitlo_in_Slavutych/";

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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS myq (chat_id INTEGER, queue TEXT, PRIMARY KEY (chat_id, queue))"),           // які черги показувати
    env.DB.prepare("CREATE TABLE IF NOT EXISTS subs (chat_id INTEGER, queue TEXT, PRIMARY KEY (chat_id, queue))"),          // сповіщення: на які черги
    env.DB.prepare("CREATE TABLE IF NOT EXISTS notif (chat_id INTEGER PRIMARY KEY, warn INTEGER DEFAULT 1)"),               // попередження за 10 хв: 1 так, 0 ні
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pref (chat_id INTEGER, k TEXT, v TEXT, PRIMARY KEY (chat_id, k))"),          // s — про графік (0 — ні), x — черги для перетинів, ui — версія меню
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, text TEXT, at INTEGER, claim INTEGER DEFAULT 0, tries INTEGER DEFAULT 0)"),   // черга сповіщень
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wpush (id INTEGER PRIMARY KEY AUTOINCREMENT, ep TEXT UNIQUE, p256dh TEXT, auth TEXT, queues TEXT, warn INTEGER DEFAULT 1, sched INTEGER DEFAULT 1, at INTEGER)"),   // браузери: черги «,3.2,6.1,»
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wpout (id INTEGER PRIMARY KEY AUTOINCREMENT, sid INTEGER, payload TEXT, at INTEGER, claim INTEGER DEFAULT 0, tries INTEGER DEFAULT 0)"),               // черга сповіщень у браузери
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
// Дані для застосунку на телефоні (читабельний JSON)
function statusJson(S) {
  return {
    v: 1, now: S.now, today: S.d0, tomorrow: S.d1, kyiv_offset_min: S.off, map: S.map, site: S.site,
    queues: S.queues.map(x => ({ name: x.name, state: x.state === 1 ? "on" : x.state === 0 ? "off" : "unknown", since: x.since || null,
      today: x.today && x.today.map(([a, b]) => [hm(a), b >= 1440 ? "24:00" : hm(b)]), tomorrow: x.tomorrow && x.tomorrow.map(([a, b]) => [hm(a), b >= 1440 ? "24:00" : hm(b)]) })),
  };
}

// ------------------------- Telegram -------------------------
async function tg(env, method, body, quiet) {
  let j;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    j = await r.json();
  } catch (e) { j = { ok: false, description: String(e && e.message || e) }; }
  if (!j.ok && !quiet && !/not modified/i.test(String(j.description || ""))) await logErr(env, method, j).catch(() => {});
  return j;
}
// Останні 10 помилок Telegram — видно на головній сторінці бота (без токенів і тексту повідомлень)
async function logErr(env, method, j) {
  let l = []; try { l = JSON.parse(await kvGet(env, "pub:tgerr") || "[]"); } catch (e) {}
  l.push({ at: Date.now(), m: method, c: j.error_code || 0, d: String(j.description || "").slice(0, 300) });
  await kvSet(env, "pub:tgerr", JSON.stringify(l.slice(-10)));
}
async function secret(env) {                            // секрет вебхука — з токена, щоб нічого окремо не налаштовувати
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("svitlo-pub:" + env.BOT_TOKEN));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const send = (env, chat, v) => tg(env, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true, ...v });

// ------------------------- що й як показувати -------------------------
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? `${d} д ${h} год` : h ? `${h} год ${m % 60} хв` : `${m % 60} хв`; };
const hours = m => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} год ${r} хв` : h ? `${h} год` : `${r} хв`; };
const span = ([a, b]) => hm(a) + " – " + hm(b);
const total = l => l.reduce((s, [a, b]) => s + b - a, 0);
const listUa = l => l.length > 1 ? l.slice(0, -1).join(", ") + " і " + l[l.length - 1] : l.join("");
const DAYS = ["неділя", "понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота"];
const dayName = d => { const [dd, mm, yy] = String(d).split(".").map(Number); return DAYS[new Date(Date.UTC(yy, mm - 1, dd, 12)).getUTCDay()] || ""; };
const dayTitle = (S, d) => { const x = d ? S.d1 : S.d0; return `${d ? "завтра" : "сьогодні"}, ${x.slice(0, 5)} (${dayName(x)})`; };
const names = S => S.queues.map(q => q.name);
const inOrder = (S, l) => names(S).filter(n => l.includes(n));          // лише наявні черги, у порядку основного бота
const qOf = (S, n) => S.queues.find(q => q.name === n);

// Кнопки внизу екрана (завжди під рукою, навіть коли прийшло сповіщення)
const MENU = { keyboard: [[{ text: "💡 Стан" }, { text: "📅 Графік" }, { text: "🗓 Перетини" }], [{ text: "🔔 Сповіщення" }, { text: "⚙️ Мої черги" }]],
  resize_keyboard: true, is_persistent: true, input_field_placeholder: "Кнопки меню — нижче 👇" };
const WELCOME = "💡 <b>Світло В Славутичі</b>\n\nПокажу, чи є світло у вашій черзі, графік відключень і перетини черг. 🔔 Сповіщення прийдуть, щойно світло зникне чи з'явиться, і коли з'явиться графік на завтра.\n\nМеню — кнопки внизу екрана 👇";
const HELP = "💡 <b>Світло В Славутичі</b>\n\nКнопки внизу екрана:\n\n" +
  "💡 <b>Стан</b> — чи є зараз світло у ваших чергах, з якого часу і коли наступне відключення.\n\n" +
  "📅 <b>Графік</b> — відключення на сьогодні й завтра.\n\n" +
  "🗓 <b>Перетини</b> — порівняти кілька черг: коли де є світло, а де немає.\n\n" +
  "🔔 <b>Сповіщення</b> — світло зникло чи з'явилось, ⏰ за 10 хв до відключення, 📅 з'явився чи змінився графік.\n\n" +
  "⚙️ <b>Мої черги</b> — які черги показувати.\n\n" +
  "Стан визначають пристрої в будинках кожної черги — це факт, а не графік.\nКнопки зникли? Надішліть /start.";

// ------------------------- мої черги й налаштування -------------------------
const rowsQ = async (env, tbl, chat) => (await env.DB.prepare(`SELECT queue FROM ${tbl} WHERE chat_id=?`).bind(chat).all()).results.map(r => r.queue);
async function prefGet(env, chat, k) { const r = await env.DB.prepare("SELECT v FROM pref WHERE chat_id=? AND k=?").bind(chat, k).first(); return r ? r.v : null; }
const prefSet = (env, chat, k, v) => env.DB.prepare("INSERT INTO pref(chat_id,k,v) VALUES(?,?,?) ON CONFLICT(chat_id,k) DO UPDATE SET v=excluded.v").bind(chat, k, String(v)).run();
async function myQueues(env, chat, S) {                 // ще не обирав, але має сповіщення (зі старого меню) — беремо ті черги
  let l = await rowsQ(env, "myq", chat);
  if (!l.length) { l = await rowsQ(env, "subs", chat); if (l.length) await env.DB.prepare("INSERT OR IGNORE INTO myq(chat_id,queue) SELECT ?, value FROM json_each(?)").bind(chat, JSON.stringify(l)).run(); }
  return inOrder(S, l);
}
async function toggle(env, tbl, chat, q) {               // була — прибрати, не було — додати; true — додано
  const del = await env.DB.prepare(`DELETE FROM ${tbl} WHERE chat_id=? AND queue=?`).bind(chat, q).run();
  if (del.meta.changes) return false;
  await env.DB.prepare(`INSERT OR IGNORE INTO ${tbl}(chat_id,queue) VALUES(?,?)`).bind(chat, q).run();
  return true;
}
const notifOpts = async (env, chat) => {
  const w = await env.DB.prepare("SELECT warn FROM notif WHERE chat_id=?").bind(chat).first();
  return { warn: !w || w.warn !== 0, sched: (await prefGet(env, chat, "s")) !== "0" };
};
function grid(S, sel, pre) {                            // черги кнопками по 3 в ряд: ✅ — обрано
  const qs = names(S), rows = [];
  for (let i = 0; i < qs.length; i += 3) rows.push(qs.slice(i, i + 3).map(n => ({ text: (sel.includes(n) ? "✅ " : "▫️ ") + n, callback_data: pre + n })));
  return rows;
}

// ⚙️ Мої черги (і перший вибір)
function queuesView(S, mine) {
  const text = mine.length
    ? "⚙️ <b>Мої черги</b>\n\nПозначте черги, які показувати, — можна кілька (наприклад, дім і робота).\n\nЗараз: " + mine.join(", ")
    : "👋 <b>Оберіть свою чергу</b>\n\nМожна кілька — наприклад, дім і робота. Номер черги видно на мапі 🗺.\nПозначте черги й натисніть «Готово».";
  const kb = grid(S, mine, "qq:");
  kb.push([{ text: "✅ Готово", callback_data: "qd" }]);
  kb.push([{ text: "🗺 Мапа черг", url: S.map }]);
  return { text, reply_markup: { inline_keyboard: kb } };
}

// 💡 Стан моїх черг: кожна черга — окремим блоком, дані одні під одними
function statusView(S, mine, offer) {
  const now = S.now, parts = [];
  for (const n of mine) {
    const q = qOf(S, n); if (!q) continue;
    const icon = q.state === 1 ? "🟢" : q.state === 0 ? "🔴" : "⚪️";
    const st = q.state === 1 ? "світло є" : q.state === 0 ? "світла немає" : "немає даних";
    const l = [`${icon} <b>Черга ${esc(q.name)} — ${st}</b>`];
    if (q.state >= 0 && q.since) l.push(`🕓 з ${at(q.since, S)} · ${dur(now - q.since)}`);
    const cur = inOutage(q, S, now), nx = nextOutage(q, S, now);
    if (cur) l.push(`⏳ за графіком відключення до ${till(cur, S)}`);
    if (nx) l.push((cur ? "⏭ далі за графіком:" : `⏭ відключення через ${dur(nx.start - now)}:`) + `\n    ⚫ ${range(nx.start, nx.end, S)}`);
    else if (!cur) l.push(q.today === null ? "🗓 графіка ще немає" : q.tomorrow === null ? "✅ сьогодні відключень більше немає" : "✅ до кінця завтра відключень немає");
    parts.push(l.join("\n    "));
  }
  const text = `💡 <b>Мої черги</b> · дані на ${fmtTime(now)}\n\n` + parts.join("\n\n");
  const kb = [[{ text: "🔄 Оновити", callback_data: "st" }, { text: "📅 Графік", callback_data: "g:0" }]];
  if (offer) kb.unshift([{ text: "🔔 Увімкнути сповіщення для " + (mine.length > 1 ? "цих черг" : "черги " + mine[0]), callback_data: "na" }]);
  kb.push([{ text: "🗺 Мапа черг", url: S.map }, { text: "🌐 Сайт", url: S.site }]);
  return { text, reply_markup: { inline_keyboard: kb } };
}

// 📅 Графік моїх черг на сьогодні (d=0) чи завтра (d=1): кожен проміжок — окремим рядком
function ivLines(l, nowMin) {
  if (l === null) return "  └ ❔ графіка ще немає";
  if (!l.length) return "  └ 💡 відключень немає";
  return l.map(x => `  └ ⚫ ${span(x)}` + (nowMin >= x[0] && nowMin < x[1] ? "  ◀️ зараз" : "")).join("\n") + `\n  <i>без світла ${hours(total(l))}</i>`;
}
function schedView(S, mine, d) {
  const nowMin = d ? -1 : Math.floor((S.now - kyivMidnight(S)) / 60000);
  const qs = mine.map(n => qOf(S, n)).filter(Boolean);
  let text = `📅 <b>Графік на ${dayTitle(S, d)}</b>\n\n` + qs.map(q => `🏢 <b>Черга ${esc(q.name)}</b>\n` + ivLines(d ? q.tomorrow : q.today, nowMin)).join("\n\n");
  if (d && qs.every(q => q.tomorrow === null)) text += "\n\n<i>Графік на завтра зазвичай з'являється ввечері. Щойно буде — бот надішле його (🔔 Сповіщення → 📅).</i>";
  return { text, reply_markup: { inline_keyboard: [
    [{ text: (d ? "" : "✅ ") + "Сьогодні", callback_data: "g:0" }, { text: (d ? "✅ " : "") + "Завтра", callback_data: "g:1" }],
    [{ text: "🗓 Перетини", callback_data: "x" }, { text: "💡 Стан", callback_data: "st" }]] } };
}

// 🗓 Перетини (як в адмін-боті): спершу вибір черг (запам'ятовується), потім день
async function cmpSel(env, chat, S) {
  const v = await prefGet(env, chat, "x");
  return v === null ? myQueues(env, chat, S) : inOrder(S, v ? v.split(",") : []);
}
function cmpMenu(S, sel) {
  const kb = grid(S, sel, "xq:");
  kb.push([{ text: "✅ На сьогодні", callback_data: "xr:0" }, { text: "✅ На завтра", callback_data: "xr:1" }]);
  return { text: "🗓 <b>Перетини</b>\n\nОберіть черги, які порівняти, і день — покажу, коли де є світло, а де немає.\n\n" +
    (sel.length ? "Обрано: " + sel.join(", ") : "Нічого не обрано — порівняю всі черги."), reply_markup: { inline_keyboard: kb } };
}
function cmpText(S, sel, d) {
  const qs = sel.map(n => qOf(S, n)).filter(Boolean), L = {};
  for (const q of qs) L[q.name] = d ? q.tomorrow : q.today;
  const head = `🗓 <b>Перетини на ${dayTitle(S, d)}</b>\n\n📝 <b>Відключення:</b>\n` + qs.map(q => `🏢 <b>Черга ${esc(q.name)}:</b>\n` +
    (L[q.name] === null ? "  └ ❔ графіка ще немає" : L[q.name].length ? L[q.name].map(x => "  └ " + span(x)).join("\n") : "  └ 🟡 світло є")).join("\n");
  const known = qs.filter(q => L[q.name] !== null);
  if (!known.length) return head + "\n\nГрафіка на цей день ще немає.";
  // відрізки дня, де в кожній черзі стан той самий (точно до хвилини)
  const pts = [...new Set([0, 1440, ...known.flatMap(q => L[q.name].flat())])].filter(m => m >= 0 && m <= 1440).sort((a, b) => a - b);
  const off = (n, m) => L[n].some(([a, b]) => a <= m && m < b), segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const sig = known.map(q => off(q.name, pts[i]) ? "1" : "0").join(""), l = segs[segs.length - 1];
    if (l && l.sig === sig) l.b = pts[i + 1]; else segs.push({ a: pts[i], b: pts[i + 1], sig });
  }
  let body = "";
  for (const s of segs) {
    let t = `🕒 <b>${span([s.a, s.b])}</b>\n`;
    if (!s.sig.includes("1")) t += "└ 🟡 Світло є всюди\n";
    else {
      t += known.map((q, i) => `🏢 ${esc(q.name)}: ${s.sig[i] === "1" ? "⚫ Відключено" : "🟡 Світло є"}`).join("\n") + "\n";
      if (!s.sig.includes("0") && known.length > 1) t += "⚠️ <i>(Немає світла ніде)</i>\n";
    }
    if (head.length + body.length + t.length > 3850) { body += "…\n"; break; }   // межа Telegram — 4096 символів
    body += t + "\n";
  }
  const miss = qs.filter(q => L[q.name] === null).map(q => q.name);
  return (head + "\n\n" + body).trim() + (miss.length ? `\n\n<i>Без графіка: ${miss.join(", ")}</i>` : "");
}
const cmpView = (S, sel, d) => ({ text: cmpText(S, sel.length ? sel : names(S), d), reply_markup: { inline_keyboard: [
  [{ text: (d ? "" : "✅ ") + "Сьогодні", callback_data: "xr:0" }, { text: (d ? "✅ " : "") + "Завтра", callback_data: "xr:1" }],
  [{ text: "◀️ Змінити черги", callback_data: "x" }]] } });

// 🔔 Сповіщення
async function notifyMenu(env, chat, S) {
  const subs = inOrder(S, await rowsQ(env, "subs", chat)), o = await notifOpts(env, chat);
  const what = ["коли світло <b>зникне</b> чи <b>з'явиться</b>"];
  if (o.warn) what.push("<b>за 10 хв</b> до планового відключення");
  if (o.sched) what.push("коли з'явиться чи зміниться <b>графік</b>");
  const kb = grid(S, subs, "nq:");
  kb.push([{ text: (o.warn ? "✅" : "▫️") + " ⏰ За 10 хв до відключення", callback_data: "nw" }]);
  kb.push([{ text: (o.sched ? "✅" : "▫️") + " 📅 Графік на завтра і зміни", callback_data: "ns" }]);
  kb.push([{ text: "Готово", callback_data: "nd" }]);
  return { text: "🔔 <b>Сповіщення про світло</b>\n\nПозначте черги — бот напише, " + listUa(what) + ".\n\n" +
    (subs.length ? "Зараз: " + subs.map(n => "черга " + n).join(", ") : "Зараз сповіщень немає."), reply_markup: { inline_keyboard: kb } };
}

// ------------------------- повідомлення й кнопки -------------------------
async function onUpdate(env, u) {
  if (u.callback_query) return onCallback(env, u.callback_query);
  const m = u.message;                                  // змінені повідомлення не обробляємо
  if (!m || !m.chat || m.chat.type !== "private") return;
  // ⚠️ відповідаємо лише на текст від людини: службові («прикріплює…»), від ботів, стікери — пропускаємо (інакше можливе зациклення)
  if ((m.from && m.from.is_bot) || m.pinned_message || typeof m.text !== "string") return;
  const chat = m.chat.id, now = Date.now();
  const prev = await env.DB.prepare("SELECT last_ts FROM pub_users WHERE chat_id=?").bind(chat).first();
  await env.DB.prepare("INSERT INTO pub_users(chat_id,first_ts,last_ts,n) VALUES(?,?,?,1) ON CONFLICT(chat_id) DO UPDATE SET last_ts=excluded.last_ts, n=n+1").bind(chat, now, now).run();
  if (prev && now - prev.last_ts < 1000) return;        // запобіжник: не частіше ніж раз на секунду
  const say = v => send(env, chat, v);
  let S; try { S = await snapshot(env); } catch (e) { return say({ text: "⚠️ Зараз немає даних від основного бота. Спробуйте за хвилину." }); }
  const t = m.text.trim(), low = t.toLowerCase(), cmd = (t.match(/^\/(\w+)/) || [])[1] || "";
  const ui = await prefGet(env, chat, "ui");
  if (ui !== "2") {                                     // уперше з новим меню: старе закріплене повідомлення зі станом — прибрати
    if (prev && ui !== "1") await tg(env, "unpinAllChatMessages", { chat_id: chat }, true);
    await prefSet(env, chat, "ui", "2");
  }
  if (cmd === "start" || ui !== "2") await say({ text: WELCOME, reply_markup: MENU });
  if (cmd === "help" || /допом/.test(low)) return say({ text: HELP, reply_markup: MENU });
  if (cmd === "notify" || /сповіщ/.test(low)) return say(await notifyMenu(env, chat, S));
  if (cmd === "compare" || /перетин/.test(low)) return say(cmpMenu(S, await cmpSel(env, chat, S)));
  const mine = await myQueues(env, chat, S);
  if (cmd === "queues" || /мої черги/.test(low) || !mine.length) return say(queuesView(S, mine));   // спершу — обрати свої черги
  if (cmd === "schedule" || /графік/.test(low)) return say(schedView(S, mine, /завтра/.test(low) ? 1 : 0));
  return say(statusView(S, mine));
}

async function onCallback(env, cq) {
  const chat = cq.message && cq.message.chat && cq.message.chat.id, d = String(cq.data || "");
  const ans = (text, alert) => tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text, show_alert: !!alert } : {}) });
  if (!chat) return ans();
  let S; try { S = await snapshot(env); } catch (e) { return ans("⚠️ Зараз немає даних — спробуйте за хвилину", true); }
  const edit = v => tg(env, "editMessageText", { chat_id: chat, message_id: cq.message.message_id, parse_mode: "HTML", disable_web_page_preview: true, ...v });
  const valid = q => names(S).includes(q);

  // 💡 стан і 📅 графік (r і e: — кнопки зі старих повідомлень)
  if (d === "st" || d === "r" || d.startsWith("e:") || d.startsWith("g:")) {
    const mine = await myQueues(env, chat, S);
    if (!mine.length) { await ans(); return edit(queuesView(S, mine)); }
    const r = await edit(d.startsWith("g:") ? schedView(S, mine, d === "g:1" ? 1 : 0) : statusView(S, mine));
    return ans(d.startsWith("g:") ? "" : r.ok ? `Оновлено: дані на ${fmtTime(S.now)}` : `Без змін: дані на ${fmtTime(S.now)}`);
  }
  // ⚙️ мої черги
  if (d === "q") { await ans(); return edit(queuesView(S, await myQueues(env, chat, S))); }
  if (d.startsWith("qq:")) {
    if (valid(d.slice(3))) await toggle(env, "myq", chat, d.slice(3));
    await ans();
    return edit(queuesView(S, inOrder(S, await rowsQ(env, "myq", chat))));
  }
  if (d === "qd") {
    const mine = inOrder(S, await rowsQ(env, "myq", chat));
    if (!mine.length) return ans("Позначте хоча б одну чергу", true);
    const subs = await env.DB.prepare("SELECT 1 FROM subs WHERE chat_id=? LIMIT 1").bind(chat).first();
    await ans("✅ Мої черги: " + mine.join(", "));
    return edit(statusView(S, mine, !subs));
  }
  // 🗓 перетини
  if (d === "x") { await ans(); return edit(cmpMenu(S, await cmpSel(env, chat, S))); }
  if (d.startsWith("xq:")) {
    const q = d.slice(3), sel = await cmpSel(env, chat, S);
    if (valid(q)) { const i = sel.indexOf(q); if (i >= 0) sel.splice(i, 1); else sel.push(q); await prefSet(env, chat, "x", inOrder(S, sel).join(",")); }
    await ans();
    return edit(cmpMenu(S, inOrder(S, sel)));
  }
  if (d.startsWith("xr:")) { await ans(); return edit(cmpView(S, await cmpSel(env, chat, S), d === "xr:1" ? 1 : 0)); }
  // 🔔 сповіщення
  let note = "";
  if (d === "n") { await ans(); return edit(await notifyMenu(env, chat, S)); }
  if (d === "na") {
    const mine = await myQueues(env, chat, S);
    if (mine.length) await env.DB.prepare("INSERT OR IGNORE INTO subs(chat_id,queue) SELECT ?, value FROM json_each(?)").bind(chat, JSON.stringify(mine)).run();
    note = "🔔 Сповіщення увімкнено: " + mine.join(", ");
  } else if (d.startsWith("nq:")) {
    const q = d.slice(3);
    if (valid(q)) note = (await toggle(env, "subs", chat, q)) ? `🔔 Черга ${q}: сповіщення увімкнено` : `🔕 Черга ${q}: сповіщення вимкнено`;
  } else if (d === "nw") {
    const nv = (await notifOpts(env, chat)).warn ? 0 : 1;
    await env.DB.prepare("INSERT INTO notif(chat_id,warn) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET warn=excluded.warn").bind(chat, nv).run();
    note = nv ? "⏰ Попередження за 10 хв увімкнено" : "Попередження за 10 хв вимкнено";
  } else if (d === "ns") {
    const nv = (await notifOpts(env, chat)).sched ? "0" : "1";
    await prefSet(env, chat, "s", nv);
    note = nv === "1" ? "📅 Повідомлятиму про графік на завтра і його зміни" : "Про графік повідомляти не буду";
  } else if (d === "nd") {
    const subs = inOrder(S, await rowsQ(env, "subs", chat)), o = await notifOpts(env, chat);
    await ans();
    return edit({ text: subs.length
      ? `🔔 Готово! Сповіщення: ${subs.map(n => "черга " + n).join(", ")}.\n${o.warn ? "✅" : "▫️"} за 10 хв до відключення · ${o.sched ? "✅" : "▫️"} графік\n\nЗмінити — кнопка «🔔 Сповіщення» внизу.`
      : "🔕 Сповіщень немає. Увімкнути — кнопка «🔔 Сповіщення» внизу." });
  } else return ans();                                  // невідома (застаріла) кнопка
  await ans(note);
  return edit(await notifyMenu(env, chat, S));
}

// Раз на хвилину: свіжі дані → події (світло зникло/з'явилось, скоро відключення, новий графік) → розсилка
async function tick(env) {
  await init(env);
  const out = {};
  const c = await env.DB.prepare("SELECT (SELECT 1 FROM subs LIMIT 1) s, (SELECT 1 FROM wpush LIMIT 1) w, (SELECT 1 FROM outbox LIMIT 1) o, (SELECT 1 FROM wpout LIMIT 1) p").first();
  const subs = c.s || c.w, pending = c.o || c.p;
  if (subs || env.FCM_SA) {                              // нікому нічого не потрібно — основний бот не смикаємо
    const S = await snapshot(env, true);
    out.events = [...await events(env, S), ...await schedEvents(env, S)];
  }
  if (pending || (out.events && out.events.length)) out.sent = await drainAll(env);
  else { const n = await unpinOld(env); if (n) out.unpinned = n; }
  if (!subs && !env.FCM_SA && !pending && !out.unpinned) out.skipped = "нікому нічого не потрібно";
  return out;
}
// Одноразово: у тих, хто користувався ботом до нового меню, прибрати закріплене повідомлення зі станом (по 10 за хвилину)
let UNPINNED = false;
async function unpinOld(env) {
  if (UNPINNED) return 0;
  const l = (await env.DB.prepare("SELECT chat_id FROM pub_users WHERE chat_id NOT IN (SELECT chat_id FROM pref WHERE k='ui') LIMIT 10").all()).results.map(r => r.chat_id);
  if (!l.length) { UNPINNED = true; return 0; }
  for (const c of l) await tg(env, "unpinAllChatMessages", { chat_id: c }, true);
  await env.DB.prepare("INSERT OR IGNORE INTO pref(chat_id,k,v) SELECT value, 'ui', '1' FROM json_each(?)").bind(JSON.stringify(l)).run();
  return l.length;
}

// ------------------------- 🔔 Сповіщення -------------------------
// Telegram: таблиця subs (+ notif.warn, pref s). Застосунок: теми Firebase q_<черга>, w_<черга>, s_<черга>.
const topic = (kind, q) => ({ warn: "w_", sched: "s_" }[kind] || "q_") + String(q).replace(/[^A-Za-z0-9\-_.~]/g, "_");
function kyivMidnight(S) { const [d, m, y] = S.d0.split(".").map(Number); return Date.UTC(y, m - 1, d) - S.off * 60000; }
function plan(q, S) {                                   // відключення сьогодні й завтра в мс, злиті (22:00–24:00 + 00:00–02:00 — одне)
  const base = kyivMidnight(S), all = [], out = [];
  for (const [a, b] of q.today || []) all.push([base + a * 60000, base + b * 60000]);
  for (const [a, b] of q.tomorrow || []) all.push([base + (1440 + a) * 60000, base + (1440 + b) * 60000]);
  all.sort((x, y) => x[0] - y[0]);
  for (const x of all) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([...x]); }
  return out;
}
function nextOutage(q, S, now) { const x = plan(q, S).find(x => x[0] > now); return x ? { start: x[0], end: x[1] } : null; }   // найближче відключення за графіком
function inOutage(q, S, now) { const x = plan(q, S).find(x => x[0] <= now && now < x[1]); return x ? x[1] : 0; }             // зараз за графіком відключення — до коли
const at = (ms, S) => fmtTime(ms) + (fmtDate(ms) !== fmtDate(S.now) ? " (" + fmtDate(ms).slice(0, 5) + ")" : "");
// проміжок: «20:00 – 24:00», «04:00 – 08:00 (18.11)», «20:00 – 04:00 (18.11)» (дата — лише коли не сьогодні, і один раз)
function range(a, b, S, sep = " – ") {
  const day = ms => fmtDate(ms) !== fmtDate(S.now) ? fmtDate(ms).slice(0, 5) : "";
  const da = day(a), db = day(b - 60000), tb = fmtTime(b) === "00:00" ? "24:00" : fmtTime(b);
  return da && da === db ? `${fmtTime(a)}${sep}${tb} (${da})` : `${fmtTime(a)}${da ? ` (${da})` : ""}${sep}${tb}${db ? ` (${db})` : ""}`;
}
const till = (ms, S) => fmtTime(ms) === "00:00" ? "24:00" + (fmtDate(ms - 60000) !== fmtDate(S.now) ? " (" + fmtDate(ms - 60000).slice(0, 5) + ")" : "") : at(ms, S);
function evLost(q, p, S) {
  const t = q.since || S.now, end = inOutage(q, S, t + 60000);
  const plan = end ? `🗓 За графіком відключення до ${till(end, S)}` : "🗓 Позапланово (за графіком світло мало бути)";
  const was = p[1] ? `\n☀️ Світло було: ${dur(t - p[1])}` : "";
  return { kind: "lost", q: q.name, title: `🔴 Черга ${q.name}: світло зникло`, body: `о ${fmtTime(t)}` + (p[1] ? ` · було ${dur(t - p[1])}` : "") + (end ? ` · за графіком до ${till(end, S)}` : " · позапланово"),
    text: `🔴 <b>${q.name}: світло зникло о ${fmtTime(t)}</b>${was}\n${plan}` };
}
function evBack(q, p, S) {
  const t = q.since || S.now, nx = nextOutage(q, S, t);
  const was = p[1] ? `\n🌑 Світла не було: ${dur(t - p[1])}` : "";
  const next = nx ? `\n🗓 Наступне відключення за графіком: ${range(nx.start, nx.end, S, "–")}` : "";
  return { kind: "back", q: q.name, title: `🟢 Черга ${q.name}: світло з'явилось`, body: `о ${fmtTime(t)}` + (p[1] ? ` · не було ${dur(t - p[1])}` : "") + (nx ? ` · далі за графіком ${at(nx.start, S)}` : ""),
    text: `🟢 <b>${q.name}: світло з'явилось о ${fmtTime(t)}</b>${was}${next}` };
}
function evWarn(q, nx, S, now) {
  const m = Math.max(1, Math.round((nx.start - now) / 60000));
  return { kind: "warn", q: q.name, title: `⏰ Черга ${q.name}: за ${m} хв відключення`, body: `за графіком ${range(nx.start, nx.end, S, "–")}`,
    text: `⏰ <b>${q.name}: відключення о ${at(nx.start, S)}</b>\n🕓 за графіком ${range(nx.start, nx.end, S, "–")}, через ${m} хв` };
}
// Події: порівнюємо з попереднім знімком (pub:prev); попередження — раз на кожне відключення (pub:warned)
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
  await webEnqueue(env, ev.kind, ev.q, { kind: ev.kind, q: ev.q, title: ev.title, body: ev.body, tag: (ev.kind === "warn" ? "w:" : "e:") + ev.q, url: "/#q=" + encodeURIComponent(ev.q), at: Date.now() });
  if (env.FCM_SA) await fcmSend(env, topic(ev.kind, ev.q), { kind: ev.kind, q: ev.q, title: ev.title, body: ev.body, at: String(Date.now()) }, ev.kind === "warn" ? "600s" : "3600s").catch(e => fcmErr(env, String(e && e.message || e)));
}

// 📅 Графік з'явився чи змінився (на сьогодні або завтра). Щоб не слати по кілька разів, поки графік вносять,
// подія — лише коли новий графік простояв без змін ≥ 90 с (pub:sched: sent — що вже повідомили, pend — що чекає).
const ivKey = l => l === null ? null : ivStr(l);
async function schedEvents(env, S) {
  const now = Date.now(), days = [S.d0, S.d1], cur = {};
  for (const d of days) { cur[d] = {}; for (const q of S.queues) cur[d][q.name] = ivKey(d === S.d0 ? q.today : q.tomorrow); }
  let sv = null; try { sv = JSON.parse(await kvGet(env, "pub:sched") || "null"); } catch (e) {}
  if (!sv || !sv.sent) { await kvSet(env, "pub:sched", JSON.stringify({ sent: cur, pend: {} })); return []; }   // перший раз — лише запам'ятати
  const sent = {}, pend = {}, evs = [];
  for (const d of days) {
    sent[d] = { ...(sv.sent[d] || {}) }; pend[d] = {};
    for (const q of S.queues) {
      const n = q.name, c = cur[d][n], p = sent[d][n];   // p === undefined — новий день, ще нічого не знали
      if (c === p) continue;
      const w = sv.pend && sv.pend[d] && sv.pend[d][n];
      if (!w || w[0] !== c) { pend[d][n] = [c, now]; continue; }   // щойно змінився — чекаємо, чи не зміниться ще
      if (now - w[1] < 90000) { pend[d][n] = w; continue; }
      sent[d][n] = c;
      if (c !== null) evs.push({ q, day: d === S.d1 ? 1 : 0, was: p === undefined ? null : p });   // графік прибрали — мовчимо
    }
  }
  const ns = JSON.stringify({ sent, pend });
  if (ns !== JSON.stringify(sv)) await kvSet(env, "pub:sched", ns);
  if (evs.length) await deliverSched(env, S, evs);
  return evs.map(e => "sched:" + e.q.name + (e.day ? ":завтра" : ":сьогодні"));
}
function schedMsg(S, evs) {                             // одне повідомлення на людину — про всі її черги разом
  const idx = n => names(S).indexOf(n), out = [];
  for (const day of [1, 0]) {
    const l = evs.filter(e => e.day === day).sort((a, b) => idx(a.q.name) - idx(b.q.name));
    if (!l.length) continue;
    const allNew = l.every(e => e.was === null), allCh = l.every(e => e.was !== null), dw = day ? "завтра" : "сьогодні", dd = day ? S.d1 : S.d0;
    const h = (allNew ? `📅 <b>З'явився графік на ${dw}</b>` : allCh ? `✏️ <b>Змінився графік на ${dw}</b>` : `📅 <b>Графік на ${dw}</b>`) + ` · ${dd.slice(0, 5)}, ${dayName(dd)}`;
    out.push(h + "\n\n" + l.map(e => `🏢 <b>Черга ${esc(e.q.name)}</b>` + (allNew || allCh ? "" : e.was === null ? " · новий" : " · змінено") + "\n" +
      ivLines(day ? e.q.tomorrow : e.q.today, -1) +
      (e.was !== null ? `\n  <i>було: ${e.was === "" ? "без відключень" : e.was.split(",").map(x => x.split("-").map(Number).map(hm).join("–")).join(", ")}</i>` : "")).join("\n\n"));
  }
  return out.join("\n\n");
}
async function deliverSched(env, S, evs) {
  for (const e of evs) {                               // застосунок (Firebase) і браузери — окремо по кожній черзі
    const l = e.day ? e.q.tomorrow : e.q.today, dw = e.day ? "завтра" : "сьогодні", dd = e.day ? S.d1 : S.d0;
    const title = e.was === null ? `📅 Черга ${e.q.name}: графік на ${dw}` : `✏️ Черга ${e.q.name}: змінився графік на ${dw}`;
    const body = `${dd.slice(0, 5)}: ` + (l.length ? l.map(x => hm(x[0]) + "–" + hm(x[1])).join(", ") : "відключень немає");
    await webEnqueue(env, "sched", e.q.name, { kind: "sched", q: e.q.name, day: dd, d: e.day, title, body, tag: "s:" + e.q.name, url: "/#compare=" + encodeURIComponent(e.q.name) + "&d=" + e.day, at: Date.now() });
    if (env.FCM_SA) await fcmSend(env, topic("sched", e.q.name), { kind: "sched", q: e.q.name, day: dd, title, body, at: String(Date.now()) }, "43200s").catch(err => fcmErr(env, String(err && err.message || err)));
  }
  // Telegram: кожному підписаному (хто не вимкнув «📅») — одне повідомлення про всі його черги; однакові тексти — одним записом
  const qn = [...new Set(evs.map(e => e.q.name))];
  const rows = (await env.DB.prepare("SELECT s.chat_id c, s.queue q FROM subs s LEFT JOIN pref p ON p.chat_id=s.chat_id AND p.k='s' WHERE COALESCE(p.v,'1')<>'0' AND s.queue IN (SELECT value FROM json_each(?))").bind(JSON.stringify(qn)).all()).results;
  if (!rows.length) return;
  const per = new Map(); for (const r of rows) per.set(r.c, (per.get(r.c) || []).concat(r.q));
  const texts = [], idx = new Map(), pairs = [];
  for (const [c, l] of per) {
    const k = l.sort().join(",");
    if (!idx.has(k)) { idx.set(k, texts.length); texts.push(schedMsg(S, evs.filter(e => l.includes(e.q.name)))); }
    pairs.push([c, idx.get(k)]);
  }
  await env.DB.prepare("INSERT INTO outbox(chat_id,text,at) SELECT json_extract(p.value,'$[0]'), (SELECT t.value FROM json_each(?) t WHERE t.key = json_extract(p.value,'$[1]')), ? FROM json_each(?) p")
    .bind(JSON.stringify(texts), Date.now(), JSON.stringify(pairs)).run();
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
  const r = await drain(env, 15), w = await drainWeb(env, 10), t = Date.now() - 120000;
  const c = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM outbox WHERE claim < ?) n, (SELECT COUNT(*) FROM wpout WHERE claim < ?) m").bind(t, t).first();
  if (!env.SELF) return r.sent + w.sent;
  const calls = [], key = await secret(env);           // помічники: Telegram — до 6, браузери — до 5 (по 40 за раз; межа Cloudflare — 50 запитів на виклик)
  if (c.n && !r.slow) for (let i = 0; i < Math.min(6, Math.ceil(c.n / 40)); i++) calls.push("/drain");
  if (c.m && !w.slow) for (let i = 0; i < Math.min(5, Math.ceil(c.m / 40)); i++) calls.push("/drain?w=1");
  const res = await Promise.all(calls.map(p => env.SELF.fetch("https://svitlo-public" + p, { method: "POST", headers: { "x-drain": key } }).then(x => x.json()).catch(() => ({ sent: 0 }))));
  return r.sent + w.sent + res.reduce((a, x) => a + (x.sent || 0), 0);
}

// ------------------------- 🌐 Сповіщення в браузер (Web Push) -------------------------
// Ключі VAPID створюються самі (раз назавжди) і лежать у базі: нічого налаштовувати не треба.
let VAPID = null;
async function vapid(env) {
  if (VAPID) return VAPID;
  let v = null; try { v = JSON.parse(await kvGet(env, "pub:vapid") || "null"); } catch (e) {}
  if (!v) {
    await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES('pub:vapid',?)").bind(JSON.stringify(await genVapid())).run();
    v = JSON.parse(await kvGet(env, "pub:vapid"));      // двоє створили одночасно — лишається один ключ
  }
  return VAPID = v;
}
const wpOpts = kind => ({ ttl: kind === "warn" ? 600 : kind === "sched" ? 43200 : kind === "test" ? 300 : 3600, urgency: kind === "sched" ? "normal" : "high" });
async function webEnqueue(env, kind, q, msg) {          // кожному браузеру, підписаному на чергу (і на цей вид)
  const f = kind === "warn" ? " AND warn=1" : kind === "sched" ? " AND sched=1" : "";
  await env.DB.prepare(`INSERT INTO wpout(sid,payload,at) SELECT id, ?, ? FROM wpush WHERE instr(queues, ?) > 0${f}`).bind(JSON.stringify(msg), Date.now(), "," + q + ",").run();
}
async function drainWeb(env, max) {
  const now = Date.now();
  const rows = (await env.DB.prepare("UPDATE wpout SET claim=?, tries=tries+1 WHERE id IN (SELECT id FROM wpout WHERE claim < ? ORDER BY id LIMIT ?) RETURNING id, sid, payload, tries").bind(now, now - 120000, max).all()).results;
  if (!rows.length) return { sent: 0, left: 0 };
  const subs = new Map((await env.DB.prepare("SELECT id, ep, p256dh, auth FROM wpush WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...new Set(rows.map(r => r.sid))])).all()).results.map(x => [x.id, x]));
  const keys = await vapid(env), done = [], gone = [], back = [];
  let stop = false, sent = 0;
  for (const r of rows) {
    const s = subs.get(r.sid);
    if (!s) { done.push(r.id); continue; }
    if (stop) { back.push(r.id); continue; }
    let msg; try { msg = JSON.parse(r.payload); } catch (e) { done.push(r.id); continue; }
    const st = await webPush(keys, { endpoint: s.ep, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, wpOpts(msg.kind));
    if (st >= 200 && st < 300) { done.push(r.id); sent++; }
    else if (st === 404 || st === 410 || st === 403) { done.push(r.id); gone.push(s.id); }   // браузер відписався / підписка недійсна
    else if (st === 429) { stop = true; back.push(r.id); }
    else if (r.tries >= 3 || st === 400 || st === 413) { done.push(r.id); await wpErr(env, `${new URL(s.ep).hostname}: ${st || "немає зв'язку"}`); }
    else back.push(r.id);
  }
  const ids = l => l.join(",");
  if (done.length) await env.DB.prepare(`DELETE FROM wpout WHERE id IN (${ids(done)})`).run();
  if (back.length) await env.DB.prepare(`UPDATE wpout SET claim=0 WHERE id IN (${ids(back)})`).run();
  if (gone.length) { const g = ids([...new Set(gone)]); await env.DB.batch([env.DB.prepare(`DELETE FROM wpush WHERE id IN (${g})`), env.DB.prepare(`DELETE FROM wpout WHERE sid IN (${g})`)]); }
  return { sent, left: back.length, slow: stop };
}
async function wpErr(env, d) {
  let l = []; try { l = JSON.parse(await kvGet(env, "pub:wperr") || "[]"); } catch (e) {}
  l.push({ at: Date.now(), d: String(d).slice(0, 300) });
  await kvSet(env, "pub:wperr", JSON.stringify(l.slice(-10)));
}
// Сайт (інша адреса) звертається сюди з браузера — тому дозволяємо запити з будь-якого сайту (CORS)
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
async function webApi(req, env, p) {
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  await init(env);
  if (p === "/wp/key") return J({ key: (await vapid(env)).pub });
  if (req.method !== "POST") return J({ ok: false, error: "потрібен POST" }, 405);
  const b = await req.json().catch(() => ({})), sub = b && b.sub || {}, ep = String(sub.endpoint || b.endpoint || "");
  const row = () => env.DB.prepare("SELECT * FROM wpush WHERE ep=?").bind(ep).first();
  if (p === "/wp/sub") {                                // увімкнути / змінити: черги, ⏰ за 10 хв, 📅 графік
    if (!validSub(sub)) return J({ ok: false, error: "браузер надіслав незрозумілу підписку" }, 400);
    let S = null; try { S = await snapshot(env); } catch (e) {}
    const qs = [...new Set((Array.isArray(b.queues) ? b.queues : []).map(String))].filter(q => S ? names(S).includes(q) : /^[\w.\-]{1,20}$/.test(q)).slice(0, 40);
    if (!qs.length) { await env.DB.prepare("DELETE FROM wpush WHERE ep=?").bind(ep).run(); return J({ ok: true, queues: [] }); }
    if (!(await row()) && (await env.DB.prepare("SELECT COUNT(*) n FROM wpush").first()).n >= 20000) return J({ ok: false, error: "забагато підписок — спробуйте пізніше" }, 503);
    await env.DB.prepare("INSERT INTO wpush(ep,p256dh,auth,queues,warn,sched,at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(ep) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, queues=excluded.queues, warn=excluded.warn, sched=excluded.sched, at=excluded.at")
      .bind(ep, sub.keys.p256dh, sub.keys.auth, "," + qs.join(",") + ",", b.warn === false ? 0 : 1, b.sched === false ? 0 : 1, Date.now()).run();
    return J({ ok: true, queues: qs, warn: b.warn !== false, sched: b.sched !== false });
  }
  if (p === "/wp/unsub") { await env.DB.prepare("DELETE FROM wpush WHERE ep=?").bind(ep).run(); return J({ ok: true }); }
  if (p === "/wp/get") { const r = await row(); return J(r ? { ok: true, queues: r.queues.split(",").filter(Boolean), warn: !!r.warn, sched: !!r.sched } : { ok: false }); }
  if (p === "/wp/test") {                               // «Пробне» — одразу на цей браузер, не частіше разу на хвилину
    const r = await row();
    if (!r) return J({ ok: false, error: "спершу увімкніть сповіщення" });
    const k = "wt:" + r.id, last = +(await kvGet(env, k)) || 0, hk = "wt:h:" + Math.floor(Date.now() / 3600000), hn = +(await kvGet(env, hk)) || 0;
    if (Date.now() - last < 60000) return J({ ok: false, error: "зачекайте хвилину" });
    if (hn >= 300) return J({ ok: false, error: "забагато перевірок, спробуйте пізніше" });
    await kvSet(env, k, String(Date.now())); await kvSet(env, hk, String(hn + 1));
    const st = await webPush(await vapid(env), { endpoint: r.ep, keys: { p256dh: r.p256dh, auth: r.auth } },
      { kind: "test", q: "", title: "🧪 Сповіщення працюють", body: "Так приходитиме повідомлення, коли у ваших чергах зникне чи з'явиться світло.", tag: "test", url: "/#notify", at: Date.now() }, wpOpts("test"));
    if (st === 404 || st === 410 || st === 403) { await env.DB.prepare("DELETE FROM wpush WHERE id=?").bind(r.id).run(); return J({ ok: false, gone: true, error: "браузер відкликав дозвіл — увімкніть сповіщення ще раз" }); }
    return J(st >= 200 && st < 300 ? { ok: true } : { ok: false, error: st ? "служба доставки браузера відповіла " + st : "немає зв'язку зі службою доставки" });
  }
  return J({ ok: false, error: "невідомий запит" }, 404);
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
async function fcmSend(env, tpc, data, ttl, again, device) {   // tpc — тема; device — замість теми один телефон (пробне)
  const sa = JSON.parse(env.FCM_SA), tok = await fcmToken(env, again);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ message: { ...(device ? { token: device } : { topic: tpc }), data, android: { priority: "HIGH", ttl } } }) });
  if (r.status === 401 && !again) return fcmSend(env, tpc, data, ttl, true, device);
  if (!r.ok) { const t = await r.text().catch(() => ""); if (!device) await fcmErr(env, `${tpc}: ${r.status} ${t.slice(0, 200)}`); return device ? t.slice(0, 200) || String(r.status) : false; }
  return true;
}
// «Пробне» в застосунку: справжнє сповіщення через Firebase саме на цей телефон (за його ідентифікатором) — не частіше разу на хвилину
async function pushTest(env, body) {
  const t = String(body && body.token || "");
  if (!/^[\w:.\-]{60,400}$/.test(t)) return { ok: false, error: "немає ідентифікатора телефона" };
  if (!env.FCM_SA) return { ok: false, error: "Firebase на сервері ще не налаштовано" };
  const k = "pt:" + t.slice(-24), last = +(await kvGet(env, k)) || 0, hk = "pt:h:" + Math.floor(Date.now() / 3600000), hn = +(await kvGet(env, hk)) || 0;
  if (Date.now() - last < 60000) return { ok: false, error: "зачекайте хвилину" };
  if (hn >= 200) return { ok: false, error: "забагато перевірок, спробуйте пізніше" };
  await kvSet(env, k, String(Date.now())); await kvSet(env, hk, String(hn + 1));
  const r = await fcmSend(env, "", { kind: "test", q: "", title: "🧪 Сповіщення працюють", body: "Так приходитиме повідомлення, коли у ваших чергах зникне чи з'явиться світло.", at: String(Date.now()) }, "300s", false, t);
  return r === true ? { ok: true } : { ok: false, error: "Firebase: " + r };
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
  const wh = await tg(env, "setWebhook", { url: `${origin}/tg`, secret_token: await secret(env), allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  out.push(wh.ok ? `✅ Вебхук встановлено: ${origin}/tg` : "❌ Вебхук: " + wh.description);
  await tg(env, "setMyCommands", { commands: [
    { command: "start", description: "Меню" }, { command: "status", description: "💡 Стан моїх черг" }, { command: "schedule", description: "📅 Графік відключень" },
    { command: "compare", description: "🗓 Перетини черг" }, { command: "notify", description: "🔔 Сповіщення" }, { command: "queues", description: "⚙️ Мої черги" },
    { command: "help", description: "Як користуватися" }] });
  await tg(env, "setMyDescription", { description: "💡 Світло В Славутичі: чи є світло у вашій черзі, графік відключень, перетини черг і сповіщення. Натисніть «Почати»." });
  await tg(env, "setMyShortDescription", { short_description: "Чи є світло у вашій черзі в Славутичі, графік і сповіщення" });
  out.push(`🤖 Бот: @${me.result.username}`);
  let S = null;
  try { S = await pull(env); await kvSet(env, "pub:snap", JSON.stringify({ at: Date.now(), S })); SNAP = S; SNAP_TS = Date.now(); } catch (e) { out.push("❌ " + (e && e.message || e) + `\nПеревірте: ${MAIN(env)}/api/status має відкриватися (основний бот 4.0.5+, увімкнена публічна сторінка).`); }
  if (S) out.push(`📊 Дані з основного бота (${MAIN(env)}): черг ${S.queues.length}`);
  if (env.FCM_SA) { try { await fcmToken(env, true); out.push(`📲 Firebase: ✅ (проєкт ${JSON.parse(env.FCM_SA).project_id})`); } catch (e) { out.push("📲 Firebase: ❌ " + (e && e.message || e)); } }
  else out.push("📲 Firebase: ще не налаштовано (секрет FCM_SA) — сповіщення лише в Telegram");
  try { out.push(`🌐 Сповіщення в браузері (сайт): ✅ ключ ${(await vapid(env)).pub.slice(0, 12)}…`); } catch (e) { out.push("🌐 Сповіщення в браузері: ❌ " + (e && e.message || e)); }
  out.push("Далі: відкрийте бота в Telegram і натисніть «Почати» — бот попросить обрати черги.");
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
      if (p === "/push-test" && req.method === "POST") {
        await init(env);
        const b = await req.json().catch(() => ({}));
        return new Response(JSON.stringify(await pushTest(env, b)), { headers: { "content-type": "application/json; charset=utf-8" } });
      }
      if (p === "/drain" && req.method === "POST") {                 // помічник розсилки (виклик самого себе, щоб розіслати швидше)
        await init(env);
        if (req.headers.get("x-drain") !== await secret(env)) return new Response("forbidden", { status: 403 });
        return new Response(JSON.stringify(u.searchParams.get("w") ? await drainWeb(env, 40) : await drain(env, 40)), { headers: { "content-type": "application/json" } });
      }
      if (p.startsWith("/wp/")) return await webApi(req, env, p);
      if (p === "/setup") return new Response(await setup(env, u.origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
      await init(env);
      let sn = null; try { sn = JSON.parse(await kvGet(env, "pub:snap") || "null"); } catch (e) {}
      const st = !sn ? "даних ще не було (вони з'являться після першого звернення)" : (sn.S ? `дані від ${fmtTime(sn.S.now)}, ${fmtDate(sn.S.now)}` : "даних немає") + (sn.err && sn.err.at > (sn.at || 0) ? `\n⚠️ Останнє звернення до основного бота (${fmtTime(sn.err.at)}): ${sn.err.msg}` : "");
      let errs = []; try { errs = JSON.parse(await kvGet(env, "pub:tgerr") || "[]"); } catch (e) {}
      const el = errs.length ? "\n\nОстанні помилки Telegram:\n" + errs.slice().reverse().map(e => `${fmtDate(e.at)} ${fmtTime(e.at)}  ${e.m}: ${e.c} ${e.d}`).join("\n") : "";
      let fe = []; try { fe = JSON.parse(await kvGet(env, "pub:fcmerr") || "[]"); } catch (e) {}
      let we = []; try { we = JSON.parse(await kvGet(env, "pub:wperr") || "[]"); } catch (e) {}
      const ns = await env.DB.prepare("SELECT (SELECT COUNT(DISTINCT chat_id) FROM subs) s, (SELECT COUNT(DISTINCT chat_id) FROM myq) m, (SELECT COUNT(*) FROM outbox) o, (SELECT COUNT(*) FROM pub_users) u, (SELECT COUNT(*) FROM wpush) w, (SELECT COUNT(*) FROM wpout) wo").first();
      const fl = `\nКористувачів: ${ns.u}; обрали свої черги: ${ns.m}; підписаних на сповіщення: ${ns.s}; у черзі на надсилання: ${ns.o}\nFirebase: ${env.FCM_SA ? "налаштовано" : "не налаштовано"}` + (fe.length ? "\nОстанні помилки Firebase:\n" + fe.slice().reverse().map(e => `${fmtDate(e.at)} ${fmtTime(e.at)}  ${e.d}`).join("\n") : "") +
        `\nСповіщення в браузері (сайт): підписано ${ns.w}; у черзі ${ns.wo}` + (we.length ? "\nОстанні помилки браузерних сповіщень:\n" + we.slice().reverse().map(e => `${fmtDate(e.at)} ${fmtTime(e.at)}  ${e.d}`).join("\n") : "");
      return new Response(`💡 Світло В Славутичі — бот для мешканців працює.\nДжерело: ${MAIN(env)}/api/status — ${st}\nДані для застосунку: /status.json\nНалаштування бота: /setup${fl}${el}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      return new Response("Помилка: " + (e && e.message || e), { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.BOT_TOKEN) return;
    ctx.waitUntil(tick(env).catch(e => console.error("tick", e)));
  },
};
