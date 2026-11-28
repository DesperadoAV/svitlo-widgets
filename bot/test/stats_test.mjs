// Статистика бота для мешканців (/stats.json) — лише кількості. Справжні Telegram і основний бот не використовуються:
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


// вебхук: секрет — з /setup
await B("/setup"); const SEC=log.find(x=>x.m==="setWebhook").b.secret_token;
const msg=async(chat,text)=>{ NOW+=2000; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),message:{chat:{id:chat,type:"private"},from:{id:chat},text}})}); };
const cbq=async(chat,data)=>{ NOW+=2000; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),callback_query:{id:"c",from:{id:chat},data,message:{chat:{id:chat,type:"private"},message_id:900}}})}); };
const st=async()=>{ const r=await B("/stats.json"); return { h:r.headers.get("cache-control"), j:await r.json() }; };
// вчора: двоє людей
NOW-=86400000; await msg(101,"/start"); await msg(102,"/start"); await cbq(102,"q:3.2");
NOW+=86400000;
// сьогодні: 102 знову + двоє нових; 103 — кнопками
await msg(102,"💡 Стан"); await msg(103,"/start"); await cbq(103,"q:4.1"); await cbq(103,"x"); await msg(104,"/start");
sqlite.prepare("INSERT OR IGNORE INTO subs(chat_id,queue) VALUES(102,'3.2'),(103,'3.2'),(103,'4.1')").run();
sqlite.prepare("INSERT OR IGNORE INTO myq(chat_id,queue) VALUES(102,'3.2'),(103,'4.1'),(104,'1.1')").run();
// сповіщення: 3 у Telegram (одне — людина заблокувала бота), 1 у браузер
sqlite.prepare("INSERT INTO outbox(chat_id,text,at) VALUES(102,'a',?),(103,'b',?),(104,'c',?)").run(NOW,NOW,NOW);
const origFetch=globalThis.fetch;
globalThis.fetch=async(u,o={})=>{ if(String(u).includes("/sendMessage")){ let b={}; try{b=JSON.parse(o.body)}catch(e){} if(b.chat_id===104) return {json:async()=>({ok:false,error_code:403,description:"Forbidden: bot was blocked by the user"})}; } return origFetch(u,o); };
await cron(); globalThis.fetch=origFetch;
let {h,j}=await st();
chk("/stats.json: без кешу, лише кількості (немає жодних номерів чатів)", h==="no-store" && !/10[1-4]\b/.test(JSON.stringify({...j,days:j.days.map(d=>({...d,day:""}))}).replace(/"now":\d+/,"")), JSON.stringify(j).slice(0,200));
chk("користувачів 4; нових сьогодні 2, за 7 днів 4", j.users===4 && j.new.d0===2 && j.new.d7===4, JSON.stringify(j.new));
chk("активних: сьогодні 3 (102, 103, 104), вчора 2, за 7 днів 4", j.active.d0===3 && j.active.d1===2 && j.active.d7===4, JSON.stringify(j.active));
const t=j.days[13], y=j.days[12];
chk("дії в боті: сьогодні 5 (3 повідомлення + 2 кнопки), вчора 3", t.act===5 && y.act===3, JSON.stringify([t,y]));
chk("надіслано в Telegram сьогодні 2 (заблокований не рахується)", t.tg===2, t.tg);
chk("обрали черги 3; сповіщення ввімкнули 2; по чергах 3.2 — 2, 4.1 — 1", j.myq===3 && j.subs===2 && j.byQueue["3.2"]===2 && j.byQueue["4.1"]===1, JSON.stringify([j.myq,j.subs,j.byQueue]));
chk("14 днів у розкладі по днях; «рахую з» — учорашня дата", j.days.length===14 && j.since===y.day, j.since);
// телефони із застосунком: віджет бере /status.json
const WG=async(ua,id)=>{ NOW+=60000; await B("/status.json",{headers:{"user-agent":ua,...(id?{"x-svitlo-device":id}:{})}}); };
await WG("SvitloWidget/1.1.31 (Android 13)"); await WG("SvitloWidget/1.1.31 (Android 13)"); await WG("SvitloWidget/1.1.31 (Android 16)"); await WG("SvitloWidget/1.1.28 (Android 16)"); await WG("Mozilla/5.0 Chrome");
({j}=await st());
chk("застосунок: 3 телефони (однакові версії — один), версії 1.1.31 — 2, 1.1.28 — 1; «щонайменше» (без номера)", j.app.d0.n===3 && j.app.d0.exact===false && j.app.d0.byVer["1.1.31"]===2 && j.app.d0.byVer["1.1.28"]===1, JSON.stringify(j.app));
await WG("SvitloWidget/1.1.32 (Android 17)","abcdefghij12"); await WG("SvitloWidget/1.1.32 (Android 17)","abcdefghij12"); await WG("SvitloWidget/1.1.32 (Android 17)","zyxwvutsrq98");
({j}=await st());
chk("…нові версії з анонімним номером: два різні телефони з однаковими версіями рахуються окремо (усього 5)", j.app.d0.n===5 && j.app.d0.byVer["1.1.32"]===2, JSON.stringify(j.app));
chk("…у статистиці немає самих номерів телефонів", !/abcdefghij12|zyxwvutsrq98/.test(JSON.stringify(j)));
// старше 60 днів прибирається раз на добу
sqlite.prepare("INSERT INTO dau(day,chat_id) VALUES('2026-01-01',1)").run(); sqlite.prepare("INSERT INTO daily(day,k,n) VALUES('2026-01-01','act',9)").run();
sqlite.prepare("DELETE FROM kv WHERE k='pub:clean'").run(); await cron();
chk("старша за 60 днів статистика прибрана", !sqlite.prepare("SELECT 1 FROM dau WHERE day='2026-01-01'").get() && !sqlite.prepare("SELECT 1 FROM daily WHERE day='2026-01-01'").get());
console.log(errs.length ? "\nПОМИЛОК: "+errs.length : "\nУСЕ ПРОЙДЕНО"); process.exit(errs.length?1:0);
