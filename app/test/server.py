# Тестовий сервер для емулятора: віддає /status.json як справжній бот (лише для перевірки віджета).
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        now = int(time.time() * 1000)
        q = lambda n, s, ago, t, tm: {"name": n, "state": s, "since": now - ago * 60000 if ago else None, "today": t, "tomorrow": tm}
        data = {"v": 1, "now": now, "kyiv_offset_min": 120, "map": "https://desperadoav.github.io/Svitlo_in_Slavutych/", "site": "https://svitlo51.a-m-vasylets.workers.dev/",
                "queues": [q("1.1", "on", 300, [["16:00", "20:00"]], [["10:00", "12:00"]]), q("2.1", "off", 95, [["14:00", "18:00"]], None),
                           q("3.1", "on", 300, [], None), q("3.2", "on", 300, [["08:00", "12:00"], ["20:00", "24:00"]], [["00:00", "04:00"], ["16:00", "20:00"]]),
                           q("4.1", "unknown", 0, None, None), q("6.1", "off", 95, [["14:00", "18:00"]], [])]}
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200); self.send_header("content-type", "application/json; charset=utf-8"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
        open("hits.log", "a").write(time.strftime("%H:%M:%S") + " " + self.path + "\n")
    def log_message(self, *a): pass
HTTPServer(("0.0.0.0", int(sys.argv[1] if len(sys.argv) > 1 else 8765)), H).serve_forever()
