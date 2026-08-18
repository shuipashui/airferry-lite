package com.airferrylite.receiver

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
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
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var fileText: TextView
    private lateinit var speedText: TextView
    private lateinit var missingText: TextView
    private lateinit var progress: ProgressBar
    private lateinit var frameAnalyzer: QrFrameAnalyzer
    private lateinit var cameraExecutor: ExecutorService
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        previewView = findViewById(R.id.previewView)
        statusText = findViewById(R.id.statusText)
        fileText = findViewById(R.id.fileText)
        speedText = findViewById(R.id.speedText)
        missingText = findViewById(R.id.missingText)
        progress = findViewById(R.id.progress)
        cameraExecutor = Executors.newSingleThreadExecutor()
        frameAnalyzer = QrFrameAnalyzer { decoded ->
            ContextCompat.getMainExecutor(this).execute { handleResult(decoded) }
        }
        findViewById<Button>(R.id.resetButton).setOnClickListener { resetTransfer() }
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
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder().setResolutionStrategy(
                            ResolutionStrategy(
                                Size(1280, 720),
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                            )
                        ).build()
                    )
                    .setTargetRotation(rotation)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(cameraExecutor, frameAnalyzer)
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                statusText.text = "正在高速扫描"
            } catch (error: Exception) {
                cameraStarted = false
                statusText.text = "摄像头启动失败：${error.message ?: "未知错误"}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun handleResult(result: DecodedQr) {
        val bytes = result.bytes
        if (bytes != null && HighSpeedAssembler.looksLikeFrame(bytes)) {
            handleHighSpeedFrame(bytes)
            return
        }
        result.text?.let { handleFrame(it) }
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
        val update = highSpeedAssembler.accept(bytes)
        val now = SystemClock.elapsedRealtime()
        updateSpeed(update, bytes.size - HIGH_SPEED_HEADER_SIZE, now)
        val file = update.complete
        if (file == null && update.error == null && now - lastHighUiAt < UI_REFRESH_INTERVAL_MS) return
        lastHighUiAt = now
        fileText.text = if (file != null) "${file.name} · ${formatBytes(file.bytes.size.toLong())}" else "高速文件流"
        val percent = if (update.totalBlocks == 0) 0 else minOf(99, update.solvedBlocks * 100 / update.totalBlocks)
        progress.progress = if (file != null) 100 else percent
        missingText.text = if (file != null) {
            "SHA-256 校验通过"
        } else {
            "高速帧：${update.receivedFrames} · 已恢复块：${update.solvedBlocks}/${update.totalBlocks}"
        }
        statusText.text = when {
            update.error != null -> update.error
            file != null -> "接收完成，正在保存"
            else -> "高速接收中：$percent%"
        }
        if (file != null && update.session != null && lastSavedSession != "high:${update.session}") {
            lastSavedSession = "high:${update.session}"
            saveFile(file.name, file.mime, file.bytes)
        }
    }

    private fun updateSpeed(update: HighSpeedUpdate, payloadBytes: Int, now: Long) {
        if (update.receivedFrames < lastHighFrameCount) resetSpeed(now)
        val newFrames = update.receivedFrames - lastHighFrameCount
        lastHighFrameCount = update.receivedFrames
        if (newFrames <= 0) return
        if (speedWindowStartedAt == 0L) speedWindowStartedAt = now
        speedWindowBytes += newFrames.toLong() * payloadBytes.coerceAtLeast(0)
        val elapsed = now - speedWindowStartedAt
        if (elapsed < SPEED_REFRESH_INTERVAL_MS) return
        val sample = speedWindowBytes * 1000.0 / elapsed.coerceAtLeast(1)
        speedBytesPerSecond = if (speedBytesPerSecond == 0.0) sample else speedBytesPerSecond * 0.65 + sample * 0.35
        speedText.text = "实时速度：${formatRate(speedBytesPerSecond)}"
        speedWindowStartedAt = now
        speedWindowBytes = 0
    }

    private fun updateUi(update: TransferUpdate) {
        val meta = update.meta
        fileText.text = meta?.let { "${it.name} · ${formatBytes(it.originalSize)}" } ?: "未识别文件"
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
        highSpeedAssembler.reset()
        lastSavedSession = null
        lastHighUiAt = 0
        resetSpeed(SystemClock.elapsedRealtime())
        updateUi(TransferUpdate(null, 0, 0))
        progress.progress = 0
        speedText.text = "实时速度：—"
        missingText.text = "缺失片段：—"
        statusText.text = "正在高速扫描"
    }

    private fun resetSpeed(now: Long) {
        lastHighFrameCount = 0
        speedWindowStartedAt = now
        speedWindowBytes = 0
        speedBytesPerSecond = 0.0
    }

    private fun saveFile(meta: TransferMeta, bytes: ByteArray) = saveFile(meta.name, meta.mime, bytes)

    private fun saveFile(name: String, mime: String, bytes: ByteArray) {
        val safeName = name.substringAfterLast('/').substringAfterLast('\\').ifBlank { "received.bin" }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AirFerry Lite")
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        if (uri == null) {
            statusText.text = "保存失败"
            return
        }
        contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
        statusText.text = "已保存到 Download/AirFerry Lite/$safeName"
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
        super.onDestroy()
    }

    companion object {
        private const val CAMERA_PERMISSION_REQUEST = 42
        private const val HIGH_SPEED_HEADER_SIZE = 20
        private const val UI_REFRESH_INTERVAL_MS = 100L
        private const val SPEED_REFRESH_INTERVAL_MS = 400L
    }
}
