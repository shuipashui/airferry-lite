package com.airferrylite.receiver

import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
    private val tileDecoders = Array(TILE_WORKERS) { NativeQrDecoder() }
    private val tileExecutor = Executors.newFixedThreadPool(TILE_WORKERS)
    private val workerBusy = AtomicInteger(0)
    private val multiLayout = AtomicBoolean(false)
    private val singleLayoutConfirmed = AtomicBoolean(false)
    private val trackedRoi = AtomicReference<ScanRegion?>(null)
    private val trackedTiles = AtomicReference<List<ScanRegion>?>(null)
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

    fun close() {
        tileExecutor.shutdownNow()
        runCatching { tileExecutor.awaitTermination(200, TimeUnit.MILLISECONDS) }
    }

    fun setMultiLayout(enabled: Boolean) {
        if (multiLayout.getAndSet(enabled) != enabled) {
            roiMisses.set(0)
            if (enabled) singleLayoutConfirmed.set(false) else {
                trackedRoi.set(null)
                trackedTiles.set(null)
            }
        }
    }

    fun resetSession() {
        setMultiLayout(false)
        singleLayoutConfirmed.set(false)
        trackedRoi.set(null)
        trackedTiles.set(null)
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
        return ScanLayout.activeRegion(trackedRoi.get(), roiMisses.get(), width, height)
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
        val previousTiles = trackedTiles.get().orEmpty().map {
            ScanLayout.clamp(it, image.width, image.height)
        }
        if (previousTiles.isNotEmpty()) {
            add(readCropsParallel(image, previousTiles.filter { !tileCovered(it, merged) }, retryBinarizer = false))
        }
        if (transferCount(merged) >= 4) return merged
        val exclusive = ScanLayout.exclusiveQuadrants(region)
        val overlays = ScanLayout.overlappingQuadrants(region)
        val pending = overlays.indices.mapNotNull { index ->
            overlays[index].takeUnless { tileCovered(exclusive[index], merged) }
        }
        add(readCropsSerial(image, pending, retryBinarizer = false))
        if (transferCount(merged) >= 4) return merged
        val retries = exclusive.mapNotNull { tile ->
            if (tileCovered(tile, merged)) null
            else ScanLayout.inflate(tile, 1.28f, image.width, image.height)
        }
        add(readCropsSerial(image, retries, retryBinarizer = true))
        return merged
    }

    private fun readCropsParallel(
        image: ImageProxy,
        crops: List<ScanRegion>,
        retryBinarizer: Boolean
    ): List<NativeHit> {
        if (crops.isEmpty()) return emptyList()
        if (crops.size == 1) return tileDecoders[0].read(image, crops[0], 1, retryBinarizer)
        val jobs = crops.take(TILE_WORKERS)
        workerBusy.set(jobs.size)
        return try {
            jobs.mapIndexed { index, crop ->
                tileExecutor.submit(Callable {
                    tileDecoders[index].read(image, crop, 1, retryBinarizer)
                })
            }.flatMap { it.get() }
        } finally {
            workerBusy.set(0)
        }
    }

    private fun readCropsSerial(
        image: ImageProxy,
        crops: List<ScanRegion>,
        retryBinarizer: Boolean
    ): List<NativeHit> {
        if (crops.isEmpty()) return emptyList()
        val hits = mutableListOf<NativeHit>()
        for (crop in crops) {
            hits += decoder.read(image, crop, 1, retryBinarizer)
            if (transferCount(hits) >= 4) break
        }
        return hits
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
            if (roiMisses.incrementAndGet() >= 2) trackedTiles.set(null)
            return
        }
        roiMisses.set(0)
        validQrInWindow.addAndGet(transferHits.size.toLong())
        val lockedMulti = transferHits.any { QrPayload.isMultiLayout(QrPayload.bytesFrom(it.bytes, it.text)) } ||
            transferHits.size >= 2
        if (lockedMulti) {
            lockMultiLayout()
            multiHits.addAndGet(transferHits.size.toLong())
        } else {
            singleLayoutConfirmed.set(true)
            singleHits.addAndGet(transferHits.size.toLong())
        }
        rememberRoi(imageWidth, imageHeight, transferHits)
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
            coverGrid = multiLayout.get() && hits.size < 4
        )?.let { next ->
            trackedRoi.set(
                when {
                    hits.size >= 4 -> next
                    hits.size >= 3 -> ScanLayout.union(
                        trackedRoi.get() ?: ScanLayout.centerSquare(imageWidth, imageHeight),
                        next,
                        imageWidth,
                        imageHeight
                    )
                    else -> ScanLayout.centerSquare(imageWidth, imageHeight)
                }
            )
        }
        if (multiLayout.get() && hits.size >= 3) {
            val perCode = hits.map { hit ->
                hit.points.map { (x, y) -> (hit.originLeft + x) to (hit.originTop + y) }
            }
            trackedTiles.set(ScanLayout.tilesFromHits(perCode, imageWidth, imageHeight))
        } else if (hits.size < 2) {
            trackedTiles.set(null)
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
                workerCount = TILE_WORKERS,
                workerBusy = workerBusy.get(),
                emptyDecodes = emptyDecodes.get(),
                decodeErrors = decodeErrors.get(),
                bufferAllocations = 0,
                roiMisses = roiMisses.get(),
                roiTracked = trackedRoi.get() != null && roiMisses.get() < ScanLayout.ROI_MISS_LIMIT,
                multiLayout = multiLayout.get()
            )
        )
    }

    companion object {
        private const val STATS_INTERVAL_MS = 1000L
        private const val TILE_WORKERS = 4
    }
}
