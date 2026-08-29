package com.interprova.screenrecorder

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Process
import android.util.Log
import android.view.Surface
import androidx.annotation.RequiresApi
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * One screen recording: video from the display, audio from this app's own
 * playback, muxed into a single MP4.
 *
 * Why this is not `MediaRecorder`
 *   MediaRecorder can take a Surface for video and a *microphone* for audio,
 *   and nothing else. The microphone is the one input this app cannot use —
 *   the speech recogniser holds it for the whole interview, and a second
 *   client silences it with no error. The sound we actually want is the
 *   interviewer's voice, which is PLAYBACK, and the only way to reach it is
 *   `AudioPlaybackCaptureConfiguration` → `AudioRecord`. MediaRecorder has no
 *   way to accept an AudioRecord, so the encode/mux work is done by hand.
 *
 * What is captured
 *   `addMatchingUid(myUid)` — this app's own playback and nothing else. Not a
 *   detail: the alternative (matching by usage) would capture whatever else
 *   the phone happens to be playing, which is both a privacy problem and a
 *   Play policy one. The candidate's microphone is never touched.
 *
 * The two hard parts, and how they are handled
 *   1. A MediaMuxer cannot start until every track is added, and each encoder
 *      only reports its format after it has produced output. So both drain
 *      loops park at `maybeStartMuxer()` until the expected tracks are
 *      present, and nothing is written before that. But "until" cannot mean
 *      "forever": someone who taps record before the interviewer has said a
 *      word has nothing playing to capture, and an audio track that never
 *      arrives would hold back every video frame and produce an empty file.
 *      So the wait for audio has a deadline, after which the recording
 *      continues as video-only. A silent recording beats no recording.
 *   2. Audio timestamps have to be generated: `AudioRecord.read` gives PCM
 *      with no clock. They are derived from the frame count so the audio track
 *      stays in step with itself, and offset from the same start instant as
 *      the video so the two stay in step with each other.
 */
class ScreenCaptureSession(
  private val context: Context,
  private val projection: MediaProjection,
  private val width: Int,
  private val height: Int,
  private val densityDpi: Int,
  private val outputPath: String,
  /** False on API < 29, or when the audio pipeline refuses to start. */
  private val withAudio: Boolean,
) {

  companion object {
    private const val TAG = ScreenRecordService.TAG
    private const val VIDEO_MIME = MediaFormat.MIMETYPE_VIDEO_AVC
    private const val AUDIO_MIME = MediaFormat.MIMETYPE_AUDIO_AAC
    private const val FRAME_RATE = 30
    private const val I_FRAME_INTERVAL = 2
    private const val VIDEO_BITRATE = 6_000_000
    private const val AUDIO_BITRATE = 128_000
    private const val SAMPLE_RATE = 44_100
    private const val CHANNELS = 2
    private const val TIMEOUT_US = 10_000L

    /**
     * How long the muxer waits for an audio track before giving up on it and
     * writing video alone. Playback capture yields nothing at all while the
     * app is silent, and the interviewer's first sentence can be several
     * seconds out — but the video frames arriving meanwhile have to go
     * somewhere, and holding them is how a recording ends up empty.
     */
    private const val AUDIO_GRACE_MS = 4_000L

    /** How long a drain loop keeps waiting for output after end-of-stream. */
    private const val EOS_GRACE_MS = 2_000L

    /**
     * How long `stop()` waits for a drain thread to notice and unwind. It has
     * to be comfortably under the caller's own deadline, because two of these
     * run back to back and the encoder and muxer teardown still follow.
     */
    private const val JOIN_TIMEOUT_MS = 2_500L

    /** True when playback capture exists at all on this OS. */
    fun audioCaptureSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
  }

  private var muxer: MediaMuxer? = null
  private var videoEncoder: MediaCodec? = null
  private var audioEncoder: MediaCodec? = null
  private var audioRecord: AudioRecord? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var inputSurface: Surface? = null

  private var videoTrack = -1
  private var audioTrack = -1
  /** Drops to 1 when audio refuses to start, or misses its deadline. */
  private var expectedTracks = if (withAudio) 2 else 1
  private var muxerStarted = false
  /** Set when the audio deadline passes; tells the audio pump to give up. */
  @Volatile private var audioAbandoned = false
  /*
   * A ReentrantLock rather than `synchronized` + wait/notify. Kotlin's `Any`
   * has no wait/notify — those live on java.lang.Object — and reaching for it
   * through a cast is the kind of thing that compiles on one Kotlin version
   * and not the next. A Condition says the same thing and is checked by the
   * compiler.
   */
  private val muxerLock = ReentrantLock()
  private val muxerReady = muxerLock.newCondition()

  private val running = AtomicBoolean(false)
  private var videoThread: Thread? = null
  private var audioThread: Thread? = null

  /** Shared zero point so the two tracks agree on when the recording began. */
  @Volatile private var startNs = 0L

  /** Set when a drain loop dies, so `stop()` can report an unusable file. */
  @Volatile private var failure: Throwable? = null

  fun start() {
    // One guard around the whole set-up: each step below owns a native
    // resource, and a throw halfway through must not leave an encoder or a
    // muxer holding the file. The caller still sees the original cause.
    try {
      muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      Log.i(TAG, "Muxer open at $outputPath")

      startVideo()
      Log.i(TAG, "Video encoder and virtual display running")
    } catch (e: Throwable) {
      Log.e(TAG, "Video pipeline failed to start", e)
      releaseEverything()
      throw e
    }

    if (withAudio) {
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw IllegalStateException("API < 29")
        startAudio()
        Log.i(TAG, "Playback capture running")
      } catch (e: Throwable) {
        // Audio is a bonus; a recording without it is still worth having, and
        // failing the whole take because playback capture was refused would be
        // the wrong trade. The track count is fixed up so the muxer does not
        // wait forever for a track that will never arrive.
        Log.w(TAG, "Playback capture unavailable; recording video only", e)
        audioEncoder?.let { runCatching { it.release() } }
        audioEncoder = null
        audioRecord?.let { runCatching { it.release() } }
        audioRecord = null
        muxerLock.withLock { expectedTracks = 1 }
        audioAbandoned = true
      }
    }

    startNs = System.nanoTime()
    running.set(true)

    videoThread = Thread({ drainVideo() }, "interprova-video").also { it.start() }
    if (audioEncoder != null) {
      audioThread = Thread({ pumpAudio() }, "interprova-audio").also { it.start() }
    }
  }

  /**
   * @return true when the muxer produced a complete file.
   *
   * Every step is logged. A stop that hangs is not hypothetical here — one did,
   * on 2026-08-29: the recording kept running with its notification up long
   * after the user had pressed stop, and because nothing in this method said
   * where it had got to, "somewhere in stop()" was all anyone could tell. The
   * caller now also runs this under a deadline (ScreenRecorderModule), so a
   * step that never returns can no longer strand the projection.
   */
  fun stop(): Boolean {
    if (!running.getAndSet(false)) return false
    val t0 = System.currentTimeMillis()
    fun step(what: String) = Log.i(TAG, "stop: $what (+${System.currentTimeMillis() - t0}ms)")

    // Video first: signalling EOS lets the encoder flush what the display has
    // already produced instead of dropping the tail.
    runCatching { videoEncoder?.signalEndOfInputStream() }
    step("end-of-stream signalled")
    // Anything still parked waiting for a track it will never get should wake
    // up and unwind rather than sit out its full timeout.
    muxerLock.withLock { muxerReady.signalAll() }

    runCatching { audioThread?.join(JOIN_TIMEOUT_MS) }
    step("audio thread joined (alive=${audioThread?.isAlive})")
    runCatching { videoThread?.join(JOIN_TIMEOUT_MS) }
    step("video thread joined (alive=${videoThread?.isAlive})")

    // The virtual display goes first so the encoder stops being fed, and the
    // projection stops producing frames for a surface about to be released.
    runCatching { virtualDisplay?.release() }; virtualDisplay = null
    step("virtual display released")
    runCatching { inputSurface?.release() }; inputSurface = null
    runCatching { videoEncoder?.stop() }
    runCatching { videoEncoder?.release() }; videoEncoder = null
    step("video encoder released")
    runCatching { audioRecord?.stop() }
    runCatching { audioRecord?.release() }; audioRecord = null
    step("audio record released")
    runCatching { audioEncoder?.stop() }
    runCatching { audioEncoder?.release() }; audioEncoder = null
    step("audio encoder released")

    var complete = false
    muxerLock.withLock {
      if (muxerStarted) {
        // A muxer stopped before any sample was written throws; that is the
        // "stopped within a second of starting" case and the file is useless
        // either way.
        complete = runCatching { muxer?.stop() }.isSuccess
      } else {
        Log.e(TAG, "Muxer never started: no track ever produced output")
      }
      runCatching { muxer?.release() }
      muxer = null
      muxerStarted = false
    }
    step("muxer closed (complete=$complete)")
    failure?.let { Log.e(TAG, "A drain loop failed during the recording", it) }
    return complete && failure == null
  }

  /** Best-effort release of whatever `start()` managed to build before it threw. */
  private fun releaseEverything() {
    runCatching { virtualDisplay?.release() }; virtualDisplay = null
    runCatching { inputSurface?.release() }; inputSurface = null
    runCatching { videoEncoder?.release() }; videoEncoder = null
    runCatching { audioRecord?.release() }; audioRecord = null
    runCatching { audioEncoder?.release() }; audioEncoder = null
    runCatching { muxer?.release() }; muxer = null
  }

  /* ----------------------------------------------------------------- video */

  private fun startVideo() {
    val format = MediaFormat.createVideoFormat(VIDEO_MIME, width, height).apply {
      setInteger(
        MediaFormat.KEY_COLOR_FORMAT,
        MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
      )
      setInteger(MediaFormat.KEY_BIT_RATE, VIDEO_BITRATE)
      setInteger(MediaFormat.KEY_FRAME_RATE, FRAME_RATE)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL)
    }

    val encoder = MediaCodec.createEncoderByType(VIDEO_MIME)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = encoder.createInputSurface()
    encoder.start()
    videoEncoder = encoder

    virtualDisplay = projection.createVirtualDisplay(
      "interprova-screen",
      width,
      height,
      densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      inputSurface,
      null,
      null,
    )
  }

  private fun drainVideo() {
    val encoder = videoEncoder ?: return
    val info = MediaCodec.BufferInfo()
    var idleSinceMs = 0L
    try {
      while (true) {
        val index = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
        when {
          index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
            // After end-of-stream the encoder owes us its tail. If it never
            // arrives, leave anyway: a thread that never exits turns every
            // stop() into a stall and then leaks the encoder behind it.
            if (!running.get()) {
              if (idleSinceMs == 0L) idleSinceMs = System.currentTimeMillis()
              if (System.currentTimeMillis() - idleSinceMs > EOS_GRACE_MS) {
                Log.w(TAG, "Video encoder produced no end-of-stream; leaving the drain loop")
                break
              }
            }
          }
          index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            muxerLock.withLock {
              if (videoTrack < 0) videoTrack = muxer!!.addTrack(encoder.outputFormat)
              maybeStartMuxer()
            }
          }
          index >= 0 -> {
            idleSinceMs = 0L
            val buffer = encoder.getOutputBuffer(index)
            writeSample(buffer, info, videoTrack)
            encoder.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
        }
      }
    } catch (e: Throwable) {
      failure = e
    }
  }

  /* ----------------------------------------------------------------- audio */

  @SuppressLint("MissingPermission")
  @RequiresApi(Build.VERSION_CODES.Q)
  private fun startAudio() {

    val config = AudioPlaybackCaptureConfiguration.Builder(projection)
      // This app only. Never other apps' audio.
      .addMatchingUid(Process.myUid())
      .build()

    val audioFormat = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(SAMPLE_RATE)
      .setChannelMask(
        if (CHANNELS == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO,
      )
      .build()

    val minBuffer = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      if (CHANNELS == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    ).coerceAtLeast(SAMPLE_RATE) * 2

    val record = AudioRecord.Builder()
      .setAudioFormat(audioFormat)
      .setBufferSizeInBytes(minBuffer)
      .setAudioPlaybackCaptureConfig(config)
      .build()
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw IllegalStateException("AudioRecord did not initialise")
    }

    val format = MediaFormat.createAudioFormat(AUDIO_MIME, SAMPLE_RATE, CHANNELS).apply {
      setInteger(
        MediaFormat.KEY_AAC_PROFILE,
        MediaCodecInfo.CodecProfileLevel.AACObjectLC,
      )
      setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BITRATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, minBuffer)
    }
    val encoder = MediaCodec.createEncoderByType(AUDIO_MIME)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()

    audioRecord = record
    audioEncoder = encoder
    record.startRecording()
  }

  private fun pumpAudio() {
    val record = audioRecord ?: return
    val encoder = audioEncoder ?: return
    val info = MediaCodec.BufferInfo()
    val chunk = ByteArray(4096)
    // Frames read so far — the audio clock. Wall time would drift against the
    // encoder and the two tracks would slide apart over a ten-minute call.
    var framesWritten = 0L
    val bytesPerFrame = 2 * CHANNELS

    try {
      while (running.get() && !audioAbandoned) {
        val read = record.read(chunk, 0, chunk.size)
        if (read > 0) {
          val inputIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
          if (inputIndex >= 0) {
            val input = encoder.getInputBuffer(inputIndex)!!
            input.clear()
            input.put(chunk, 0, read)
            val ptsUs = framesWritten * 1_000_000L / SAMPLE_RATE
            encoder.queueInputBuffer(inputIndex, 0, read, ptsUs, 0)
            framesWritten += read / bytesPerFrame
          }
        }
        drainAudio(encoder, info, endOfStream = false)
      }

      if (audioAbandoned) {
        Log.w(TAG, "Audio abandoned; the recording continues without a sound track")
        return
      }

      // Tell the encoder there is nothing more, then flush what it holds.
      val inputIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
      if (inputIndex >= 0) {
        encoder.queueInputBuffer(
          inputIndex,
          0,
          0,
          framesWritten * 1_000_000L / SAMPLE_RATE,
          MediaCodec.BUFFER_FLAG_END_OF_STREAM,
        )
      }
      drainAudio(encoder, info, endOfStream = true)
    } catch (e: Throwable) {
      failure = e
    }
  }

  private fun drainAudio(encoder: MediaCodec, info: MediaCodec.BufferInfo, endOfStream: Boolean) {
    val deadlineMs = System.currentTimeMillis() + EOS_GRACE_MS
    while (true) {
      if (audioAbandoned) return
      val index = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
      when {
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream) return
          if (System.currentTimeMillis() > deadlineMs) {
            Log.w(TAG, "Audio encoder produced no end-of-stream; leaving the drain loop")
            return
          }
        }
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> muxerLock.withLock {
          // The deadline may already have passed and the muxer started without
          // us. Adding a track after that throws, and there is nothing to do
          // with the audio but drop it.
          if (muxerStarted) {
            Log.w(TAG, "Audio format arrived after the muxer started; dropping the sound track")
            audioAbandoned = true
          } else if (audioTrack < 0) {
            audioTrack = muxer!!.addTrack(encoder.outputFormat)
            maybeStartMuxer()
          }
        }
        index >= 0 -> {
          val buffer = encoder.getOutputBuffer(index)
          writeSample(buffer, info, audioTrack)
          encoder.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  /* ------------------------------------------------------------------- mux */

  /** Caller must hold `muxerLock`. */
  private fun maybeStartMuxer() {
    if (muxerStarted) return
    if (videoTrack < 0) return

    if (expectedTracks == 2 && audioTrack < 0) {
      // Give playback capture its grace period, then go without it. See the
      // AUDIO_GRACE_MS note: an interviewer who has not spoken yet produces no
      // audio at all, and the video frames piling up behind it are the whole
      // recording.
      val startedAt = startNs
      if (startedAt == 0L) return
      val waitedMs = (System.nanoTime() - startedAt) / 1_000_000
      if (waitedMs < AUDIO_GRACE_MS) return
      Log.w(TAG, "No audio after ${waitedMs}ms; starting the muxer video-only")
      expectedTracks = 1
      audioAbandoned = true
    }

    muxer?.start()
    muxerStarted = true
    Log.i(TAG, "Muxer started with $expectedTracks track(s)")
    muxerReady.signalAll()
  }

  private fun writeSample(buffer: ByteBuffer?, info: MediaCodec.BufferInfo, track: Int) {
    if (buffer == null) return
    // Codec config bytes belong in the track format, not in the stream.
    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) { info.size = 0; return }
    if (info.size <= 0) return

    muxerLock.withLock {
      // The other track's format may not have arrived yet. Waiting here rather
      // than dropping the sample is what keeps the first second of the
      // recording from being silent or black — and `maybeStartMuxer` is
      // re-tried on every pass, because once video is the only track producing
      // output this loop is the only place still checking the audio deadline.
      var waited = 0L
      while (!muxerStarted && running.get() && waited < AUDIO_GRACE_MS + 1_000) {
        maybeStartMuxer()
        if (muxerStarted) break
        muxerReady.await(50, TimeUnit.MILLISECONDS)
        waited += 50
      }
      if (!muxerStarted || track < 0) return
      buffer.position(info.offset)
      buffer.limit(info.offset + info.size)
      muxer?.writeSampleData(track, buffer, info)
    }
  }
}
