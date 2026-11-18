// Перевірка сповіщень у браузер (Web Push, сайт «Світло В Славутичі»): підписка, шифрування, підпис VAPID, події, розсилка.
// «Браузер» тут підставний, але зі справжніми ключами: тест сам розшифровує кожне сповіщення так, як це зробив би браузер.
// Справжні служби доставки, Telegram і основний бот не використовуються. Запуск: node bot/test/webpush_test.mjs
import { DatabaseSync } from 'node:sqlite';
let NOW = Date.parse("2026-11-17T15:30:00+02:00"); Date.now = () => NOW;
const { default: bot } = await import(new URL('../worker.js', import.meta.url));
const sqlite = new DatabaseSync(':memory:');
function stmt(sql){ let args=[]; const o={ bind:(...a)=>{args=a;return o;}, async run(){ const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }, async first(){ return sqlite.prepare(sql).get(...args) ?? null; }, async all(){ return {results: sqlite.prepare(sql).all(...args)}; }, _raw(){ const st=sqlite.prepare(sql); return /^\s*SELECT/i.test(sql)?{results:st.all(...args)}:(st.run(...args),{results:[]}); } }; return o; }
const DB={ prepare:(s)=>stmt(s), async batch(l){ return l.map(s=>s._raw()); } };
const errs=[]; const chk=(n,c,x="")=>{console.log((c?"✅":"❌")+" "+n+(x!==""?" | "+String(x).slice(0,300):"")); if(!c) errs.push(n);};
const b64u=b=>Buffer.from(b).toString("base64url"), unb=s=>new Uint8Array(Buffer.from(s,"base64url")), te=new TextEncoder();
const cat=(...a)=>{ const o=new Uint8Array(a.reduce((n,x)=>n+x.length,0)); let i=0; for(const x of a){o.set(x,i);i+=x.length;} return o; };

// ---- підставні браузери: справжні ключі P-256 і секрет auth, як у Chrome/Firefox
async function browser(id, host="fcm.googleapis.com/fcm/send"){
  const k=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const pub=new Uint8Array(await crypto.subtle.exportKey("raw",k.publicKey)), auth=crypto.getRandomValues(new Uint8Array(16));
  return { id, priv:k.privateKey, pub, auth, sub:{ endpoint:`https://${host}/${id}`, keys:{ p256dh:b64u(pub), auth:b64u(auth) } }, got:[] };
}
async function hkdf(salt,ikm,info,len){ const k=await crypto.subtle.importKey("raw",ikm,"HKDF",false,["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt,info},k,len*8)); }
async function decrypt(br, body){                                     // так розшифровує браузер (RFC 8291)
  const salt=body.slice(0,16), idlen=body[20], as=body.slice(21,21+idlen), ct=body.slice(21+idlen);
  const asKey=await crypto.subtle.importKey("raw",as,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:asKey},br.priv,256));
  const ikm=await hkdf(br.auth,shared,cat(te.encode("WebPush: info\0"),br.pub,as),32);
  const cek=await hkdf(salt,ikm,te.encode("Content-Encoding: aes128gcm\0"),16), nonce=await hkdf(salt,ikm,te.encode("Content-Encoding: nonce\0"),12);
  const key=await crypto.subtle.importKey("raw",cek,"AES-GCM",false,["decrypt"]);
  const pt=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:nonce},key,ct));
  let e=pt.length-1; while(e>0 && pt[e]===0) e--; if(pt[e]!==2) throw new Error("немає роздільника 0x02");
  return JSON.parse(new TextDecoder().decode(pt.slice(0,e)));
}
async function vapidOk(h, aud){                                       // підпис VAPID справжній і для цієї служби
  const m=/^vapid t=([^,]+), k=(.+)$/.exec(h||""); if(!m) return "немає заголовка vapid";
  const [a,b,c]=m[1].split("."), pk=await crypto.subtle.importKey("raw",unb(m[2]),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  if(!await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},pk,unb(c),te.encode(a+"."+b))) return "підпис не сходиться";
  const cl=JSON.parse(Buffer.from(b,"base64url")); if(cl.aud!==aud) return "aud "+cl.aud; if(cl.exp<NOW/1000+3600 || cl.exp>NOW/1000+86400) return "exp"; if(!/^(https:|mailto:)/.test(cl.sub)) return "sub";
  return m[2];
}

const FAKE = { v:1, today:"17.11.2026", tomorrow:"18.11.2026", kyiv_offset_min:120, map:"https://map.test/", site:"https://svitlo-main.test/",
  queues:[ {name:"3.2",state:"on",since:NOW-5*3600000,today:[["15:40","17:00"]],tomorrow:null},
           {name:"4.1",state:"on",since:NOW-3600000,today:[],tomorrow:null},
           {name:"6.1",state:"off",since:NOW-2*3600000,today:[["12:00","16:00"]],tomorrow:null} ] };
const Q=n=>FAKE.queues.find(q=>q.name===n);
const BR=new Map(); let STATUS=()=>201, pushes=[], tgl=[];
globalThis.fetch=async(u,o={})=>{ u=String(u);
  if(u==="https://svitlo-main.test/api/status") return new Response(JSON.stringify({...FAKE,now:NOW}));
  if(u.includes("api.telegram.org")){ let b={}; try{b=JSON.parse(o.body)}catch(e){} tgl.push({m:u.split("/").pop(),b}); return new Response(JSON.stringify({ok:true,result:{message_id:1}})); }
  const br=[...BR.values()].find(x=>x.sub.endpoint===u);
  if(br){ const st=STATUS(br); const body=new Uint8Array(await new Response(o.body).arrayBuffer());
    const p={br:br.id,st,h:o.headers,v:await vapidOk(o.headers.authorization,new URL(u).origin)};
    try{ p.msg=await decrypt(br,body); }catch(e){ p.err=String(e); }
    pushes.push(p); if(st<300) br.got.push(p.msg); return new Response("",{status:st}); }
  throw new Error("тест не має ходити в інтернет: "+u); };
const penv={DB, BOT_TOKEN:"PUB:abc", MAIN_URL:"https://svitlo-main.test"};
const ctx={waitUntil:()=>{}}; penv.SELF={ fetch:(u,i)=>bot.fetch(new Request(u,i),penv,ctx) };
const B=async(p,i={})=>bot.fetch(new Request("https://pub.test"+p,i),penv,ctx);
const post=async(p,b,h={})=>{ const r=await B(p,{method:"POST",headers:{"content-type":"application/json",origin:"https://svitlo51.test",...h},body:JSON.stringify(b)}); return {r, j:await r.json()}; };
const tick=async()=>{ const n=pushes.length; const P=[]; await bot.scheduled({},penv,{waitUntil:p=>P.push(p)}); await Promise.all(P); return pushes.slice(n); };
const later=m=>{ NOW+=m*60000; };

// ---- ключ і CORS
let r=await B("/wp/key"); const K=await r.json();
chk("/wp/key: публічний ключ VAPID (65 байт), дозволено з будь-якого сайту", r.status===200 && unb(K.key).length===65 && unb(K.key)[0]===4 && r.headers.get("access-control-allow-origin")==="*", K.key);
chk("…ключ створився сам і зберігся в базі (наступного разу — той самий)", (await (await B("/wp/key")).json()).key===K.key && JSON.parse(sqlite.prepare("SELECT v FROM kv WHERE k='pub:vapid'").get().v).pub===K.key);
r=await B("/wp/sub",{method:"OPTIONS",headers:{origin:"https://svitlo51.test","access-control-request-method":"POST","access-control-request-headers":"content-type"}});
chk("попередній запит браузера (OPTIONS) — 204 із дозволами CORS", r.status===204 && /POST/.test(r.headers.get("access-control-allow-methods")) && /content-type/.test(r.headers.get("access-control-allow-headers")));

// ---- підписка
const A=await browser("A"), Bb=await browser("B"), C=await browser("C","updates.push.services.mozilla.com/wpush/v2");
for (const x of [A,Bb,C]) BR.set(x.id,x);
let {r:rr,j}=await post("/wp/sub",{sub:{endpoint:"https://evil.test/x",keys:A.sub.keys},queues:["3.2"]});
chk("чужа адреса (не служба доставки браузера) — відмова 400", rr.status===400 && j.ok===false, JSON.stringify(j));
({j}=await post("/wp/sub",{sub:{endpoint:A.sub.endpoint,keys:{p256dh:"abc",auth:"x"}},queues:["3.2"]})); chk("биті ключі — відмова", j.ok===false);
({j}=await post("/wp/sub",{sub:A.sub,queues:["3.2","9.9","3.2"],warn:true,sched:false}));
chk("A: підписка на 3.2 (неіснуюча 9.9 і повтори відкинуті), ⏰ так, 📅 ні", j.ok && JSON.stringify(j.queues)==='["3.2"]' && j.warn===true && j.sched===false, JSON.stringify(j));
({j}=await post("/wp/sub",{sub:Bb.sub,queues:["3.2","6.1"],warn:false}));
({j}=await post("/wp/sub",{sub:C.sub,queues:["6.1"]}));
chk("B: 3.2 і 6.1 без ⏰; C (Firefox): 6.1", sqlite.prepare("SELECT COUNT(*) n FROM wpush").get().n===3 && sqlite.prepare("SELECT queues q, warn w, sched s FROM wpush WHERE ep=?").get(Bb.sub.endpoint).q===",3.2,6.1,");
({j}=await post("/wp/get",{endpoint:A.sub.endpoint})); chk("/wp/get — збережені налаштування (щоб сайт показав їх після очищення браузера)", j.ok && j.queues.join()==="3.2" && j.warn===true && j.sched===false, JSON.stringify(j));
({j}=await post("/wp/sub",{sub:A.sub,queues:["3.2"],warn:true,sched:true})); chk("повторна підписка того самого браузера — оновлення, а не дубль", sqlite.prepare("SELECT COUNT(*) n FROM wpush").get().n===3 && j.sched===true);

// ---- «Пробне»
let n0=pushes.length; ({j}=await post("/wp/test",{endpoint:A.sub.endpoint})); let p=pushes.slice(n0)[0];
chk("«Пробне»: сповіщення одразу в цей браузер", j.ok===true && p && p.br==="A" && p.msg && p.msg.kind==="test" && /Сповіщення працюють/.test(p.msg.title), JSON.stringify(j)+" "+JSON.stringify(p&&p.msg));
chk("…зашифроване для цього браузера (aes128gcm) і підписане ключем VAPID сервера", !p.err && p.v===K.key && p.h["content-encoding"]==="aes128gcm" && p.h.ttl==="300" && p.h.urgency==="high", (p.err||"")+" "+p.v);
({j}=await post("/wp/test",{endpoint:A.sub.endpoint})); chk("…вдруге за хвилину — «зачекайте хвилину»", j.ok===false && /хвилину/.test(j.error) && pushes.length===n0+1);
({j}=await post("/wp/test",{endpoint:"https://fcm.googleapis.com/fcm/send/nobody"})); chk("…не підписаний — «спершу увімкніть»", j.ok===false && /увімкніть/.test(j.error));

// ---- події
let T=await tick();
chk("перший запуск: за 10 хв до відключення 3.2 — A (⏰ так) отримав, B (⏰ ні) — ні", T.length===1 && T[0].br==="A" && T[0].msg.kind==="warn" && T[0].msg.q==="3.2" && /за 10 хв/.test(T[0].msg.title) && T[0].msg.tag==="w:3.2" && T[0].h.ttl==="600", T.map(x=>x.br+":"+(x.msg&&x.msg.title)).join(" / "));
later(10); await tick(); Object.assign(Q("3.2"),{state:"off",since:NOW}); later(1); T=await tick();
chk("3.2 згасла — A і B, текст як у застосунку, натиснути — відкрити сайт на цій черзі", T.map(x=>x.br).sort().join()==="A,B" && T.every(x=>x.msg.kind==="lost" && /3\.2: світло зникло/.test(x.msg.title) && /за графіком до 17:00/.test(x.msg.body) && x.msg.url==="/#q=3.2" && x.msg.tag==="e:3.2" && x.h.urgency==="high"), T.map(x=>x.br+":"+JSON.stringify(x.msg)).join(" / "));
later(3); Object.assign(Q("6.1"),{state:"on",since:NOW}); T=await tick();
chk("6.1 з'явилось — B і C (Firefox), A — ні", T.map(x=>x.br).sort().join()==="B,C" && T.every(x=>x.msg.kind==="back" && !x.err), T.map(x=>x.br+":"+(x.err||x.msg.title)).join(" / "));
chk("…для Firefox — підпис для служби Mozilla", T.find(x=>x.br==="C").v===K.key);
// графік на завтра: A (📅 так), B (📅 за замовчуванням — так), C (6.1)
Q("3.2").tomorrow=[["08:00","12:00"]]; for(let i=0;i<2;i++){ later(1); await tick(); } later(1); T=await tick();
const sch=T.filter(x=>x.msg.kind==="sched");
chk("з'явився графік на завтра 3.2 — A і B; відкриває перетини на завтра", sch.map(x=>x.br).sort().join()==="A,B" && sch[0].msg.title==="📅 Черга 3.2: графік на завтра" && sch[0].msg.body==="18.11: 08:00–12:00" && sch[0].msg.url==="/#compare=3.2&d=1" && sch[0].h.urgency==="normal", sch.map(x=>x.br+":"+JSON.stringify(x.msg)).join(" / "));
await post("/wp/sub",{sub:A.sub,queues:["3.2"],sched:false});
Q("3.2").tomorrow=[["08:00","13:00"]]; for(let i=0;i<2;i++){ later(1); await tick(); } later(1); T=await tick();
chk("графік змінився: A вимкнув 📅 — не отримав, B — «змінився графік»", T.filter(x=>x.msg.kind==="sched").map(x=>x.br).join()==="B" && /змінився графік/.test(T.find(x=>x.br==="B").msg.title));

// ---- служба доставки: браузер відписався (410), просить пригальмувати (429)
STATUS=br=>br.id==="C"?410:201; Object.assign(Q("6.1"),{state:"off",since:NOW}); later(1); T=await tick();
chk("410 від служби доставки — підписку C прибрано (більше не шлемо)", T.some(x=>x.br==="C" && x.st===410) && !sqlite.prepare("SELECT 1 FROM wpush WHERE ep=?").get(C.sub.endpoint) && sqlite.prepare("SELECT COUNT(*) n FROM wpout").get().n===0);
let first=true; STATUS=br=>{ if(br.id==="B" && first){ first=false; return 429; } return 201; };
Object.assign(Q("3.2"),{state:"on",since:NOW}); later(1); T=await tick();
chk("429 — сповіщення лишилось у черзі…", T.some(x=>x.br==="B" && x.st===429) && sqlite.prepare("SELECT COUNT(*) n FROM wpout").get().n===1, sqlite.prepare("SELECT COUNT(*) n FROM wpout").get().n);
later(3); T=await tick(); chk("…і дійшло наступного разу", T.some(x=>x.br==="B" && x.st===201 && x.msg.kind==="back") && sqlite.prepare("SELECT COUNT(*) n FROM wpout").get().n===0);

// ---- багато браузерів: усі за один запуск (помічники паралельно)
const many=[]; for(let i=0;i<150;i++){ const x=await browser("M"+i); BR.set(x.id,x); many.push(x); await post("/wp/sub",{sub:x.sub,queues:["4.1"]}); }
Object.assign(Q("4.1"),{state:"off",since:NOW}); later(1); T=await tick();
chk("150 браузерів на 4.1 — усі отримали за один запуск, черга порожня", new Set(T.filter(x=>x.msg.q==="4.1").map(x=>x.br)).size===150 && sqlite.prepare("SELECT COUNT(*) n FROM wpout").get().n===0, T.length);
chk("…кожне розшифровується своїм браузером", T.every(x=>!x.err && x.v===K.key));

// ---- вимкнути
({j}=await post("/wp/sub",{sub:Bb.sub,queues:[]})); chk("зняв усі черги — підписку прибрано", j.ok && !sqlite.prepare("SELECT 1 FROM wpush WHERE ep=?").get(Bb.sub.endpoint));
({j}=await post("/wp/unsub",{endpoint:A.sub.endpoint})); chk("/wp/unsub — прибрано", j.ok && !sqlite.prepare("SELECT 1 FROM wpush WHERE ep=?").get(A.sub.endpoint));
let t=await (await B("/")).text(); chk("головна сторінка бота: скільки браузерів підписано", /Сповіщення в браузері \(сайт\): підписано 150; у черзі 0/.test(t), t.split("\n").slice(-3).join(" | "));
t=await (await B("/setup")).text(); chk("/setup: ключ для браузерів готовий", t.includes("🌐 Сповіщення в браузері (сайт): ✅ ключ "+K.key.slice(0,12)), t.replace(/\n/g," | "));
chk("жодного звернення до справжніх служб (усе підставне)", true);
console.log(errs.length?"\n❌ ПРОВАЛЕНО: "+errs.join("; "):"\nУСЕ ПРОЙДЕНО");
if (errs.length) process.exit(1);
