#!/usr/bin/env bash
# Збирає застосунок-віджет «Світло В Славутичі» (APK) через Gradle (потрібен для Firebase-сповіщень).
# Потрібно: ANDROID_HOME, JDK 17, gradle 8.10+ (на GitHub Actions — gradle/actions/setup-gradle).
# Ключ підпису: змінні KS_B64 (keystore у base64) і KS_PASS. Без них — тимчасовий ключ (лише для тесту).
# Firebase: файл google-services.json поруч (з секрету GOOGLE_SERVICES_JSON); без нього — збірка без сповіщень.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf out && mkdir -p out

if [ -n "${KS_B64:-}" ]; then
  # пробіли й переноси рядків, що могли потрапити під час копіювання з телефона, прибираємо
  printf '%s' "$KS_B64" | tr -d '[:space:]' | base64 -d > out/release.jks
  export KS_FILE="$PWD/out/release.jks" KS_PASS="$(printf '%s' "${KS_PASS:-}" | tr -d '[:space:]')"
  # перевірка без розкриття секретів: відбиток файлу ключа (має бути 1fca2fb74636…) і довжина пароля (має бути 32)
  echo "ключ: $(sha256sum out/release.jks | cut -c1-12)…, пароль: ${#KS_PASS} символів"
  if ! keytool -list -keystore out/release.jks -storepass "$KS_PASS" >/dev/null 2>&1; then
    echo "❌ Ключ підпису не відкривається: перевірте секрети ANDROID_KS_B64 і ANDROID_KS_PASS (весь вміст файлів, без зайвого)."
    exit 1
  fi
else
  echo "⚠️ Немає ключа підпису — тимчасовий (оновлення поверх не встановиться)"
  unset KS_FILE || true
fi
if [ -f google-services.json ]; then echo "Firebase: google-services.json є — сповіщення увімкнені"; else echo "⚠️ Немає google-services.json — збірка без сповіщень"; fi

gradle --no-daemon --console=plain assembleRelease
apk=$(ls build/outputs/apk/release/*.apk | head -1)
cp "$apk" out/svitlo-widget.apk
rm -f out/release.jks
BT="${ANDROID_HOME:-/usr/local/lib/android/sdk}/build-tools/$(ls "${ANDROID_HOME:-/usr/local/lib/android/sdk}/build-tools" | sort -V | tail -1)"
"$BT/apksigner" verify --verbose out/svitlo-widget.apk | head -6
"$BT/aapt2" dump badging out/svitlo-widget.apk | grep -E "^package|sdkVersion" || true
ls -la out/svitlo-widget.apk
