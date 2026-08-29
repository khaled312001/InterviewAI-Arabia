#!/usr/bin/env bash
#
# Capture WHY Google sign-in bounced to a browser, from the phone itself.
#
#   ./scripts/android-google-signin-log.sh
#   → plug the phone in, run this, tap "تسجيل الدخول بجوجل", wait.
#
# Why this exists
#   "It opens the browser" is the same sentence for four unrelated causes, and
#   the app cannot tell them apart on screen:
#
#     • DEVELOPER_ERROR (10) — no Android OAuth client matches this build's
#       package + signing certificate, or it has not propagated yet.
#     • The consent screen is in Testing and this account is not a test user,
#       so Play services hands the consent to the web.
#     • Play services is too old / missing, so the native path never starts.
#     • The token came back without an id_token — configure() ran without a
#       webClientId.
#
#   src/auth/nativeGoogleSignIn.ts turns all four into the same visible
#   behaviour (fall back to the browser) on purpose — a working sign-in beats a
#   dead button. But that makes the cause invisible, and this is where it is
#   still written down: the status code lands in logcat either way, from the
#   library, from Play services, or from our own console.warn.
#
# Requires: adb on PATH, USB debugging enabled on the phone.

set -uo pipefail

PKG="${PKG:-com.interprova.app}"
OUT="${OUT:-google-signin-log.txt}"
WAIT="${WAIT:-45}"

if ! command -v adb >/dev/null 2>&1; then
  for guess in \
    "/f/android-toolchain/sdk/platform-tools" \
    "$HOME/Android/Sdk/platform-tools" \
    "/c/Users/$USER/Android/Sdk/platform-tools"
  do
    if [ -x "$guess/adb" ] || [ -x "$guess/adb.exe" ]; then export PATH="$PATH:$guess"; break; fi
  done
fi
command -v adb >/dev/null 2>&1 || { echo "adb not found. Install Android platform-tools." >&2; exit 1; }

devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [ -z "$devices" ]; then
  echo "No device." >&2
  echo "On the phone: Settings > About phone > tap 'Build number' 7 times," >&2
  echo "then Settings > Developer options > USB debugging = ON, plug in USB," >&2
  echo "and accept the 'Allow USB debugging?' prompt." >&2
  adb devices >&2
  exit 1
fi
echo "device: $(echo "$devices" | head -1)"

adb logcat -c 2>/dev/null
echo ""
echo "  >>> NOW: open the app and tap  تسجيل الدخول بجوجل  <<<"
echo "      pick the account, and let it do whatever it does."
echo "      capturing for ${WAIT}s ..."
sleep "$WAIT"

{
  echo "=== app + play services versions ==="
  echo "app:  $(adb shell dumpsys package "$PKG" 2>/dev/null | grep -m1 versionName | tr -d '\r')"
  echo "gms:  $(adb shell dumpsys package com.google.android.gms 2>/dev/null | grep -m1 versionName | tr -d '\r')"
  echo ""

  # Our own warning first: nativeGoogleSignIn.ts prints the fix for
  # DEVELOPER_ERROR verbatim, and React Native routes console.warn to logcat.
  echo "=== the app's own JS log ==="
  adb logcat -d 2>/dev/null | grep -aE "ReactNativeJS" | tail -40

  echo ""
  echo "=== sign-in status codes ==="
  # statusCode=10 is DEVELOPER_ERROR, 12501 cancelled, 7 network, 4 sign-in required.
  adb logcat -d 2>/dev/null | grep -aiE "statusCode|SIGN_IN|DEVELOPER_ERROR|GoogleSignIn|RNGoogleSignin|SignInHub|Auth.*consent" | tail -40

  echo ""
  echo "=== what opened the browser ==="
  adb logcat -d 2>/dev/null | grep -aiE "CustomTab|chrome|browser|accounts.google.com|WrapperControlled" | tail -25

  echo ""
  echo "=== anything the app logged ==="
  pid="$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')"
  if [ -n "$pid" ]; then adb logcat -d --pid "$pid" 2>/dev/null | tail -60
  else adb logcat -d 2>/dev/null | grep -a "$PKG" | tail -60; fi
} > "$OUT" 2>&1

echo ""
echo "Written to: $OUT"
echo "The 'sign-in status codes' section usually names the cause outright."
