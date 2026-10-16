#!/usr/bin/env bash
#
# Swap a freshly built JS bundle into an existing release APK and install it —
# a two-minute loop for JavaScript-only changes, instead of a forty-minute
# `build-android.sh` that recompiles every native library to change one line.
#
# What it does
#   1. `expo export:embed` the JS for Android, exactly as Gradle's release build
#      does, then compile it to Hermes bytecode with the hermesc that ships with
#      this React Native — the same format the release APK already carries.
#   2. Replace assets/index.android.bundle inside a COPY of the base APK.
#   3. zipalign, then sign with a local DEBUG key, and install.
#
# What it is NOT
#   Not a release. The result is signed with a debug key, so:
#     • it cannot be uploaded to Play and must never leave this machine;
#     • installing it over a Play or upload-key install fails, so the script
#       uninstalls first (the app's data goes with it);
#     • native Google sign-in reports DEVELOPER_ERROR — its SHA-1 is not
#       registered — and falls back to the browser flow.
#   And it only carries JS. A change to native code, app.json, a config plugin
#   or an image that is new since the base APK needs the real build.
#
# Usage
#   ./scripts/js-hotswap.sh                        # base = release/interprova-app-release.apk
#   BASE_APK=path/to.apk ./scripts/js-hotswap.sh
#   DEBUG=1 ./scripts/js-hotswap.sh                # unminified: stack traces keep function names
#   (never `--dev true`: a dev bundle expects a Metro server, and the release
#   native host does not provide one)
#   SERIAL=emulator-5554 ./scripts/js-hotswap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/mobile"
BASE_APK="${BASE_APK:-$ROOT/release/interprova-app-release.apk}"
OUT="${OUT:-$ROOT/.hotswap}"
SDK="${ANDROID_HOME:-F:/android-toolchain/sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
JAVA_HOME="${JAVA_HOME:-F:/android-toolchain/jdk-17.0.13+11}"
KEYTOOL="$JAVA_HOME/bin/keytool"
HERMESC="$MOBILE/node_modules/react-native/sdks/hermesc/win64-bin/hermesc.exe"
DEBUG_KS="${DEBUG_KS:-$HOME/.android/debug.keystore}"
PKG=com.interprova.app
ADB=(adb ${SERIAL:+-s "$SERIAL"})

step() { printf '\n▸ %s\n' "$*"; }

[ -f "$BASE_APK" ] || { echo "no base APK at $BASE_APK" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT/assets"

step "bundle JS ($([ -n "${DEBUG:-}" ] && echo unminified || echo minified))"
( cd "$MOBILE" && npx expo export:embed \
    --platform android \
    --dev false \
    --minify "$([ -n "${DEBUG:-}" ] && echo false || echo true)" \
    --entry-file index.js \
    --bundle-output "$OUT/index.android.js" \
    --assets-dest "$OUT/res" >/dev/null )
ls -l "$OUT/index.android.js" | awk '{print "  js  " $5 " bytes"}'

step "compile to Hermes bytecode"
"$HERMESC" -emit-binary -O -max-diagnostic-width=80 -w \
  -out "$OUT/assets/index.android.bundle" "$OUT/index.android.js"
ls -l "$OUT/assets/index.android.bundle" | awk '{print "  hbc " $5 " bytes"}'

step "repack $(basename "$BASE_APK")"
cp "$BASE_APK" "$OUT/unsigned.apk"
python - "$OUT/unsigned.apk" "$OUT/assets/index.android.bundle" <<'PY'
import shutil, sys, zipfile
apk, bundle = sys.argv[1], sys.argv[2]
tmp = apk + '.tmp'
with zipfile.ZipFile(apk) as src, zipfile.ZipFile(tmp, 'w') as dst:
    for item in src.infolist():
        # The old signature files would be stale; apksigner writes new ones.
        if item.filename.startswith('META-INF/') and item.filename.split('/')[-1].split('.')[-1] in ('SF', 'RSA', 'EC', 'DSA', 'MF'):
            continue
        data = open(bundle, 'rb').read() if item.filename == 'assets/index.android.bundle' else src.read(item.filename)
        dst.writestr(item, data, compress_type=item.compress_type)
shutil.move(tmp, apk)
PY

if [ ! -f "$DEBUG_KS" ]; then
  step "create debug keystore"
  mkdir -p "$(dirname "$DEBUG_KS")"
  "$KEYTOOL" -genkeypair -v -keystore "$DEBUG_KS" -storepass android -alias androiddebugkey \
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi

step "align + sign (debug key)"
"$BT/zipalign.exe" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/apksigner.bat" sign --ks "$DEBUG_KS" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out "$OUT/interprova-hotswap.apk" "$OUT/aligned.apk"

step "install"
if ! "${ADB[@]}" install -r "$OUT/interprova-hotswap.apk" >/dev/null 2>&1; then
  # Different signing key from what is installed: the only way in is a clean install.
  "${ADB[@]}" uninstall "$PKG" >/dev/null 2>&1 || true
  "${ADB[@]}" install "$OUT/interprova-hotswap.apk"
fi
"${ADB[@]}" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo "  installed and launched: $OUT/interprova-hotswap.apk"
