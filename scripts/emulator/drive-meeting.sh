#!/bin/bash
# Drive the native Android build all the way into the live interview.
export ANDROID_HOME="F:/android-toolchain/sdk"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
export MSYS_NO_PATHCONV=1
OUT="$1"; mkdir -p "$OUT"; n=0

shot() { n=$((n+1)); "$ADB" exec-out screencap -p > "$OUT/$(printf '%02d' $n)-$1.png" 2>/dev/null; echo "  [shot] $1"; }
dumpui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml; }

# Tap the centre of the first node matching $1 (matched against the whole node,
# so it works for both text="" and content-desc="").
tapNode() {
  local raw x1 y1 x2 y2
  raw=$(dumpui | tr '>' '\n' | grep -F "$1" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  if [ -z "$raw" ]; then echo "  MISS: $1"; return 1; fi
  x1=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\1/')
  y1=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\2/')
  x2=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\3/')
  y2=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\4/')
  "$ADB" shell input tap $(( (x1+x2)/2 )) $(( (y1+y2)/2 )) >/dev/null 2>&1
  echo "  tap: $1"; sleep "${2:-3}"
}

# Type into the EditText whose content-desc is $1.
typeInto() {
  local raw x1 y1 x2 y2
  raw=$(dumpui | tr '>' '\n' | grep 'class="android.widget.EditText"' | grep -F "content-desc=\"$1\"" \
        | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  if [ -z "$raw" ]; then echo "  MISS field: $1"; return 1; fi
  x1=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\1/')
  y1=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\2/')
  x2=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\3/')
  y2=$(echo "$raw" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\4/')
  "$ADB" shell input tap $(( (x1+x2)/2 )) $(( (y1+y2)/2 )) >/dev/null 2>&1; sleep 1
  "$ADB" shell "input text '$2'" >/dev/null 2>&1; sleep 1
  "$ADB" shell input keyevent 111 >/dev/null 2>&1; sleep 1   # ESC closes the IME
  echo "  typed into: $1"
}

echo "== reset & permissions =="
"$ADB" shell pm clear com.interprova.app >/dev/null 2>&1
for p in CAMERA RECORD_AUDIO; do "$ADB" shell pm grant com.interprova.app android.permission.$p >/dev/null 2>&1; done
"$ADB" shell monkey -p com.interprova.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15; shot onboarding

echo "== sign in =="
tapNode 'content-desc="لديّ حساب بالفعل"' 4
typeInto "البريد الإلكتروني" "reviewer@interprova.app"
typeInto "كلمة المرور" "InterprovaReview#2026"
shot login-filled
tapNode 'content-desc="تسجيل الدخول"' 12
shot home

echo "== setup =="
tapNode 'مقابلة مباشرة' 6
tapNode 'content-desc="برمجة"' 3
typeInto "اسم الشركة" "Barmagly"
typeInto "المسمى الوظيفي" "Backend.Engineer"
for i in 1 2 3 4 5; do "$ADB" shell input swipe 540 1800 540 700 400 >/dev/null 2>&1; sleep 1; done
shot setup

echo "== enter the meeting =="
tapNode 'content-desc="ابدأ المقابلة المحاكاة"' 16
shot meeting-lobby
dumpui | grep -o 'text="[^"]\{2,\}"\|content-desc="[^"]\{2,\}"' | head -16

echo "== start the interview =="
tapNode 'ابدأ المقابلة مع' 20
shot meeting-live
sleep 10; shot meeting-captions
dumpui | grep -o 'text="[^"]\{2,\}"' | head -14
