// 📢 Оголошення з адмін-бота і 📲 нова версія застосунку: Telegram (усім, хто писав ботові), застосунок (Firebase, тема news),
// браузери (Web Push). Справжні Telegram, Google, GitHub і основний бот не використовуються. Запуск: node bot/test/news_test.mjs
import { DatabaseSync } from 'node:sqlite';
let NOW = Date.parse("2026-11-19T10:00:00+02:00"); Date.now = () => NOW;
const { default: bot } = await import(new URL('../worker.js', import.meta.url));
const sqlite = new DatabaseSync(':memory:');
function stmt(sql){ let args=[]; const o={ bind:(...a)=>{args=a;return o;}, async run(){ const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }, async first(){ return sqlite.prepare(sql).get(...args) ?? null; }, async all(){ return {results: sqlite.prepare(sql).all(...args)}; }, _raw(){ const st=sqlite.prepare(sql); return /^\s*SELECT/i.test(sql)?{results:st.all(...args)}:(st.run(...args),{results:[]}); } }; return o; }
const DB={ prepare:(s)=>stmt(s), async batch(l){ return l.map(s=>s._raw()); } };
const errs=[]; const chk=(n,c,x="")=>{console.log((c?"✅":"❌")+" "+n+(x!==""?" | "+String(x).slice(0,300):"")); if(!c) errs.push(n);};
const kp = await crypto.subtle.generateKey({ name:"RSASSA-PKCS1-v1_5", modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256" }, true, ["sign","verify"]);
const pk = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64").match(/.{1,64}/g).join("\n");
const SA = JSON.stringify({ type:"service_account", project_id:"svitlo-test", client_email:"bot@svitlo-test.iam.gserviceaccount.com", private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----\n`, token_uri:"https://oauth2.googleapis.com/token" });
const FAKE = { v:1, today:"19.11.2026", tomorrow:"20.11.2026", kyiv_offset_min:120, map:"https://map.test/", site:"https://svitlo-main.test/",
  queues:[ {name:"3.2",state:"on",since:NOW-3600000,today:[],tomorrow:null} ], notice:null };
let tgl=[], fcm=[], web=[], LATEST={ code:126, name:"1.1.26", url:"https://github.com/DesperadoAV/svitlo-widgets/releases/download/v1.1.26/svitlo-widget.apk" }, latestHits=0;
globalThis.fetch=async(u,o={})=>{ u=String(u); let b={}; try{b=JSON.parse(o.body)}catch(e){}
  if(u==="https://svitlo-main.test/api/status") return new Response(JSON.stringify({...FAKE,now:NOW}));
  if(u==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"AT",expires_in:3599}));
  if(u.startsWith("https://fcm.googleapis.com/v1/")){ fcm.push(b.message); return new Response("{}"); }
  if(u.startsWith("https://fcm.googleapis.com/fcm/send/")){ web.push(u); return new Response("",{status:201}); }
  if(u==="https://raw.githubusercontent.com/DesperadoAV/svitlo-widgets/app-build/latest.json"){ latestHits++; return new Response(JSON.stringify(LATEST)); }
  if(u.includes("api.telegram.org/botPUB")){ tgl.push({m:u.split("/").pop(),b}); return new Response(JSON.stringify({ok:true,result:{message_id:1}})); }
  throw new Error("тест не має ходити в інтернет: "+u); };
const penv={DB, BOT_TOKEN:"PUB:abc", MAIN_URL:"https://svitlo-main.test", FCM_SA:SA};
const ctx={waitUntil:()=>{}}; penv.SELF={ fetch:(u,i)=>bot.fetch(new Request(u,i),penv,ctx) };
const B=async(p,i={})=>bot.fetch(new Request("https://pub.test"+p,i),penv,ctx);
const tick=async()=>{ const a=tgl.length,f=fcm.length,w=web.length,P=[]; await bot.scheduled({},penv,{waitUntil:p=>P.push(p)}); await Promise.all(P); return {tg:tgl.slice(a).filter(x=>x.m==="sendMessage"),fcm:fcm.slice(f),web:web.slice(w)}; };
const later=m=>{ NOW+=m*60000; };
// люди: троє писали ботові; браузер із сповіщеннями
const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("svitlo-pub:PUB:abc")); const SEC=[...new Uint8Array(h)].slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join("");
for (const id of [11,12,13]) { await B("/tg",{method:"POST",headers:{"x-telegram-bot-api-secret-token":SEC},body:JSON.stringify({update_id:id,message:{chat:{id,type:"private"},from:{id},text:"/start"}})}); }
const k=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]); const pub=Buffer.from(await crypto.subtle.exportKey("raw",k.publicKey)).toString("base64url");
await B("/wp/sub",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sub:{endpoint:"https://fcm.googleapis.com/fcm/send/W1",keys:{p256dh:pub,auth:Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")}},queues:["3.2"]})});
let T=await tick(); later(1);
chk("без оголошення — нічого зайвого; опис останньої версії застосунку лише запам'ятали", !T.tg.length && !T.fcm.length && latestHits===1 && sqlite.prepare("SELECT v FROM kv WHERE k='pub:appver'").get().v==="126");
// оголошення для всіх: бот, застосунок, сайт
FAKE.notice={ id:NOW, text:"Завтра з 9:00 планові роботи <на підстанції>. https://ex.com/i", at:NOW, until:NOW+86400000, to:["bot","app","site"] };
later(1); T=await tick();
const tm=T.tg.filter(x=>/Оголошення/.test(x.b.text));
chk("Telegram: усім трьом, хто писав ботові, — «📢 Оголошення» і текст (HTML екрановано)", tm.map(x=>x.b.chat_id).sort().join()==="11,12,13" && tm[0].b.text==="📢 <b>Оголошення</b>\n\nЗавтра з 9:00 планові роботи &lt;на підстанції&gt;. https://ex.com/i", tm.map(x=>x.b.chat_id+":"+x.b.text.slice(0,40)).join(" / "));
const fn=T.fcm.find(m=>m.topic==="news");
chk("застосунок: push на тему news (усім застосункам), вид news", fn && fn.data.kind==="news" && fn.data.body.startsWith("Завтра з 9:00") && fn.data.title==="📢 Світло В Славутичі" && fn.android.ttl==="86400s", JSON.stringify(fn));
chk("браузери з увімкненими сповіщеннями — теж", T.web.length===1 && T.web[0].endsWith("/W1"));
let sj=await (await B("/status.json")).json(); chk("/status.json для застосунку: оголошення є", sj.notice && sj.notice.id===FAKE.notice.id && sj.notice.to.join()==="bot,app,site");
later(1); T=await tick(); chk("наступної хвилини — не повторює", !T.tg.length && !T.fcm.length && !T.web.length);
// лише для сайту — ні Telegram, ні застосунку
FAKE.notice={ id:NOW, text:"Лише для сайту", at:NOW, until:NOW+86400000, to:["site"] }; later(1); T=await tick();
chk("оголошення лише для сайту: тільки браузерам", !T.tg.some(x=>/Оголошення/.test(x.b.text)) && !T.fcm.some(m=>m.data.kind==="news") && T.web.length===1);
// давнє (бот щойно запустили, а оголошення висить уже годину) — не розсилаємо
sqlite.prepare("DELETE FROM kv WHERE k='pub:notice'").run(); FAKE.notice={ id:NOW-7200000, text:"Давнє", at:NOW-7200000, until:NOW+86400000, to:["bot","app"] }; later(1); T=await tick();
chk("давнє оголошення (понад годину) після перезапуску бота — не розсилає заднім числом", !T.tg.length && !T.fcm.length);
// нова версія застосунку
LATEST={ code:127, name:"1.1.27", url:"https://github.com/DesperadoAV/svitlo-widgets/releases/download/v1.1.27/svitlo-widget.apk" };
later(10); T=await tick(); chk("версію перевіряє не частіше ніж раз на 30 хв", latestHits===1 && !T.fcm.some(m=>m.data.kind==="update"));
later(25); T=await tick(); const up=T.fcm.find(m=>m.data.kind==="update");
chk("вийшла 1.1.27 — push усім застосункам: «📲 Нова версія застосунку 1.1.27», номер і посилання", up && up.topic==="news" && up.data.code==="127" && up.data.name==="1.1.27" && up.data.url.endsWith("/v1.1.27/svitlo-widget.apk") && up.data.title==="📲 Нова версія застосунку 1.1.27", JSON.stringify(up&&up.data));
later(31); T=await tick(); chk("та сама версія — більше не шле", !T.fcm.some(m=>m.data.kind==="update") && latestHits===3);
LATEST={ code:0 }; later(31); T=await tick(); chk("незрозумілий опис версії — нічого не шле", !T.fcm.some(m=>m.data.kind==="update"));
console.log(errs.length?"\n❌ ПРОВАЛЕНО: "+errs.join("; "):"\nУСЕ ПРОЙДЕНО");
if (errs.length) process.exit(1);
