package com.airferrylite.receiver

import android.Manifest
import android.content.ComponentName
import android.content.ContentValues
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.provider.MediaStore
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.util.Range
import android.util.Size
import android.view.Surface
import android.view.WindowManager
import android.graphics.BitmapFactory
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import com.google.android.material.button.MaterialButtonToggleGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

@OptIn(ExperimentalCamera2Interop::class)
class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var idlePanel: View
    private lateinit var resultPanel: View
    private lateinit var restartingPanel: View
    private lateinit var resultImage: ImageView
    private lateinit var resultNamesScroll: View
    private lateinit var resultNames: TextView
    private lateinit var resultMeta: TextView
    private lateinit var restartCountdown: TextView
    private lateinit var restartProgress: ProgressBar
    private lateinit var scanMetaRow: View
    private lateinit var statusText: TextView
    private lateinit var fileText: TextView
    private lateinit var speedText: TextView
    private lateinit var missingText: TextView
    private lateinit var diagnosticsText: TextView
    private lateinit var progress: ProgressBar
    private lateinit var saveButton: Button
    private lateinit var resetButton: Button
    private lateinit var startReceiveButton: Button
    private lateinit var fpsGroup: MaterialButtonToggleGroup
    private lateinit var frameAnalyzer: QrFrameAnalyzer
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var protocolExecutor: ExecutorService
    private val assembler = TransferAssembler()
    private val highSpeedAssembler = HighSpeedAssembler()
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraStarted = false
    private var lastHighFrameCount = 0
    private var lastHighUiAt = 0L
    private var speedWindowStartedAt = 0L
    private var speedWindowBytes = 0L
    private var speedBytesPerSecond = 0.0
    private var sessionStartedAt = 0L
    private var sessionUniquePayloadBytes = 0L
    private var sessionAverageBytesPerSecond = 0.0
    private val rollingRates = DoubleArray(3)
    private var rollingCount = 0
    private var rollingIndex = 0
    private var lastStats: ScanStats? = null
    private val decodedQrCount = AtomicLong(0)
    private val invalidFrameCount = AtomicLong(0)
    private val pendingProtocolFrames = AtomicInteger(0)
    @Volatile private var highFrameCount = 0L
    @Volatile private var highUniqueFrameCount = 0L
    @Volatile private var highDuplicateCount = 0L
    @Volatile private var highProtocolErrors = 0L
    @Volatile private var highBytesReceived = 0L
    @Volatile private var highLastFrameAt = 0L
    @Volatile private var invalidFrameSample = "—"
    private var lastHighUnique = 0
    private var lastHighSolved = 0
    private var lastHighTotal = 0
    private var activeCameraFps: Range<Int>? = null
    private var availableCameraFpsLabel = "未知"
    private var highSpeedCameraFpsLabel = "未开放"
    @Volatile private var latestSpeedLabel = "实时 — · 平均 —"
    @Volatile private var highSpeedSessionActive = false
    private var requestedFps = 60
    private var fullDiagnostics = ""
    private var pendingSave: PendingSave? = null
    private var pendingSession: String? = null
    private var bindingCamera = false
    private var imageAnalysis: ImageAnalysis? = null
    private var boundCamera: Camera? = null
    private var aeNudgeStep = 0
    private var aeNudgeCount = 0
    private var aeMeterCount = 0
    private var lastAeNudgeAt = 0L
    private var lastEvIndex = 0
    private var aeNudged = false
    private val protocolEpoch = AtomicInteger(0)
    private val watchdog = Handler(Looper.getMainLooper())
    private val watchdogTick = object : Runnable {
        override fun run() {
            maybeRecoverStalledScanner()
            watchdog.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }
    private var lastStatsAt = 0L
    private var lastRecoverAt = 0L
    private var recoverBurst = 0
    private var recoverBurstStartedAt = 0L
    private var processRestarting = false
    private var restartStartedAt = 0L
    private var settlePreviewBeforeAnalyze = false
    private var skipHalWaitOnBeginReceive = false
    private var softDecoderRecoverAttempted = false
    private var lastSoftRecoverAt = 0L
    private var halRecoveryRestartAttempted = false
    private var receiveSessionFromContinue = false
    private var cameraBoundAt = 0L
    private var restartDelayMs = PROCESS_RESTART_DELAY_MS
    private val restartProgressTick = object : Runnable {
        override fun run() {
            if (!processRestarting) return
            val elapsed = (SystemClock.elapsedRealtime() - restartStartedAt).coerceAtLeast(0L)
            val remaining = (restartDelayMs - elapsed).coerceAtLeast(0L)
            restartCountdown.text = ((remaining + 999) / 1000).toInt().coerceAtLeast(0).toString()
            restartProgress.progress = if (restartDelayMs <= 0L) restartProgress.max
            else ((elapsed * restartProgress.max) / restartDelayMs).toInt()
                .coerceIn(0, restartProgress.max)
            if (remaining > 0) watchdog.postDelayed(this, 50)
        }
    }

    private data class PendingSave(val name: String, val mime: String, val bytes: ByteArray)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val rootLayout = findViewById<android.view.View>(R.id.rootLayout)
        val baseLeft = rootLayout.paddingLeft
        val baseTop = rootLayout.paddingTop
        val baseRight = rootLayout.paddingRight
        val baseBottom = rootLayout.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(baseLeft + bars.left, baseTop + bars.top, baseRight + bars.right, baseBottom + bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(rootLayout)
        previewView = findViewById(R.id.previewView)
        previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
        previewView.implementationMode = PreviewView.ImplementationMode.PERFORMANCE
        idlePanel = findViewById(R.id.idlePanel)
        resultPanel = findViewById(R.id.resultPanel)
        restartingPanel = findViewById(R.id.restartingPanel)
        resultImage = findViewById(R.id.resultImage)
        resultNamesScroll = findViewById(R.id.resultNamesScroll)
        resultNames = findViewById(R.id.resultNames)
        resultMeta = findViewById(R.id.resultMeta)
        restartCountdown = findViewById(R.id.restartCountdown)
        restartProgress = findViewById(R.id.restartProgress)
        scanMetaRow = findViewById(R.id.scanMetaRow)
        statusText = findViewById(R.id.statusText)
        fileText = findViewById(R.id.fileText)
        speedText = findViewById(R.id.speedText)
        missingText = findViewById(R.id.missingText)
        diagnosticsText = findViewById(R.id.diagnosticsText)
        progress = findViewById(R.id.progress)
        saveButton = findViewById(R.id.saveButton)
        resetButton = findViewById(R.id.resetButton)
        startReceiveButton = findViewById(R.id.startReceiveButton)
        fpsGroup = findViewById(R.id.fpsGroup)
        requestedFps = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getInt(PREF_FPS, 60).let {
            if (it == 30 || it == 120) it else 60
        }
        fpsGroup.check(
            when (requestedFps) {
                30 -> R.id.fps30
                120 -> R.id.fps120
                else -> R.id.fps60
            }
        )
        fpsGroup.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val fps = when (checkedId) {
                R.id.fps30 -> 30
                R.id.fps120 -> 120
                else -> 60
            }
            if (fps != requestedFps) setRequestedFps(fps)
        }
        startReceiveButton.setOnClickListener { requestStartReceive() }
        findViewById<Button>(R.id.continueReceiveButton).setOnClickListener { continueReceive() }
        findViewById<Button>(R.id.resultSaveButton).setOnClickListener { savePendingFile() }
        resetButton.setOnClickListener { resetTransfer() }
        cameraExecutor = Executors.newSingleThreadExecutor()
        protocolExecutor = Executors.newSingleThreadExecutor()
        frameAnalyzer = QrFrameAnalyzer(
            onDecoded = { decoded ->
                decodedQrCount.incrementAndGet()
                val bytes = decoded.bytes
                if (bytes != null && HighSpeedAssembler.looksLikeFrame(bytes)) {
                    when {
                        HighSpeedAssembler.isDualLayoutFrame(bytes) -> frameAnalyzer.noteStreamLayout(2)
                        HighSpeedAssembler.isQuadLayoutFrame(bytes) -> frameAnalyzer.noteStreamLayout(4)
                    }
                    highSpeedSessionActive = true
                    val epoch = protocolEpoch.get()
                    pendingProtocolFrames.incrementAndGet()
                    protocolExecutor.execute {
                        try {
                            if (epoch != protocolEpoch.get()) return@execute
                            handleHighSpeedFrame(bytes)
                        } catch (_: Throwable) {
                            highProtocolErrors += 1
                        } finally {
                            pendingProtocolFrames.decrementAndGet()
                        }
                    }
                } else {
                    ContextCompat.getMainExecutor(this).execute { handleResult(decoded) }
                }
            },
            onStats = { stats ->
                ContextCompat.getMainExecutor(this).execute {
                    lastStats = stats
                    lastStatsAt = SystemClock.elapsedRealtime()
                    recoverBurst = 0
                    maybeSoftDecoderRecover(stats)
                    maybeRestartForHalEmptyBurst(stats)
                    renderDiagnostics()
                }
            }
        )
        findViewById<Button>(R.id.copyDiagnosticsButton).setOnClickListener { copyDiagnostics() }
        saveButton.setOnClickListener { savePendingFile() }
        watchdog.postDelayed(watchdogTick, WATCHDOG_INTERVAL_MS)
        if (consumeAutostartScan()) {
            val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            val fromContinue = prefs.getBoolean(PREF_AUTOSTART_FROM_CONTINUE, false)
            receiveSessionFromContinue = fromContinue
            if (fromContinue) {
                prefs.edit().remove(PREF_AUTOSTART_FROM_CONTINUE).apply()
            }
            val override = prefs.getLong(PREF_AUTOSTART_BIND_DELAY_OVERRIDE_MS, -1L)
            if (override >= 0L) {
                prefs.edit().remove(PREF_AUTOSTART_BIND_DELAY_OVERRIDE_MS).apply()
            }
            val halRemain = msUntilCameraBindAllowed()
            val bindDelay = when {
                override >= 0L -> maxOf(override, halRemain)
                else -> maxOf(AUTOSTART_BIND_DELAY_MS, halRemain)
            }
            skipHalWaitOnBeginReceive = bindDelay > 0L
            settlePreviewBeforeAnalyze = true
            if (fromContinue) showScanning() else showOpeningCamera()
            previewView.post {
                watchdog.postDelayed({
                    requestStartReceive()
                }, bindDelay)
            }
        } else {
            reconcileCameraStateAfterReopen()
            showIdle()
        }
        renderDiagnostics()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_REQUEST && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            previewView.post { beginReceive() }
        } else if (requestCode == CAMERA_PERMISSION_REQUEST) {
            showIdle()
            statusText.text = "需要摄像头权限才能接收"
        }
    }

    private fun requestStartReceive() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
            return
        }
        receiveSessionFromContinue = false
        beginReceive()
    }

    private fun continueReceive() {
        if (processRestarting) return
        findViewById<Button>(R.id.continueReceiveButton).isEnabled = false
        val (preKill, postKill) = planColdRestart()
        scheduleColdRestart(preKill, postKill, "正在释放相机", fromContinue = true)
    }

    private fun scheduleColdRestart(
        preKillWaitMs: Long,
        postKillBindDelayMs: Long,
        statusMessage: String,
        fromContinue: Boolean = false
    ) {
        if (processRestarting) return
        processRestarting = true
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_AUTOSTART_SCAN, true)
            .putBoolean(PREF_AUTOSTART_FROM_CONTINUE, fromContinue)
            .putLong(PREF_AUTOSTART_BIND_DELAY_OVERRIDE_MS, postKillBindDelayMs)
            .commit()
        showRestarting(preKillWaitMs, statusMessage)
        watchdog.postDelayed({
            if (postKillBindDelayMs > 0L || msUntilCameraBindAllowed() > 0L) {
                markCameraReleased()
            }
            restartProcessForScan()
        }, preKillWaitMs)
    }

    private fun planColdRestart(): Pair<Long, Long> {
        val elapsed = elapsedSinceCameraRelease()
        if (elapsed >= CAMERA_HAL_COOLDOWN_MS) {
            return CONTINUE_RESTART_MIN_MS to 0L
        }
        val remaining = CAMERA_HAL_COOLDOWN_MS - elapsed
        val preKill = remaining.coerceIn(CONTINUE_RESTART_MIN_MS, PROCESS_RESTART_DELAY_MS)
        val postKill = (CAMERA_HAL_COOLDOWN_MS - preKill).coerceAtLeast(0L)
        return preKill to postKill
    }

    private fun restartProcessForScan() {
        val intent = Intent.makeRestartActivityTask(ComponentName(this, MainActivity::class.java))
        intent.putExtra(EXTRA_AUTOSTART_SCAN, true)
        startActivity(intent)
        finishAffinity()
        Process.killProcess(Process.myPid())
        Runtime.getRuntime().exit(0)
    }

    private fun consumeAutostartScan(): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val fromPrefs = prefs.getBoolean(PREF_AUTOSTART_SCAN, false)
        val fromIntent = intent.getBooleanExtra(EXTRA_AUTOSTART_SCAN, false)
        if (fromPrefs) prefs.edit().putBoolean(PREF_AUTOSTART_SCAN, false).commit()
        return fromPrefs || fromIntent
    }

    private fun beginReceive() {
        val waitMs = if (skipHalWaitOnBeginReceive) {
            skipHalWaitOnBeginReceive = false
            0L
        } else {
            msUntilCameraBindAllowed()
        }
        if (waitMs > 0) {
            showOpeningCamera()
            watchdog.postDelayed({
                if (isDestroyed) return@postDelayed
                launchReceiveAfterHalWait()
            }, waitMs)
            return
        }
        launchReceiveAfterHalWait()
    }

    private fun launchReceiveAfterHalWait() {
        softDecoderRecoverAttempted = false
        lastSoftRecoverAt = 0L
        halRecoveryRestartAttempted = false
        if (::frameAnalyzer.isInitialized) {
            frameAnalyzer.resetSession()
            if (receiveSessionFromContinue) {
                frameAnalyzer.noteStreamLayout(2)
            }
            frameAnalyzer.setAnalysisIdle(false)
        }
        protocolEpoch.incrementAndGet()
        protocolExecutor.execute { highSpeedAssembler.reset() }
        highSpeedSessionActive = false
        highFrameCount = 0
        highUniqueFrameCount = 0
        highDuplicateCount = 0
        highProtocolErrors = 0
        highBytesReceived = 0
        highLastFrameAt = 0
        lastHighUnique = 0
        lastHighSolved = 0
        lastHighTotal = 0
        resetSpeed()
        showScanning()
        settlePreviewBeforeAnalyze = true
        previewView.post { startScanner() }
    }

    private fun inHalRecoveryWarmup(): Boolean {
        if (cameraBoundAt != 0L && SystemClock.elapsedRealtime() - cameraBoundAt < HAL_WARMUP_MS) return true
        if (receiveSessionFromContinue && highUniqueFrameCount < HAL_WARMUP_MIN_UNIQUE) return true
        return false
    }

    private fun maybeSoftDecoderRecover(stats: ScanStats) {
        if (!cameraStarted || processRestarting) return
        if (inHalRecoveryWarmup()) return
        if (stats.submittedFrames < 240) return
        if (highUniqueFrameCount >= 20) return
        val emptyRatio = stats.emptyDecodes.toDouble() / stats.submittedFrames.toDouble()
        if (emptyRatio < 0.92) {
            if (stats.emptyDecodes == 0L) softDecoderRecoverAttempted = false
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (softDecoderRecoverAttempted && now - lastSoftRecoverAt < 8000L) return
        softDecoderRecoverAttempted = true
        lastSoftRecoverAt = now
        imageAnalysis?.clearAnalyzer()
        frameAnalyzer.setAnalysisIdle(true)
        frameAnalyzer.replaceDecoders()
        resetExposureSession()
        watchdog.postDelayed({
            if (isDestroyed) return@postDelayed
            imageAnalysis?.setAnalyzer(cameraExecutor, frameAnalyzer)
            frameAnalyzer.setAnalysisIdle(false)
        }, 800L)
    }

    private fun maybeRestartForHalEmptyBurst(stats: ScanStats) {
        if (!cameraStarted || processRestarting || halRecoveryRestartAttempted) return
        if (inHalRecoveryWarmup()) return
        if (highUniqueFrameCount >= 5 || lastHighSolved >= 20) return
        val lastHalRecovery = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getLong(PREF_LAST_HAL_RECOVERY_MS, 0L)
        if (System.currentTimeMillis() - lastHalRecovery < HAL_RECOVERY_COOLDOWN_MS) return
        if (stats.submittedFrames < HAL_EMPTY_BURST_MIN_FRAMES) return
        val emptyRatio = stats.emptyDecodes.toDouble() / stats.submittedFrames.toDouble()
        if (emptyRatio < HAL_EMPTY_BURST_RATIO) return
        if (highUniqueFrameCount >= HAL_EMPTY_BURST_MAX_UNIQUE) return
        halRecoveryRestartAttempted = true
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putLong(PREF_LAST_HAL_RECOVERY_MS, System.currentTimeMillis())
            .commit()
        restartScanForHalRecovery()
    }

    private fun restartScanForHalRecovery() {
        if (processRestarting) return
        processRestarting = true
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_AUTOSTART_SCAN, true)
            .putLong(PREF_AUTOSTART_BIND_DELAY_OVERRIDE_MS, CAMERA_HAL_COOLDOWN_MS)
            .commit()
        showRestarting()
        statusText.text = "相机未就绪，正在恢复"
        watchdog.postDelayed({
            markCameraReleased()
            restartProcessForScan()
        }, PROCESS_RESTART_DELAY_MS)
    }

    private fun showIdle() {
        idlePanel.visibility = View.VISIBLE
        resultPanel.visibility = View.GONE
        restartingPanel.visibility = View.GONE
        scanMetaRow.visibility = View.GONE
        resetButton.visibility = View.GONE
        startReceiveButton.isEnabled = true
        statusText.text = "点「接收文件」开始扫描"
    }

    private fun showScanning() {
        idlePanel.visibility = View.GONE
        resultPanel.visibility = View.GONE
        restartingPanel.visibility = View.GONE
        scanMetaRow.visibility = View.VISIBLE
        resetButton.visibility = View.VISIBLE
        statusText.text = "请对准电脑二维码"
    }

    private fun showResult(pending: PendingSave) {
        idlePanel.visibility = View.GONE
        restartingPanel.visibility = View.GONE
        resultPanel.visibility = View.VISIBLE
        scanMetaRow.visibility = View.GONE
        resetButton.visibility = View.GONE
        val names = ZipListing.names(pending.bytes)
        val preview = previewBitmap(pending)
        if (preview != null && (names == null || names.size <= 1)) {
            resultImage.setImageBitmap(preview)
            resultImage.visibility = View.VISIBLE
            resultNamesScroll.visibility = View.GONE
            resultNames.text = pending.name
        } else {
            resultImage.setImageDrawable(null)
            resultImage.visibility = View.GONE
            resultNamesScroll.visibility = View.VISIBLE
            resultNames.text = if (!names.isNullOrEmpty()) names.joinToString("\n") else pending.name
        }
        resultMeta.text = if (!names.isNullOrEmpty() && names.size > 1) {
            "${names.size} 个文件 · ${formatBytes(pending.bytes.size.toLong())} · ${pending.name}"
        } else {
            "${pending.name} · ${formatBytes(pending.bytes.size.toLong())}"
        }
        statusText.text = "接收完成，可保存或继续接收"
        findViewById<Button>(R.id.continueReceiveButton).isEnabled = true
        processRestarting = false
    }

    private fun previewBitmap(pending: PendingSave) = try {
        val mime = pending.mime.lowercase()
        if (!mime.startsWith("image/")) null
        else BitmapFactory.decodeByteArray(pending.bytes, 0, pending.bytes.size)
    } catch (_: Throwable) {
        null
    }

    private fun showOpeningCamera() {
        idlePanel.visibility = View.GONE
        resultPanel.visibility = View.GONE
        restartingPanel.visibility = View.GONE
        scanMetaRow.visibility = View.VISIBLE
        resetButton.visibility = View.GONE
        statusText.text = "正在打开相机"
    }

    private fun showRestarting(delayMs: Long = PROCESS_RESTART_DELAY_MS, statusMessage: String = "正在释放相机") {
        idlePanel.visibility = View.GONE
        resultPanel.visibility = View.GONE
        scanMetaRow.visibility = View.GONE
        resetButton.visibility = View.GONE
        restartingPanel.visibility = View.VISIBLE
        restartStartedAt = SystemClock.elapsedRealtime()
        restartDelayMs = delayMs.coerceAtLeast(CONTINUE_RESTART_MIN_MS)
        restartCountdown.text = ((restartDelayMs + 999) / 1000).toInt().coerceAtLeast(1).toString()
        restartProgress.progress = 0
        statusText.text = statusMessage
        watchdog.removeCallbacks(restartProgressTick)
        watchdog.post(restartProgressTick)
    }

    private fun pauseScanner() {
        imageAnalysis?.clearAnalyzer()
        cameraStarted = false
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (::frameAnalyzer.isInitialized) frameAnalyzer.setAnalysisIdle(true)
    }

    private fun stopScanner() {
        pauseScanner()
        cameraProvider?.unbindAll()
        imageAnalysis = null
        boundCamera = null
        markCameraReleased()
    }

    private fun startScanner() {
        if (isDestroyed) return
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (::frameAnalyzer.isInitialized) frameAnalyzer.setAnalysisIdle(false)
        val bound = imageAnalysis
        if (bound != null) {
            cameraStarted = true
            val settle = settlePreviewBeforeAnalyze.also { settlePreviewBeforeAnalyze = false }
            attachAnalyzer(bound, settle)
            return
        }
        if (cameraStarted && cameraProvider != null) {
            bindCamera()
            return
        }
        cameraStarted = true
        val existing = cameraProvider
        if (existing != null) {
            bindCamera()
            return
        }
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                cameraProvider = providerFuture.get()
                if (cameraStarted && !isDestroyed && imageAnalysis == null) bindCamera()
            } catch (error: Exception) {
                cameraStarted = false
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                showIdle()
                statusText.text = "摄像头启动失败：${error.message ?: "未知错误"}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun setRequestedFps(fps: Int) {
        requestedFps = if (fps == 30 || fps == 120) fps else 60
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putInt(PREF_FPS, requestedFps).apply()
        if (cameraStarted && cameraProvider != null) bindCamera()
        else statusText.text = "已选 ${requestedFps} FPS"
    }

    private fun bindCamera() {
        val provider = cameraProvider ?: return
        if (isDestroyed || bindingCamera) return
        bindingCamera = true
        try {
            val rotation = previewView.display?.rotation ?: Surface.ROTATION_0
            val fpsRanges = cameraFpsRanges(provider)
            availableCameraFpsLabel = fpsRanges.joinToString(",") { "${it.lower}-${it.upper}" }.ifBlank { "未知" }
            highSpeedCameraFpsLabel = cameraHighSpeedFpsRanges(provider)
            val preferredFps = pickFpsRange(fpsRanges, requestedFps)
            val fallbackFps = pickFpsRange(fpsRanges, if (requestedFps == 120) 60 else 30)
            var activeFps = preferredFps
            var fellBack = false
            var preview = buildPreview(rotation, activeFps)
            var analysis = buildAnalysis(rotation, activeFps)
            imageAnalysis?.clearAnalyzer()
            provider.unbindAll()
            val settle = settlePreviewBeforeAnalyze.also { settlePreviewBeforeAnalyze = false }
            attachAnalyzer(analysis, settle)
            try {
                boundCamera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (preferredError: Exception) {
                if (fallbackFps == null || fallbackFps == preferredFps) throw preferredError
                analysis.clearAnalyzer()
                provider.unbindAll()
                activeFps = fallbackFps
                preview = buildPreview(rotation, activeFps)
                analysis = buildAnalysis(rotation, activeFps)
                attachAnalyzer(analysis, settle)
                boundCamera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                fellBack = true
            }
            imageAnalysis = analysis
            activeCameraFps = activeFps
            lastStatsAt = SystemClock.elapsedRealtime()
            cameraBoundAt = SystemClock.elapsedRealtime()
            resetExposureSession()
            markCameraHeld()
            val boundFps = activeFps
            statusText.text = if (boundFps != null && (fellBack || requestedFps !in boundFps.lower..boundFps.upper)) {
                "相机达不到 ${requestedFps} FPS，已落到 ${boundFps.lower}-${boundFps.upper}"
            } else {
                boundFps?.let { "正在高速扫描 · 相机 ${it.lower}-${it.upper} FPS" } ?: "正在高速扫描"
            }
            renderDiagnostics()
        } catch (error: Exception) {
            if (imageAnalysis == null) cameraStarted = false
            boundCamera = null
            statusText.text = "摄像头启动失败：${error.message ?: "未知错误"}"
        } finally {
            bindingCamera = false
        }
    }

    private fun resetExposureSession() {
        aeNudgeStep = 0
        aeNudgeCount = 0
        aeMeterCount = 0
        lastAeNudgeAt = 0L
        lastEvIndex = 0
        aeNudged = false
    }

    private fun attachAnalyzer(analysis: ImageAnalysis, settle: Boolean) {
        if (!settle) {
            analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
            return
        }
        watchdog.postDelayed({
            if (isDestroyed || imageAnalysis !== analysis) return@postDelayed
            analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
            if (::frameAnalyzer.isInitialized) frameAnalyzer.setAnalysisIdle(false)
        }, ANALYZER_SETTLE_MS)
    }

    private fun cameraFpsRanges(provider: ProcessCameraProvider): List<Range<Int>> {
        val cameraInfo = CameraSelector.DEFAULT_BACK_CAMERA.filter(provider.availableCameraInfos).firstOrNull() ?: return emptyList()
        return Camera2CameraInfo.from(cameraInfo).getCameraCharacteristic(
            CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES
        ).orEmpty().toList()
    }

    private fun cameraHighSpeedFpsRanges(provider: ProcessCameraProvider): String {
        val cameraInfo = CameraSelector.DEFAULT_BACK_CAMERA.filter(provider.availableCameraInfos).firstOrNull() ?: return "未开放"
        val map = Camera2CameraInfo.from(cameraInfo).getCameraCharacteristic(
            CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP
        ) ?: return "未开放"
        val ranges = map.highSpeedVideoFpsRanges.orEmpty().distinct().sortedBy { it.upper }
        val sizes = map.highSpeedVideoSizes.orEmpty().joinToString(",") { "${it.width}×${it.height}" }
        if (ranges.isEmpty()) return "未开放"
        return ranges.joinToString(",") { "${it.lower}-${it.upper}" } + if (sizes.isBlank()) "" else " @ $sizes"
    }

    private fun pickFpsRange(ranges: List<Range<Int>>, target: Int): Range<Int>? {
        return ranges.firstOrNull { it.lower == target && it.upper == target }
            ?: ranges.filter { target in it.lower..it.upper }.minWithOrNull(compareBy { it.upper - it.lower })
            ?: ranges.filter { it.upper >= target }.minWithOrNull(compareBy { kotlin.math.abs(it.upper - target) })
            ?: ranges.maxWithOrNull(compareBy<Range<Int>> { it.upper }.thenBy { it.lower })
    }

    private fun buildPreview(rotation: Int, fpsRange: Range<Int>?): Preview {
        val builder = Preview.Builder().setTargetRotation(rotation)
        applyScanCaptureOptions(Camera2Interop.Extender(builder), fpsRange)
        return builder.build().also { it.surfaceProvider = previewView.surfaceProvider }
    }

    private fun buildAnalysis(rotation: Int, fpsRange: Range<Int>?): ImageAnalysis {
        val builder = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder().setResolutionStrategy(
                    ResolutionStrategy(
                        Size(1920, 1440),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                ).build()
            )
            .setTargetRotation(rotation)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
        applyScanCaptureOptions(Camera2Interop.Extender(builder), fpsRange)
        return builder.build()
    }

    private fun <T> applyScanCaptureOptions(extender: Camera2Interop.Extender<T>, fpsRange: Range<Int>?) {
        if (fpsRange != null) {
            extender.setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange)
        }
        extender.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
        extender.setCaptureRequestOption(CaptureRequest.CONTROL_AE_LOCK, false)
        extender.setCaptureRequestOption(CaptureRequest.CONTROL_AWB_LOCK, false)
        extender.setCaptureRequestOption(
            CaptureRequest.CONTROL_AF_MODE,
            CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
        )
    }

    private fun handleResult(result: DecodedQr) {
        if (highSpeedSessionActive) return
        val legacyText = result.text?.takeIf { it.startsWith("AFL1|") }
        if (legacyText != null) {
            handleFrame(legacyText)
            return
        }
        val bytes = result.bytes
        if (bytes != null) {
            invalidFrameCount.incrementAndGet()
            if (invalidFrameSample == "—") invalidFrameSample = "${bytes.size}B:${bytes.take(8).joinToString("") { "%02x".format(it) }}"
        }
    }

    private fun handleFrame(text: String) {
        val update = assembler.accept(text)
        updateUi(update)
        val meta = update.meta
        val complete = update.complete
        if (complete != null && meta != null) {
            frameAnalyzer.setAnalysisIdle(true)
            offerCompletedFile(meta.session, meta.name, meta.mime, complete)
        }
    }

    private fun handleHighSpeedFrame(bytes: ByteArray) {
        when {
            HighSpeedAssembler.isDualLayoutFrame(bytes) -> frameAnalyzer.noteStreamLayout(2)
            HighSpeedAssembler.isQuadLayoutFrame(bytes) -> frameAnalyzer.noteStreamLayout(4)
        }
        highFrameCount += 1
        highBytesReceived += bytes.size.toLong()
        highLastFrameAt = SystemClock.elapsedRealtime()
        val update = highSpeedAssembler.accept(bytes)
        if (update.error != null) highProtocolErrors += 1
        lastHighSolved = update.solvedBlocks
        lastHighTotal = update.totalBlocks
        if (update.receivedFrames > lastHighUnique) {
            highUniqueFrameCount += (update.receivedFrames - lastHighUnique).toLong()
            lastHighUnique = update.receivedFrames
            if (highUniqueFrameCount >= HAL_WARMUP_MIN_UNIQUE) {
                receiveSessionFromContinue = false
            }
        } else highDuplicateCount += 1
        val now = SystemClock.elapsedRealtime()
        updateSpeed(update, bytes.size - HIGH_SPEED_HEADER_SIZE, now)
        val file = update.complete
        if (file == null && update.error == null && now - lastHighUiAt < UI_REFRESH_INTERVAL_MS) return
        lastHighUiAt = now
        val expectedFrames = if (update.totalBlocks in 1..768) {
            maxOf(update.totalBlocks, (update.totalBlocks * 112 + 99) / 100)
        } else {
            maxOf(update.totalBlocks, (update.totalBlocks * 3 + 1) / 2)
        }
        val framePercent = if (expectedFrames == 0) 0 else update.receivedFrames * 100 / expectedFrames
        val solvePercent = if (update.totalBlocks == 0) 0 else update.solvedBlocks * 100 / update.totalBlocks
        val percent = minOf(99, maxOf(framePercent, solvePercent))
        ContextCompat.getMainExecutor(this).execute {
            fileText.text = if (file != null) "${file.name} · ${formatBytes(file.bytes.size.toLong())}" else "高速文件流"
            progress.progress = if (file != null) 100 else percent
            speedText.text = latestSpeedLabel
            missingText.text = if (file != null) {
                "SHA-256 校验通过"
            } else {
                "唯一帧：${update.receivedFrames}/约$expectedFrames · 已恢复块：${update.solvedBlocks}/${update.totalBlocks}"
            }
            statusText.text = when {
                update.error != null -> update.error
                file != null -> "接收完成，点「保存文件」"
                else -> "高速接收中：$percent%"
            }
            renderDiagnostics()
        }
        if (file != null && update.session != null) {
            offerCompletedFile("high:${update.session}", file.name, file.mime, file.bytes)
        }
    }

    private fun updateSpeed(update: HighSpeedUpdate, payloadBytes: Int, now: Long) {
        if (update.receivedFrames < lastHighFrameCount) resetSpeed()
        val newFrames = update.receivedFrames - lastHighFrameCount
        lastHighFrameCount = update.receivedFrames
        if (newFrames <= 0) return
        if (sessionStartedAt == 0L) sessionStartedAt = now
        if (speedWindowStartedAt == 0L) speedWindowStartedAt = now
        val added = newFrames.toLong() * payloadBytes.coerceAtLeast(0)
        sessionUniquePayloadBytes += added
        speedWindowBytes += added
        val elapsed = now - speedWindowStartedAt
        if (elapsed < SPEED_REFRESH_INTERVAL_MS) return
        val sample = speedWindowBytes * 1000.0 / elapsed.coerceAtLeast(1)
        speedBytesPerSecond = sample
        rollingRates[rollingIndex] = sample
        rollingIndex = (rollingIndex + 1) % rollingRates.size
        rollingCount = minOf(rollingRates.size, rollingCount + 1)
        var rollingSum = 0.0
        for (index in 0 until rollingCount) rollingSum += rollingRates[index]
        val rolling = rollingSum / rollingCount
        sessionAverageBytesPerSecond = sessionUniquePayloadBytes * 1000.0 / (now - sessionStartedAt).coerceAtLeast(1)
        latestSpeedLabel = "实时 ${formatRate(speedBytesPerSecond)} · 平均 ${formatRate(rolling)}"
        speedWindowStartedAt = now
        speedWindowBytes = 0
    }

    private fun updateUi(update: TransferUpdate) {
        val meta = update.meta
        if (meta != null) fileText.text = "${meta.name} · ${formatBytes(meta.originalSize)}"
        val percent = if (update.total == 0) 0 else update.received * 100 / update.total
        progress.progress = percent
        missingText.text = "缺失片段：" + assembler.missing().take(40).joinToString(",").ifBlank { "无" }
        statusText.text = when {
            update.complete != null -> "接收完成，点「保存文件」"
            update.error != null -> update.error
            meta != null -> "兼容接收中：$percent%"
            else -> statusText.text
        }
    }

    private fun resetTransfer() {
        protocolEpoch.incrementAndGet()
        assembler.reset()
        protocolExecutor.execute { highSpeedAssembler.reset() }
        highSpeedSessionActive = false
        pendingSave = null
        pendingSession = null
        saveButton.isEnabled = false
        lastHighUiAt = 0
        resetSpeed()
        decodedQrCount.set(0)
        highFrameCount = 0
        highUniqueFrameCount = 0
        highDuplicateCount = 0
        highProtocolErrors = 0
        highBytesReceived = 0
        highLastFrameAt = 0
        invalidFrameCount.set(0)
        invalidFrameSample = "—"
        lastHighUnique = 0
        lastHighSolved = 0
        lastHighTotal = 0
        frameAnalyzer.consumeRecoverRequest()
        recoverBurst = 0
        softDecoderRecoverAttempted = false
        lastSoftRecoverAt = 0L
        frameAnalyzer.setAnalysisIdle(true)
        val bound = imageAnalysis
        if (bound != null) {
            bound.clearAnalyzer()
        }
        frameAnalyzer.recoverPipeline(false)
        resetExposureSession()
        if (bound != null) {
            cameraStarted = true
            watchdog.postDelayed({
                if (!isDestroyed && imageAnalysis === bound) {
                    bound.setAnalyzer(cameraExecutor, frameAnalyzer)
                }
                frameAnalyzer.setAnalysisIdle(false)
            }, ANALYZER_SETTLE_MS)
        } else {
            frameAnalyzer.setAnalysisIdle(false)
        }
        updateUi(TransferUpdate(null, 0, 0))
        fileText.text = "等待文件"
        progress.progress = 0
        speedText.text = "实时 — · 平均 —"
        missingText.text = "缺失片段：—"
        statusText.text = "正在高速扫描"
        if (::resultImage.isInitialized) {
            resultImage.setImageDrawable(null)
            resultImage.visibility = View.GONE
        }
        if (::resultNamesScroll.isInitialized) resultNamesScroll.visibility = View.VISIBLE
        if (::resultNames.isInitialized) resultNames.text = ""
        showScanning()
        renderDiagnostics()
    }

    private fun maybeRecoverStalledScanner() {
        if (!cameraStarted || bindingCamera || isDestroyed || imageAnalysis == null) return
        if (!::frameAnalyzer.isInitialized) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastRecoverAt < RECOVER_COOLDOWN_MS) return
        val asked = frameAnalyzer.consumeRecoverRequest()
        val heartbeatDead = lastStatsAt != 0L && now - lastStatsAt > SCAN_STALL_MS
        if (heartbeatDead || asked) {
            frameAnalyzer.replaceDecoders()
            if (heartbeatDead) statusText.text = "解码已重建，未重绑相机"
        }
    }

    private fun restartScanner(countRecovery: Boolean, forceRebind: Boolean = false) {
        if (!countRecovery) recoverBurst = 0
        val now = SystemClock.elapsedRealtime()
        if (!forceRebind && lastRecoverAt != 0L && now - lastRecoverAt < RECOVER_COOLDOWN_MS) {
            frameAnalyzer.resetSession()
            return
        }
        lastRecoverAt = now
        imageAnalysis?.clearAnalyzer()
        cameraProvider?.unbindAll()
        frameAnalyzer.recoverPipeline(countRecovery)
        previewView.post {
            if (!isDestroyed && cameraProvider != null) bindCamera()
        }
    }

    private fun renderDiagnostics() {
        if (!::diagnosticsText.isInitialized) return
        val stats = lastStats
        val now = SystemClock.elapsedRealtime()
        val highAge = if (highLastFrameAt == 0L) "—" else "${(now - highLastFrameAt).coerceAtLeast(0)} ms"
        val lines = listOf(
            "设备：${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · App ${BuildConfig.VERSION_NAME}",
            "相机：${stats?.width ?: "?"}×${stats?.height ?: "?"} · 采集 ${stats?.captureFps?.let { "%.1f".format(it) } ?: "?"} FPS · 选择 $requestedFps · 目标 ${preferredFpsLabel()}",
            "分析流 FPS：$availableCameraFpsLabel",
            "高速录像能力：$highSpeedCameraFpsLabel（CameraX 分析流不可直接使用）",
            "分析：提交 ${stats?.submittedFrames ?: 0} · 完成 ${stats?.analysisFps?.let { "%.1f".format(it) } ?: "0"} FPS · 丢帧 ${stats?.droppedFrames ?: 0}",
            "解码：zxing-cpp · 平均 ${stats?.averageDecodeMs?.let { "%.1f ms".format(it) } ?: "—"} · 单码命中 ${stats?.singleHits ?: 0} · 多码扫描 ${stats?.multiScans ?: 0}（命中 ${stats?.multiHits ?: 0}${perFrameLabel(stats)}）",
            "分析器：线程 ${stats?.workerCount ?: "?"} · 忙 ${stats?.workerBusy ?: "?"} · 空结果 ${stats?.emptyDecodes ?: 0} · 异常 ${stats?.decodeErrors ?: 0} · 新缓冲 ${stats?.bufferAllocations ?: 0}",
            "看门狗：恢复 ${stats?.pipelineRecoveries ?: 0} 次 · 心跳 ${if (lastStatsAt == 0L) "—" else "${(now - lastStatsAt).coerceAtLeast(0)} ms"}",
            "曝光：点测 $aeMeterCount · 补偿 $lastEvIndex · 轻推 $aeNudgeCount",
            "ROI：${roiLabel(stats)} · 连续未命中 ${stats?.roiMisses ?: 0} · 布局 ${layoutLabel(stats)}",
            "协议：二维码 ${decodedQrCount.get()} · AFL2 ${highFrameCount} · 唯一 ${highUniqueFrameCount} · 重复 ${highDuplicateCount} · 无效 ${invalidFrameCount.get()} · 错误 ${highProtocolErrors} · 队列 ${pendingProtocolFrames.get()} · 解块 ${lastHighSolved}/${lastHighTotal}",
            "高速会话：最近帧 ${highAge} · 唯一载荷 ${formatBytes(sessionUniquePayloadBytes)} · 光学 ${formatBytes(highBytesReceived)} · 速度 ${latestSpeedLabel} · 会话 ${formatRate(sessionAverageBytesPerSecond)}",
            "无效样本：$invalidFrameSample",
            "设备标识：${Build.FINGERPRINT}"
        )
        fullDiagnostics = lines.joinToString("\n")
        diagnosticsText.text = fullDiagnostics
    }

    private fun offerCompletedFile(session: String, name: String, mime: String, bytes: ByteArray) {
        val pending = PendingSave(name, mime, bytes)
        ContextCompat.getMainExecutor(this).execute {
            if (pendingSession == session) return@execute
            pendingSession = session
            pendingSave = pending
            saveButton.isEnabled = true
            fileText.text = "$name · ${formatBytes(bytes.size.toLong())}"
            progress.progress = 100
            stopScanner()
            showResult(pending)
        }
    }

    private fun savePendingFile() {
        val pending = pendingSave
        if (pending == null) {
            statusText.text = "还没有可保存的文件"
            return
        }
        val saved = saveFile(pending.name, pending.mime, pending.bytes)
        statusText.text = saved?.let { "已保存到 Download/AirFerry Lite/$it" } ?: "保存失败"
    }

    private fun roiLabel(stats: ScanStats?): String {
        val tiles = stats?.tileCount ?: 0
        return when {
            tiles >= 4 -> "格 4"
            tiles > 0 -> "格 $tiles"
            stats?.roiTracked == true -> "跟踪中"
            else -> "全图"
        }
    }

    private fun layoutLabel(stats: ScanStats?): String {
        val tiles = stats?.tileCount ?: 0
        return when {
            tiles >= 4 -> "四码"
            stats?.multiLayout == true -> "多码"
            else -> "单码"
        }
    }

    private fun perFrameLabel(stats: ScanStats?): String {
        val scans = stats?.multiScans ?: 0
        val hits = stats?.multiHits ?: 0
        if (scans <= 0 || hits <= 0) return ""
        return " · 每帧 %.2f".format(hits.toDouble() / scans)
    }

    private fun preferredFpsLabel(): String = activeCameraFps?.let { "${it.lower}-${it.upper}" } ?: "未知"

    private fun copyDiagnostics() {
        renderDiagnostics()
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("AirFerry Lite 诊断", fullDiagnostics.ifBlank { diagnosticsText.text }))
        statusText.text = "诊断信息已复制"
    }

    private fun resetSpeed() {
        lastHighFrameCount = 0
        speedWindowStartedAt = 0
        speedWindowBytes = 0
        speedBytesPerSecond = 0.0
        sessionStartedAt = 0
        sessionUniquePayloadBytes = 0
        sessionAverageBytesPerSecond = 0.0
        rollingCount = 0
        rollingIndex = 0
        rollingRates.fill(0.0)
        latestSpeedLabel = "实时 — · 平均 —"
    }

    private fun saveFile(name: String, mime: String, bytes: ByteArray): String? {
        val safeName = name.substringAfterLast('/').substringAfterLast('\\').ifBlank { "received.bin" }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AirFerry Lite")
        }
        return try {
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return null
            safeName
        } catch (_: Exception) {
            null
        }
    }

    private fun formatRate(value: Double) = when {
        value < 1024 -> "%.0f B/s".format(value)
        value < 1048576 -> "%.1f KB/s".format(value / 1024.0)
        else -> "%.2f MB/s".format(value / 1048576.0)
    }

    private fun formatBytes(size: Long) = when {
        size < 1024 -> "$size B"
        size < 1048576 -> "%.1f KB".format(size / 1024.0)
        else -> "%.1f MB".format(size / 1048576.0)
    }

    private fun markCameraHeld() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean(PREF_CAMERA_HELD, true).commit()
    }

    private fun reconcileCameraStateAfterReopen() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        if (prefs.getBoolean(PREF_CAMERA_HELD, false)) {
            // Force-kill often skips onDestroy; record HAL release before the next bind.
            markCameraReleased()
            pauseScanner()
            imageAnalysis = null
            boundCamera = null
            cameraProvider?.unbindAll()
        } else {
            prefs.edit().putBoolean(PREF_CAMERA_HELD, false).apply()
        }
    }

    private fun clearStaleCameraHeld() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val wasHeld = prefs.getBoolean(PREF_CAMERA_HELD, false)
        prefs.edit().putBoolean(PREF_CAMERA_HELD, false).apply()
        if (wasHeld) markCameraReleased()
    }

    private fun markCameraReleased() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putBoolean(PREF_CAMERA_HELD, false)
            .putLong(PREF_LAST_CAMERA_RELEASE_MS, System.currentTimeMillis())
            .commit()
    }

    private fun msUntilCameraBindAllowed(): Long {
        val lastRelease = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getLong(PREF_LAST_CAMERA_RELEASE_MS, 0L)
        if (lastRelease == 0L) return 0L
        return (lastRelease + CAMERA_HAL_COOLDOWN_MS - System.currentTimeMillis()).coerceAtLeast(0L)
    }

    private fun elapsedSinceCameraRelease(): Long {
        val lastRelease = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getLong(PREF_LAST_CAMERA_RELEASE_MS, 0L)
        if (lastRelease == 0L) return CAMERA_HAL_COOLDOWN_MS
        return (System.currentTimeMillis() - lastRelease).coerceAtLeast(0L)
    }

    override fun onDestroy() {
        watchdog.removeCallbacks(watchdogTick)
        watchdog.removeCallbacks(restartProgressTick)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (imageAnalysis != null || boundCamera != null) {
            markCameraReleased()
        }
        imageAnalysis?.clearAnalyzer()
        cameraProvider?.unbindAll()
        if (::frameAnalyzer.isInitialized) frameAnalyzer.close()
        if (::cameraExecutor.isInitialized) cameraExecutor.shutdownNow()
        if (::protocolExecutor.isInitialized) protocolExecutor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val CAMERA_PERMISSION_REQUEST = 42
        private const val HIGH_SPEED_HEADER_SIZE = 20
        private const val UI_REFRESH_INTERVAL_MS = 100L
        private const val SPEED_REFRESH_INTERVAL_MS = 1000L
        private const val PREFS_NAME = "airferry-lite"
        private const val PREF_FPS = "preview_fps"
        private const val PREF_AUTOSTART_SCAN = "autostart_scan"
        private const val PREF_AUTOSTART_FROM_CONTINUE = "autostart_from_continue"
        private const val PREF_AUTOSTART_BIND_DELAY_OVERRIDE_MS = "autostart_bind_delay_ms"
        private const val PREF_CAMERA_HELD = "camera_held"
        private const val PREF_LAST_CAMERA_RELEASE_MS = "camera_release_ms"
        private const val PREF_LAST_HAL_RECOVERY_MS = "last_hal_recovery_ms"
        private const val EXTRA_AUTOSTART_SCAN = "autostart_scan"
        private const val PROCESS_RESTART_DELAY_MS = 2000L
        private const val AUTOSTART_BIND_DELAY_MS = 2000L
        private const val CONTINUE_RESTART_MIN_MS = 400L
        private const val CAMERA_HAL_COOLDOWN_MS = 2000L
        private const val ANALYZER_SETTLE_MS = 1200L
        private const val HAL_EMPTY_BURST_MIN_FRAMES = 250L
        private const val HAL_EMPTY_BURST_RATIO = 0.80
        private const val HAL_EMPTY_BURST_MAX_UNIQUE = 25L
        private const val HAL_WARMUP_MS = 4000L
        private const val HAL_WARMUP_MIN_UNIQUE = 10L
        private const val HAL_RECOVERY_COOLDOWN_MS = 60_000L
        private const val WATCHDOG_INTERVAL_MS = 1000L
        private const val SCAN_STALL_MS = 2000L
        private const val RECOVER_COOLDOWN_MS = 5000L
        private const val RECOVER_BURST_WINDOW_MS = 30000L
        private const val MAX_RECOVER_BURST = 3
    }
}
