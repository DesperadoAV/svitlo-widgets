#!/usr/bin/env bash
# Перевірка застосунку-віджета на емуляторі. Аргумент — рівень API. Результати: app/test/out/results.txt, скріни *.png
# Справжній бот і сайт у тестах НЕ використовуються: дані й сторінки віддає тестовий сервер (server.py).
API="$1"; cd "$(dirname "$0")"; mkdir -p out; : > out/results.txt; : > hits.log
PKG=ua.svitlo.widget; APK="$(ls ../../apk/*.apk | head -1)"; T="http://10.0.2.2:8765"
ok() { echo "✅ $*" | tee -a out/results.txt; }
bad() { echo "❌ $*" | tee -a out/results.txt; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
A() { timeout 60 adb "$@"; }                                    # кожна команда — не довше хвилини (щоб тест не зависав)
shot() { timeout 30 adb exec-out screencap -p > "out/api${API}_$1.png" 2>/dev/null; }
hits() { grep -c "$1" hits.log 2>/dev/null || true; }
waitfor() { for i in $(seq 1 30); do eval "$1" && return 0; sleep 2; done; return 1; }
python3 server.py 8765 > out/server.log 2>&1 & SRV=$!
A logcat -c
A install -r "$APK" | tail -1
check "встановлення APK (Android API $API)" "A shell pm list packages | grep -q $PKG"
# мережа емулятора іноді піднімається не одразу — чекаємо, поки тестовий сервер стане доступним із телефона
A shell am start -W -n $PKG/.MainActivity --es data_url $T/status.json --es site_url $T/site >/dev/null 2>&1
# мережа емулятора після запуску буває ще не готова — тоді застосунок пробує знову (як і на справжньому телефоні); тут — кнопкою ↻
waitfor '[ $(hits status.json) -ge 1 ]' || { A shell am broadcast -n $PKG/.CardsWidget -a ua.svitlo.widget.REFRESH >/dev/null 2>&1; true; }
check "застосунок завантажив дані з тестового сервера" "waitfor '[ \$(hits status.json) -ge 1 ]'"
sleep 3                                                        # дані збережено — далі віджет
sleep 3; shot 01_holovnyi
check "головний екран відкрив тестовий сайт (не справжній)" "[ \$(hits /site) -ge 1 ]"
check "назва не залазить на рядок стану ($(A logcat -d -s SvitloMain:I | grep -o 'title_y.*' | tail -1))" "A logcat -d -s SvitloMain:I | grep -q 'title_y.* OK'"
A shell am start -S -W -n $PKG/.PreviewActivity >/dev/null 2>&1; sleep 4
shot 02_vidzhet
check "віджет: 6 карток" "A logcat -d -s SvitloPreview:I | grep -q 'cards 6'"
A shell am start -S -W -n $PKG/.PreviewActivity --es toggle 3.2 >/dev/null 2>&1; sleep 4
shot 03_rozkryto_3_2
check "натискання на чергу 3.2 розкриває графік" "A logcat -d -s SvitloPreview:I | grep -q 'expanded \[3.2\]'"
A shell am start -S -W -n $PKG/.PreviewActivity --es queues 3.2,6.1 --es toggle 6.1 >/dev/null 2>&1; sleep 4
shot 04_lyshe_2_cherhy
check "вибір черг: лише 2 картки" "A logcat -d -s SvitloPreview:I | grep -q 'cards 2'"
A shell am start -W -n $PKG/.ConfigActivity --ei appWidgetId 424242 >/dev/null 2>&1; sleep 3
shot 05_vybir_cherh
A shell input keyevent 4; sleep 1
before=$(hits status.json)
A shell am broadcast -n $PKG/.CardsWidget -a ua.svitlo.widget.REFRESH >/dev/null 2>&1
check "кнопка ↻: дані завантажено ще раз" "waitfor '[ \$(hits status.json) -gt $before ]'"
A logcat -d > out/logcat-all.txt
if grep -A3 "FATAL EXCEPTION" out/logcat-all.txt | grep -q "$PKG"; then bad "застосунок падав (див. crash.txt)"; grep -A25 "FATAL EXCEPTION" out/logcat-all.txt > out/crash.txt; else ok "без падінь"; fi
grep -iE "svitlo|RemoteViews" out/logcat-all.txt | tail -200 > out/logcat-app.txt
grep -v ' /status.json' hits.log | grep -vE ' /(site|map)' > out/other-hits.txt
kill $SRV 2>/dev/null; true
