// Перевірка публічного бота (svitlo-public) на тій самій базі, що й основний бот.
import { DatabaseSync } from 'node:sqlite';
let NOW = Date.parse("2026-11-17T15:30:00+02:00"); Date.now = () => NOW;
const { default: main } = await import('/tmp/s2/w_full.mjs');
const { default: bot } = await import('/tmp/claude-0/sw/bot/worker.js');
const sqlite = new DatabaseSync(':memory:');
function stmt(sql){ let args=[]; const o={ bind:(...a)=>{args=a;return o;}, async run(){ const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }, async first(){ return sqlite.prepare(sql).get(...args) ?? null; }, async all(){ return {results: sqlite.prepare(sql).all(...args)}; }, _raw(){ const st=sqlite.prepare(sql); return /^\s*SELECT/i.test(sql)?{results:st.all(...args)}:(st.run(...args),{results:[]}); } }; return o; }
const DB={ prepare:(s)=>stmt(s), async batch(l){ return l.map(s=>s._raw()); } };
const log=[]; let wid=0;
globalThis.fetch=async(u,o={})=>{ u=String(u); let b={}; try{b=JSON.parse(o.body)}catch(e){}
  if(u.includes("api.telegram.org/botPUB")){ const m=u.split("/").pop(); log.push({m,b});
    if(m==="getMe") return {json:async()=>({ok:true,result:{username:"svitlo_slav_bot"}})};
    if(m==="sendWidget") return {json:async()=>({ok:true,result:{message_id:100+log.length,widget:{id:"W"+(++wid)}}})};
    if(m==="sendSharedWidget") return {json:async()=>(b.widget_id==="Wgone"?{ok:false,description:"Bad Request: widget not found"}:{ok:true,result:{message_id:100+log.length}})};
    return {json:async()=>({ok:true,result:true})}; }
  return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:1}}),text:async()=>""}; };
const env={DB, ADMIN_BOT_TOKEN:"A", ADMIN_IDS:"1", ADMIN_KEY:"k", TG_SECRET:"s"}, penv={DB, BOT_TOKEN:"PUB:abc"};
const call=(p,i={})=>main.fetch(new Request("https://svitlo.test"+p,{...i,headers:{Cookie:"k=k",...(i.headers||{})}}),env,{waitUntil:p=>p});
let W=[]; const B=async(p,i={})=>{ const r=await bot.fetch(new Request("https://pub.test"+p,i),penv,{waitUntil:x=>W.push(x)}); await Promise.all(W); W=[]; return r; };
const errs=[]; const chk=(n,c,x="")=>{console.log((c?"✅":"❌")+" "+n+(x!==""?" | "+String(x).slice(0,260):"")); if(!c) errs.push(n);};
for (const n of ["1.1","2.1","3.1","3.2","4.1","6.1"]) await call("/admin/new",{method:"POST",body:new URLSearchParams({name:n})});
for (const n of ["1.1","2.1","3.1","3.2","4.1"]) await main.fetch(new Request(`https://svitlo.test/p/${n}/esp1`),env,{waitUntil:p=>p});
sqlite.prepare("UPDATE queues SET state='Offline', state_ts=? WHERE name='6.1'").run(NOW-3*3600000);
sqlite.prepare("UPDATE queues SET last_esp1=? WHERE name='6.1'").run(NOW-3*3600000);
const ins=sqlite.prepare("INSERT INTO schedule(queue,day,start,end) VALUES(?,?,?,?)");
for (const [q,d,a,b] of [["3.2","17.11.2026","08:00","12:00"],["3.2","17.11.2026","11:00","14:00"],["3.2","17.11.2026","20:00","23:59"],["3.2","18.11.2026","00:00","04:00"],["1.1","17.11.2026","16:00","20:00"],["6.1","17.11.2026","12:00","18:00"]]) ins.run(q,d,a,b);
// /status.json
let r=await B("/status.json"); const S=await r.json();
const q32=S.queues.find(q=>q.name==="3.2"), q61=S.queues.find(q=>q.name==="6.1"), q41=S.queues.find(q=>q.name==="4.1");
chk("/status.json: 6 черг, CORS", S.queues.length===6 && r.headers.get("access-control-allow-origin")==="*", S.queues.map(q=>q.name+":"+q.state).join(" "));
chk("…3.2: світло є, графік злито (08–14, 20–24), завтра 00–04", q32.state==="on" && JSON.stringify(q32.today)==='[["08:00","14:00"],["20:00","24:00"]]' && JSON.stringify(q32.tomorrow)==='[["00:00","04:00"]]', JSON.stringify(q32));
chk("…6.1: світла немає з 12:30", q61.state==="off" && q61.since===NOW-3*3600000);
chk("…4.1: графіка немає — null (а не «відключень немає»)", q41.today===null && q41.tomorrow===null);
chk("…мапа й сайт", S.map.startsWith("https://desperadoav.github.io/") && S.site.includes("svitlo51"));
// setup
r=await B("/setup"); let t=await r.text();
const wh=log.find(x=>x.m==="setWebhook");
chk("/setup: вебхук на /tg із секретом, команди, опис", wh && wh.b.url==="https://pub.test/tg" && /^[0-9a-f]{32}$/.test(wh.b.secret_token) && log.some(x=>x.m==="setMyCommands") && t.includes("@svitlo_slav_bot"), t.replace(/\n/g," | "));
const SEC=wh.b.secret_token;
r=await B("/tg",{method:"POST",body:JSON.stringify({update_id:1,message:{chat:{id:555,type:"private"},text:"/start"}})});
chk("вебхук без секрету — 403", r.status===403);
const tgp=async(chat,text)=>{ const n=log.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),message:{chat:{id:chat,type:"private"},from:{id:chat},text}})}); return log.slice(n); };
let L=await tgp(555,"/start");
const sw=L.find(x=>x.m==="sendWidget");
chk("перший /start: створено спільний віджет (html, public_data, підпис, кнопки Мапа/Сайт)", sw && sw.b.is_shared===true && sw.b.html.includes("Світло В Славутичі") && JSON.parse(sw.b.public_data).q.length===6 && sw.b.caption && sw.b.reply_markup.inline_keyboard[0].length===2, sw && Object.keys(sw.b).join(","));
chk("…картку закріплено", L.some(x=>x.m==="pinChatMessage" && x.b.chat_id===555));
L=await tgp(777,"привіт");
chk("інший користувач — той самий спільний віджет (sendSharedWidget W1)", L.some(x=>x.m==="sendSharedWidget" && x.b.widget_id==="W1") && !L.some(x=>x.m==="sendWidget"));
chk("користувачі записані", sqlite.prepare("SELECT COUNT(*) n FROM pub_users").get().n===2);
L=await tgp(555,"/help"); chk("/help — пояснення з кнопками", L.some(x=>x.m==="sendMessage" && x.b.text.includes("Вибрати черги")));
// оновлення
let n=log.length; await bot.scheduled({},penv,{waitUntil:p=>p}); await new Promise(r=>setTimeout(r,10));
chk("щохвилинна перевірка без змін — Telegram не смикаємо", !log.slice(n).some(x=>x.m==="editSharedWidgetData"));
NOW+=60000; sqlite.prepare("UPDATE queues SET state='Offline', state_ts=? WHERE name='3.2'").run(NOW);
n=log.length; await bot.scheduled({},penv,{waitUntil:p=>p}); await new Promise(r=>setTimeout(r,10));
const ed=log.slice(n).find(x=>x.m==="editSharedWidgetData");
chk("3.2 згасла — спільну картку оновлено одним запитом", ed && ed.b.widget_id==="W1" && JSON.parse(ed.b.public_data).q.find(q=>q[0]==="3.2")[1]===0 && ed.b.cache_time===60, ed && ed.b.public_data);
// віджет зник (наприклад, видалили) — створюється новий
sqlite.prepare("UPDATE kv SET v=? WHERE k='pub:widgets'").run(JSON.stringify([{id:"Wgone",ver:1}]));
L=await tgp(888,"/start"); chk("спільний віджет не знайдено — бот створює новий", L.some(x=>x.m==="sendWidget") && JSON.parse(sqlite.prepare("SELECT v FROM kv WHERE k='pub:widgets'").get().v).some(w=>w.id==="W2"));
// розмір даних: багато інтервалів
for (const q of ["1.1","2.1","3.1","4.1","6.1"]) for (let h=0; h<24; h+=2) { ins.run(q,"17.11.2026",`${String(h).padStart(2,"0")}:00`,`${String(h).padStart(2,"0")}:30`); ins.run(q,"18.11.2026",`${String(h).padStart(2,"0")}:00`,`${String(h).padStart(2,"0")}:30`); }
NOW+=60000; n=log.length; await bot.scheduled({},penv,{waitUntil:p=>p}); await new Promise(r=>setTimeout(r,10));
const ed2=log.slice(n).find(x=>x.m==="editSharedWidgetData");
chk("дуже багато відключень — дані все одно ≤ 1024 байт (без «завтра» для частини черг)", ed2 && new TextEncoder().encode(ed2.b.public_data).length<=1024, ed2 && new TextEncoder().encode(ed2.b.public_data).length);
const html=await (await B("/widget-preview")).text(); chk("/widget-preview віддає сторінку з віджетом", html.includes("TelegramWidget") && html.includes("Вибрати черги"));
console.log(errs.length?"\n❌ ПРОВАЛЕНО: "+errs.join("; "):"\nУСЕ ПРОЙДЕНО");
