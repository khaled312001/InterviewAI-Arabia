/**
 * Declare Android hardware requirements explicitly, instead of letting Google
 * Play infer them.
 *
 * Play derives implicit `<uses-feature required="true">` entries from the
 * permissions a manifest requests, and then filters the app off every device
 * that lacks one. `CAMERA` implies BOTH `android.hardware.camera` and
 * `android.hardware.camera.autofocus`; `RECORD_AUDIO` implies
 * `android.hardware.microphone`. Nothing in the project declared any of them,
 * so all three were silently required.
 *
 * Two of those are wrong for this app:
 *
 *   android.hardware.camera.autofocus — never used. Interprova points a fixed
 *     front camera at a face for a self-view; it never focuses on anything.
 *     Requiring autofocus excludes tablets and Chromebooks for a capability
 *     the code does not call.
 *
 *   android.hardware.camera — optional by the app's own design. The media
 *     layer treats the camera as a capability to be probed, not assumed
 *     (`capabilities.camera.available`), the call screen has a camera toggle,
 *     and an interview conducted with the camera off is a complete interview:
 *     the questions, the speech recognition, the scoring and the evaluation
 *     all run on the voice. A candidate on a camera-less device gets the
 *     product, minus the mirror.
 *
 * The microphone is the one that IS required, and it is now declared as such
 * rather than inherited — an interview trainer that cannot hear the candidate
 * has nothing to offer. Saying so explicitly means the requirement is a
 * decision in this file rather than a side effect of a permission.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

/** name → required. Order here is the order they appear in the manifest. */
const FEATURES = {
  'android.hardware.camera': false,
  'android.hardware.camera.autofocus': false,
  'android.hardware.camera.front': false,
  'android.hardware.microphone': true,
};

module.exports = function withAndroidHardwareFeatures(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] || [];

    for (const [name, required] of Object.entries(FEATURES)) {
      // Idempotent: prebuild runs this on a manifest that may already carry
      // the entry from a previous run or from a library's own manifest, and a
      // duplicate `uses-feature` is a manifest-merger failure, not a no-op.
      const existing = manifest['uses-feature'].find(
        (f) => f?.$?.['android:name'] === name,
      );
      if (existing) {
        existing.$['android:required'] = String(required);
      } else {
        manifest['uses-feature'].push({
          $: { 'android:name': name, 'android:required': String(required) },
        });
      }
    }

    return cfg;
  });
};
