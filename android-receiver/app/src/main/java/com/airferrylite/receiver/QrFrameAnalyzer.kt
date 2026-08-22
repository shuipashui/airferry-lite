package com.airferrylite.receiver

import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import java.nio.ByteBuffer
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
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
    val multiLayout: Boolean,
    val tileCount: Int,
    val pipelineRecoveries: Long
)

/** Latest-frame zxing-cpp scan on the CameraX analyzer thread. */
class QrFrameAnalyzer(
    private val onDecoded: (DecodedQr) -> Unit,
    private val onStats: (ScanStats) -> Unit = {},
    private val onHighContrastMiss: () -> Unit = {}
) : ImageAnalysis.Analyzer {
    @Volatile private var decoder = NativeQrDecoder()
    @Volatile private var tileDecoders = Array(TILE_WORKERS) { NativeQrDecoder() }
    @Volatile private var decodeExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    @Volatile private var tileExecutor: ExecutorService = Executors.newFixedThreadPool(TILE_WORKERS)
    private val workerBusy = AtomicInteger(0)
    private val skipUntilRecover = AtomicBoolean(false)
    private val analysisIdle = AtomicBoolean(false)
    private val recoverRequested = AtomicBoolean(false)
    private val pipelineRecoveries = AtomicLong(0)
    private val lastImageTimestamp = AtomicLong(0)
    private val staleTimestampFrames = AtomicInteger(0)
    private val lumaLock = Any()
    @Volatile private var lumaScratch: ByteBuffer? = null
    private val multiLayout = AtomicBoolean(false)
    private val singleLayoutConfirmed = AtomicBoolean(false)
    private val trackedRoi = AtomicReference<ScanRegion?>(null)
    private val trackedTiles = AtomicReference<List<ScanRegion>?>(null)
    private val tileUndercount = AtomicInteger(0)
    private val twoTileStreak = AtomicInteger(0)
    private val sawThreeOrMore = AtomicBoolean(false)
    private val dualSettled = AtomicBoolean(false)
    private val dualLayout = AtomicBoolean(false)
    private val dualHint = AtomicBoolean(false)
    private val highContrastMissStreak = AtomicInteger(0)
    private val nudgeOnAnyEmpty = AtomicBoolean(false)
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
        if (skipUntilRecover.get()) {
            droppedFrames.incrementAndGet()
            image.close()
            return
        }
        if (analysisIdle.get()) {
            image.close()
            return
        }
        noteImageTimestamp(image.imageInfo.timestamp)
        val snapshot = try {
            captureLuma(image)
        } catch (_: Exception) {
            decodeErrors.incrementAndGet()
            image.close()
            return
        }
        image.close()
        val region = chooseRegion(snapshot.width, snapshot.height)
        val maxSymbols = if (multiLayout.get() || !singleLayoutConfirmed.get()) 4 else 1
        if (maxSymbols > 1) multiScans.incrementAndGet()
        submittedFrames.incrementAndGet()
        val started = System.nanoTime()
        val hits = try {
            decodeExecutor.submit(Callable { decodeFrame(snapshot, region, maxSymbols) })
                .get(FRAME_DECODE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            requestRecover()
            emptyList()
        } catch (_: Exception) {
            decodeErrors.incrementAndGet()
            emptyList()
        }
        decodeNanos.addAndGet(System.nanoTime() - started)
        decodeSamples.incrementAndGet()
        decodedInWindow.incrementAndGet()
        publish(snapshot.width, snapshot.height, region, hits)
        val transfers = transferCount(hits)
        if (transfers == 0) noteHighContrastMiss(snapshot)
        else highContrastMissStreak.set(0)
    }

    fun close() {
        skipUntilRecover.set(true)
        decodeExecutor.shutdownNow()
        tileExecutor.shutdownNow()
        runCatching { decodeExecutor.awaitTermination(200, TimeUnit.MILLISECONDS) }
        runCatching { tileExecutor.awaitTermination(200, TimeUnit.MILLISECONDS) }
    }

    fun consumeRecoverRequest(): Boolean = recoverRequested.getAndSet(false)

    fun isPaused(): Boolean = skipUntilRecover.get()

    fun setAnalysisIdle(idle: Boolean) {
        analysisIdle.set(idle)
    }

    fun setNudgeOnAnyEmpty(enabled: Boolean) {
        nudgeOnAnyEmpty.set(enabled)
    }

    fun replaceDecoders() {
        decoder = NativeQrDecoder()
        tileDecoders = Array(TILE_WORKERS) { NativeQrDecoder() }
        synchronized(lumaLock) { lumaScratch = null }
    }

    fun recoverPipeline(count: Boolean = false) {
        skipUntilRecover.set(true)
        val oldDecode = decodeExecutor
        val oldTiles = tileExecutor
        decodeExecutor = Executors.newSingleThreadExecutor()
        tileExecutor = Executors.newFixedThreadPool(TILE_WORKERS)
        decoder = NativeQrDecoder()
        tileDecoders = Array(TILE_WORKERS) { NativeQrDecoder() }
        oldDecode.shutdownNow()
        oldTiles.shutdownNow()
        runCatching { oldDecode.awaitTermination(200, TimeUnit.MILLISECONDS) }
        runCatching { oldTiles.awaitTermination(200, TimeUnit.MILLISECONDS) }
        synchronized(lumaLock) { lumaScratch = null }
        analysisIdle.set(false)
        resetSession()
        lastImageTimestamp.set(0)
        staleTimestampFrames.set(0)
        recoverRequested.set(false)
        skipUntilRecover.set(false)
        if (count) pipelineRecoveries.incrementAndGet()
    }

    fun setMultiLayout(enabled: Boolean) {
        if (multiLayout.getAndSet(enabled) != enabled) {
            roiMisses.set(0)
            if (enabled) singleLayoutConfirmed.set(false) else {
                trackedRoi.set(null)
                trackedTiles.set(null)
                tileUndercount.set(0)
                dualLayout.set(false)
                dualSettled.set(false)
                dualHint.set(false)
            }
        }
    }

    fun resetProtocol() {
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
        lastImageTimestamp.set(0)
        staleTimestampFrames.set(0)
        recoverRequested.set(false)
        skipUntilRecover.set(false)
        analysisIdle.set(false)
    }

    fun resetSession() {
        setMultiLayout(false)
        singleLayoutConfirmed.set(false)
        trackedRoi.set(null)
        trackedTiles.set(null)
        tileUndercount.set(0)
        twoTileStreak.set(0)
        sawThreeOrMore.set(false)
        dualSettled.set(false)
        dualLayout.set(false)
        dualHint.set(false)
        highContrastMissStreak.set(0)
        resetProtocol()
    }

    private fun chooseRegion(width: Int, height: Int): ScanRegion {
        return ScanLayout.activeRegion(trackedRoi.get(), roiMisses.get(), width, height)
    }

    private fun decodeFrame(luma: LumaSnapshot, region: ScanRegion, maxSymbols: Int): List<NativeHit> {
        val merged = mutableListOf<NativeHit>()
        val seen = mutableSetOf<String>()
        fun add(hits: List<NativeHit>) {
            for (hit in hits) {
                val key = QrPayload.frameKey(QrPayload.bytesFrom(hit.bytes, hit.text)) ?: continue
                if (seen.add(key)) merged += hit
            }
        }
        fun acquireDualSibling() {
            val square = ScanLayout.centerSquare(luma.width, luma.height)
            if (transferCount(merged) < 2) {
                add(readCropsParallel(luma, ScanLayout.dualHalves(square), retryBinarizer = false))
            }
            if (transferCount(merged) >= 2) return
            val exclusive = ScanLayout.exclusiveQuadrants(square)
            val overlays = ScanLayout.overlappingQuadrants(square)
            val pending = overlays.indices.mapNotNull { index ->
                overlays[index].takeUnless { tileCovered(exclusive[index], merged, exclusive) }
            }
            add(readCropsSerial(luma, pending, retryBinarizer = false))
            if (transferCount(merged) >= 2) return
            val retries = exclusive.mapNotNull { tile ->
                if (tileCovered(tile, merged, exclusive)) null
                else ScanLayout.inflate(tile, 1.28f, luma.width, luma.height)
            }
            add(readCropsSerial(luma, retries, retryBinarizer = true))
        }
        // Unconfirmed: cheap max4, then at most parallel halves. A 1-hit 0x1c
        // must not run acquireDualSibling — that serial 8-way dropped first-from-blank
        // to 16.4 ms / 35 FPS / 38 KB/s and never produced 2-in-one-frame (0.8.53).
        // Empty-frame serial after dualHint was worse (0.8.52: 20.6 ms / 5 KB/s).
        // Lock dual only when the same frame already has two transfer hits.
        if (!multiLayout.get()) {
            add(decoder.read(luma, region, maxSymbols))
            if (
                transferCount(merged) == 1 &&
                (dualHint.get() || anyDualLayout(merged) || anyMultiLayout(merged))
            ) {
                add(
                    readCropsParallel(
                        luma,
                        ScanLayout.dualHalves(ScanLayout.centerSquare(luma.width, luma.height)),
                        retryBinarizer = false
                    )
                )
            }
            return merged
        }
        val previousTiles = trackedTiles.get().orEmpty().map {
            ScanLayout.clamp(it, luma.width, luma.height)
        }
        if (previousTiles.isNotEmpty()) {
            add(readCropsParallel(luma, previousTiles.filter { !tileCovered(it, merged, previousTiles) }, retryBinarizer = false))
        }
        // Dual header (layoutCodes=2): never run the 8-way quad fill. Old
        // layoutCodes=4 dual still settles after six 2-of-2 frames.
        if (dualLayout.get() || dualTilesSettled(previousTiles.size)) {
            if (previousTiles.size < 2) {
                add(decoder.read(luma, ScanLayout.centerSquare(luma.width, luma.height), 4))
                if (transferCount(merged) == 1) acquireDualSibling()
            } else if (transferCount(merged) >= 2) {
                return merged
            } else {
                val missed = previousTiles.mapNotNull { tile ->
                    if (tileCovered(tile, merged, previousTiles)) null
                    else ScanLayout.inflate(tile, 1.28f, luma.width, luma.height)
                }
                add(readCropsParallel(luma, missed, retryBinarizer = true))
                if (transferCount(merged) < 2) {
                    val halves = ScanLayout.dualHalves(region)
                    add(readCropsParallel(luma, halves.filter { !tileCovered(it, merged, halves) }, retryBinarizer = true))
                }
            }
            return merged
        }
        // Dual: a 1-of-2 miss plus 1440px max4 drops analysis to ~28 FPS (0.8.35).
        // Quad: 格 2 must still run quadrant fill (0.8.36 returned here → ~84 KB/s).
        // max4 only while tiles are still below two.
        if (previousTiles.size < 2) {
            add(decoder.read(luma, ScanLayout.centerSquare(luma.width, luma.height), 4))
            if (transferCount(merged) < 2) {
                add(readCropsParallel(luma, ScanLayout.dualHalves(ScanLayout.centerSquare(luma.width, luma.height)), retryBinarizer = false))
            }
        }
        if (transferCount(merged) >= 4) return merged
        if (previousTiles.size >= 4 && transferCount(merged) >= 3) return merged
        val exclusive = ScanLayout.exclusiveQuadrants(region)
        val overlays = ScanLayout.overlappingQuadrants(region)
        val pending = overlays.indices.mapNotNull { index ->
            overlays[index].takeUnless { tileCovered(exclusive[index], merged, exclusive) }
        }
        add(readCropsSerial(luma, pending, retryBinarizer = false))
        if (transferCount(merged) >= 4) return merged
        if (previousTiles.size >= 4 && transferCount(merged) >= 3) return merged
        val retries = exclusive.mapNotNull { tile ->
            if (tileCovered(tile, merged, exclusive)) null
            else ScanLayout.inflate(tile, 1.28f, luma.width, luma.height)
        }
        add(readCropsSerial(luma, retries, retryBinarizer = true))
        if (transferCount(merged) < 2 && previousTiles.size >= 2) {
            val halves = ScanLayout.dualHalves(region)
            add(readCropsParallel(luma, halves.filter { !tileCovered(it, merged, halves) }, retryBinarizer = true))
        }
        return merged
    }

    private fun readCropsParallel(
        luma: LumaSnapshot,
        crops: List<ScanRegion>,
        retryBinarizer: Boolean
    ): List<NativeHit> {
        if (crops.isEmpty()) return emptyList()
        if (crops.size == 1) return tileDecoders[0].read(luma, crops[0], 1, retryBinarizer)
        val jobs = crops.take(TILE_WORKERS)
        workerBusy.set(jobs.size)
        return try {
            jobs.mapIndexed { index, crop ->
                tileExecutor.submit(Callable {
                    tileDecoders[index].read(luma, crop, 1, retryBinarizer)
                })
            }.flatMap { it.get() }
        } finally {
            workerBusy.set(0)
        }
    }

    private fun readCropsSerial(
        luma: LumaSnapshot,
        crops: List<ScanRegion>,
        retryBinarizer: Boolean
    ): List<NativeHit> {
        if (crops.isEmpty()) return emptyList()
        val hits = mutableListOf<NativeHit>()
        for (crop in crops) {
            hits += decoder.read(luma, crop, 1, retryBinarizer)
            if (transferCount(hits) >= 4) break
        }
        return hits
    }

    private fun captureLuma(image: ImageProxy): LumaSnapshot {
        val plane = image.planes[0]
        val source = plane.buffer.duplicate().apply { rewind() }
        val size = source.remaining()
        val copy = synchronized(lumaLock) {
            val existing = lumaScratch
            if (existing != null && existing.capacity() >= size) {
                existing.clear()
                existing.limit(size)
                existing
            } else {
                ByteBuffer.allocateDirect(size).also { lumaScratch = it }
            }
        }
        copy.put(source)
        copy.position(0)
        copy.limit(size)
        return LumaSnapshot(
            copy.slice(),
            plane.rowStride,
            plane.pixelStride.coerceAtLeast(1),
            image.width,
            image.height
        )
    }

    private fun noteImageTimestamp(timestamp: Long) {
        if (timestamp == 0L) return
        val previous = lastImageTimestamp.getAndSet(timestamp)
        if (previous != 0L && previous == timestamp) {
            if (staleTimestampFrames.incrementAndGet() >= STALE_TIMESTAMP_LIMIT) requestRecover()
        } else {
            staleTimestampFrames.set(0)
        }
    }

    private fun requestRecover() {
        decodeErrors.incrementAndGet()
        recoverRequested.set(true)
    }

    private fun transferCount(hits: List<NativeHit>) =
        hits.count { QrPayload.isTransfer(QrPayload.bytesFrom(it.bytes, it.text)) }

    private fun tileCovered(tile: ScanRegion, hits: List<NativeHit>, candidates: List<ScanRegion>): Boolean {
        if (hits.isEmpty() || candidates.isEmpty()) return false
        for (hit in hits) {
            if (hit.points.isEmpty()) continue
            val cx = (hit.originLeft + hit.points.map { it.first }.average()).toFloat()
            val cy = (hit.originTop + hit.points.map { it.second }.average()).toFloat()
            val owner = ScanLayout.ownerIndex(candidates, cx, cy)
            if (owner < 0) continue
            val owned = candidates[owner]
            if (owned.left == tile.left && owned.top == tile.top && owned.width == tile.width && owned.height == tile.height) return true
        }
        return false
    }

    private fun publish(imageWidth: Int, imageHeight: Int, region: ScanRegion, hits: List<NativeHit>) {
        val transferHits = hits.filter { QrPayload.isTransfer(QrPayload.bytesFrom(it.bytes, it.text)) }
        if (transferHits.isEmpty()) {
            emptyDecodes.incrementAndGet()
            val miss = roiMisses.incrementAndGet()
            val lockedTiles = trackedTiles.get()?.size ?: 0
            val missLimit = if (lockedTiles >= 2) 6 else 2
            if (miss >= missLimit) {
                trackedTiles.set(null)
                trackedRoi.set(null)
                tileUndercount.set(0)
                twoTileStreak.set(0)
                dualSettled.set(false)
                sawThreeOrMore.set(false)
                dualLayout.set(false)
                dualHint.set(false)
                multiLayout.set(false)
                singleLayoutConfirmed.set(false)
            }
            return
        }
        roiMisses.set(0)
        validQrInWindow.addAndGet(transferHits.size.toLong())
        if (anyDualLayout(transferHits)) dualHint.set(true)
        if (transferHits.size >= 2 && dualHint.get()) {
            lockDualLayout()
            multiHits.addAndGet(transferHits.size.toLong())
        } else if (transferHits.size >= 2) {
            lockMultiLayout()
            multiHits.addAndGet(transferHits.size.toLong())
        } else if (dualHint.get() || anyMultiLayout(transferHits)) {
            singleLayoutConfirmed.set(false)
        } else {
            singleLayoutConfirmed.set(true)
            singleHits.addAndGet(transferHits.size.toLong())
        }
        rememberRoi(imageWidth, imageHeight, transferHits)
        transferHits.forEach { onDecoded(DecodedQr(QrPayload.bytesFrom(it.bytes, it.text), it.text)) }
    }

    private fun lockDualLayout() {
        lockMultiLayout()
        dualLayout.set(true)
        dualSettled.set(true)
        sawThreeOrMore.set(false)
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
        val existingRoi = trackedRoi.get()
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
                        existingRoi ?: ScanLayout.centerSquare(imageWidth, imageHeight),
                        next,
                        imageWidth,
                        imageHeight
                    )
                    multiLayout.get() && hits.size >= 2 -> next
                    multiLayout.get() -> existingRoi
                    else -> ScanLayout.centerSquare(imageWidth, imageHeight)
                }
            )
        }
        if (!multiLayout.get()) return
        val previous = trackedTiles.get()
        val perCode = hits.map { hit ->
            hit.points.map { (x, y) -> (hit.originLeft + x) to (hit.originTop + y) }
        }
        when {
            hits.size >= 2 -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.tilesFromHits(perCode, imageWidth, imageHeight))
            }
            previous != null && previous.size >= 2 && hits.size < 2 -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.followContainedHits(previous, perCode, imageWidth, imageHeight))
            }
            previous != null && previous.isNotEmpty() -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.followContainedHits(previous, perCode, imageWidth, imageHeight))
            }
        }
        if (hits.size >= 3) {
            sawThreeOrMore.set(true)
            dualSettled.set(false)
            twoTileStreak.set(0)
            return
        }
        val locked = trackedTiles.get()?.size ?: 0
        if (hits.size == 2 && locked == 2) {
            if (twoTileStreak.incrementAndGet() >= DUAL_SETTLE_FRAMES) dualSettled.set(true)
        } else {
            twoTileStreak.set(0)
        }
    }

    private fun dualTilesSettled(tileCount: Int): Boolean {
        return tileCount == 2 && dualSettled.get() && !sawThreeOrMore.get()
    }

    private fun noteHighContrastMiss(luma: LumaSnapshot) {
        val looksQr = LumaContrast.looksLikeDenseQr(luma)
        if (!looksQr && !nudgeOnAnyEmpty.get()) {
            highContrastMissStreak.set(0)
            return
        }
        val streak = highContrastMissStreak.incrementAndGet()
        if (streak > 0 && streak % HIGH_CONTRAST_MISS_PULSE == 0) onHighContrastMiss()
    }

    private fun anyDualLayout(hits: List<NativeHit>): Boolean {
        for (hit in hits) {
            if (QrPayload.isDualLayout(QrPayload.bytesFrom(hit.bytes, hit.text))) return true
        }
        return false
    }

    private fun anyMultiLayout(hits: List<NativeHit>): Boolean {
        for (hit in hits) {
            if (QrPayload.isMultiLayout(QrPayload.bytesFrom(hit.bytes, hit.text))) return true
        }
        return false
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
                multiLayout = multiLayout.get(),
                tileCount = trackedTiles.get()?.size ?: 0,
                pipelineRecoveries = pipelineRecoveries.get()
            )
        )
    }

    companion object {
        private const val STATS_INTERVAL_MS = 1000L
        private const val TILE_WORKERS = 4
        private const val FRAME_DECODE_TIMEOUT_MS = 400L
        private const val STALE_TIMESTAMP_LIMIT = 12
        private const val DUAL_SETTLE_FRAMES = 6
        private const val HIGH_CONTRAST_MISS_PULSE = 24
    }
}
