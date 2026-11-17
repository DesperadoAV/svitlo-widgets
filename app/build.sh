#!/usr/bin/env bash
# Збирає застосунок-віджет «Світло В Славутичі» (APK) інструментами Android SDK, без Gradle.
# Потрібно: ANDROID_HOME (є на GitHub Actions), JDK 17.
# Ключ підпису: змінні KS_B64 (keystore у base64) і KS_PASS. Без них — тимчасовий ключ (лише для тесту).
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLAT_NAME="$(ls "$SDK/platforms" | grep -E '^android-[0-9]+$' | sort -V | tail -1)"
JAR="$SDK/platforms/$PLAT_NAME/android.jar"
API="${PLAT_NAME#android-}"
TARGET=$(( API > 36 ? 36 : API ))          # поведінку перевіряли до Android 16; на 17 працює як застосунок для 16
MIN=19                                     # Android 4.4
CODE="${VERSION_CODE:-$(( ${GITHUB_RUN_NUMBER:-1} + 100 ))}"
NAME="${VERSION_NAME:-1.0.${GITHUB_RUN_NUMBER:-0}}"
echo "build-tools: $BT"; echo "platform: $PLAT_NAME (target $TARGET, min $MIN)"; echo "version: $NAME ($CODE)"

rm -rf out && mkdir -p out/gen out/classes out/dex
cat > out/gen/BuildInfo.java <<EOF
package ua.svitlo.widget;
final class BuildInfo { static final String VERSION = "$NAME"; private BuildInfo() {} }
EOF

"$BT/aapt2" compile --dir res -o out/res.zip
"$BT/aapt2" link -o out/base.apk -I "$JAR" --manifest AndroidManifest.xml out/res.zip \
  --min-sdk-version $MIN --target-sdk-version $TARGET --version-code "$CODE" --version-name "$NAME" \
  --java out/gen --auto-add-overlay
javac -nowarn -Xlint:-options -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath "$JAR" -d out/classes \
  $(find src out/gen -name '*.java')
"$BT/d8" --release --min-api $MIN --lib "$JAR" --output out/dex $(find out/classes -name '*.class')
( cd out/dex && zip -q -u ../base.apk classes.dex )
"$BT/zipalign" -p -f 4 out/base.apk out/aligned.apk

if [ -n "${KS_B64:-}" ]; then
  # пробіли й переноси рядків, що могли потрапити під час копіювання з телефона, прибираємо
  printf '%s' "$KS_B64" | tr -d '[:space:]' | base64 -d > out/release.jks; KS=out/release.jks; PASS="$(printf '%s' "${KS_PASS:-}" | tr -d '[:space:]')"
  # перевірка без розкриття секретів: відбиток файлу ключа (має бути 1fca2fb74636…) і довжина пароля (має бути 32)
  echo "ключ: $(sha256sum out/release.jks | cut -c1-12)…, пароль: ${#PASS} символів"
  if ! keytool -list -keystore out/release.jks -storepass "$PASS" >/dev/null 2>&1; then
    echo "❌ Ключ підпису не відкривається: перевірте секрети ANDROID_KS_B64 і ANDROID_KS_PASS (весь вміст файлів, без зайвого)."
    exit 1
  fi
else
  echo "⚠️ Немає ключа підпису — тимчасовий (оновлення поверх не встановиться)"
  keytool -genkeypair -keystore out/tmp.jks -storepass tmppass -keypass tmppass -alias svitlo -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Svitlo test" >/dev/null 2>&1
  KS=out/tmp.jks; PASS=tmppass
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$PASS" --ks-key-alias svitlo --min-sdk-version $MIN --out out/svitlo-widget.apk out/aligned.apk
"$BT/apksigner" verify --verbose --min-sdk-version $MIN out/svitlo-widget.apk | head -8
rm -f out/release.jks
ls -la out/svitlo-widget.apk
