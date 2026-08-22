package com.airferrylite.receiver

import android.Manifest
import android.content.ContentValues
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
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
    private lateinit var resultImage: ImageView
    private lateinit var resultMeta: TextView
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
        resultImage = findViewById(R.id.resultImage)
        resultMeta = findViewById(R.id.resultMeta)
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
                    renderDiagnostics()
                }
            }
        )
        findViewById<Button>(R.id.copyDiagnosticsButton).setOnClickListener { copyDiagnostics() }
        saveButton.setOnClickListener { savePendingFile() }
        watchdog.postDelayed(watchdogTick, WATCHDOG_INTERVAL_MS)
        showIdle()
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
        beginReceive()
    }

    private fun continueReceive() {
        resetTransfer()
        beginReceive()
    }

    private fun beginReceive() {
        showScanning()
        previewView.post { startScanner() }
    }

    private fun showIdle() {
        idlePanel.visibility = View.VISIBLE
        resultPanel.visibility = View.GONE
        scanMetaRow.visibility = View.GONE
        resetButton.visibility = View.GONE
        startReceiveButton.isEnabled = true
        statusText.text = "点「接收文件」开始扫描"
    }

    private fun showScanning() {
        idlePanel.visibility = View.GONE
        resultPanel.visibility = View.GONE
        scanMetaRow.visibility = View.VISIBLE
        resetButton.visibility = View.VISIBLE
        statusText.text = "请对准电脑二维码"
    }

    private fun showResult(pending: PendingSave) {
        idlePanel.visibility = View.GONE
        resultPanel.visibility = View.VISIBLE
        scanMetaRow.visibility = View.GONE
        resetButton.visibility = View.GONE
        resultMeta.text = "${pending.name} · ${formatBytes(pending.bytes.size.toLong())} · ${pending.mime.ifBlank { "未知类型" }}"
        val preview = previewBitmap(pending)
        if (preview != null) {
            resultImage.visibility = View.VISIBLE
            resultImage.setImageBitmap(preview)
        } else {
            resultImage.setImageDrawable(null)
            resultImage.visibility = View.GONE
        }
        statusText.text = "接收完成，可保存或继续接收"
    }

    private fun previewBitmap(pending: PendingSave) = try {
        val mime = pending.mime.lowercase()
        if (!mime.startsWith("image/")) null
        else BitmapFactory.decodeByteArray(pending.bytes, 0, pending.bytes.size)
    } catch (_: Throwable) {
        null
    }

    private fun stopScanner() {
        imageAnalysis?.clearAnalyzer()
        cameraProvider?.unbindAll()
        imageAnalysis = null
        cameraStarted = false
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (::frameAnalyzer.isInitialized) frameAnalyzer.setAnalysisIdle(true)
    }

    private fun startScanner() {
        if (isDestroyed) return
        if (cameraStarted && imageAnalysis != null) return
        cameraStarted = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (::frameAnalyzer.isInitialized) frameAnalyzer.setAnalysisIdle(false)
        val existing = cameraProvider
        if (existing != null) {
            bindCamera()
            return
        }
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                cameraProvider = providerFuture.get()
                if (cameraStarted && !isDestroyed) bindCamera()
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
            analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
            try {
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (preferredError: Exception) {
                if (fallbackFps == null || fallbackFps == preferredFps) throw preferredError
                analysis.clearAnalyzer()
                provider.unbindAll()
                activeFps = fallbackFps
                preview = buildPreview(rotation, activeFps)
                analysis = buildAnalysis(rotation, activeFps)
                analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                fellBack = true
            }
            imageAnalysis = analysis
            activeCameraFps = activeFps
            lastStatsAt = SystemClock.elapsedRealtime()
            val boundFps = activeFps
            statusText.text = if (boundFps != null && (fellBack || requestedFps !in boundFps.lower..boundFps.upper)) {
                "相机达不到 ${requestedFps} FPS，已落到 ${boundFps.lower}-${boundFps.upper}"
            } else {
                boundFps?.let { "正在高速扫描 · 相机 ${it.lower}-${it.upper} FPS" } ?: "正在高速扫描"
            }
            renderDiagnostics()
        } catch (error: Exception) {
            if (imageAnalysis == null) cameraStarted = false
            statusText.text = "摄像头启动失败：${error.message ?: "未知错误"}"
        } finally {
            bindingCamera = false
        }
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
        frameAnalyzer.resetSession()
        updateUi(TransferUpdate(null, 0, 0))
        fileText.text = "等待文件"
        progress.progress = 0
        speedText.text = "实时 — · 平均 —"
        missingText.text = "缺失片段：—"
        statusText.text = "正在高速扫描"
        if (::resultImage.isInitialized) resultImage.setImageDrawable(null)
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
        if (heartbeatDead) {
            if (now - recoverBurstStartedAt > RECOVER_BURST_WINDOW_MS) recoverBurst = 0
            if (recoverBurst == 0) recoverBurstStartedAt = now
            recoverBurst += 1
            if (recoverBurst > MAX_RECOVER_BURST) {
                statusText.text = "摄像头无画面，退出应用重开"
                return
            }
            restartScanner(countRecovery = true, forceRebind = true)
            statusText.text = "扫描卡住，已重启相机"
            return
        }
        if (asked) frameAnalyzer.replaceDecoders()
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
            tiles >= 2 -> "双码"
            stats?.multiLayout == true -> "多码未锁格"
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

    override fun onDestroy() {
        watchdog.removeCallbacks(watchdogTick)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
        private const val WATCHDOG_INTERVAL_MS = 1000L
        private const val SCAN_STALL_MS = 2000L
        private const val RECOVER_COOLDOWN_MS = 5000L
        private const val RECOVER_BURST_WINDOW_MS = 30000L
        private const val MAX_RECOVER_BURST = 3
    }
}
