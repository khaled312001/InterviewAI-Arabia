package com.interprova.screenrecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * The foreground service that makes screen capture legal.
 *
 * From Android 14 (API 34) `MediaProjectionManager.getMediaProjection()` throws
 * a SecurityException unless a foreground service of type `mediaProjection` is
 * ALREADY running when it is called. This app targets API 36, so this is not
 * optional and the ordering is not negotiable:
 *
 *   1. ask for consent (`createScreenCaptureIntent`)
 *   2. start THIS service and wait for it to be foreground
 *   3. only then `getMediaProjection(...)`
 *
 * Step 2 says "wait", and that word is the whole reason this class has a
 * callback. `startForegroundService()` does not start anything — it queues the
 * service start on the caller's main looper. A caller that goes straight on to
 * step 3 in the same main-thread turn is running BEFORE `onStartCommand` here,
 * and if it then hits an error and stops the service, Android sees a foreground
 * service that was started and brought down without ever calling
 * `startForeground` and kills the whole process with
 * `ForegroundServiceDidNotStartInTimeException`. That is not a hypothetical:
 * it is what versionCode 6 did on the first real device it ran on. So the
 * module hands over `onForeground` and does nothing until it fires.
 *
 * The notification is not decoration either — a foreground service must post
 * one, and on a screen recorder it is the honest signal that the screen is
 * being captured. Android shows its own recording indicator as well; both are
 * intended.
 */
class ScreenRecordService : Service() {

  companion object {
    const val TAG = "ScreenRecorder"

    private const val CHANNEL_ID = "interprova.screen_recording"
    private const val NOTIFICATION_ID = 8731

    /** Set by the module before start, so the text can be localised in JS. */
    @Volatile var title: String = "Recording"
    @Volatile var body: String = ""

    /**
     * Fired on the main thread once `startForeground` has returned — with the
     * failure if it threw instead. Cleared by the module as soon as it runs;
     * a service start with nobody listening is a leaked notification, so the
     * service stops itself in that case.
     */
    @Volatile var onForeground: ((Throwable?) -> Unit)? = null

    /**
     * True between a successful `startForeground()` and `onDestroy()`. The
     * module reads it to know whether `stopService` is safe to call now or has
     * to be posted behind a start that has not landed yet.
     */
    @Volatile var isForeground: Boolean = false

    fun start(context: Context) {
      val intent = Intent(context, ScreenRecordService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ScreenRecordService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Nothing here may throw past this point: an exception escaping
    // onStartCommand leaves the service started-but-not-foreground, which is
    // the exact state that kills the process a few hundred milliseconds later.
    val failure = try {
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      isForeground = true
      Log.i(TAG, "Recording service is foreground")
      null
    } catch (e: Throwable) {
      Log.e(TAG, "startForeground failed", e)
      isForeground = false
      e
    }

    val listener = onForeground
    if (listener == null) {
      // Started with nobody waiting — a stale restart, or a start whose caller
      // has already given up. Do not leave a recording notification behind.
      Log.w(TAG, "Recording service started with no listener; stopping")
      stopSelf()
      return START_NOT_STICKY
    }
    listener(failure)

    // The recorder owns the lifetime; a restarted service with no projection
    // would be a notification with nothing behind it.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isForeground = false
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(
            CHANNEL_ID,
            "Screen recording",
            // LOW: it must be visible and silent. A recording indicator that
            // makes a sound during a spoken interview would be recorded too.
            NotificationManager.IMPORTANCE_LOW,
          ),
        )
      }
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle(title)
      .apply { if (body.isNotEmpty()) setContentText(body) }
      // The platform's own record icon rather than the app icon: this
      // notification is about what the SYSTEM is doing on the app's behalf.
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .build()
  }
}
