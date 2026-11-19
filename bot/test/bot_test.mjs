// Перевірка бота для мешканців (svitlo-public). Справжні Telegram і основний бот не використовуються:
// основний бот — підставний (FAKE), а якщо задати MAIN_MJS=шлях/до/основного/воркера.mjs — ще й перевірка з ним самим.
// Запуск: node bot/test/bot_test.mjs
import { DatabaseSync } from 'node:sqlite';
let NOW = Date.parse("2026-11-17T15:30:00+02:00"); Date.now = () => NOW;
const { default: bot } = await import(new URL('../worker.js', import.meta.url));
const sqlite = new DatabaseSync(':memory:');
function stmt(sql){ let args=[]; const o={ bind:(...a)=>{args=a;return o;}, async run(){ const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }, async first(){ return sqlite.prepare(sql).get(...args) ?? null; }, async all(){ return {results: sqlite.prepare(sql).all(...args)}; }, _raw(){ const st=sqlite.prepare(sql); return /^\s*SELECT/i.test(sql)?{results:st.all(...args)}:(st.run(...args),{results:[]}); } }; return o; }
const DB={ prepare:(s)=>stmt(s), async batch(l){ return l.map(s=>s._raw()); } };

// підставний основний бот: /api/status у форматі 4.0.5
const FAKE = { v:1, now:NOW, today:"17.11.2026", tomorrow:"18.11.2026", kyiv_offset_min:120, map:"https://desperadoav.github.io/Svitlo_in_Slavutych/", site:"https://svitlo-main.test/",
  queues:[
    {name:"1.1",state:"on",since:NOW-5*3600000,today:[["16:00","20:00"]],tomorrow:null},
    {name:"2.1",state:"on",since:NOW-3600000,today:[],tomorrow:null},
    {name:"3.1",state:"unknown",since:null,today:null,tomorrow:null},
    {name:"3.2",state:"on",since:NOW-7200000,today:[["08:00","12:00"],["11:00","14:00"],["20:00","24:00"]],tomorrow:[["00:00","04:00"]]},
    {name:"4.1",state:"on",since:NOW-600000,today:null,tomorrow:null},
    {name:"6.1",state:"off",since:NOW-3*3600000,today:[["12:00","18:00"]],tomorrow:null}]};
let MAIN_DOWN=false, MAIN_HITS=0, MAIN_FN=null, WIDGET_FAIL=null;
const log=[]; let wid=0;
globalThis.fetch=async(u,o={})=>{ u=String(u); let b={}; try{b=JSON.parse(o.body)}catch(e){}
  if(u.startsWith("https://svitlo-main.test/")){ MAIN_HITS++;
    if(MAIN_DOWN) throw new Error("connect timeout");
    if(MAIN_FN) return MAIN_FN(u);
    if(u!=="https://svitlo-main.test/api/status") return new Response("nf",{status:404});
    return new Response(JSON.stringify({...FAKE,now:NOW}),{headers:{"content-type":"application/json"}}); }
  if(u.includes("api.telegram.org/botPUB")){ const m=u.split("/").pop(); log.push({m,b});
    if(m==="getMe") return {json:async()=>({ok:true,result:{username:"svitlo_slav_bot"}})};
    if(m==="sendWidget") return {json:async()=>(WIDGET_FAIL?{ok:false,error_code:400,description:WIDGET_FAIL}:{ok:true,result:{message_id:100+log.length,widget:{id:"W"+(++wid)}}})};
    if(m==="sendSharedWidget") return {json:async()=>(b.widget_id==="Wgone"?{ok:false,description:"Bad Request: widget not found"}:{ok:true,result:{message_id:100+log.length}})};
    return {json:async()=>({ok:true,result:true})}; }
  throw new Error("тест не має ходити в інтернет: "+u); };
const penv={DB, BOT_TOKEN:"PUB:abc", MAIN_URL:"https://svitlo-main.test/"};
let W=[]; const B=async(p,i={})=>{ const r=await bot.fetch(new Request("https://pub.test"+p,i),penv,{waitUntil:x=>W.push(x)}); await Promise.all(W); W=[]; return r; };
const cron=async()=>{ const n=log.length; const P=[]; await bot.scheduled({},penv,{waitUntil:p=>P.push(p)}); await Promise.all(P); return log.slice(n); };
const errs=[]; const chk=(n,c,x="")=>{console.log((c?"✅":"❌")+" "+n+(x!==""?" | "+String(x).slice(0,260):"")); if(!c) errs.push(n);};
const later=ms=>{ NOW+=ms; };

// /status.json
let r=await B("/status.json"); const S=await r.json();
const q32=S.queues.find(q=>q.name==="3.2"), q61=S.queues.find(q=>q.name==="6.1"), q41=S.queues.find(q=>q.name==="4.1"), q21=S.queues.find(q=>q.name==="2.1");
chk("/status.json: 6 черг, CORS", S.queues.length===6 && r.headers.get("access-control-allow-origin")==="*", S.queues.map(q=>q.name+":"+q.state).join(" "));
chk("…3.2: світло є, графік злито (08–14, 20–24), завтра 00–04", q32.state==="on" && JSON.stringify(q32.today)==='[["08:00","14:00"],["20:00","24:00"]]' && JSON.stringify(q32.tomorrow)==='[["00:00","04:00"]]', JSON.stringify(q32));
chk("…6.1: світла немає з 12:30", q61.state==="off" && q61.since===NOW-3*3600000);
chk("…4.1: графіка немає — null; 2.1: відключень немає — []", q41.today===null && q41.tomorrow===null && JSON.stringify(q21.today)==="[]");
chk("…мапа й сайт — від основного бота", S.map.startsWith("https://desperadoav.github.io/") && S.site==="https://svitlo-main.test/");
// кеш: багато запитів — основний бот смикається не частіше ніж раз на 90 с
MAIN_HITS=0; for(let i=0;i<20;i++){ later(3000); await B("/status.json"); }
chk("20 запитів за хвилину — до основного бота не більше 1 звернення", MAIN_HITS<=1, MAIN_HITS);
// setup
r=await B("/setup"); let t=await r.text();
const wh=log.find(x=>x.m==="setWebhook");
chk("/setup: вебхук на /tg із секретом, команди, опис, дані з основного бота", wh && wh.b.url==="https://pub.test/tg" && /^[0-9a-f]{32}$/.test(wh.b.secret_token) && log.some(x=>x.m==="setMyCommands") && t.includes("@svitlo_slav_bot") && t.includes("черг 6"), t.replace(/\n/g," | "));
const SEC=wh.b.secret_token;
r=await B("/tg",{method:"POST",body:JSON.stringify({update_id:1,message:{chat:{id:555,type:"private"},text:"/start"}})});
chk("вебхук без секрету — 403", r.status===403);
const tgp=async(chat,text,gap=1500)=>{ NOW+=gap; const n=log.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),message:{chat:{id:chat,type:"private"},from:{id:chat},text}})}); return log.slice(n); };
// ті, хто користувався ботом до нового меню (4242, 4243 — зі сповіщеннями на 4.1): прибрати закріплене повідомлення зі станом
sqlite.prepare("INSERT INTO pub_users(chat_id,first_ts,last_ts,n) VALUES(4242,?,?,3),(4243,?,?,5)").run(NOW-86400000,NOW-86400000,NOW-86400000,NOW-86400000);
MAIN_HITS=0; let L=await cron();
chk("старим користувачам щохвилинний запуск прибирає закріплене повідомлення (нічого не надсилаючи)", L.filter(x=>x.m==="unpinAllChatMessages").map(x=>x.b.chat_id).sort().join(",")==="4242,4243" && !L.some(x=>x.m==="sendMessage"), L.map(x=>x.m+":"+(x.b.chat_id||"")).join(",")+" / "+MAIN_HITS);
chk("…і раз на хвилину дивиться в основний бот (чи немає оголошення для всіх)", MAIN_HITS===1, MAIN_HITS);
later(60000); L=await cron(); chk("…лише раз", !L.some(x=>x.m==="unpinAllChatMessages"));
sqlite.prepare("INSERT INTO subs(chat_id,queue) VALUES(4243,'4.1')").run(); sqlite.prepare("DELETE FROM kv WHERE k='pub:prev'").run();
const cbk=async(chat,data,mid=900)=>{ const n=log.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),callback_query:{id:"c1",from:{id:chat},data,message:{chat:{id:chat},message_id:mid}}})}); return log.slice(n); };
const kbOf=x=>x && x.b.reply_markup && x.b.reply_markup.inline_keyboard ? x.b.reply_markup.inline_keyboard.flat() : [];
const last=(L,m="editMessageText")=>L.filter(x=>x.m===m).pop();
const oneLine=x=>x && x.b.text.replace(/\n/g," | ");

// ── перший /start: кнопки внизу і вибір своєї черги; нічого не закріплюємо
L=await tgp(555,"/start"); let sm=L.filter(x=>x.m==="sendMessage");
chk("перший /start: привітання з кнопками внизу (💡 Стан, 📅 Графік, 🗓 Перетини, 🔔 Сповіщення, ⚙️ Мої черги); без закріплення і карток",
  sm.length===2 && sm[0].b.reply_markup.keyboard && sm[0].b.reply_markup.is_persistent && sm[0].b.reply_markup.resize_keyboard && ["💡 Стан","📅 Графік","🗓 Перетини","🔔 Сповіщення","⚙️ Мої черги"].every(t=>JSON.stringify(sm[0].b.reply_markup.keyboard).includes(t)) && !L.some(x=>/pin|Widget/i.test(x.m)), L.map(x=>x.m).join(","));
chk("…і одразу — вибір своєї черги (усі 6 черг кнопками, «Готово»), стану всіх черг немає", sm[1] && sm[1].b.text.includes("Оберіть свою чергу") && kbOf(sm[1]).filter(k=>/^qq:/.test(k.callback_data)).length===6 && kbOf(sm[1]).some(k=>k.callback_data==="qd") && !sm[1].b.text.includes("Черга 1.1"), oneLine(sm[1]));
L=await cbk(555,"qd"); chk("«Готово» без жодної черги — підказка", L.some(x=>x.m==="answerCallbackQuery" && x.b.show_alert && /хоча б одну/.test(x.b.text)) && !L.some(x=>x.m==="editMessageText"));
await cbk(555,"qq:3.2"); L=await cbk(555,"qq:6.1"); let e=last(L);
chk("позначив 3.2 і 6.1 — ✅ на кнопках", e && kbOf(e).some(k=>k.text==="✅ 3.2") && kbOf(e).some(k=>k.text==="✅ 6.1") && kbOf(e).some(k=>k.text==="▫️ 1.1") && e.b.text.includes("Зараз: 3.2, 6.1"), oneLine(e));
L=await cbk(555,"qd"); e=last(L);
chk("«Готово» — стан лише моїх черг, кожна окремим блоком", e && e.b.text.startsWith("💡 <b>Мої черги</b>") && e.b.text.includes("🟢 <b>Черга 3.2 — світло є</b>") && e.b.text.includes("🔴 <b>Черга 6.1 — світла немає</b>") && !e.b.text.includes("1.1") && !e.b.text.includes("4.1"), oneLine(e));
chk("…3.2: з 13:30; наступне відключення 20:00 – 04:00 (через північ — одним проміжком); 6.1: за графіком до 18:00", /🕓 з 13:30 · 2 год \d+ хв/.test(e.b.text) && /⏭ відключення через 4 год 2\d хв:\n {4}⚫ 20:00 – 04:00 \(18\.11\)/.test(e.b.text) && e.b.text.includes("⏳ за графіком відключення до 18:00"), oneLine(e));
chk("…кнопки: 🔄 Оновити, 📅 Графік, 🔔 увімкнути сповіщення для цих черг, мапа і сайт", kbOf(e).some(k=>k.callback_data==="st") && kbOf(e).some(k=>k.callback_data==="g:0") && kbOf(e).some(k=>k.callback_data==="na" && /цих черг/.test(k.text)) && kbOf(e).some(k=>k.url==="https://svitlo-main.test/") && kbOf(e).some(k=>k.url && k.url.startsWith("https://desperadoav.github.io/")));
L=await cbk(555,"na"); e=last(L);
chk("«🔔 Увімкнути сповіщення» — підписано на 3.2 і 6.1, показано меню сповіщень", sqlite.prepare("SELECT GROUP_CONCAT(queue) g FROM (SELECT queue FROM subs WHERE chat_id=555 ORDER BY queue)").get().g==="3.2,6.1" && e && e.b.text.includes("Сповіщення про світло") && L.some(x=>x.m==="answerCallbackQuery" && /3\.2, 6\.1/.test(x.b.text)));
// ── кнопки внизу
L=await tgp(555,"📅 Графік"); let m=last(L,"sendMessage");
chk("«📅 Графік» — на сьогодні, кожен проміжок окремим рядком, поточний позначено", m && m.b.text.startsWith("📅 <b>Графік на сьогодні, 17.11 (вівторок)</b>") && m.b.text.includes("🏢 <b>Черга 3.2</b>\n  └ ⚫ 08:00 – 14:00\n  └ ⚫ 20:00 – 24:00\n  <i>без світла 10 год</i>") && m.b.text.includes("🏢 <b>Черга 6.1</b>\n  └ ⚫ 12:00 – 18:00  ◀️ зараз"), oneLine(m));
L=await cbk(555,"g:1"); e=last(L);
chk("…«Завтра»: 3.2 — 00:00 – 04:00, 6.1 — графіка ще немає; ✅ на кнопці «Завтра»", e && e.b.text.includes("Графік на завтра, 18.11 (середа)") && e.b.text.includes("Черга 3.2</b>\n  └ ⚫ 00:00 – 04:00") && e.b.text.includes("Черга 6.1</b>\n  └ ❔ графіка ще немає") && kbOf(e).some(k=>k.text==="✅ Завтра"), oneLine(e));
L=await tgp(555,"графік на завтра"); chk("написав «графік на завтра» — графік на завтра", last(L,"sendMessage") && last(L,"sendMessage").b.text.includes("Графік на завтра"));
L=await tgp(555,"💡 Стан"); m=last(L,"sendMessage"); chk("«💡 Стан» — стан моїх черг новим повідомленням (вже без пропозиції сповіщень)", m && m.b.text.startsWith("💡 <b>Мої черги</b>") && !kbOf(m).some(k=>k.callback_data==="na"), oneLine(m));
L=await cbk(555,"st"); chk("🔄 — оновлено в тому самому повідомленні, підказка з часом", L.some(x=>x.m==="editMessageText" && x.b.message_id===900) && L.some(x=>x.m==="answerCallbackQuery" && /дані на/.test(x.b.text)));
// ── перетини
L=await tgp(555,"🗓 Перетини"); m=last(L,"sendMessage");
chk("«🗓 Перетини» — вибір черг (мої вже позначені), «На сьогодні» / «На завтра»", m && kbOf(m).some(k=>k.text==="✅ 3.2") && kbOf(m).some(k=>k.text==="✅ 6.1") && kbOf(m).some(k=>k.text==="▫️ 1.1") && kbOf(m).some(k=>k.callback_data==="xr:0") && kbOf(m).some(k=>k.callback_data==="xr:1"), oneLine(m));
L=await cbk(555,"xq:1.1"); e=last(L); chk("…додав 1.1", e && kbOf(e).some(k=>k.text==="✅ 1.1") && e.b.text.includes("Обрано: 1.1, 3.2, 6.1"), oneLine(e));
L=await cbk(555,"xr:0"); e=last(L); const X=e ? e.b.text : "";
chk("перетини на сьогодні: спершу відключення по чергах", X.startsWith("🗓 <b>Перетини на сьогодні, 17.11 (вівторок)</b>") && X.includes("🏢 <b>Черга 1.1:</b>\n  └ 16:00 – 20:00\n🏢 <b>Черга 3.2:</b>\n  └ 08:00 – 14:00\n  └ 20:00 – 24:00"), X.replace(/\n/g," | "));
chk("…далі відрізки дня: 00–08 світло всюди; 12–14 3.2 і 6.1 без світла, а в 1.1 є; 18–20 лише 1.1 без світла", X.includes("🕒 <b>00:00 – 08:00</b>\n└ 🟡 Світло є всюди") && X.includes("🕒 <b>12:00 – 14:00</b>\n🏢 1.1: 🟡 Світло є\n🏢 3.2: ⚫ Відключено\n🏢 6.1: ⚫ Відключено") && X.includes("🕒 <b>18:00 – 20:00</b>\n🏢 1.1: ⚫ Відключено\n🏢 3.2: 🟡 Світло є") && X.includes("🕒 <b>20:00 – 24:00</b>") && !X.includes("Немає світла ніде"), X.replace(/\n/g," | "));
chk("…кнопки: Сьогодні ✅ / Завтра, «◀️ Змінити черги»", kbOf(e).some(k=>k.text==="✅ Сьогодні") && kbOf(e).some(k=>k.callback_data==="x"));
await cbk(555,"xq:1.1"); L=await cbk(555,"xr:0"); e=last(L);
chk("…лише 3.2 і 6.1: 12:00 – 14:00 — «Немає світла ніде»", e && e.b.text.includes("🕒 <b>12:00 – 14:00</b>\n🏢 3.2: ⚫ Відключено\n🏢 6.1: ⚫ Відключено\n⚠️ <i>(Немає світла ніде)</i>"), oneLine(e));
L=await cbk(555,"xr:1"); e=last(L);
chk("…на завтра: у 6.1 графіка ще немає — порівнюємо те, що є, і пишемо, де графіка немає", e && e.b.text.includes("Перетини на завтра, 18.11") && e.b.text.includes("<i>Без графіка: 6.1</i>") && e.b.text.includes("🕒 <b>00:00 – 04:00</b>"), oneLine(e));
L=await cbk(555,"x"); e=last(L); chk("«◀️ Змінити черги» — назад до вибору", e && kbOf(e).some(k=>k.callback_data==="xq:3.2"));
// ── мої черги, довідка, /start ще раз
L=await tgp(555,"⚙️ Мої черги"); m=last(L,"sendMessage"); chk("«⚙️ Мої черги» — редагування", m && m.b.text.includes("Зараз: 3.2, 6.1") && kbOf(m).some(k=>k.text==="✅ 3.2"), oneLine(m));
L=await tgp(555,"/help"); chk("/help — пояснення кнопок", L.some(x=>x.m==="sendMessage" && x.b.text.includes("Перетини") && x.b.reply_markup.keyboard));
L=await tgp(555,"/start"); chk("повторний /start — привітання (повертає кнопки) і стан моїх черг, без вибору і без закріплення", L.filter(x=>x.m==="sendMessage").length===2 && last(L,"sendMessage").b.text.startsWith("💡 <b>Мої черги</b>") && !L.some(x=>/pin/i.test(x.m)), L.map(x=>x.m).join(","));
L=await tgp(555,"що там"); chk("будь-який інший текст — стан моїх черг", L.filter(x=>x.m==="sendMessage").length===1 && last(L,"sendMessage").b.text.startsWith("💡 <b>Мої черги</b>"));
chk("користувачі записані", sqlite.prepare("SELECT COUNT(*) n FROM pub_users").get().n===3);

// ── ті, хто користувався ботом до нового меню
L=await tgp(4243,"/status");
chk("старий користувач зі сповіщеннями на 4.1 — кнопки внизу і одразу стан 4.1 (черги взято зі сповіщень)", L[0] && L[0].m==="sendMessage" && L[0].b.reply_markup.keyboard && last(L,"sendMessage").b.text.includes("Черга 4.1 — світло є") && sqlite.prepare("SELECT queue FROM myq WHERE chat_id=4243").get().queue==="4.1", L.map(x=>x.m).join(","));
L=await cbk(4242,"e:3.2"); e=last(L); chk("кнопка «3.2» зі старого повідомлення (черги ще не обрано) — вибір черг", e && e.b.text.includes("Оберіть свою чергу"));
L=await cbk(4242,"r"); chk("…«🔄» зі старого повідомлення — так само", last(L) && last(L).b.text.includes("Оберіть свою чергу"));

// ── дані: щохвилинний запуск, сповіщення, основний бот недоступний
later(60000); MAIN_HITS=0; L=await cron();
chk("щохвилинний запуск — один запит до основного бота, без змін — нічого не надсилаємо", MAIN_HITS===1 && !L.some(x=>x.m==="sendMessage"), MAIN_HITS);
later(60000); FAKE.queues[3]={...FAKE.queues[3],state:"off",since:NOW};
L=await cron(); const lost=L.find(x=>x.m==="sendMessage" && x.b.chat_id===555);
chk("3.2 згасла — 555 (сповіщення на 3.2) отримав повідомлення", lost && /3\.2: світло зникло/.test(lost.b.text), lost && lost.b.text);
later(60000); MAIN_DOWN=true; L=await cron();
chk("основний бот недоступний — щохвилинний запуск не падає і нічого не надсилає", !L.some(x=>x.m==="sendMessage"));
later(120000); r=await B("/status.json"); const S2=await r.json();
chk("…/status.json віддає останні відомі дані (зі старим часом)", r.status===200 && S2.queues.find(q=>q.name==="3.2").state==="off" && S2.now<NOW-60000, r.status+" "+S2.now);
t=await (await B("/")).text(); chk("…головна сторінка бота показує проблему", t.includes("⚠️") && t.includes("connect timeout"), t.replace(/\n/g," | "));
L=await tgp(555,"💡 Стан"); chk("…і в Telegram бот відповідає (останні відомі дані)", last(L,"sendMessage") && last(L,"sendMessage").b.text.includes("🔴 <b>Черга 3.2 — світла немає</b>"));
MAIN_DOWN=false; later(60000); L=await cron();
t=await (await B("/")).text(); chk("основний бот знову працює — попередження зникло", !t.includes("⚠️"), t.replace(/\n/g," | "));
// основний бот старий (немає /api/status) або вимкнена сторінка
MAIN_FN=()=>new Response("nf",{status:404}); later(120000); t=await (await B("/setup")).text();
chk("основний бот без /api/status — /setup пояснює, що оновити", t.includes("4.0.5") && t.includes("❌"), t.replace(/\n/g," | "));
MAIN_FN=()=>new Response("<html>",{status:200}); later(120000); MAIN_DOWN=false;
r=await B("/status.json"); chk("незрозуміла відповідь — дані не ламаються (лишаються останні)", r.status===200 && (await r.json()).queues.length===6);
MAIN_FN=null;
// 🔁 без зациклення: службове «прикріплює…», повідомлення від бота, змінене повідомлення — без відповіді
NOW+=60000; const raw=async u=>{ const n=log.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),...u})}); return log.slice(n); };
L=await raw({message:{chat:{id:4242,type:"private"},from:{id:999,is_bot:true},pinned_message:{message_id:5}}});
chk("службове «прикріплює…» — бот не відповідає (немає зациклення)", L.length===0, L.map(x=>x.m).join(","));
L=await raw({message:{chat:{id:4242,type:"private"},from:{id:4242},pinned_message:{message_id:5}}}); chk("…навіть якщо від людини", L.length===0);
L=await raw({message:{chat:{id:4242,type:"private"},from:{id:777,is_bot:true},text:"/start"}}); chk("повідомлення від бота — без відповіді", L.length===0);
L=await raw({edited_message:{chat:{id:4242,type:"private"},from:{id:4242},text:"/start"}}); chk("змінене повідомлення — без відповіді", L.length===0);
L=await raw({message:{chat:{id:4242,type:"private"},from:{id:4242},sticker:{file_id:"x"}}}); chk("стікер/фото без тексту — без відповіді", L.length===0);
L=await tgp(4242,"/start",60000); const L2=await tgp(4242,"/start",0);
chk("два /start за мить — одна відповідь (привітання з кнопками і вибір черг); вдруге не прибирає закріплене", L.filter(x=>x.m==="sendMessage").length===2 && L2.length===0 && !L.some(x=>/pin/i.test(x.m)), L.map(x=>x.m).join(",")+" / "+L2.map(x=>x.m).join(","));
// дуже багато відключень і всі черги — перетини вміщаються в одне повідомлення Telegram (≤ 4096), розмітка не ламається
const many=[]; for(let h=0;h<24;h+=2) many.push([`${String(h).padStart(2,"0")}:00`,`${String(h).padStart(2,"0")}:30`]);
const many2=many.map(([a])=>[a.slice(0,2)+":15",a.slice(0,2)+":45"]);
FAKE.queues.forEach((q,i)=>{ q.today=i%2?many:many2; q.tomorrow=many; });
for (const n of ["5.1","5.2","6.2"]) FAKE.queues.push({name:n,state:"on",since:NOW,today:many,tomorrow:many});
later(120000); sqlite.prepare("INSERT OR REPLACE INTO pref(chat_id,k,v) VALUES(555,'x','')").run();
L=await cbk(555,"xr:0"); e=last(L);
chk("перетини: 9 черг × 12 відключень — ≤ 4096 символів, теги не обрізані", e && e.b.text.length<=4096 && (e.b.text.match(/<b>/g)||[]).length===(e.b.text.match(/<\/b>/g)||[]).length && e.b.text.includes("…"), e && e.b.text.length);
// бот без даних узагалі (нова база, основний бот недоступний)
sqlite.prepare("DELETE FROM kv WHERE k='pub:snap'").run(); MAIN_DOWN=true; later(120000);
r=await B("/status.json"); chk("немає жодних даних — /status.json 503 з поясненням (застосунок покаже помилку)", r.status===503 && (await r.json()).error.includes("немає даних"));
MAIN_DOWN=false;

// разом зі справжнім основним ботом (локально, без мережі)
if (process.env.MAIN_MJS) {
  const { default: main } = await import(process.env.MAIN_MJS);
  const msql = new DatabaseSync(':memory:');
  function mstmt(sql){ let args=[]; const o={ bind:(...a)=>{args=a;return o;}, async run(){ const r=msql.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }, async first(){ return msql.prepare(sql).get(...args) ?? null; }, async all(){ return {results: msql.prepare(sql).all(...args)}; }, _raw(){ const st=msql.prepare(sql); return /^\s*SELECT/i.test(sql)?{results:st.all(...args)}:(st.run(...args),{results:[]}); } }; return o; }
  const menv={DB:{ prepare:(s)=>mstmt(s), async batch(l){ return l.map(s=>s._raw()); } }, ADMIN_BOT_TOKEN:"A", ADMIN_IDS:"1", ADMIN_KEY:"k", TG_SECRET:"s"};
  const mcall=(p,i={})=>main.fetch(new Request("https://svitlo-main.test"+p,{...i,headers:{Cookie:"k=k",...(i.headers||{})}}),menv,{waitUntil:p=>p});
  for (const n of ["1.1","3.2","6.1"]) await mcall("/admin/new",{method:"POST",body:new URLSearchParams({name:n})});
  for (const n of ["1.1","3.2"]) await mcall(`/p/${n}/esp1`);
  msql.prepare("UPDATE queues SET state='Offline', state_ts=?, last_esp1=? WHERE name='6.1'").run(NOW-3600000, NOW-3600000);
  msql.prepare("INSERT INTO schedule(queue,day,start,end) VALUES(?,?,?,?)").run("3.2", "17.11.2026".replace("17", String(new Date(NOW+7200000).getUTCDate()).padStart(2,"0")), "20:00", "23:59");
  MAIN_FN=u=>mcall(new URL(u).pathname);
  later(120000); r=await B("/status.json"); const R=await r.json();
  chk("зі справжнім основним ботом: 3 черги, 6.1 без світла, 3.2 з графіком до 24:00", R.queues.length===3 && R.queues.find(q=>q.name==="6.1").state==="off" && JSON.stringify(R.queues.find(q=>q.name==="3.2").today)==='[["20:00","24:00"]]' && R.site==="https://svitlo-main.test/", JSON.stringify(R).slice(0,300));
  MAIN_FN=null;
}
console.log(errs.length?"\n❌ ПРОВАЛЕНО: "+errs.join("; "):"\nУСЕ ПРОЙДЕНО");
if (errs.length) process.exit(1);
