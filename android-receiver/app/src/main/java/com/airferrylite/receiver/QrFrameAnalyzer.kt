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

/**
 * Latest-frame zxing-cpp scan on the CameraX analyzer thread.
 *
 * Layout model (same as main): only [multiLayout] + [singleLayoutConfirmed] + tracked tile count.
 * - Single: confirmed single → maxSymbols=1, one crop.
 * - Dual / quad: locked multi → tracked tiles (格 2 or 格 4) + quadrant fill when still short on codes.
 *   Dual fast path: 格 2, both codes in frame, and session is not quad → skip quadrant fill.
 *   Quad (170 KB/s): never take dual fast path when quadStream or sawThreeOrMore; always quadrant fill until 格 4.
 */
class QrFrameAnalyzer(
    private val onDecoded: (DecodedQr) -> Unit,
    private val onStats: (ScanStats) -> Unit = {}
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
    private val sawThreeOrMore = AtomicBoolean(false)
    private val quadStream = AtomicBoolean(false)
    private val dualStream = AtomicBoolean(false)
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

    fun resetTrackedTiles() {
        trackedRoi.set(null)
        trackedTiles.set(null)
        tileUndercount.set(0)
        roiMisses.set(0)
    }

    fun resetSession() {
        setMultiLayout(false)
        singleLayoutConfirmed.set(false)
        trackedRoi.set(null)
        trackedTiles.set(null)
        tileUndercount.set(0)
        sawThreeOrMore.set(false)
        quadStream.set(false)
        dualStream.set(false)
        resetProtocol()
    }

    fun noteStreamLayout(layoutCodes: Int) {
        when (layoutCodes) {
            2 -> {
                dualStream.set(true)
                quadStream.set(false)
                sawThreeOrMore.set(false)
                singleLayoutConfirmed.set(false)
            }
            4 -> {
                quadStream.set(true)
                dualStream.set(false)
                singleLayoutConfirmed.set(false)
            }
        }
    }

    private fun chooseRegion(width: Int, height: Int): ScanRegion {
        return ScanLayout.activeRegion(trackedRoi.get(), roiMisses.get(), width, height)
    }

    private fun decodeFrame(luma: LumaSnapshot, region: ScanRegion, maxSymbols: Int): List<NativeHit> {
        if (!multiLayout.get()) {
            if (maxSymbols > 1 && !singleLayoutConfirmed.get() && !quadStream.get()) {
                val merged = mutableListOf<NativeHit>()
                val seen = mutableSetOf<String>()
                fun add(hits: List<NativeHit>) {
                    for (hit in hits) {
                        val key = QrPayload.frameKey(QrPayload.bytesFrom(hit.bytes, hit.text)) ?: continue
                        if (seen.add(key)) merged += hit
                    }
                }
                add(readCropsParallel(luma, ScanLayout.dualHalves(region), retryBinarizer = false))
                if (transferCount(merged) < 2) {
                    add(decoder.read(luma, ScanLayout.centerSquare(luma.width, luma.height), 4))
                }
                return merged
            }
            return decoder.read(luma, region, maxSymbols)
        }
        val merged = mutableListOf<NativeHit>()
        val seen = mutableSetOf<String>()
        fun add(hits: List<NativeHit>) {
            for (hit in hits) {
                val key = QrPayload.frameKey(QrPayload.bytesFrom(hit.bytes, hit.text)) ?: continue
                if (seen.add(key)) merged += hit
            }
        }
        val previousTiles = trackedTiles.get().orEmpty().map {
            ScanLayout.clamp(it, luma.width, luma.height)
        }
        if (previousTiles.isNotEmpty()) {
            val tileCrops = if (previousTiles.size >= 2) {
                previousTiles.map { ScanLayout.inflate(it, 1.14f, luma.width, luma.height) }
            } else {
                previousTiles
            }
            val pendingTiles = tileCrops.filter { !tileCovered(it, merged, previousTiles) }
            val pending = if (
                dualStream.get() && !quadStream.get() &&
                previousTiles.size == 2 && transferCount(merged) < 2
            ) {
                val halves = ScanLayout.dualHalves(region)
                (pendingTiles + halves).take(TILE_WORKERS)
            } else {
                pendingTiles
            }
            if (pending.isNotEmpty()) {
                add(readCropsParallel(luma, pending, retryBinarizer = false))
            }
        }
        if (previousTiles.size in 2..3 && transferCount(merged) < 2) {
            if (dualStream.get() && !quadStream.get()) {
                add(readCropsParallel(luma, ScanLayout.dualHalves(region), retryBinarizer = false))
            } else {
                add(decoder.read(luma, ScanLayout.centerSquare(luma.width, luma.height), 4))
            }
        }
        if (transferCount(merged) >= 4) return merged
        if (previousTiles.size >= 4 && transferCount(merged) >= 3) return merged
        // Quad 格 4: parallel overlay + inflate only — serial 8-way was ~21 ms (0.8.68).
        // Must keep filling past 2 hits; early return at 2 codes caused ~1.98/frame (0.8.73).
        if (quadStream.get() && previousTiles.size >= 4) {
            if (transferCount(merged) < 4) {
                val exclusive = ScanLayout.exclusiveQuadrants(region)
                val overlays = ScanLayout.overlappingQuadrants(region)
                val pending = overlays.indices.mapNotNull { index ->
                    overlays[index].takeUnless { tileCovered(exclusive[index], merged, exclusive) }
                }
                if (pending.isNotEmpty()) {
                    add(readCropsParallel(luma, pending.take(TILE_WORKERS), retryBinarizer = false))
                }
            }
            if (transferCount(merged) >= 4) return merged
            if (transferCount(merged) >= 3) return merged
            if (transferCount(merged) < 4) {
                val exclusive = ScanLayout.exclusiveQuadrants(region)
                val retries = exclusive.mapNotNull { tile ->
                    if (tileCovered(tile, merged, exclusive)) null
                    else ScanLayout.inflate(tile, 1.28f, luma.width, luma.height)
                }
                if (retries.isNotEmpty()) {
                    add(readCropsParallel(luma, retries.take(TILE_WORKERS), retryBinarizer = true))
                }
            }
            return merged
        }
        if (!quadStream.get() && !sawThreeOrMore.get() && previousTiles.size < 2) {
            if (transferCount(merged) < 2) {
                add(readCropsParallel(luma, ScanLayout.dualHalves(region), retryBinarizer = false))
            }
            if (transferCount(merged) < 2) {
                add(decoder.read(luma, ScanLayout.centerSquare(luma.width, luma.height), 4))
            }
            if (dualFastPath(previousTiles.size, transferCount(merged))) return merged
            // Unconfirmed dual: never serial 8-way overlay (0.8.50 / HANDOVER).
            return merged
        }
        if (!quadStream.get() && !sawThreeOrMore.get() && previousTiles.size == 2) {
            if (transferCount(merged) < 2) {
                val retries = previousTiles.map { ScanLayout.inflate(it, 1.28f, luma.width, luma.height) }
                add(readCropsParallel(luma, retries, retryBinarizer = true))
            }
            if (transferCount(merged) < 2) {
                add(readCropsParallel(luma, ScanLayout.dualHalves(region), retryBinarizer = false))
            }
            if (dualFastPath(previousTiles.size, transferCount(merged))) return merged
        }
        if (dualFastPath(previousTiles.size, transferCount(merged))) return merged
        val exclusive = ScanLayout.exclusiveQuadrants(region)
        val overlays = ScanLayout.overlappingQuadrants(region)
        val pending = overlays.indices.mapNotNull { index ->
            overlays[index].takeUnless { tileCovered(exclusive[index], merged, exclusive) }
        }
        add(readCropsSerial(luma, pending, retryBinarizer = false))
        if (transferCount(merged) >= 4) return merged
        if (previousTiles.size >= 4 && transferCount(merged) >= 3) return merged
        if (dualFastPath(previousTiles.size, transferCount(merged))) return merged
        val retries = exclusive.mapNotNull { tile ->
            if (tileCovered(tile, merged, exclusive)) null
            else ScanLayout.inflate(tile, 1.28f, luma.width, luma.height)
        }
        add(readCropsSerial(luma, retries, retryBinarizer = true))
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
        skipUntilRecover.set(true)
    }

    private fun transferCount(hits: List<NativeHit>) =
        hits.count { QrPayload.isTransfer(QrPayload.bytesFrom(it.bytes, it.text)) }

    /** Skip 8-way quadrant fill only for settled dual (格 2). Quad must keep filling until 格 4. */
    private fun dualFastPath(lockedTiles: Int, transfers: Int): Boolean {
        if (lockedTiles != 2 || transfers < 2) return false
        if (quadStream.get() || sawThreeOrMore.get()) return false
        return true
    }

    private fun noteLayoutFromHits(hits: List<NativeHit>) {
        for (hit in hits) {
            val bytes = QrPayload.bytesFrom(hit.bytes, hit.text) ?: continue
            when {
                QrPayload.isQuadLayout(bytes) -> {
                    quadStream.set(true)
                    dualStream.set(false)
                    singleLayoutConfirmed.set(false)
                }
                QrPayload.isDualLayout(bytes) -> {
                    dualStream.set(true)
                    singleLayoutConfirmed.set(false)
                }
            }
        }
        if (dualStream.get()) {
            quadStream.set(false)
            sawThreeOrMore.set(false)
        }
    }

    private fun quadTileGrid(imageWidth: Int, imageHeight: Int): List<ScanRegion> {
        return ScanLayout.exclusiveQuadrants(ScanLayout.centerSquare(imageWidth, imageHeight))
    }

    private fun tileCovered(tile: ScanRegion, hits: List<NativeHit>, candidates: List<ScanRegion>): Boolean {
        if (hits.isEmpty() || candidates.isEmpty()) return false
        for (hit in hits) {
            if (hit.points.isEmpty()) continue
            val cx = (hit.originLeft + hit.points.map { it.first }.average()).toFloat()
            val cy = (hit.originTop + hit.points.map { it.second }.average()).toFloat()
            val owner = ScanLayout.ownerIndex(candidates, cx, cy)
            if (owner < 0) continue
            val owned = candidates[owner]
            if (owned.left == tile.left && owned.top == tile.top && owned.width == tile.width && owned.height == tile.height) {
                return true
            }
        }
        return false
    }

    private fun publish(imageWidth: Int, imageHeight: Int, region: ScanRegion, hits: List<NativeHit>) {
        val transferHits = hits.filter { QrPayload.isTransfer(QrPayload.bytesFrom(it.bytes, it.text)) }
        if (transferHits.isEmpty()) {
            emptyDecodes.incrementAndGet()
            val miss = roiMisses.incrementAndGet()
            val lockedTiles = trackedTiles.get()?.size ?: 0
            val missLimit = when {
                lockedTiles >= 4 -> 6
                quadStream.get() -> 6
                lockedTiles >= 2 -> 6
                else -> 2
            }
            if (miss >= missLimit) {
                if (lockedTiles < 2 && multiLayout.get() && !quadStream.get()) {
                    multiLayout.set(false)
                    trackedRoi.set(null)
                    singleLayoutConfirmed.set(false)
                }
                trackedTiles.set(null)
                tileUndercount.set(0)
            }
            return
        }
        roiMisses.set(0)
        validQrInWindow.addAndGet(transferHits.size.toLong())
        noteLayoutFromHits(transferHits)
        val hasDualLayout = transferHits.any { QrPayload.isDualLayout(QrPayload.bytesFrom(it.bytes, it.text)) }
        val hasQuadLayout = transferHits.any { QrPayload.isQuadLayout(QrPayload.bytesFrom(it.bytes, it.text)) }
        val lockedMulti = transferHits.size >= 2 || hasDualLayout || hasQuadLayout
        if (lockedMulti) {
            lockMultiLayout()
            if (transferHits.size >= 2) {
                multiHits.addAndGet(transferHits.size.toLong())
            }
        } else {
            val bytes = QrPayload.bytesFrom(transferHits.first().bytes, transferHits.first().text)
            when {
                QrPayload.isMultiLayout(bytes) -> singleLayoutConfirmed.set(false)
                bytes != null && HighSpeedAssembler.looksLikeFrame(bytes) -> {
                    // AFL2 file header (magic 0x0c) is not multi-layout but must not lock single-code scan.
                    singleLayoutConfirmed.set(false)
                }
                else -> singleLayoutConfirmed.set(true)
            }
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
            quadStream.get() -> {
                if (hits.size >= 3) sawThreeOrMore.set(true)
                tileUndercount.set(0)
                val grid = quadTileGrid(imageWidth, imageHeight)
                val base = previous?.takeIf { it.size >= 4 } ?: grid
                trackedTiles.set(
                    ScanLayout.followContainedHits(base, perCode, imageWidth, imageHeight)
                )
            }
            hits.size >= 3 -> {
                sawThreeOrMore.set(true)
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.tilesFromHits(perCode, imageWidth, imageHeight))
            }
            hits.size >= 2 && (previous == null || previous.size < 2) -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.tilesFromHits(perCode, imageWidth, imageHeight))
            }
            dualStream.get() && hits.size == 1 && (previous == null || previous.size < 2) -> {
                tileUndercount.set(0)
                val pair = ScanLayout.pairFromHit(perCode.first(), imageWidth, imageHeight)
                trackedTiles.set(
                    if (pair.size >= 2) pair
                    else ScanLayout.tilesFromHits(perCode, imageWidth, imageHeight)
                )
            }
            previous != null && previous.size >= 4 && hits.size < 2 -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.followContainedHits(previous, perCode, imageWidth, imageHeight))
            }
            previous != null && previous.size >= 2 && hits.size < 2 -> {
                if (tileUndercount.incrementAndGet() >= TILE_UNDERCOUNT_LIMIT) {
                    trackedTiles.set(null)
                    trackedRoi.set(null)
                    tileUndercount.set(0)
                }
            }
            previous != null && previous.size >= 2 -> {
                tileUndercount.set(0)
            }
            previous != null && previous.isNotEmpty() -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.followContainedHits(previous, perCode, imageWidth, imageHeight))
            }
            hits.size >= 2 -> {
                tileUndercount.set(0)
                trackedTiles.set(ScanLayout.tilesFromHits(perCode, imageWidth, imageHeight))
            }
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
        private const val TILE_UNDERCOUNT_LIMIT = 3
    }
}
