# Тестовий сервер для емулятора: віддає /status.json як справжній бот (лише для перевірки віджета).
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        open("hits.log", "a").write(time.strftime("%H:%M:%S") + " " + self.path + "\n")
        port = self.server.server_address[1]
        if self.path.startswith("/latest.json"):                                  # 📲 опис «нової версії» для перевірки самооновлення
            b = json.dumps({"code": 9999, "name": "1.1.9999", "url": "http://10.0.2.2:%d/app.apk" % port, "notes": "тест"}).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        if self.path.startswith("/app.apk") and len(sys.argv) > 2:               # сам файл — той самий APK, що тестується
            b = open(sys.argv[2], "rb").read()
            self.send_response(200); self.send_header("content-type", "application/vnd.android.package-archive"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        if not self.path.startswith("/status.json"):
            b = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font:20px sans-serif;padding:20px'>"
                 "<h2>Тестовий сайт</h2><p>(справжній сайт у тестах не відкриваємо)</p>"
                 # 🎨 як справжній сайт: застосунок каже вибраний вигляд (svSetBars), а /site-bars-old|new — ніби людина натиснула перемикач
                 "<script>window.svSetBars=function(v){console.log('svSetBars '+v)};"
                 "var m=/bars-(old|new)/.exec(location.pathname);if(m&&window.SvitloApp)SvitloApp.bars(m[1]);"
                 # 🔔 /site-nget — сайт питає налаштування сповіщень; /site-nsave — ніби натиснули «Увімкнути» (3.2, 6.1, без графіка на завтра)
                 "var p=location.pathname,A=window.SvitloApp;"
                 "if(A&&/site-n(get|save)/.test(p))console.log('notifyGet '+A.notifyGet());"
                 "if(A&&/site-nsave/.test(p)){window.svNotifyDone=function(r){console.log('svNotifyDone '+r)};A.notifySave(JSON.stringify({queues:['3.2','6.1'],warn:true,sched:false}));}"
                 # ➕ /site-wr — ніби натиснули «➕ Віджет» і ↻
                 "if(A&&/site-wr/.test(p)){A.addWidget();A.refresh();}</script>").encode()
            self.send_response(200); self.send_header("content-type", "text/html; charset=utf-8"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        now = int(time.time() * 1000)
        q = lambda n, s, ago, t, tm: {"name": n, "state": s, "since": now - ago * 60000 if ago else None, "today": t, "tomorrow": tm}
        data = {"v": 1, "now": now, "kyiv_offset_min": 120, "map": "http://10.0.2.2:8765/map", "site": "http://10.0.2.2:8765/site",
                "queues": [q("1.1", "on", 300, [["16:00", "20:00"]], [["10:00", "12:00"]]), q("2.1", "off", 95, [["14:00", "18:00"]], None),
                           q("3.1", "on", 300, [], None), q("3.2", "on", 300, [["08:00", "12:00"], ["20:00", "24:00"]], [["00:00", "04:00"], ["16:00", "20:00"]]),
                           q("4.1", "unknown", 0, None, None), q("6.1", "off", 95, [["14:00", "18:00"]], [])]}
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200); self.send_header("content-type", "application/json; charset=utf-8"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
HTTPServer(("0.0.0.0", int(sys.argv[1] if len(sys.argv) > 1 else 8765)), H).serve_forever()
