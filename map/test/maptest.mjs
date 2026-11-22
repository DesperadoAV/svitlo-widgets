// Мапа: повідомлення зверху можна згорнути; меню, вікна й віконця маркерів — над ним. Усе локально (Google, тайли й Leaflet — підставні).
import { createRequire } from 'node:module'; import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const HTML = fs.readFileSync(process.argv[2] || new URL('../index.html', import.meta.url), 'utf8');
const LD = process.env.LEAFLET_DIR || createRequire(import.meta.url).resolve('leaflet/dist/leaflet.js').replace(/leaflet\.js$/, '');
const LJS = fs.readFileSync(LD + '/leaflet.js'), LCSS = fs.readFileSync(LD + '/leaflet.css');
const OUT = process.env.SHOTS || new URL('./out/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let MSG = 'Увага! Сьогодні з 14:00 до 18:00 планові роботи на підстанції.\nЧерги 3.1 і 3.2 — без світла.\nСлідкуйте за новинами в каналах.';
const csvq = (rows) => rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
function mainCsv(){ const r = []; for (let i = 0; i < 25; i++) r.push(['', '', '', '']); ['1.1','2.1','3.1','3.2','4.1','6.1'].forEach((q, i) => r[i + 1] = [q, '', 'Світло є', '']); r[9] = ['', '', '', MSG]; return csvq(r); }
const qCsv = csvq([['h'], ['h'], ['', 'вул. Тестова 1', '', '51.5229', '30.7598', 'y', '', '', '22.11.2026 09:00']]);
const errs = []; const chk = (n, c, x = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (x !== '' ? ' | ' + String(x).slice(0, 200) : '')); if (!c) errs.push(n); };
const b = await chromium.launch(); const C = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'uk-UA' });
await C.route('**/*', r => { const u = r.request().url();
  if (u.startsWith('https://map.test/')) return r.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML });
  if (u.includes('leaflet.js')) return r.fulfill({ contentType: 'application/javascript', body: LJS });
  if (u.includes('leaflet.css')) return r.fulfill({ contentType: 'text/css', body: LCSS });
  if (u.includes('docs.google.com')) return r.fulfill({ contentType: 'text/csv; charset=utf-8', body: /gid=1910800617/.test(u) ? mainCsv() : qCsv });
  if (/\.(png|jpg)|icons8|postimg|tile\.openstreetmap/.test(u)) return r.fulfill({ contentType: 'image/png', body: PNG });
  return r.abort(); });
const pg = await C.newPage(), perr = []; pg.on('pageerror', e => perr.push(String(e)));
const shot = n => pg.screenshot({ path: OUT + n + '.png' });
await pg.goto('https://map.test/'); await pg.waitForSelector('#top-alert.show', { timeout: 15000 });
const st = () => pg.evaluate(() => { const a = document.getElementById('top-alert'), r = a.getBoundingClientRect(); return { cls: a.className, h: Math.round(r.height), l: Math.round(r.left), w: Math.round(r.width), vis: getComputedStyle(a).visibility, btn: document.getElementById('alert-btn').textContent }; });
let s = await st();
chk('повідомлення показано розгорнутим, праворуч від кнопок (не закриває їх)', s.cls === 'show' && s.l >= 72 && s.h > 60, JSON.stringify(s));
chk('…текст повністю', (await pg.$eval('#alert-text', e => e.innerText)) === MSG);
await shot('m1_rozgornute');
await pg.click('#alert-btn'); s = await st();
chk('▲ — згорнулось у маленьку плашку «📢 Повідомлення ▼»', s.cls.includes('min') && s.h < 45 && s.btn === '▼' && (await pg.$eval('#top-alert', e => e.innerText)).includes('📢 Повідомлення'), JSON.stringify(s));
await shot('m2_zhornute');
await pg.reload(); await pg.waitForSelector('#top-alert.show'); s = await st();
chk('після перезавантаження — так само згорнуте (той самий текст)', s.cls.includes('min'), JSON.stringify(s));
MSG = 'Нове повідомлення: графік змінено.';
await pg.evaluate(() => updateData()); await pg.waitForFunction(() => document.getElementById('alert-text').innerText.startsWith('Нове'), null, { timeout: 10000 }); s = await st();
chk('нове повідомлення — знову розгорнуте, щоб люди його побачили', !s.cls.includes('min') && s.btn === '▲', JSON.stringify(s));
await pg.click('#alert-btn'); await pg.click('#top-alert #alert-mini'); s = await st();
chk('натиснути на згорнуту плашку — розгортається', !s.cls.includes('min'), JSON.stringify(s));
MSG = 'Увага! Сьогодні з 14:00 до 18:00 планові роботи на підстанції.\nЧерги 3.1 і 3.2 — без світла.\nСлідкуйте за новинами в каналах.';
await pg.evaluate(() => updateData()); await pg.waitForFunction(() => document.getElementById('alert-text').innerText.startsWith('Увага'), null, { timeout: 10000 });
// меню шарів — над повідомленням
await pg.click('.side-btn'); await pg.waitForTimeout(200);
const top1 = await pg.evaluate(() => { const a = document.getElementById('top-alert').getBoundingClientRect(), m = document.getElementById('qMenu').getBoundingClientRect(); const x = Math.max(a.left, m.left) + 10, y = Math.max(a.top, m.top) + 10; const e = document.elementFromPoint(x, y); return { menu: !!e.closest('#qMenu'), x, y }; });
chk('меню черг відкрите — воно над повідомленням', top1.menu, JSON.stringify(top1));
await shot('m3_menu');
await pg.click('.side-btn');
// вікно «і» — над повідомленням
await pg.click('.info-btn'); await pg.waitForTimeout(200);
const top2 = await pg.evaluate(() => { const a = document.getElementById('top-alert').getBoundingClientRect(); const e = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2); return !e.closest('#top-alert'); });
chk('вікно інформації «і» — над повідомленням', top2);
await pg.evaluate(() => toggleModal('infoModal'));
// віконце маркера біля верху — повідомлення ховається, поки віконце відкрите
await pg.evaluate(() => { window.__m = L.marker(map.containerPointToLatLng([195, 210])).addTo(map).bindPopup('<b>вул. Тестова 1</b><br><i>під’їзд 2</i><br>💡 Світло є<br><small>Оновлено: 09:00</small>'); window.__m.openPopup(); });
await pg.waitForTimeout(600); s = await st();
const ov = await pg.evaluate(() => { const a = document.getElementById('top-alert').getBoundingClientRect(), p = document.querySelector('.leaflet-popup').getBoundingClientRect(); return { a: [a.top, a.bottom].map(Math.round), p: [p.top, p.bottom].map(Math.round), over: p.top < a.bottom }; });
chk('відкрите віконце маркера не закрите повідомленням (' + (ov.over ? 'перекривались — повідомлення сховалось' : 'не перекриваються') + ')', ov.over ? s.vis === 'hidden' : s.vis === 'visible', JSON.stringify(ov) + ' ' + s.vis);
await shot('m4_popup');
await pg.evaluate(() => map.closePopup()); await pg.waitForTimeout(300); s = await st();
chk('віконце закрили — повідомлення знову видно', s.vis === 'visible', JSON.stringify(s));
// згорнуте + віконце: мапа зсувається, щоб віконце було під плашкою
await pg.click('#alert-btn'); await pg.evaluate(() => window.__m.openPopup()); await pg.waitForTimeout(700); s = await st();
const ov2 = await pg.evaluate(() => { const a = document.getElementById('top-alert').getBoundingClientRect(), p = document.querySelector('.leaflet-popup').getBoundingClientRect(); return { a: Math.round(a.bottom), p: Math.round(p.top) }; });
chk('згорнута плашка і віконце маркера — обидва видно, віконце нижче плашки', ov2.p >= ov2.a && s.vis === 'visible', JSON.stringify(ov2) + ' ' + s.vis);
await shot('m5_popup_zhornute');
chk('без помилок на сторінці', perr.length === 0, perr.join(' | '));
await b.close(); console.log(errs.length ? 'ПОМИЛКИ: ' + errs.length : 'УСЕ ДОБРЕ'); process.exit(errs.length ? 1 : 0);
