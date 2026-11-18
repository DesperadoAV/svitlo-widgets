// =============================================================================
// Web Push — сповіщення в браузер (сайт «💡 Світло В Славутичі»): стандарт RFC 8030 / 8291 / 8292,
// без сторонніх бібліотек, лише WebCrypto (працює в Cloudflare Workers і в Node для тестів).
//  • VAPID: пара ключів P-256 сервера; браузер підписується з публічним ключем, сервер підписує кожен запит.
//  • Вміст шифрується (aes128gcm) ключами конкретного браузера — служба доставки (Google, Mozilla, Apple) його не бачить.
// =============================================================================
const te = new TextEncoder();
export const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/** Нова пара ключів VAPID: { jwk — закритий ключ, pub — публічний (base64url, 65 байт) }. */
export async function genVapid() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { jwk: await crypto.subtle.exportKey("jwk", k.privateKey), pub: b64u(await crypto.subtle.exportKey("raw", k.publicKey)) };
}

/** Чи схожа підписка на справжню: адреса однієї зі служб доставки браузерів і ключі правильної довжини. */
const HOSTS = [".googleapis.com", ".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];
export function validSub(s) {
  try {
    const u = new URL(s.endpoint);
    if (u.protocol !== "https:" || !HOSTS.some(h => ("." + u.hostname).endsWith(h)) || s.endpoint.length > 1000) return false;
    const p = unb64u(s.keys.p256dh), a = unb64u(s.keys.auth);
    return p.length === 65 && p[0] === 4 && a.length === 16;
  } catch (e) { return false; }
}

// Підпис для служби доставки (JWT ES256), один на годину для кожної служби
const JWT = new Map();
async function vapidHeader(keys, endpoint, sub) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000), c = JWT.get(aud + keys.pub);
  if (c && c.exp - now > 600) return c.h;
  if (!keys.key) keys.key = await crypto.subtle.importKey("jwk", keys.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const exp = now + 12 * 3600;
  const un = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))) + "." + b64u(te.encode(JSON.stringify({ aud, exp, sub })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.key, te.encode(un));   // WebCrypto дає r‖s — саме те, що треба для JWT
  const h = `vapid t=${un}.${b64u(sig)}, k=${keys.pub}`;
  JWT.set(aud + keys.pub, { h, exp });
  return h;
}

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
/** Шифрування вмісту для одного браузера (RFC 8291, aes128gcm). Повертає готове тіло запиту. */
export async function encrypt(sub, data, eph, salt) {   // eph і salt передає лише тест (приклад із RFC 8291); зазвичай — нові щоразу
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  eph = eph || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const as = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode("WebPush: info\0"), ua, as), 32);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(data, new Uint8Array([2]))));   // 2 — останній (єдиний) запис
  const rs = new Uint8Array([0, 0, 16, 0]);                                                                                         // розмір запису 4096
  return cat(salt, rs, new Uint8Array([as.length]), as, ct);
}

/** Надіслати одне сповіщення. keys — {jwk, pub}; sub — {endpoint, keys:{p256dh, auth}}; msg — об'єкт (піде як JSON).
 *  Повертає код відповіді служби доставки: 201/200 — прийнято, 404/410 — підписки вже немає, 429 — забагато, 0 — немає зв'язку. */
export async function webPush(keys, sub, msg, { ttl = 3600, urgency = "high", subject = "https://svitlo-public.desperadoav.workers.dev" } = {}) {
  const body = await encrypt(sub, te.encode(JSON.stringify(msg)));
  try {
    const r = await fetch(sub.endpoint, { method: "POST", body, headers: {
      authorization: await vapidHeader(keys, sub.endpoint, subject), "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
      ttl: String(ttl), urgency } });
    return r.status;
  } catch (e) { return 0; }
}
