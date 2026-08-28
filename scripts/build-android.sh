#!/usr/bin/env bash
#
# Build a signed release APK (and optionally an AAB) for Interprova, locally.
#
#   ./scripts/build-android.sh            # APK
#   ./scripts/build-android.sh --aab      # Play Store bundle
#   ./scripts/build-android.sh --apk --aab
#
# Why this script exists — three environment traps, each with a misleading error:
#
#  1. The repo path contains a space ("F:\InterviewAI Arabia"), which breaks
#     Gradle/AGP. We build from a copy at $BUILD_DIR. A directory junction does
#     NOT work: Expo's autolinking resolves through it with require.resolve and
#     hands Gradle the real spaced path anyway.
#  2. local.properties is a Java .properties file, so backslashes are escapes:
#     `sdk.dir=F:\android-toolchain\sdk` silently becomes `F:androidtoolchainsdk`
#     and fails with "The filename, directory name, or volume label syntax is
#     incorrect" from SdkLocator. Forward slashes only.
#  3. Expo SDK 51 pins compileSdk 34 / build-tools 34.0.0.
#
# `expo prebuild --clean` regenerates android/ from app.json and therefore
# discards the signing config, so this script re-applies it every run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-/c/iaabuild}"
TARGET_SDK="${TARGET_SDK:-35}"      # Google Play floor for new apps
AGP_VERSION="${AGP_VERSION:-8.6.0}" # minimum that supports compileSdk 35
# Gradle and AGP move together: AGP 8.6 needs Gradle 8.7+, AGP 8.9 (the first
# that compiles against SDK 36) needs 8.11.1+. Raising AGP without raising the
# wrapper fails with "Minimum supported Gradle version is ..." after several
# minutes of configuration, so both are knobs and both are patched below.
#
#   TARGET_SDK=36 AGP_VERSION=8.9.1 GRADLE_VERSION=8.11.1 ./scripts/build-android.sh --aab
GRADLE_VERSION="${GRADLE_VERSION:-8.8}"

export JAVA_HOME="${JAVA_HOME:-f:/android-toolchain/jdk-17.0.13+11}"
export ANDROID_HOME="${ANDROID_HOME:-F:/android-toolchain/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

KEYSTORE="${KEYSTORE:-C:/Users/KHALE/localbuild/ks/interviewai-upload.jks}"
KEY_ALIAS="${KEY_ALIAS:-interviewai-upload}"
KEY_PASS="${KEY_PASS:-InterviewAI#2026Key}"

WANT_APK=1; WANT_AAB=0
for a in "$@"; do
  case "$a" in
    --aab) WANT_AAB=1; WANT_APK=0 ;;
    --apk) WANT_APK=1 ;;
    *) echo "unknown flag: $a"; exit 2 ;;
  esac
done
[ $# -gt 1 ] && { WANT_APK=1; WANT_AAB=1; }

# Unbuffered: when this script is backgrounded its output is otherwise held
# until exit, so a 25-minute build is indistinguishable from a hung one.
exec 1>&2

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }

[ -f "$KEYSTORE" ] || { echo "keystore missing: $KEYSTORE"; exit 1; }

set -o pipefail   # a half-finished sync must not look like success
say "Syncing sources to a space-free path ($BUILD_DIR)"
# A previous run's Gradle daemon can still hold its own lock files in the
# destination, and tar cannot overwrite a file another process has open — the
# whole sync then aborts with "Device or resource busy" before one source file
# is copied. Nothing here needs Gradle's caches: `prebuild --clean` regenerates
# android/ two steps down, so every .gradle directory is excluded, not just the
# one under android/.
mkdir -p "$BUILD_DIR"
# tar exits 1 for "file changed as we read it" — a WARNING, not a failure.
# It fires whenever anything else touches mobile/ mid-read (a web export, an
# editor save), and under `set -e` that aborted the whole build for a file we
# had already excluded. Exit 2 is the real error; 0 and 1 are both fine.
set +e
tar -C "$ROOT/mobile" \
    --warning=no-file-changed \
    --exclude='./android/build' --exclude='./android/app/build' \
    --exclude='./android/.gradle' --exclude='./.expo' --exclude='./dist' \
    --exclude='*/.gradle' --exclude='./.gradle' \
    -cf - . | (cd "$BUILD_DIR" && tar -x --overwrite -f -)
tar_rc=${PIPESTATUS[0]}
set -e
if [ "$tar_rc" -gt 1 ]; then echo "sync failed (tar exit $tar_rc)" >&2; exit 1; fi

cd "$BUILD_DIR"

say "Regenerating the native project from app.json"
npx expo prebuild --platform android --no-install --clean

say "Patching the React Native gradle plugin for modern Gradle"
# Gradle 8.11 RELOCATED `serviceOf` from org.gradle.configurationcache.extensions
# to org.gradle.internal.extensions.core. React Native 0.74 ships a gradle plugin
# that still imports the old path, so the plugin fails to COMPILE under any
# Gradle new enough for AGP 8.9 — which is the first AGP that can compile against
# SDK 36. Without this one-line fix, API 36 is unreachable without a full React
# Native upgrade.
#
# Idempotent and version-guarded: on Gradle 8.8 the old path still exists and the
# patch is skipped, so the default build is untouched.
python - "$BUILD_DIR" "$GRADLE_VERSION" <<'PY'
import io, os, sys

build_dir, gradle = sys.argv[1], sys.argv[2]
major, minor = (int(x) for x in (gradle.split(".") + ["0"])[:2])
if (major, minor) < (8, 11):
    print("  Gradle %s still has the old package — no patch needed" % gradle)
    raise SystemExit

target = os.path.join(build_dir, "node_modules", "@react-native", "gradle-plugin",
                      "react-native-gradle-plugin", "build.gradle.kts")
OLD = "org.gradle.configurationcache.extensions.serviceOf"
NEW = "org.gradle.internal.extensions.core.serviceOf"
s = io.open(target, encoding="utf-8").read()
if NEW in s:
    print("  already patched")
elif OLD in s:
    io.open(target, "w", encoding="utf-8").write(s.replace(OLD, NEW))
    print("  serviceOf import moved to org.gradle.internal.extensions.core")
else:
    raise SystemExit("  serviceOf import not found — RN gradle plugin changed shape")
PY

say "Raising the target API level for Google Play"
# Play rejects new apps below API 35 (36 from 2026-08-31). Expo SDK 51 ships
# AGP 8.2.1, whose ceiling is compileSdk 34 — and targetSdk can never exceed
# compileSdk, so the level cannot be raised without also raising AGP. The
# Gradle wrapper here is already 8.8, which satisfies AGP 8.6.
cd "$BUILD_DIR/android"
python - "$TARGET_SDK" "$AGP_VERSION" "$GRADLE_VERSION" <<'PY'
import io, re, sys
sdk, agp, gradle = sys.argv[1], sys.argv[2], sys.argv[3]

# The wrapper pins the Gradle that runs the build; AGP refuses to load under an
# older one, so this has to move in step with AGP_VERSION.
wp = 'gradle/wrapper/gradle-wrapper.properties'
w = io.open(wp, encoding='utf-8').read()
w = re.sub(r'gradle-[0-9.]+-all\.zip', f'gradle-{gradle}-all.zip', w)
io.open(wp, 'w', encoding='utf-8').write(w)

p = 'gradle.properties'
s = io.open(p, encoding='utf-8').read()
# build.gradle reads these through findProperty(), so setting them here is
# what actually reaches Gradle.
# `enableProguardInReleaseBuilds` turns on R8: the shrinking and renaming that
# Play's release dashboard scores as "obfuscation". The template reads it via
# findProperty() in android/app/build.gradle, which is why it is set here and
# not in app.json — expo-build-properties writes a different file for this and
# the value never reaches Gradle (the same trap as compileSdkVersion).
#
# R8 renames and strips. A native module resolved reflectively can disappear and
# only fail at runtime, so THIS BUILD MUST BE RUN ON A DEVICE before upload —
# installing it is not enough, the interview screen has to be opened.
for key, val in (('compileSdkVersion', sdk), ('targetSdkVersion', sdk),
                 ('buildToolsVersion', sdk + '.0.0'),
                 ('enableProguardInReleaseBuilds', 'true'),
                 ('enableShrinkResourcesInReleaseBuilds', 'true')):
    line = f'android.{key}={val}'
    s = re.sub(rf'^android\.{key}=.*$', line, s, flags=re.M) \
        if re.search(rf'^android\.{key}=', s, re.M) else s + chr(10) + line + chr(10)
io.open(p, 'w', encoding='utf-8').write(s)

p = 'build.gradle'
s = io.open(p, encoding='utf-8').read()
# The template declares the plugin without a version and lets the React
# Native gradle plugin pin it. Pin it explicitly instead.
before = s
s = s.replace("classpath('com.android.tools.build:gradle')",
              f"classpath('com.android.tools.build:gradle:{agp}')")
assert s != before, 'AGP classpath line not found — template changed'
io.open(p, 'w', encoding='utf-8').write(s)
print(f'  targetSdk={sdk} compileSdk={sdk} AGP={agp} Gradle={gradle} R8=on')
PY

say "Re-applying release signing"
cd "$BUILD_DIR/android"
printf 'sdk.dir=%s\n' "$(echo "$ANDROID_HOME" | tr '\\' '/')" > local.properties

python - "$KEYSTORE" "$KEY_ALIAS" "$KEY_PASS" <<'PY'
import io, re, sys
ks, alias, pw = sys.argv[1], sys.argv[2], sys.argv[3]

p = 'gradle.properties'
s = io.open(p, encoding='utf-8').read()
if 'MYAPP_UPLOAD_STORE_FILE' not in s:
    s += (
        "\n# Release signing (upload key). Keystore lives outside the repo;\n"
        "# these values are machine-local and must never be committed.\n"
        f"MYAPP_UPLOAD_STORE_FILE={ks}\n"
        f"MYAPP_UPLOAD_STORE_PASSWORD={pw}\n"
        f"MYAPP_UPLOAD_KEY_ALIAS={alias}\n"
        f"MYAPP_UPLOAD_KEY_PASSWORD={pw}\n"
    )
s = s.replace('org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m',
              'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m')
io.open(p, 'w', encoding='utf-8').write(s)

p = 'app/build.gradle'
s = io.open(p, encoding='utf-8').read()
old_sc = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }"""
new_sc = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            // No silent fallback to the public Android debug key: Play rejects
            // such builds and anyone could forge an update, so an unconfigured
            // build must fail loudly instead.
            if (!project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                throw new GradleException('Release signing not configured: set MYAPP_UPLOAD_* in android/gradle.properties')
            }
            storeFile file(MYAPP_UPLOAD_STORE_FILE)
            storePassword MYAPP_UPLOAD_STORE_PASSWORD
            keyAlias MYAPP_UPLOAD_KEY_ALIAS
            keyPassword MYAPP_UPLOAD_KEY_PASSWORD
        }
    }"""
if 'MYAPP_UPLOAD_STORE_FILE' not in s:
    assert old_sc in s, 'signingConfigs block not in the expected shape'
    s = s.replace(old_sc, new_sc)
# Expo's template puts two comment lines between `release {` and
# `signingConfig`, so an exact-string replace silently misses and the build
# ships signed with the public Android DEBUG key — which Play rejects and
# which anyone could forge. Match the block structurally instead.
s, n = re.subn(
    r"(buildTypes\s*\{.*?release\s*\{)(.*?)(signingConfig\s+signingConfigs\.)debug",
    lambda m: m.group(1) + m.group(2) + m.group(3) + "release",
    s, count=1, flags=re.S)
assert n == 1 or 'signingConfigs.release' in s, 'could not point buildTypes.release at the release signingConfig'
print('  release buildType -> signingConfigs.release')
io.open(p, 'w', encoding='utf-8').write(s)
print('  signing configured')
PY

TASKS=""
[ "$WANT_APK" = 1 ] && TASKS="$TASKS assembleRelease"
[ "$WANT_AAB" = 1 ] && TASKS="$TASKS bundleRelease"

say "Gradle:$TASKS"
./gradlew $TASKS --no-daemon --console=plain

say "Artifacts"
mkdir -p "$ROOT/release"
for f in $(find "$BUILD_DIR/android/app/build/outputs" \( -name '*.apk' -o -name '*.aab' \) 2>/dev/null); do
  base="$(basename "$f")"
  out="$ROOT/release/interprova-${base}"
  cp "$f" "$out"
  echo "  $out  ($(du -h "$out" | cut -f1))"
done

say "Done"
