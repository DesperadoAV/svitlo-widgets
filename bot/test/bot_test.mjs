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
const tgp=async(chat,text)=>{ const n=log.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),message:{chat:{id:chat,type:"private"},from:{id:chat},text}})}); return log.slice(n); };
// поки ніхто не писав — щохвилинний запуск основного бота не смикає
MAIN_HITS=0; await cron(); chk("ще немає картки — щохвилинний запуск не звертається до основного бота", MAIN_HITS===0, MAIN_HITS);
let L=await tgp(555,"/start");
const sw=L.find(x=>x.m==="sendWidget");
chk("перший /start: створено спільний віджет (html, public_data, підпис, кнопки Мапа/Сайт)", sw && sw.b.is_shared===true && sw.b.html.includes("Світло В Славутичі") && JSON.parse(sw.b.public_data).q.length===6 && sw.b.caption && sw.b.reply_markup.inline_keyboard[0].length===2 && sw.b.reply_markup.inline_keyboard[0][1].url==="https://svitlo-main.test/", sw && Object.keys(sw.b).join(","));
chk("…картку закріплено", L.some(x=>x.m==="pinChatMessage" && x.b.chat_id===555));
L=await tgp(777,"привіт");
chk("інший користувач — той самий спільний віджет (sendSharedWidget W1)", L.some(x=>x.m==="sendSharedWidget" && x.b.widget_id==="W1") && !L.some(x=>x.m==="sendWidget"));
chk("користувачі записані", sqlite.prepare("SELECT COUNT(*) n FROM pub_users").get().n===2);
L=await tgp(555,"/help"); chk("/help — пояснення з кнопками", L.some(x=>x.m==="sendMessage" && x.b.text.includes("/notify") && x.b.text.includes("🔄")));
// оновлення
later(60000); MAIN_HITS=0; L=await cron();
chk("щохвилинний запуск без змін — один запит до основного бота, Telegram не смикаємо", MAIN_HITS===1 && !L.some(x=>x.m==="editSharedWidgetData"), MAIN_HITS);
later(60000); FAKE.queues[3]={...FAKE.queues[3],state:"off",since:NOW};
L=await cron(); const ed=L.find(x=>x.m==="editSharedWidgetData");
chk("3.2 згасла — спільну картку оновлено одним запитом", ed && ed.b.widget_id==="W1" && JSON.parse(ed.b.public_data).q.find(q=>q[0]==="3.2")[1]===0 && ed.b.cache_time===60, ed && ed.b.public_data);
// основний бот недоступний
later(60000); MAIN_DOWN=true; L=await cron();
chk("основний бот недоступний — щохвилинний запуск не падає і картку не чіпає", !L.some(x=>x.m==="editSharedWidgetData"));
later(120000); r=await B("/status.json"); const S2=await r.json();
chk("…/status.json віддає останні відомі дані (зі старим часом)", r.status===200 && S2.queues.find(q=>q.name==="3.2").state==="off" && S2.now<NOW-60000, r.status+" "+S2.now);
t=await (await B("/")).text(); chk("…головна сторінка бота показує проблему", t.includes("⚠️") && t.includes("connect timeout"), t.replace(/\n/g," | "));
L=await tgp(999,"/start"); chk("…і в Telegram картка все одно надсилається", L.some(x=>x.m==="sendSharedWidget"));
MAIN_DOWN=false; later(60000); L=await cron();
chk("основний бот знову працює, змін немає — картку не смикаємо до 10 хв", !L.some(x=>x.m==="editSharedWidgetData"));
later(8*60000); L=await cron();
chk("…через 10 хв від попереднього — картку оновлено (новий час)", L.some(x=>x.m==="editSharedWidgetData"));
t=await (await B("/")).text(); chk("…попередження зникло", !t.includes("⚠️"), t.replace(/\n/g," | "));
// основний бот старий (немає /api/status) або вимкнена сторінка
MAIN_FN=()=>new Response("nf",{status:404}); later(120000); t=await (await B("/setup")).text();
chk("основний бот без /api/status — /setup пояснює, що оновити", t.includes("4.0.5") && t.includes("❌"), t.replace(/\n/g," | "));
MAIN_FN=()=>new Response("<html>",{status:200}); later(120000); MAIN_DOWN=false;
r=await B("/status.json"); chk("незрозуміла відповідь — дані не ламаються (лишаються останні)", r.status===200 && (await r.json()).queues.length===6);
MAIN_FN=null;
// віджет зник (наприклад, видалили) — створюється новий
sqlite.prepare("UPDATE kv SET v=? WHERE k='pub:widgets'").run(JSON.stringify([{id:"Wgone",ver:1}]));
L=await tgp(888,"/start"); chk("спільний віджет не знайдено — бот створює новий", L.some(x=>x.m==="sendWidget") && JSON.parse(sqlite.prepare("SELECT v FROM kv WHERE k='pub:widgets'").get().v).some(w=>w.id==="W2"));
// Telegram вимкнув картки (INPUT_MEDIA_WIDGET_NOT_ALLOWED) — стан черг повідомленням із кнопками, без технічних слів
WIDGET_FAIL="Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED"; sqlite.prepare("DELETE FROM kv WHERE k='pub:widgets'").run();
L=await tgp(4242,"/start"); let fb=L.find(x=>x.m==="sendMessage");
const kbt=fb && fb.b.reply_markup.inline_keyboard.flat();
chk("картки заборонені — стан усіх черг повідомленням, кнопки черг/🔄/🔔/Мапа/Сайт, закріплено", fb && fb.b.text.includes("Черга 3.2") && !/NOT_ALLOWED|не вдалося/i.test(fb.b.text) && kbt.some(k=>k.callback_data==="e:3.2") && kbt.some(k=>k.callback_data==="r") && kbt.some(k=>k.callback_data==="n") && kbt.some(k=>k.url) && L.some(x=>x.m==="pinChatMessage"), fb && fb.b.text.replace(/\n/g," | "));
t=await (await B("/")).text(); chk("…причина видна на головній сторінці бота", t.includes("sendWidget: 400 Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED"), t.split("\n").slice(-2).join(" | "));
L=await tgp(4243,"/start"); chk("…наступні /start — одразу стан, картку не пробуємо (6 год)", !L.some(x=>/Widget/.test(x.m)) && L.some(x=>x.m==="sendMessage"));
const cbk=async(chat,data,kb)=>{ const n=log.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),callback_query:{id:"c1",from:{id:chat},data,message:{chat:{id:chat},message_id:900,reply_markup:kb}}})}); return log.slice(n); };
L=await cbk(4243,"e:3.2",fb.b.reply_markup); let ex=L.find(x=>x.m==="editMessageText");
chk("натиснув «3.2» — розкрито: графік сьогодні/завтра, наступне відключення; кнопка ▾", ex && /Черга 3\.2<\/b>[^\n]*\n\s+сьогодні: 08:00–14:00, 20:00–24:00\n\s+завтра: 00:00–04:00/.test(ex.b.text) && /наступне відключення: 20:00|за графіком відключення до/.test(ex.b.text) && ex.b.reply_markup.inline_keyboard.flat().some(k=>k.text==="▾ 3.2"), ex && ex.b.text.replace(/\n/g," | "));
L=await cbk(4243,"e:6.1",ex.b.reply_markup); ex=L.find(x=>x.m==="editMessageText");
chk("…ще «6.1» — розкриті обидві", ex && ex.b.reply_markup.inline_keyboard.flat().filter(k=>/^▾/.test(k.text)).length===2);
L=await cbk(4243,"r",ex.b.reply_markup); ex=L.find(x=>x.m==="editMessageText");
chk("🔄 — оновлено в тому самому повідомленні, розкриті лишаються; підказка з часом", ex && ex.b.message_id===900 && ex.b.reply_markup.inline_keyboard.flat().filter(k=>/^▾/.test(k.text)).length===2 && L.some(x=>x.m==="answerCallbackQuery" && /дані на/.test(x.b.text)));
NOW+=7*3600000; WIDGET_FAIL=null; L=await tgp(4244,"/start"); chk("через 6+ год пробує картку знову; Telegram дозволив — картка", L.some(x=>x.m==="sendWidget") && !L.some(x=>x.m==="sendMessage") && sqlite.prepare("SELECT v FROM kv WHERE k='pub:wdg_off'").get().v==="0");
// розмір даних: багато інтервалів
const many=[]; for(let h=0;h<24;h+=2) many.push([`${String(h).padStart(2,"0")}:00`,`${String(h).padStart(2,"0")}:30`]);
for (const q of FAKE.queues) { q.today=many; q.tomorrow=many; }
for (const n of ["5.1","5.2","6.2"]) FAKE.queues.push({name:n,state:"on",since:NOW,today:many,tomorrow:many});
later(60000); L=await cron(); const ed2=L.find(x=>x.m==="editSharedWidgetData");
chk("дуже багато відключень — дані все одно ≤ 1024 байт (без «завтра» для частини черг)", ed2 && new TextEncoder().encode(ed2.b.public_data).length<=1024, ed2 && new TextEncoder().encode(ed2.b.public_data).length);
const html=await (await B("/widget-preview")).text(); chk("/widget-preview віддає сторінку з віджетом", html.includes("TelegramWidget") && html.includes("Вибрати черги"));
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
