package com.airferrylite.receiver

import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

data class DecodedQr(val bytes: ByteArray?, val text: String?)
data class ScanStats(
    val captureFps: Double,
    val analysisFps: Double,
    val validQrFps: Double,
    val droppedFrames: Long,
    val width: Int,
    val height: Int,
    val submittedFrames: Long,
    val multiScans: Long,
    val multiHits: Long,
    val singleHits: Long,
    val averageDecodeMs: Double,
    val workerCount: Int,
    val workerBusy: Int,
    val emptyDecodes: Long,
    val decodeErrors: Long,
    val bufferAllocations: Long,
    val roiMisses: Int,
    val roiTracked: Boolean,
    val multiLayout: Boolean
)

/** Latest-frame zxing-cpp scan on the CameraX analyzer thread. */
class QrFrameAnalyzer(
    private val onDecoded: (DecodedQr) -> Unit,
    private val onStats: (ScanStats) -> Unit = {}
) : ImageAnalysis.Analyzer {
    private val decoder = NativeQrDecoder()
    private val multiLayout = AtomicBoolean(false)
    private val singleLayoutConfirmed = AtomicBoolean(false)
    private val trackedRoi = AtomicReference<ScanRegion?>(null)
    private val roiMisses = AtomicInteger(0)
    private val capturedInWindow = AtomicLong(0)
    private val decodedInWindow = AtomicLong(0)
    private val validQrInWindow = AtomicLong(0)
    private val droppedFrames = AtomicLong(0)
    private val submittedFrames = AtomicLong(0)
    private val multiScans = AtomicLong(0)
    private val multiHits = AtomicLong(0)
    private val singleHits = AtomicLong(0)
    private val decodeNanos = AtomicLong(0)
    private val decodeSamples = AtomicLong(0)
    private val emptyDecodes = AtomicLong(0)
    private val decodeErrors = AtomicLong(0)
    private val statsWindowStartedAt = AtomicLong(SystemClock.elapsedRealtime())

    override fun analyze(image: ImageProxy) {
        capturedInWindow.incrementAndGet()
        reportStatsIfDue(image.width, image.height)
        try {
            val region = chooseRegion(image.width, image.height)
            val maxSymbols = if (multiLayout.get() || !singleLayoutConfirmed.get()) 4 else 1
            if (maxSymbols > 1) multiScans.incrementAndGet()
            submittedFrames.incrementAndGet()
            val started = System.nanoTime()
            val hits = try {
                decodeFrame(image, region, maxSymbols)
            } catch (_: Exception) {
                decodeErrors.incrementAndGet()
                emptyList()
            }
            decodeNanos.addAndGet(System.nanoTime() - started)
            decodeSamples.incrementAndGet()
            decodedInWindow.incrementAndGet()
            publish(image.width, image.height, region, hits)
        } finally {
            image.close()
        }
    }

    fun close() = Unit

    fun setMultiLayout(enabled: Boolean) {
        if (multiLayout.getAndSet(enabled) != enabled) {
            roiMisses.set(0)
            if (enabled) singleLayoutConfirmed.set(false) else trackedRoi.set(null)
        }
    }

    fun resetSession() {
        setMultiLayout(false)
        singleLayoutConfirmed.set(false)
        trackedRoi.set(null)
        roiMisses.set(0)
        droppedFrames.set(0)
        submittedFrames.set(0)
        multiScans.set(0)
        multiHits.set(0)
        singleHits.set(0)
        decodeNanos.set(0)
        decodeSamples.set(0)
        emptyDecodes.set(0)
        decodeErrors.set(0)
    }

    private fun chooseRegion(width: Int, height: Int): ScanRegion {
        return ScanLayout.centerSquare(width, height)
    }

    private fun decodeFrame(image: ImageProxy, region: ScanRegion, maxSymbols: Int): List<NativeHit> {
        if (!multiLayout.get()) return decoder.read(image, region, maxSymbols)
        val merged = mutableListOf<NativeHit>()
        val seen = mutableSetOf<String>()
        fun add(hits: List<NativeHit>) {
            for (hit in hits) {
                val key = QrPayload.frameKey(QrPayload.bytesFrom(hit.bytes, hit.text)) ?: continue
                if (seen.add(key)) merged += hit
            }
        }
        val overlays = ScanLayout.overlappingQuadrants(region)
        val tiles = ScanLayout.exclusiveQuadrants(region)
        for (index in overlays.indices) {
            if (transferCount(merged) >= 4) break
            if (tileCovered(tiles[index], merged)) continue
            add(decoder.read(image, overlays[index], 1))
        }
        if (transferCount(merged) < 4) add(decoder.read(image, region, 4))
        return merged
    }

    private fun transferCount(hits: List<NativeHit>) =
        hits.count { QrPayload.isTransfer(QrPayload.bytesFrom(it.bytes, it.text)) }

    private fun tileCovered(tile: ScanRegion, hits: List<NativeHit>): Boolean {
        for (hit in hits) {
            if (hit.points.isEmpty()) continue
            val cx = hit.originLeft + hit.points.map { it.first }.average()
            val cy = hit.originTop + hit.points.map { it.second }.average()
            if (cx >= tile.left && cx < tile.left + tile.width && cy >= tile.top && cy < tile.top + tile.height) return true
        }
        return false
    }

    private fun publish(imageWidth: Int, imageHeight: Int, region: ScanRegion, hits: List<NativeHit>) {
        val transferHits = hits.filter { QrPayload.isTransfer(QrPayload.bytesFrom(it.bytes, it.text)) }
        if (transferHits.isEmpty()) {
            emptyDecodes.incrementAndGet()
            roiMisses.incrementAndGet()
            return
        }
        roiMisses.set(0)
        validQrInWindow.addAndGet(transferHits.size.toLong())
        rememberRoi(imageWidth, imageHeight, transferHits)
        val lockedMulti = transferHits.any { QrPayload.isMultiLayout(QrPayload.bytesFrom(it.bytes, it.text)) } ||
            transferHits.size >= 2
        if (lockedMulti) {
            lockMultiLayout()
            multiHits.addAndGet(transferHits.size.toLong())
        } else {
            singleLayoutConfirmed.set(true)
            singleHits.addAndGet(transferHits.size.toLong())
        }
        transferHits.forEach { onDecoded(DecodedQr(QrPayload.bytesFrom(it.bytes, it.text), it.text)) }
    }

    private fun lockMultiLayout() {
        if (!multiLayout.getAndSet(true)) {
            roiMisses.set(0)
            singleLayoutConfirmed.set(false)
        }
    }

    private fun rememberRoi(imageWidth: Int, imageHeight: Int, hits: List<NativeHit>) {
        val points = ArrayList<Pair<Float, Float>>(hits.size * 4)
        for (hit in hits) {
            for ((x, y) in hit.points) {
                points += (hit.originLeft + x) to (hit.originTop + y)
            }
        }
        ScanLayout.regionFromPoints(
            points,
            imageWidth,
            imageHeight,
            hits.size,
            coverGrid = true
        )?.let { next ->
            trackedRoi.set(ScanLayout.union(trackedRoi.get(), next, imageWidth, imageHeight))
        }
    }

    private fun reportStatsIfDue(width: Int, height: Int) {
        val now = SystemClock.elapsedRealtime()
        val startedAt = statsWindowStartedAt.get()
        val elapsed = now - startedAt
        if (elapsed < STATS_INTERVAL_MS || !statsWindowStartedAt.compareAndSet(startedAt, now)) return
        val captured = capturedInWindow.getAndSet(0)
        val decoded = decodedInWindow.getAndSet(0)
        val validQr = validQrInWindow.getAndSet(0)
        onStats(
            ScanStats(
                captureFps = captured * 1000.0 / elapsed.coerceAtLeast(1),
                analysisFps = decoded * 1000.0 / elapsed.coerceAtLeast(1),
                validQrFps = validQr * 1000.0 / elapsed.coerceAtLeast(1),
                droppedFrames = droppedFrames.get(),
                width = width,
                height = height,
                submittedFrames = submittedFrames.get(),
                multiScans = multiScans.get(),
                multiHits = multiHits.get(),
                singleHits = singleHits.get(),
                averageDecodeMs = decodeNanos.get() / 1_000_000.0 / decodeSamples.get().coerceAtLeast(1),
                workerCount = 1,
                workerBusy = 0,
                emptyDecodes = emptyDecodes.get(),
                decodeErrors = decodeErrors.get(),
                bufferAllocations = 0,
                roiMisses = roiMisses.get(),
                roiTracked = multiLayout.get() && trackedRoi.get() != null && roiMisses.get() < ScanLayout.ROI_MISS_LIMIT,
                multiLayout = multiLayout.get()
            )
        )
    }

    companion object {
        private const val STATS_INTERVAL_MS = 1000L
    }
}
