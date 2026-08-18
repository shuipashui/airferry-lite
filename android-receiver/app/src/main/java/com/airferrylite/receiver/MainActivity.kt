package com.airferrylite.receiver

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.ResultMetadataType
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

class MainActivity : AppCompatActivity() {
    private lateinit var barcodeView: DecoratedBarcodeView
    private lateinit var statusText: TextView
    private lateinit var fileText: TextView
    private lateinit var missingText: TextView
    private lateinit var progress: ProgressBar
    private val assembler = TransferAssembler()
    private val highSpeedAssembler = HighSpeedAssembler()
    private var lastSavedSession: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); setContentView(R.layout.activity_main)
        barcodeView = findViewById(R.id.barcodeView); statusText = findViewById(R.id.statusText); fileText = findViewById(R.id.fileText); missingText = findViewById(R.id.missingText); progress = findViewById(R.id.progress)
        barcodeView.barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
        findViewById<Button>(R.id.resetButton).setOnClickListener { assembler.reset(); highSpeedAssembler.reset(); lastSavedSession = null; updateUi(TransferUpdate(null, 0, 0)); statusText.text = "请对准电脑二维码" }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 42) else startScanner()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) { super.onRequestPermissionsResult(requestCode, permissions, grantResults); if (requestCode == 42 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startScanner() else statusText.text = "需要摄像头权限才能接收" }

    private fun startScanner() { barcodeView.decodeContinuous(object : BarcodeCallback { override fun barcodeResult(result: BarcodeResult?) { result?.let { handleResult(it) } } }); barcodeView.resume() }

    private fun handleResult(result: BarcodeResult) {
        val segments = result.result.resultMetadata?.get(ResultMetadataType.BYTE_SEGMENTS) as? Iterable<*>
        val bytes = segments?.filterIsInstance<ByteArray>()?.takeIf { it.isNotEmpty() }?.let { pieces ->
            ByteArray(pieces.sumOf { it.size }).also { output -> var offset = 0; for (piece in pieces) { piece.copyInto(output, offset); offset += piece.size } }
        }
        if (bytes != null && HighSpeedAssembler.looksLikeFrame(bytes)) {
            handleHighSpeedFrame(bytes)
            return
        }
        result.text?.let { handleFrame(it) }
    }

    private fun handleFrame(text: String) { val update = assembler.accept(text); updateUi(update); val meta = update.meta; if (update.complete != null && meta != null && lastSavedSession != meta.session) { lastSavedSession = meta.session; saveFile(meta, update.complete); } }
    private fun handleHighSpeedFrame(bytes: ByteArray) {
        val update = highSpeedAssembler.accept(bytes)
        val file = update.complete
        fileText.text = if (file != null) "${file.name} · ${formatBytes(file.bytes.size.toLong())}" else "高速文件流"
        val percent = if (update.totalBlocks == 0) 0 else minOf(99, update.solvedBlocks * 100 / update.totalBlocks)
        progress.progress = if (file != null) 100 else percent
        missingText.text = if (file != null) "SHA-256 校验通过" else "高速帧：${update.receivedFrames} · 已恢复块：${update.solvedBlocks}/${update.totalBlocks}"
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
    private fun updateUi(update: TransferUpdate) { val meta = update.meta; fileText.text = meta?.let { "${it.name} · ${formatBytes(it.originalSize)}" } ?: "未识别文件"; val percent = if (update.total == 0) 0 else update.received * 100 / update.total; progress.progress = percent; missingText.text = "缺失片段：" + assembler.missing().take(40).joinToString(",").ifBlank { "无" }; if (update.complete != null) statusText.text = "接收完成，正在保存" else if (update.error != null) statusText.text = update.error else if (meta != null) statusText.text = "接收中：$percent%" }

    private fun saveFile(meta: TransferMeta, bytes: ByteArray) = saveFile(meta.name, meta.mime, bytes)
    private fun saveFile(name: String, mime: String, bytes: ByteArray) { val safeName = name.substringAfterLast('/').substringAfterLast('\\').ifBlank { "received.bin" }; val values = ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, safeName); put(MediaStore.MediaColumns.MIME_TYPE, mime); put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AirFerry Lite") }; val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values); if (uri == null) { statusText.text = "保存失败"; return }; contentResolver.openOutputStream(uri)?.use { it.write(bytes) }; statusText.text = "已保存到 Download/AirFerry Lite/$safeName" }
    private fun formatBytes(size: Long) = if (size < 1024) "$size B" else if (size < 1048576) "%.1f KB".format(size / 1024.0) else "%.1f MB".format(size / 1048576.0)
    override fun onResume() { super.onResume(); if (::barcodeView.isInitialized && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) barcodeView.resume() }
    override fun onPause() { if (::barcodeView.isInitialized) barcodeView.pause(); super.onPause() }
}
