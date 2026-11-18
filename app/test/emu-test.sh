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
# мережа емулятора буває не готова одразу після запуску — чекаємо до 2 хв, поки тестовий сервер стане доступним
A shell svc wifi enable >/dev/null 2>&1; A shell svc data enable >/dev/null 2>&1
for i in $(seq 1 40); do A shell "ping -c 1 -W 2 10.0.2.2" >/dev/null 2>&1 && break; sleep 3; done
check "мережа емулятора працює" "A shell 'ping -c 1 -W 2 10.0.2.2' >/dev/null 2>&1"
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
check "віджет: картки справді намальовані ($(A logcat -d -s SvitloPreview:I | grep -o 'drawn.*' | tail -1))" "A logcat -d -s SvitloPreview:I | grep -o 'drawn [0-9]*' | tail -1 | grep -q 'drawn [1-9]'"
check "віджет: усі 6 карток влазять ($(A logcat -d -s SvitloPreview:I | grep -o 'cards.*' | tail -1))" "A logcat -d -s SvitloPreview:I | grep -q 'cards 6 shown 6 hidden 0'"
A shell am start -S -W -n $PKG/.PreviewActivity --es toggle 3.2 >/dev/null 2>&1; sleep 4
shot 03_rozkryto_3_2
check "натискання на чергу 3.2 розкриває графік, усі 6 карток лишаються ($(A logcat -d -s SvitloPreview:I | grep -o 'cards.*' | tail -1))" "A logcat -d -s SvitloPreview:I | grep -q 'shown 6 hidden 0 expanded \[3.2\]'"
A shell am start -S -W -n $PKG/.PreviewActivity --es queues 3.2,6.1 --es toggle 6.1 >/dev/null 2>&1; sleep 4
shot 04_lyshe_2_cherhy
check "вибір черг: 2 картки, обидві розкриті, із «завтра» ($(A logcat -d -s SvitloPreview:I | grep -o 'cards.*' | tail -1))" "A logcat -d -s SvitloPreview:I | grep -q 'cards 2 shown 2 hidden 0 expanded \[6.1, 3.2\] tomorrow \[6.1, 3.2\]'"
A shell am start -S -W -n $PKG/.PreviewActivity --es queues all --ei h 160 >/dev/null 2>&1; sleep 4
shot 04b_malyi_vidzhet
if [ "$API" -ge 31 ]; then
  check "малий віджет (Android 12+): усі картки в списку, розкриті не згортаються ($(A logcat -d -s SvitloPreview:I | grep -o 'mode.*' | tail -1))" "A logcat -d -s SvitloPreview:I | grep 'cards' | tail -1 | grep -q 'mode list cards 6 shown 6 hidden 0 expanded \[6.1, 3.2\]'"
  A shell input swipe 160 205 160 105 600 >/dev/null 2>&1; sleep 2      # гортаємо список усередині віджета (він займає верх екрана)
  shot 04c_malyi_vidzhet_hortannia
else
  check "малий віджет: показує, що влазить, і «ще N» ($(A logcat -d -s SvitloPreview:I | grep -o 'cards.*' | tail -1))" "A logcat -d -s SvitloPreview:I | grep 'cards' | tail -1 | grep -q 'hidden [1-9]'"
fi
# плитки: квадратик (1×1), смужка (2×1, 4×1), сітка (2×2) — колір = є світло чи ні, 💡 і номер, час
tilecheck() {   # $1 — назва, $2 — параметри перегляду, $3 — очікуваний вигляд, $4 — скільки плиток намальовано, $5 — файл скріна
  A shell am start -S -W -n $PKG/.PreviewActivity $2 >/dev/null 2>&1; sleep 4
  shot "$5"
  local got; got="$(A logcat -d -s SvitloPreview:I | grep -o 'mode tiles.*' | tail -1); $(A logcat -d -s SvitloPreview:I | grep -o 'drawn [0-9]*' | tail -1)"
  check "$1 ($got)" "echo \"$got\" | grep -q '$3' && echo \"$got\" | grep -q 'drawn $4\$'"
}
tilecheck "квадратик 1×1: 💡 і номер черги" "--es queues 3.2 --ei w 70 --ei h 70" "70x70 cols 1 rows 1 n 1 kind 0 first 3.2" 1 05a_kvadratyk
tilecheck "смужка 2×1, одна черга: стан і час докладно" "--es queues 3.2 --ei w 150 --ei h 70" "cols 1 rows 1 n 1 kind 2" 1 05b_smuzhka_2
tilecheck "плитки 3 черг у вузькій смужці 2×1: 2 плитки з часом" "--es queues 1.1,2.1,6.1 --ei w 160 --ei h 90" "cols 2 rows 1 n 2 kind 1" 2 05c_dvi_plytky
tilecheck "сітка 2×2: 4 плитки" "--es queues all --ei w 150 --ei h 150" "cols 2 rows 2 n 4 kind 1" 4 05d_sitka_2x2
tilecheck "оновлення поверх (як на робочому столі) не додає плиток: усе ще 1" "--es queues 3.2 --ei w 150 --ei h 90 --ez reapply true" "cols 1 rows 1 n 1 kind 2" 1 05e_onovlennia
# один ряд на всю ширину — без заголовка, картка «сьогодні»; гортання до «завтра» (Android 12+)
modecheck() {   # $1 — назва, $2 — параметри, $3 — очікуваний вигляд, $4 — намальовано (регулярний вираз), $5 — скрін
  A shell am start -S -W -n $PKG/.PreviewActivity $2 >/dev/null 2>&1; sleep 4
  shot "$5"
  local got; got="$(A logcat -d -s SvitloPreview:I | grep -o 'mode .*' | tail -1); $(A logcat -d -s SvitloPreview:I | grep -o 'drawn [0-9-]*' | tail -1)"
  check "$1 ($got)" "echo \"$got\" | grep -q '$3' && echo \"$got\" | grep -Eq 'drawn $4\$'"
}
if [ "$API" -ge 31 ]; then modecheck "смужка в один ряд, одна черга: сьогодні, гортанням — завтра" "--es queues 3.2 --ei w 296 --ei h 90" "mode strip 296x90 queues 1" "[12]" 06a_ryad_odna
else modecheck "смужка в один ряд, одна черга: сьогодні" "--es queues 3.2 --ei w 296 --ei h 90" "mode strip 296x90 queues 1" "1" 06a_ryad_odna; fi
A shell input swipe 160 120 160 60 500 >/dev/null 2>&1; sleep 2; shot 06b_ryad_hortannia
modecheck "два ряди, одна черга: велика картка — сьогодні й завтра" "--es queues 3.2 --ei w 296 --ei h 190" "mode big 296x190 queues 1" "1" 06c_dva_riady
check "час на плитці: світла немає → «до …», є → «відкл …» або «з …»" "A logcat -d -s SvitloPreview:I | grep 'mode tiles' | grep -q 'time «\(до\|відкл\|з\) [0-9][0-9]:[0-9][0-9]»'"
A shell am start -W -n $PKG/.ConfigActivity --ei appWidgetId 424242 >/dev/null 2>&1; sleep 3
shot 05_vybir_cherh
A shell input keyevent 4; sleep 1
# сповіщення: пробне (без Firebase — його в тестах не чіпаємо)
[ "$API" -ge 33 ] && A shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
A shell am start -W -n $PKG/.NotifyActivity --ez test_notify true >/dev/null 2>&1; sleep 4
shot 06_spovishchennia_vybir
check "пробне сповіщення показано" "A shell dumpsys notification --noredact | grep -q 'pkg=$PKG'"
A shell cmd statusbar expand-notifications >/dev/null 2>&1 || A shell service call statusbar 1 >/dev/null 2>&1; sleep 3
shot 07_spovishchennia
A shell cmd statusbar collapse >/dev/null 2>&1 || A shell service call statusbar 2 >/dev/null 2>&1; sleep 1
ok "Firebase на цьому емуляторі: $(A logcat -d -s SvitloNotify:I | grep -o 'fcm .*' | tail -1)"
A shell input keyevent 4; sleep 1
# 📅 сповіщення «з'явився графік» — так, ніби прийшло від сервера (Firebase і справжній бот не чіпаємо)
A logcat -c
A shell "am start -S -W -n $PKG/.NotifyActivity --es test_queues 3.2 --es test_push 'sched|3.2|Sched 3.2 test|19.11 08:00-12:00'" >/dev/null 2>&1; sleep 3
check "графік на завтра: сповіщення показано (окремий канал «Графік відключень»)" "A logcat -d -s SvitloNotify:I | grep -q 'shown sched 3.2' && A shell dumpsys notification --noredact | grep -q 'Sched 3.2 test'"
A shell "am start -S -W -n $PKG/.NotifyActivity --es test_queues 3.2 --es test_push 'sched|6.1|Sched 6.1 test|x'" >/dev/null 2>&1; sleep 2
check "…для невибраної черги — не показує" "A logcat -d -s SvitloNotify:I | grep -q 'skip sched 6.1'"
A shell "am start -S -W -n $PKG/.NotifyActivity --es test_queues 3.2 --ez test_nosched true --es test_push 'sched|3.2|Sched off test|x'" >/dev/null 2>&1; sleep 2
shot 08_spovishchennia_hrafik
check "…галочку «📅 Графік на завтра» знято — не показує" "A logcat -d -s SvitloNotify:I | grep -q 'skip sched 3.2'"
A shell input keyevent 4; sleep 1
# 🗓 перетини: смужки черг одна під одною і відрізки дня
cmpcheck() {   # $1 — назва, $2 — параметри, $3 — очікуваний підсумок, $4 — скрін
  A shell am start -S -W -n $PKG/.CompareActivity $2 >/dev/null 2>&1; sleep 3
  shot "$4"
  local got; got="$(A logcat -d -s SvitloCompare:I | grep -o 'compare .*' | tail -1)"
  check "$1 ($got)" "echo \"$got\" | grep -qF '$3'"
}
cmpcheck "перетини 3.2 і 6.1 на сьогодні: 6 відрізків, «ніде немає» — жодного" "--es queues 3.2,6.1 --ei day 0" "compare d0 [3.2, 6.1] segs 6 alloff 0 known 2" 09a_peretyny_sohodni
cmpcheck "…на завтра: 4 відрізки" "--es queues 3.2,6.1 --ei day 1" "compare d1 [3.2, 6.1] segs 4 alloff 0 known 2" 09b_peretyny_zavtra
cmpcheck "2.1 і 6.1 сьогодні: 14:00–18:00 — немає світла ніде" "--es queues 2.1,6.1 --ei day 0" "compare d0 [2.1, 6.1] segs 3 alloff 1 known 2" 09c_peretyny_nide
cmpcheck "…завтра в 2.1 графіка ще немає — порівнюємо те, що є" "--es queues 2.1,6.1 --ei day 1" "compare d1 [2.1, 6.1] segs 1 alloff 0 known 1" 09d_bez_hrafika
A shell input keyevent 4; sleep 1
before=$(hits status.json)
A shell am broadcast -n $PKG/.CardsWidget -a ua.svitlo.widget.REFRESH >/dev/null 2>&1
check "кнопка ↻: дані завантажено ще раз" "waitfor '[ \$(hits status.json) -gt $before ]'"
A logcat -d > out/logcat-all.txt
if grep -A3 "FATAL EXCEPTION" out/logcat-all.txt | grep -q "$PKG"; then bad "застосунок падав (див. crash.txt)"; grep -A25 "FATAL EXCEPTION" out/logcat-all.txt > out/crash.txt; else ok "без падінь"; fi
grep -iE "svitlo|RemoteViews" out/logcat-all.txt | tail -200 > out/logcat-app.txt
grep -v ' /status.json' hits.log | grep -vE ' /(site|map)' > out/other-hits.txt
kill $SRV 2>/dev/null; true
