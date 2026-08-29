package com.interprova.screenrecorder

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Records the whole screen, not just the camera.
 *
 * Why a hand-written module
 *   `react-native-record-screen` — the obvious dependency — was last published
 *   in April 2024 and contains no foreground service at all: no
 *   `startForeground`, no `foregroundServiceType`, no manifest entry. On
 *   Android 14 and later that is an immediate SecurityException from
 *   `getMediaProjection`, and this app targets API 36. There was nothing to
 *   adopt.
 *
 * What it captures, and what it does not
 *   The display, and this app's own playback — so the interviewer is heard.
 *   Not the microphone: the speech recogniser holds the one microphone client
 *   Android gives an app for the whole interview, and a second client silences
 *   it with no error. The candidate's own voice is therefore absent from the
 *   file by design, and the control bar says so before anyone presses record.
 *
 *   That combination is why `MediaRecorder` is not used: it takes a Surface
 *   for video and a *microphone* for audio and nothing else. Playback capture
 *   arrives as an `AudioRecord`, which MediaRecorder cannot accept, so the
 *   encode and mux are done by hand in ScreenCaptureSession.
 *
 * Ordering
 *   Consent, then service, then projection. See ScreenRecordService.
 */
class ScreenRecorderModule : Module() {

  companion object {
    private const val REQUEST_CODE = 0x5C41
    /**
     * Longest edge of the recording. Phones are now 1200×2800 and above, and a
     * hardware H.264 encoder will refuse a size it has no profile for — an
     * unhelpful `prepare()` failure with nothing in the log about dimensions.
     * Scaling to 1280 keeps the file readable, keeps the bitrate honest, and
     * is inside every encoder this app can run on.
     */
    private const val MAX_EDGE = 1280
  }

  private var session: ScreenCaptureSession? = null
  private var projection: MediaProjection? = null
  private var outputFile: File? = null
  private var pending: Promise? = null
  private var startedAtMs: Long = 0

  private val mainHandler = Handler(Looper.getMainLooper())

  /**
   * Registered before `createVirtualDisplay`, which API 34 requires — and
   * which also matters at runtime: the user can revoke capture from the system
   * UI at any moment, and without this the encoder would keep running against
   * a display that has stopped producing frames.
   */
  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      mainHandler.post { teardown(keepFile = true) }
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("No react context")

  override fun definition() = ModuleDefinition {
    Name("ScreenRecorder")

    Function("isAvailable") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
    }

    Function("isRecording") { session != null }

    /**
     * Asks for consent and starts. Resolves with the output path once frames
     * are actually being written, so the caller's timer starts when the
     * recording does rather than when the dialog opened.
     */
    AsyncFunction("start") { title: String, body: String, promise: Promise ->
      if (session != null) {
        promise.reject(CodedException("ERR_ALREADY_RECORDING", "A recording is already running", null))
        return@AsyncFunction
      }
      val activity = appContext.activityProvider?.currentActivity
        ?: run {
          promise.reject(CodedException("ERR_NO_ACTIVITY", "No foreground activity", null))
          return@AsyncFunction
        }

      ScreenRecordService.title = title
      ScreenRecordService.body = body

      pending = promise
      val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CODE)
    }

    /**
     * Stops and returns the file. `null` when nothing was running, so a double
     * stop — which the call screen can produce by ending a meeting while a
     * stop is already in flight — is a no-op rather than an error.
     */
    AsyncFunction("stop") { promise: Promise ->
      val file = outputFile
      if (session == null || file == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val durationMs = System.currentTimeMillis() - startedAtMs
      val ok = teardown(keepFile = true)
      if (!ok || !file.exists() || file.length() == 0L) {
        promise.reject(CodedException("ERR_EMPTY_RECORDING", "The recording produced no file", null))
        return@AsyncFunction
      }
      promise.resolve(mapOf(
        "uri" to "file://${file.absolutePath}",
        "durationMs" to durationMs,
        "sizeBytes" to file.length(),
      ))
    }

    /** Abandons a recording and deletes the file. Used when the user declines to save. */
    AsyncFunction("cancel") {
      val file = outputFile
      teardown(keepFile = false)
      file?.delete()
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null

      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        // Declining the system dialog is a decision, not a failure.
        promise.reject(CodedException("ERR_PERMISSION_DENIED", "Screen capture was not allowed", null))
        return@OnActivityResult
      }

      try {
        beginRecording(payload.resultCode, payload.data!!)
        promise.resolve(true)
      } catch (e: Throwable) {
        teardown(keepFile = false)
        promise.reject(CodedException("ERR_RECORDER_START", e.message ?: "Could not start the recorder", e))
      }
    }

    OnDestroy { teardown(keepFile = false) }
  }

  /** Real display size, scaled into something an encoder will accept. */
  private fun recordingSize(): Triple<Int, Int, Int> {
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    var width: Int
    var height: Int
    val density: Int

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.currentWindowMetrics.bounds
      width = bounds.width()
      height = bounds.height()
      density = context.resources.configuration.densityDpi
    } else {
      val metrics = DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(metrics)
      width = metrics.widthPixels
      height = metrics.heightPixels
      density = metrics.densityDpi
    }

    val longest = maxOf(width, height)
    if (longest > MAX_EDGE) {
      val scale = MAX_EDGE.toFloat() / longest
      width = (width * scale).toInt()
      height = (height * scale).toInt()
    }
    // Round DOWN to a multiple of 16. H.264 encoders are specified in
    // macroblocks; an odd width is the classic source of a `prepare()` that
    // fails with no explanation.
    return Triple(width / 16 * 16, height / 16 * 16, density)
  }

  private fun beginRecording(resultCode: Int, data: Intent) {
    val (width, height, density) = recordingSize()

    val file = File(context.cacheDir, "interprova-screen-${System.currentTimeMillis()}.mp4")
    outputFile = file

    // The service must be foreground BEFORE the projection is obtained: from
    // Android 14 `getMediaProjection` throws otherwise, and this app targets 36.
    ScreenRecordService.start(context)

    val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val proj = manager.getMediaProjection(resultCode, data)
      ?: throw IllegalStateException("MediaProjection was refused")
    projection = proj
    // Required from API 34 before createVirtualDisplay, and useful before that:
    // the user can revoke capture from the system UI at any moment.
    proj.registerCallback(projectionCallback, mainHandler)

    val capture = ScreenCaptureSession(
      context = context,
      projection = proj,
      width = width,
      height = height,
      densityDpi = density,
      outputPath = file.absolutePath,
      withAudio = ScreenCaptureSession.audioCaptureSupported(),
    )
    capture.start()
    session = capture
    startedAtMs = System.currentTimeMillis()
  }

  /**
   * Release everything, in the order that survives a half-started session.
   *
   * `MediaRecorder.stop()` throws IllegalStateException when it was never
   * started or when it received no frames at all — a stop within a few hundred
   * milliseconds of start. That is not a reason to leak the projection, so
   * every step is independently guarded and the caller learns the outcome from
   * the return value instead of an exception.
   */
  private fun teardown(keepFile: Boolean): Boolean {
    var stoppedCleanly = false

    session?.let { capture ->
      // The session owns both encoders, the muxer and the virtual display, and
      // reports whether the muxer actually closed a file.
      stoppedCleanly = try { capture.stop() } catch (_: Throwable) { false }
    }
    session = null

    projection?.let { proj ->
      try { proj.unregisterCallback(projectionCallback) } catch (_: Throwable) {}
      try { proj.stop() } catch (_: Throwable) {}
    }
    projection = null

    try { ScreenRecordService.stop(context) } catch (_: Throwable) {}

    if (!keepFile) {
      try { outputFile?.delete() } catch (_: Throwable) {}
      outputFile = null
    }
    return stoppedCleanly
  }
}
