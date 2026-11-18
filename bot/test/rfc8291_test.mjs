// Шифрування сповіщень у браузер — звірка з офіційним прикладом стандарту (RFC 8291, додаток A): результат має збігтися до байта.
import { encrypt } from '../webpush.js';
const unb = s => new Uint8Array(Buffer.from(s.replace(/\s+/g, ""), "base64url"));
const asPub = unb("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
const jwk = { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", x: Buffer.from(asPub.slice(1, 33)).toString("base64url"), y: Buffer.from(asPub.slice(33)).toString("base64url") };
const eph = { privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
              publicKey: await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, true, []) };
const sub = { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" } };
const body = await encrypt(sub, unb("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"), eph, unb("DGv6ra1nlYgDCS1FRnbzlw"));
const want = Buffer.concat([unb("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
                            unb("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ")]);
const ok = Buffer.from(body).equals(want);
console.log((ok ? "✅" : "❌") + " шифрування збігається з прикладом RFC 8291 до байта (" + body.length + " байт)");
if (!ok) { console.log(Buffer.from(body).toString("base64url")); console.log(want.toString("base64url")); process.exit(1); }
