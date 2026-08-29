#!/usr/bin/env bash
#
# Capture WHY the app died on a real device, in one command.
#
#   ./scripts/android-crash-report.sh                    # launch what is installed
#   ./scripts/android-crash-report.sh release/foo.apk    # install that, then launch
#
# Why this exists
#   "It crashes on the first screen" is the same sentence for a dozen unrelated
#   causes — a missing native library, an unsatisfied link, a JS exception
#   thrown before first render, a Firebase misconfiguration, an ABI mismatch,
#   or an ELF page-alignment refusal. The Android log says exactly which, and
#   says it in a different place for each: a Java crash lands in AndroidRuntime,
#   a native abort in DEBUG/tombstone, a JS crash in ReactNativeJS, and a
#   loader refusal in the linker's own lines, which are not tagged as errors at
#   all. So a plain `adb logcat | grep -i error` misses most of them.
#
#   This pulls all of them, plus the one that is invisible without knowing to
#   look: the 16 KB page-size refusal. A device with 16 KB pages will not load
#   a library whose ELF segments are aligned to 4 KB, and the app dies right
#   after the splash with nothing in the Java log at all.
#
# Requires: adb on PATH and a device with USB debugging enabled
#   (Settings > About phone > tap "Build number" 7 times,
#    then Settings > Developer options > USB debugging).

set -uo pipefail

PKG="${PKG:-com.interprova.app}"
ACTIVITY="${ACTIVITY:-.MainActivity}"
APK="${1:-}"
OUT="${OUT:-android-crash-report.txt}"

if ! command -v adb >/dev/null 2>&1; then
  for guess in \
    "$HOME/Android/Sdk/platform-tools" \
    "$LOCALAPPDATA/Android/Sdk/platform-tools" \
    "/c/Users/$USER/Android/Sdk/platform-tools" \
    "/f/android-toolchain/sdk/platform-tools"
  do
    [ -x "$guess/adb" ] || [ -x "$guess/adb.exe" ] && export PATH="$PATH:$guess" && break
  done
fi
command -v adb >/dev/null 2>&1 || { echo "adb not found. Install Android platform-tools." >&2; exit 1; }

devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [ -z "$devices" ]; then
  echo "No device. Connect the phone by USB, enable USB debugging, and accept" >&2
  echo "the 'Allow USB debugging?' prompt on the phone (then re-run)." >&2
  adb devices >&2
  exit 1
fi
echo "device: $(echo "$devices" | head -1)"

# ---------------------------------------------------------------- device facts
#
# Page size is printed FIRST because it decides whether anything else matters.
# `getconf PAGE_SIZE` reports 16384 on a 16 KB device; such a device refuses
# every 4 KB-aligned .so in the APK, and no amount of JS debugging will help.
echo "" > "$OUT"
{
  echo "=== device ==="
  for p in ro.product.manufacturer ro.product.model ro.build.version.release \
           ro.build.version.sdk ro.product.cpu.abi ro.build.display.id; do
    echo "$p = $(adb shell getprop $p 2>/dev/null | tr -d '\r')"
  done
  echo "PAGE_SIZE = $(adb shell getconf PAGE_SIZE 2>/dev/null | tr -d '\r')  (16384 means this device REQUIRES 16 KB-aligned libraries)"
  echo ""
} >> "$OUT"

if [ -n "$APK" ]; then
  echo "installing $APK ..."
  adb install -r -d "$APK" 2>&1 | tail -3 | tee -a "$OUT"
fi

echo "launching $PKG ..."
adb logcat -c 2>/dev/null
adb shell am force-stop "$PKG" 2>/dev/null
adb shell am start -W -n "$PKG/$ACTIVITY" >/dev/null 2>&1

# Give it long enough to die. A startup crash is usually under 5s; a slow cold
# start on a budget handset can take 8.
sleep 12

pid="$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')"
if [ -n "$pid" ]; then
  echo "STILL RUNNING (pid $pid) — it did not crash on this launch." | tee -a "$OUT"
else
  echo "PROCESS IS GONE — it crashed." | tee -a "$OUT"
fi

# ---------------------------------------------------------------- the evidence
{
  echo ""
  echo "=== 16 KB page-size / loader refusals (checked first: these kill the app before any JS runs) ==="
  adb logcat -d 2>/dev/null | grep -aiE "bad ELF alignment|not .*aligned|p_align|dlopen failed|couldn't find DSO|library .* not found|UnsatisfiedLink" | head -40

  echo ""
  echo "=== java / kotlin crash ==="
  adb logcat -d 2>/dev/null | grep -aA 60 "FATAL EXCEPTION" | head -80

  echo ""
  echo "=== native abort (tombstone) ==="
  adb logcat -d 2>/dev/null | grep -aE "^.*(DEBUG|libc)\s+:" | grep -aA 40 -E "signal|Abort message|backtrace" | head -60

  echo ""
  echo "=== react native / expo ==="
  adb logcat -d 2>/dev/null | grep -aE "ReactNativeJS|ExpoModulesCore|ReactNative |SoLoader: .*not found on" | head -60

  echo ""
  echo "=== everything this app logged ==="
  [ -n "$pid" ] && adb logcat -d --pid "$pid" 2>/dev/null | tail -120 \
                || adb logcat -d 2>/dev/null | grep -a "$PKG" | tail -120
} >> "$OUT"

echo ""
echo "Report written to: $OUT"
echo "Send that file back — the first section usually names the cause outright."

# Exit non-zero when the app died, so this doubles as a release gate:
#
#   ./scripts/android-crash-report.sh release/foo.apk && echo "boots"
#
# Worth having, because the web probe cannot cover this. `probe-webapp.mjs`
# runs the WEB bundle, and the crash this script was written for was
# native-only: `window.location` exists in a browser and does not on a device,
# so the one build that mattered was the one nothing checked.
[ -n "$pid" ]
