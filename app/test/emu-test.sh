#!/usr/bin/env bash
# Перевірка застосунку-віджета на емуляторі. Аргумент — рівень API. Результати: app/test/out/results.txt, скріни *.png
API="$1"; cd "$(dirname "$0")"; mkdir -p out; : > out/results.txt; : > hits.log
PKG=ua.svitlo.widget; APK="$(ls ../../apk/*.apk | head -1)"
ok() { echo "✅ $*" | tee -a out/results.txt; }
bad() { echo "❌ $*" | tee -a out/results.txt; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
shot() { adb exec-out screencap -p > "out/api${API}_$1.png" 2>/dev/null; }
python3 server.py 8765 > out/server.log 2>&1 & SRV=$!
adb logcat -c
adb install -r "$APK" | tail -1
check "встановлення APK (Android API $API)" "adb shell pm list packages | grep -q $PKG"
# головний екран; адреса даних — тестовий сервер (не справжній бот)
adb shell am start -W -n $PKG/.MainActivity --es data_url http://10.0.2.2:8765/status.json >/dev/null 2>&1; sleep 8
shot 01_holovnyi
check "застосунок завантажив дані з (тестового) сервера" "[ \$(grep -c status.json hits.log) -ge 1 ]"
# віджет у «перегляді» (на емуляторі немає робочого стола, куди перетягнути віджет)
adb shell cmd appwidget grantbind --package $PKG --user 0 2>&1 | head -2
adb shell am start -W -n $PKG/.PreviewActivity >/dev/null 2>&1; sleep 6
shot 02_vidzhet
check "віджет створено (є id)" "adb logcat -d -s SvitloPreview:I | grep -q 'widget id'"
adb shell am start -S -W -n $PKG/.PreviewActivity --es toggle 3.2 >/dev/null 2>&1; sleep 6
shot 03_rozkryto_3_2
adb shell am start -S -W -n $PKG/.PreviewActivity --es toggle 3.2 --es queues 3.2,6.1 >/dev/null 2>&1; sleep 6
shot 04_lyshe_2_cherhy
# вибір черг
WID=$(adb logcat -d -s SvitloPreview:I | grep -o 'widget id [0-9]*' | tail -1 | grep -o '[0-9]*$')
adb shell am start -W -n $PKG/.ConfigActivity --ei appWidgetId "$WID" >/dev/null 2>&1; sleep 3
shot 05_vybir_cherh
adb shell input keyevent 4; sleep 1
# натискання ⟳ на віджеті — оновлення
before=$(grep -c status.json hits.log)
adb shell am broadcast -n $PKG/.CardsWidget -a ua.svitlo.widget.REFRESH >/dev/null 2>&1; sleep 5
check "кнопка ⟳: дані завантажено ще раз" "[ \$(grep -c status.json hits.log) -gt $before ]"
adb logcat -d > out/logcat-all.txt
if grep -q "FATAL EXCEPTION" out/logcat-all.txt && grep -A3 "FATAL EXCEPTION" out/logcat-all.txt | grep -q "$PKG"; then bad "застосунок падав (див. crash.txt)"; grep -A25 "FATAL EXCEPTION" out/logcat-all.txt > out/crash.txt; else ok "без падінь"; fi
grep -iE "svitlo|AppWidget|RemoteViews" out/logcat-all.txt | tail -200 > out/logcat-app.txt
kill $SRV 2>/dev/null; true
