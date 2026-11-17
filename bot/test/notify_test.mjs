// Перевірка сповіщень бота (svitlo-public): підписки, події «зникло / з'явилось / за 10 хв», розсилка в Telegram і Firebase.
// Справжні Telegram, Google і основний бот не використовуються — усе підставне. Запуск: node bot/test/notify_test.mjs
import { DatabaseSync } from 'node:sqlite';
let NOW = Date.parse("2026-11-17T15:30:00+02:00"); Date.now = () => NOW;
const { default: bot } = await import(new URL('../worker.js', import.meta.url));
const sqlite = new DatabaseSync(':memory:');
function stmt(sql){ let args=[]; const o={ bind:(...a)=>{args=a;return o;}, async run(){ const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }, async first(){ return sqlite.prepare(sql).get(...args) ?? null; }, async all(){ return {results: sqlite.prepare(sql).all(...args)}; }, _raw(){ const st=sqlite.prepare(sql); return /^\s*SELECT/i.test(sql)?{results:st.all(...args)}:(st.run(...args),{results:[]}); } }; return o; }
const DB={ prepare:(s)=>stmt(s), async batch(l){ return l.map(s=>s._raw()); } };
const errs=[]; const chk=(n,c,x="")=>{console.log((c?"✅":"❌")+" "+n+(x!==""?" | "+String(x).slice(0,300):"")); if(!c) errs.push(n);};

// ключ «сервісного акаунта» Firebase — справжній RSA, щоб перевірити підпис
const kp = await crypto.subtle.generateKey({ name:"RSASSA-PKCS1-v1_5", modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256" }, true, ["sign","verify"]);
const pk = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64").match(/.{1,64}/g).join("\n");
const SA = JSON.stringify({ type:"service_account", project_id:"svitlo-test", client_email:"bot@svitlo-test.iam.gserviceaccount.com", private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----\n`, token_uri:"https://oauth2.googleapis.com/token" });

const FAKE = { v:1, today:"17.11.2026", tomorrow:"18.11.2026", kyiv_offset_min:120, map:"https://map.test/", site:"https://svitlo-main.test/",
  queues:[ {name:"3.2",state:"on",since:NOW-5*3600000,today:[["15:40","17:00"]],tomorrow:null},
           {name:"4.1",state:"on",since:NOW-3600000,today:[],tomorrow:null},
           {name:"6.1",state:"off",since:NOW-2*3600000,today:[["12:00","16:00"]],tomorrow:null} ] };
const Q = n => FAKE.queues.find(q=>q.name===n);
let tgl=[], fcm=[], oauth=0, BLOCKED=new Set(), RATE=0, mainHits=0;
globalThis.fetch=async(u,o={})=>{ u=String(u); let b={}; try{b=JSON.parse(o.body)}catch(e){}
  if(u==="https://svitlo-main.test/api/status"){ mainHits++; return new Response(JSON.stringify({...FAKE,now:NOW})); }
  if(u==="https://oauth2.googleapis.com/token"){ oauth++;
    const a=new URLSearchParams(o.body).get("assertion").split("."), ok=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",kp.publicKey,Buffer.from(a[2],"base64url"),new TextEncoder().encode(a[0]+"."+a[1]));
    const cl=JSON.parse(Buffer.from(a[1],"base64url"));
    if(!ok || cl.scope!=="https://www.googleapis.com/auth/firebase.messaging" || cl.iss!=="bot@svitlo-test.iam.gserviceaccount.com") return new Response(JSON.stringify({error:"invalid_grant"}),{status:400});
    return new Response(JSON.stringify({access_token:"AT"+oauth,expires_in:3599})); }
  if(u.startsWith("https://fcm.googleapis.com/")){ fcm.push({u,auth:o.headers.authorization,m:b.message}); return new Response("{}"); }
  if(u.includes("api.telegram.org/botPUB")){ const m=u.split("/").pop();
    if(m==="sendMessage" && BLOCKED.has(b.chat_id)) return new Response(JSON.stringify({ok:false,error_code:403,description:"Forbidden: bot was blocked by the user"}));
    if(m==="sendMessage" && RATE && tgl.filter(x=>x.m==="sendMessage").length>=RATE) { RATE=0; return new Response(JSON.stringify({ok:false,error_code:429,description:"Too Many Requests: retry after 3"})); }
    tgl.push({m,b}); return new Response(JSON.stringify({ok:true,result:{message_id:500+tgl.length}})); }
  throw new Error("тест не має ходити в інтернет: "+u); };

const penv={DB, BOT_TOKEN:"PUB:abc", MAIN_URL:"https://svitlo-main.test"};
const ctx={waitUntil:()=>{}};
penv.SELF={ fetch:(u,i)=>bot.fetch(new Request(u,i),penv,ctx) };
let W=[]; const B=async(p,i={})=>{ const r=await bot.fetch(new Request("https://pub.test"+p,i),penv,{waitUntil:x=>W.push(x)}); await Promise.all(W); W=[]; return r; };
await B("/setup"); const SEC=(await (async()=>{ const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("svitlo-pub:PUB:abc")); return [...new Uint8Array(h)].slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join(""); })());
const upd=async u=>{ const n=tgl.length; await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:Math.random(),...u})}); return tgl.slice(n); };
const msg=(chat,text)=>upd({message:{chat:{id:chat,type:"private"},from:{id:chat},text}});
const press=(chat,data)=>upd({callback_query:{id:"cb"+Math.random(),from:{id:chat},data,message:{chat:{id:chat},message_id:77}}});
const tick=async()=>{ const n=tgl.length, f=fcm.length; const P=[]; await bot.scheduled({},penv,{waitUntil:p=>P.push(p)}); await Promise.all(P); return {tg:tgl.slice(n).filter(x=>x.m==="sendMessage"), fcm:fcm.slice(f)}; };
const later=m=>{ NOW+=m*60000; };
const subs=c=>sqlite.prepare("SELECT queue FROM subs WHERE chat_id=? ORDER BY queue").all(c).map(r=>r.queue).join(",");

// нікому нічого не треба — основний бот не смикаємо
mainHits=0; await tick(); chk("ні підписок, ні карток, ні Firebase — щохвилинний запуск не звертається до основного бота", mainHits===0, mainHits);

// меню сповіщень
let L=await msg(1001,"/notify"); const menu=L.find(x=>x.m==="sendMessage");
chk("/notify — меню з чергами і попередженням за 10 хв", menu && menu.b.reply_markup.inline_keyboard.flat().some(k=>k.callback_data==="nq:3.2") && menu.b.reply_markup.inline_keyboard.flat().some(k=>k.callback_data==="nw"), menu && JSON.stringify(menu.b.reply_markup).slice(0,200));
L=await press(1001,"nq:3.2");
chk("натиснув «3.2» — підписався; меню оновилось з ✅, коротке підтвердження", subs(1001)==="3.2" && L.some(x=>x.m==="answerCallbackQuery" && /3\.2.*увімкнено/.test(x.b.text)) && L.some(x=>x.m==="editMessageText" && JSON.stringify(x.b.reply_markup).includes("✅ 3.2")));
await press(1002,"nq:3.2"); await press(1002,"nq:6.1"); L=await press(1002,"nw");
chk("інший користувач: 3.2 і 6.1, попередження за 10 хв вимкнув", subs(1002)==="3.2,6.1" && sqlite.prepare("SELECT warn FROM notif WHERE chat_id=1002").get().warn===0 && L.some(x=>x.m==="answerCallbackQuery" && /вимкнено/.test(x.b.text)));
await press(1003,"nq:4.1"); L=await press(1003,"nq:4.1"); chk("повторне натискання — відписка", subs(1003)==="" && L.some(x=>x.m==="answerCallbackQuery" && /вимкнено/.test(x.b.text)));
L=await press(1001,"nd"); chk("«Готово» — підсумок замість меню", L.some(x=>x.m==="editMessageText" && x.b.text.includes("черга 3.2")));
L=await msg(1004,"/start"); chk("у картці/стані є кнопка «🔔 Сповіщення»", L.some(x=>x.b.reply_markup && JSON.stringify(x.b.reply_markup).includes('"callback_data":"n"')));
L=await press(1004,"n"); chk("кнопка «🔔» відкриває меню", L.some(x=>x.m==="sendMessage" && x.b.text.includes("Сповіщення про світло")));

// перший запуск: запам'ятовує стан; 3.2 — відключення о 15:40, зараз 15:30 → попередження
penv.FCM_SA=SA;
let T=await tick();
chk("за 10 хв до планового відключення — попередження тим, хто його не вимкнув (1001 так, 1002 ні)", T.tg.length===1 && T.tg[0].b.chat_id===1001 && /за 10 хв відключення/.test(T.tg[0].b.text) && T.tg[0].b.text.includes("15:40–17:00"), T.tg.map(x=>x.b.chat_id+":"+x.b.text).join(" / "));
chk("…і в застосунок: тема w_3.2, дані (kind, q, title, body), висока важливість", T.fcm.length===1 && T.fcm[0].m.topic==="w_3.2" && T.fcm[0].m.data.kind==="warn" && T.fcm[0].m.data.q==="3.2" && /за 10 хв/.test(T.fcm[0].m.data.title) && T.fcm[0].m.android.priority==="HIGH" && T.fcm[0].auth==="Bearer AT1" && T.fcm[0].u.includes("/projects/svitlo-test/"), T.fcm[0] && JSON.stringify(T.fcm[0].m));
later(1); T=await tick(); chk("через хвилину попередження не повторюється", T.tg.length===0 && T.fcm.length===0);
// 3.2 згасла о 15:41 (у межах планового)
later(9); await tick(); Object.assign(Q("3.2"),{state:"off",since:NOW}); later(1); T=await tick();
const lost=T.tg.map(x=>x.b.chat_id).sort().join(",");
chk("3.2 згасла — повідомлення обом підписаним", lost==="1001,1002", lost);
chk("…текст: час, скільки було світло, за графіком до 17:00", /світло зникло/.test(T.tg[0].b.text) && /Світло було: 5 год 1\d хв/.test(T.tg[0].b.text) && /до 17:00/.test(T.tg[0].b.text), T.tg[0].b.text.replace(/\n/g," | "));
chk("…Firebase: тема q_3.2, kind=lost; доступ Google отримано один раз", T.fcm.length===1 && T.fcm[0].m.topic==="q_3.2" && T.fcm[0].m.data.kind==="lost" && oauth===1, oauth);
// 6.1 з'явилась, 3.2 повернулась позапланово рано
later(5); Object.assign(Q("6.1"),{state:"on",since:NOW}); Object.assign(Q("3.2"),{state:"on",since:NOW}); T=await tick();
const back=T.tg.map(x=>x.b.chat_id+":"+(/6\.1/.test(x.b.text)?"6.1":"3.2")).sort().join(",");
chk("з'явилось світло: 3.2 → 1001 і 1002, 6.1 → лише 1002", back==="1001:3.2,1002:3.2,1002:6.1", back);
chk("…текст: скільки не було світла", T.tg.some(x=>/світло з'явилось/.test(x.b.text) && /Світла не було: 2 год/.test(x.b.text)), T.tg.map(x=>x.b.text).join(" / ").replace(/\n/g," | "));
chk("…Firebase: q_3.2 і q_6.1 (kind=back)", T.fcm.map(x=>x.m.topic).sort().join(",")==="q_3.2,q_6.1" && T.fcm.every(x=>x.m.data.kind==="back"));
// через північ: сьогодні до 24:00 + завтра з 00:00 — це одне відключення, не нове
Object.assign(Q("4.1"),{today:[["22:00","24:00"]],tomorrow:[["00:00","02:00"]]});
NOW=Date.parse("2026-11-17T23:00:00+02:00"); T=await tick(); chk("відключення через північ — без хибного попередження о 23:50", !T.tg.length && !T.fcm.length);
// завтра о 00:00, а сьогодні — ні: попередження о 23:50
Object.assign(Q("4.1"),{today:[["08:00","12:00"]],tomorrow:[["00:00","04:00"]]});
const sub41=[]; for(let i=0;i<120;i++){ sqlite.prepare("INSERT INTO subs(chat_id,queue) VALUES(?,?)").run(5000+i,"4.1"); sub41.push(5000+i); }
NOW=Date.parse("2026-11-17T23:51:00+02:00"); T=await tick();
chk("завтра о 00:00 — попередження о 23:51 («за 9 хв», час із датою)", T.fcm.some(x=>x.m.topic==="w_4.1" && /за 9 хв/.test(x.m.data.title) && /00:00 \(18\.11\)/.test(x.m.data.body)), T.fcm.map(x=>x.m.data.title+" "+x.m.data.body).join(" / "));
chk("120 підписників — усі отримали за один запуск (помічники паралельно)", new Set(T.tg.map(x=>x.b.chat_id)).size===120 && sqlite.prepare("SELECT COUNT(*) n FROM outbox").get().n===0, T.tg.length+" / у черзі "+sqlite.prepare("SELECT COUNT(*) n FROM outbox").get().n);
// Telegram просить пригальмувати (429) — решта пізніше; заблокували бота — підписку прибрано
BLOCKED.add(1002); Object.assign(Q("3.2"),{state:"off",since:NOW}); later(1); delete penv.SELF;
for(let i=0;i<30;i++) sqlite.prepare("INSERT INTO subs(chat_id,queue) VALUES(?,?)").run(7000+i,"3.2");
RATE=tgl.filter(x=>x.m==="sendMessage").length+5; T=await tick();
const left=sqlite.prepare("SELECT COUNT(*) n FROM outbox").get().n;
chk("429 від Telegram — надіслано частину, решта лишилась у черзі", T.tg.length===5 && left>0, T.tg.length+" надіслано, у черзі "+left);
let total=T.tg.length; for(let i=0;i<5 && sqlite.prepare("SELECT COUNT(*) n FROM outbox").get().n;i++){ later(1); total+=(await tick()).tg.length; }
chk("…наступними запусками дісталося всім (31 = 30 нових + 1001; 1002 заблокував)", total===31 && sqlite.prepare("SELECT COUNT(*) n FROM outbox").get().n===0, total);
chk("заблокував бота — підписки прибрано", subs(1002)==="", subs(1002));
// Firebase: токен прострочився / відкликаний (401) — бере новий
penv.SELF={ fetch:(u,i)=>bot.fetch(new Request(u,i),penv,ctx) };
const of=globalThis.fetch; let first401=true; globalThis.fetch=async(u,o)=>{ if(String(u).startsWith("https://fcm.") && first401){ first401=false; return new Response("unauth",{status:401}); } return of(u,o); };
Object.assign(Q("3.2"),{state:"on",since:NOW}); later(1); const o0=oauth; T=await tick(); globalThis.fetch=of;
chk("Firebase відповів 401 — новий доступ і повтор", oauth===o0+1 && T.fcm.some(x=>x.m.topic==="q_3.2"), `oauth ${o0}→${oauth}`);
// головна сторінка й /setup
let t=await (await B("/")).text(); chk("головна сторінка: кількість підписаних, Firebase налаштовано", /підписаних на сповіщення: \d+/.test(t) && t.includes("Firebase: налаштовано"), t.split("\n").slice(2,5).join(" | "));
t=await (await B("/setup")).text(); chk("/setup перевіряє Firebase", t.includes("📲 Firebase: ✅ (проєкт svitlo-test)"), t.replace(/\n/g," | "));
penv.FCM_SA='{"bad":1}'; t=await (await B("/setup")).text(); chk("…неправильний ключ — зрозуміла помилка", /Firebase: ❌ .*не той файл/.test(t));
const cmds=tgl.filter(x=>x.m==="setMyCommands").pop(); chk("команди бота: start, notify, status, help; вебхук приймає кнопки", cmds && cmds.b.commands.map(c=>c.command).join(",")==="start,notify,status,help" && tgl.filter(x=>x.m==="setWebhook").pop().b.allowed_updates.includes("callback_query"));
console.log(errs.length?"\n❌ ПРОВАЛЕНО: "+errs.join("; "):"\nУСЕ ПРОЙДЕНО");
if (errs.length) process.exit(1);
