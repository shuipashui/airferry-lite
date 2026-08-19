package com.airferrylite.receiver

import android.Manifest
import android.content.ContentValues
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.util.Range
import android.util.Size
import android.view.Surface
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
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

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var fileText: TextView
    private lateinit var speedText: TextView
    private lateinit var scanText: TextView
    private lateinit var missingText: TextView
    private lateinit var diagnosticsText: TextView
    private lateinit var progress: ProgressBar
    private lateinit var frameAnalyzer: QrFrameAnalyzer
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var protocolExecutor: ExecutorService
    private val assembler = TransferAssembler()
    private val highSpeedAssembler = HighSpeedAssembler()
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraStarted = false
    private var lastSavedSession: String? = null
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
        statusText = findViewById(R.id.statusText)
        fileText = findViewById(R.id.fileText)
        speedText = findViewById(R.id.speedText)
        scanText = findViewById(R.id.scanText)
        missingText = findViewById(R.id.missingText)
        diagnosticsText = findViewById(R.id.diagnosticsText)
        progress = findViewById(R.id.progress)
        cameraExecutor = Executors.newSingleThreadExecutor()
        protocolExecutor = Executors.newSingleThreadExecutor()
        frameAnalyzer = QrFrameAnalyzer(
            onDecoded = { decoded ->
                decodedQrCount.incrementAndGet()
                val bytes = decoded.bytes
                if (bytes != null && HighSpeedAssembler.looksLikeFrame(bytes)) {
                    highSpeedSessionActive = true
                    if (HighSpeedAssembler.isMultiLayoutFrame(bytes)) frameAnalyzer.setMultiLayout(true)
                    pendingProtocolFrames.incrementAndGet()
                    protocolExecutor.execute {
                        try {
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
                    scanText.text = "采集 %.0f · 分析 %.0f · 有效码 %.0f FPS · 丢帧 %d · %d×%d".format(
                        stats.captureFps,
                        stats.analysisFps,
                        stats.validQrFps,
                        stats.droppedFrames,
                        stats.width,
                        stats.height
                    )
                    renderDiagnostics()
                }
            }
        )
        findViewById<Button>(R.id.resetButton).setOnClickListener { resetTransfer() }
        findViewById<Button>(R.id.copyDiagnosticsButton).setOnClickListener { copyDiagnostics() }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
        } else {
            previewView.post { startScanner() }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_REQUEST && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            previewView.post { startScanner() }
        } else {
            statusText.text = "需要摄像头权限才能接收"
        }
    }

    private fun startScanner() {
        if (cameraStarted || isDestroyed) return
        cameraStarted = true
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                cameraProvider = provider
                val rotation = previewView.display?.rotation ?: Surface.ROTATION_0
                val preview = Preview.Builder().setTargetRotation(rotation).build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }
                val fpsRanges = cameraFpsRanges(provider)
                availableCameraFpsLabel = fpsRanges.joinToString(",") { "${it.lower}-${it.upper}" }.ifBlank { "未知" }
                highSpeedCameraFpsLabel = cameraHighSpeedFpsRanges(provider)
                val preferredFps = preferredCameraFpsRange(fpsRanges)
                val fallbackFps = fallbackCameraFpsRange(fpsRanges, preferredFps)
                var activeFps = preferredFps
                var analysis = buildAnalysis(rotation, activeFps)
                analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
                provider.unbindAll()
                try {
                    provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                } catch (preferredError: Exception) {
                    if (fallbackFps == null || fallbackFps == preferredFps) throw preferredError
                    provider.unbindAll()
                    activeFps = fallbackFps
                    analysis = buildAnalysis(rotation, activeFps)
                    analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
                    provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                }
                activeCameraFps = activeFps
                statusText.text = activeFps?.let { "正在高速扫描 · 相机 ${it.lower}-${it.upper} FPS" } ?: "正在高速扫描"
            } catch (error: Exception) {
                cameraStarted = false
                statusText.text = "摄像头启动失败：${error.message ?: "未知错误"}"
            }
        }, ContextCompat.getMainExecutor(this))
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

    private fun preferredCameraFpsRange(ranges: List<Range<Int>>): Range<Int>? {
        return listOf(120, 90, 60).asSequence()
            .mapNotNull { target -> ranges.firstOrNull { it.lower == target && it.upper == target } }
            .firstOrNull()
            ?: ranges.filter { it.lower <= 120 && it.upper >= 60 }
                .maxWithOrNull(compareBy<Range<Int>> { it.upper }.thenBy { it.lower })
            ?: ranges.maxWithOrNull(compareBy<Range<Int>> { it.upper }.thenBy { it.lower })
    }

    private fun fallbackCameraFpsRange(ranges: List<Range<Int>>, preferred: Range<Int>?): Range<Int>? =
        ranges.firstOrNull { it.lower == 30 && it.upper == 60 }
            ?: ranges.filter { it != preferred }.maxWithOrNull(compareBy<Range<Int>> { it.upper }.thenBy { it.lower })

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
        if (fpsRange != null) {
            Camera2Interop.Extender(builder).setCaptureRequestOption(
                CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                fpsRange
            )
        }
        return builder.build()
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
        if (update.complete != null && meta != null && lastSavedSession != meta.session) {
            lastSavedSession = meta.session
            saveFile(meta, update.complete)
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
                file != null -> "接收完成，正在保存"
                else -> "高速接收中：$percent%"
            }
            renderDiagnostics()
        }
        if (file != null && update.session != null && lastSavedSession != "high:${update.session}") {
            lastSavedSession = "high:${update.session}"
            val savedName = file.name
            val savedMime = file.mime
            val savedBytes = file.bytes
            val saved = saveFile(savedName, savedMime, savedBytes)
            ContextCompat.getMainExecutor(this).execute {
                statusText.text = saved?.let { "已保存到 Download/AirFerry Lite/$it" } ?: "保存失败"
            }
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
            update.complete != null -> "接收完成，正在保存"
            update.error != null -> update.error
            meta != null -> "兼容接收中：$percent%"
            else -> statusText.text
        }
    }

    private fun resetTransfer() {
        assembler.reset()
        protocolExecutor.execute { highSpeedAssembler.reset() }
        highSpeedSessionActive = false
        frameAnalyzer.resetSession()
        lastSavedSession = null
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
        updateUi(TransferUpdate(null, 0, 0))
        fileText.text = "等待文件"
        progress.progress = 0
        speedText.text = "实时 — · 平均 —"
        scanText.text = "扫描性能：等待取帧"
        missingText.text = "缺失片段：—"
        statusText.text = "正在高速扫描"
        renderDiagnostics()
    }

    private fun renderDiagnostics() {
        if (!::diagnosticsText.isInitialized) return
        val stats = lastStats
        val now = SystemClock.elapsedRealtime()
        val highAge = if (highLastFrameAt == 0L) "—" else "${(now - highLastFrameAt).coerceAtLeast(0)} ms"
        diagnosticsText.text = listOf(
            "设备：${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · App ${BuildConfig.VERSION_NAME}",
            "相机：${stats?.width ?: "?"}×${stats?.height ?: "?"} · 采集 ${stats?.captureFps?.let { "%.1f".format(it) } ?: "?"} FPS · 目标 ${preferredFpsLabel()}",
            "分析流 FPS：$availableCameraFpsLabel",
            "高速录像能力：$highSpeedCameraFpsLabel（CameraX 分析流不可直接使用）",
            "分析：提交 ${stats?.submittedFrames ?: 0} · 完成 ${stats?.analysisFps?.let { "%.1f".format(it) } ?: "0"} FPS · 丢帧 ${stats?.droppedFrames ?: 0}",
            "解码：zxing-cpp · 平均 ${stats?.averageDecodeMs?.let { "%.1f ms".format(it) } ?: "—"} · 单码命中 ${stats?.singleHits ?: 0} · 多码扫描 ${stats?.multiScans ?: 0}（命中 ${stats?.multiHits ?: 0}${perFrameLabel(stats)}）",
            "分析器：线程 ${stats?.workerCount ?: "?"} · 忙 ${stats?.workerBusy ?: "?"} · 空结果 ${stats?.emptyDecodes ?: 0} · 异常 ${stats?.decodeErrors ?: 0} · 新缓冲 ${stats?.bufferAllocations ?: 0}",
            "ROI：${if (stats?.roiTracked == true) "跟踪中" else "全图"} · 连续未命中 ${stats?.roiMisses ?: 0} · 布局 ${if (stats?.multiLayout == true) "四码" else "单码"}",
            "协议：二维码 ${decodedQrCount.get()} · AFL2 ${highFrameCount} · 唯一 ${highUniqueFrameCount} · 重复 ${highDuplicateCount} · 无效 ${invalidFrameCount.get()} · 错误 ${highProtocolErrors} · 队列 ${pendingProtocolFrames.get()} · 解块 ${lastHighSolved}/${lastHighTotal}",
            "高速会话：最近帧 ${highAge} · 接收字节 ${formatBytes(highBytesReceived)} · 速度 ${latestSpeedLabel} · 会话 ${formatRate(sessionAverageBytesPerSecond)}",
            "无效样本：$invalidFrameSample",
            "设备标识：${Build.FINGERPRINT}"
        ).joinToString("\n")
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
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("AirFerry Lite 诊断", diagnosticsText.text))
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

    private fun saveFile(meta: TransferMeta, bytes: ByteArray) {
        val saved = saveFile(meta.name, meta.mime, bytes)
        statusText.text = saved?.let { "已保存到 Download/AirFerry Lite/$it" } ?: "保存失败"
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
    }
}
