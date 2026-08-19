package com.airferrylite.receiver

import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.Result
import com.google.zxing.ResultMetadataType
import com.google.zxing.common.HybridBinarizer
import java.nio.ByteBuffer
import java.util.ArrayDeque
import java.util.EnumMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

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

private data class ScanRegion(val left: Int, val top: Int, val width: Int, val height: Int)
private data class LumaFrame(
    val bytes: ByteArray,
    val region: ScanRegion,
    val imageWidth: Int,
    val imageHeight: Int,
    val sequence: Long
)

/** Keeps CameraX non-blocking, reuses luma buffers and tracks the last decoded QR region. */
class QrFrameAnalyzer(
    private val onDecoded: (DecodedQr) -> Unit,
    private val onStats: (ScanStats) -> Unit = {}
) : ImageAnalysis.Analyzer {
    private val workerCount = (Runtime.getRuntime().availableProcessors() - 2).coerceIn(2, 4)
    private val decodeExecutor = Executors.newFixedThreadPool(workerCount)
    private val availableWorkers = Semaphore(workerCount)
    private val readers = ThreadLocal.withInitial {
        MultiFormatReader().apply { setHints(DECODE_HINTS) }
    }
    private val bufferPool = ArrayDeque<ByteArray>(workerCount + 2)
    private val multiLayout = AtomicBoolean(false)
    private val trackedRegion = AtomicReference<ScanRegion?>(null)
    private val roiMisses = AtomicInteger(0)
    private val frameSequence = AtomicLong(0)
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
    private val bufferAllocations = AtomicLong(0)
    private val statsWindowStartedAt = AtomicLong(SystemClock.elapsedRealtime())

    override fun analyze(image: ImageProxy) {
        capturedInWindow.incrementAndGet()
        reportStatsIfDue(image.width, image.height)
        if (!availableWorkers.tryAcquire()) {
            droppedFrames.incrementAndGet()
            image.close()
            return
        }

        val sequence = frameSequence.incrementAndGet()
        val region = chooseRegion(image.width, image.height, sequence)
        val bytes = acquireBuffer(region.width * region.height)
        val frame = try {
            val plane = image.planes[0]
            copyLumaRegion(plane.buffer, plane.rowStride, plane.pixelStride, region, bytes)
            LumaFrame(bytes, region, image.width, image.height, sequence)
        } catch (_: Exception) {
            releaseBuffer(bytes)
            availableWorkers.release()
            return
        } finally {
            image.close()
        }

        try {
            submittedFrames.incrementAndGet()
            decodeExecutor.execute {
                try {
                    val started = System.nanoTime()
                    val results = decode(frame)
                    decodeNanos.addAndGet(System.nanoTime() - started)
                    decodeSamples.incrementAndGet()
                    decodedInWindow.incrementAndGet()
                    if (results.isNotEmpty()) {
                        roiMisses.set(0)
                        validQrInWindow.addAndGet(results.size.toLong())
                        if (!multiLayout.get()) updateTrackedRegion(results, frame)
                        if (multiLayout.get() || frame.sequence % LEGACY_MULTI_SCAN_EVERY == 0L) {
                            multiHits.addAndGet(results.size.toLong())
                        } else {
                            singleHits.addAndGet(results.size.toLong())
                        }
                        results.forEach { onDecoded(toDecodedQr(it)) }
                    } else {
                        emptyDecodes.incrementAndGet()
                        if (trackedRegion.get() != null && roiMisses.incrementAndGet() >= ROI_MISS_LIMIT) {
                            trackedRegion.set(null)
                            roiMisses.set(0)
                        }
                    }
                } finally {
                    releaseBuffer(frame.bytes)
                    availableWorkers.release()
                }
            }
        } catch (_: RejectedExecutionException) {
            releaseBuffer(frame.bytes)
            availableWorkers.release()
        }
    }

    fun close() {
        decodeExecutor.shutdownNow()
        synchronized(bufferPool) { bufferPool.clear() }
    }

    fun setMultiLayout(enabled: Boolean) {
        if (multiLayout.getAndSet(enabled) != enabled) {
            trackedRegion.set(null)
            roiMisses.set(0)
        }
    }

    private fun chooseRegion(width: Int, height: Int, sequence: Long): ScanRegion {
        if (multiLayout.get()) {
            val side = min(width, height)
            return ScanRegion((width - side) / 2, (height - side) / 2, side, side)
        }
        val tracked = trackedRegion.get()
        if (tracked != null && sequence % FULL_SCAN_EVERY != 0L) return clampRegion(tracked, width, height)
        val side = min(width, height)
        return ScanRegion((width - side) / 2, (height - side) / 2, side, side)
    }

    private fun decode(frame: LumaFrame): List<Result> {
        val source = PlanarYUVLuminanceSource(
            frame.bytes,
            frame.region.width,
            frame.region.height,
            0,
            0,
            frame.region.width,
            frame.region.height,
            false
        )
        val reader = readers.get() ?: return emptyList()
        val sequence = frame.sequence
        return try {
            if (multiLayout.get()) {
                multiScans.incrementAndGet()
                return decodeQuadrants(frame, reader)
            }
            // Keep the hot path on ZXing's single-code decoder. A full
            // multi-code search is considerably more expensive on Android's
            // Java decoder and used to starve analysis at high camera FPS.
            if (sequence % LEGACY_MULTI_SCAN_EVERY != 0L) {
                listOf(reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))))
            } else {
                multiScans.incrementAndGet()
                try {
                    val multiple = com.google.zxing.multi.GenericMultipleBarcodeReader(reader)
                    multiple.decodeMultiple(BinaryBitmap(HybridBinarizer(source))).toList()
                } catch (_: Exception) {
                    decodeErrors.incrementAndGet()
                    reader.reset()
                    listOf(reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))))
                }
            }
        } catch (_: Exception) {
            decodeErrors.incrementAndGet()
            try {
                reader.reset()
                listOf(reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))))
            } catch (_: Exception) {
                decodeErrors.incrementAndGet()
                emptyList()
            }
        } finally {
            reader.reset()
        }
    }

    private fun decodeQuadrants(frame: LumaFrame, reader: MultiFormatReader): List<Result> {
        val width = frame.region.width
        val height = frame.region.height
        val halfWidth = width / 2
        val halfHeight = height / 2
        val output = ArrayList<Result>(4)
        for (row in 0..1) {
            for (column in 0..1) {
                val left = column * halfWidth
                val top = row * halfHeight
                val cropWidth = if (column == 0) halfWidth else width - left
                val cropHeight = if (row == 0) halfHeight else height - top
                try {
                    reader.reset()
                    val source = PlanarYUVLuminanceSource(
                        frame.bytes,
                        width,
                        height,
                        left,
                        top,
                        cropWidth,
                        cropHeight,
                        false
                    )
                    output += reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))
                } catch (_: Exception) {
                    // Quadrants are independent; preserve codes already found.
                }
            }
        }
        return output
    }

    private fun updateTrackedRegion(results: List<Result>, frame: LumaFrame) {
        val points = results.flatMap { it.resultPoints?.toList().orEmpty() }
            .filter { it.x.isFinite() && it.y.isFinite() }
        if (points.size < 2) return
        val minX = points.minOf { it.x.toDouble() }
        val maxX = points.maxOf { it.x.toDouble() }
        val minY = points.minOf { it.y.toDouble() }
        val maxY = points.maxOf { it.y.toDouble() }
        val spanX = max(32.0, maxX - minX)
        val spanY = max(32.0, maxY - minY)
        val marginX = spanX * ROI_MARGIN
        val marginY = spanY * ROI_MARGIN
        val left = frame.region.left + (minX - marginX).roundToInt()
        val top = frame.region.top + (minY - marginY).roundToInt()
        val right = frame.region.left + (maxX + marginX).roundToInt()
        val bottom = frame.region.top + (maxY + marginY).roundToInt()
        val candidate = ScanRegion(left, top, max(MIN_ROI_SIZE, right - left), max(MIN_ROI_SIZE, bottom - top))
        trackedRegion.set(clampRegion(candidate, frame.imageWidth, frame.imageHeight))
    }

    private fun clampRegion(region: ScanRegion, imageWidth: Int, imageHeight: Int): ScanRegion {
        val width = min(region.width, imageWidth)
        val height = min(region.height, imageHeight)
        val left = region.left.coerceIn(0, imageWidth - width)
        val top = region.top.coerceIn(0, imageHeight - height)
        return ScanRegion(left, top, width, height)
    }

    private fun toDecodedQr(result: Result): DecodedQr {
        val segments = result.resultMetadata?.get(ResultMetadataType.BYTE_SEGMENTS) as? Iterable<*>
        val pieces = segments?.filterIsInstance<ByteArray>().orEmpty()
        val bytes = when {
            pieces.isNotEmpty() -> ByteArray(pieces.sumOf { it.size }).also { output ->
                var offset = 0
                for (piece in pieces) {
                    piece.copyInto(output, offset)
                    offset += piece.size
                }
            }
            result.rawBytes?.isNotEmpty() == true -> result.rawBytes.copyOf()
            result.text != null -> result.text.toByteArray(Charsets.ISO_8859_1)
            else -> null
        }
        return DecodedQr(bytes, result.text)
    }

    private fun copyLumaRegion(source: ByteBuffer, rowStride: Int, pixelStride: Int, region: ScanRegion, output: ByteArray) {
        val input = source.duplicate()
        val inputStart = input.position()
        var outputOffset = 0
        for (row in 0 until region.height) {
            var inputOffset = inputStart + (region.top + row) * rowStride + region.left * pixelStride
            if (pixelStride == 1) {
                input.position(inputOffset)
                input.get(output, outputOffset, region.width)
                outputOffset += region.width
                continue
            }
            for (column in 0 until region.width) {
                output[outputOffset++] = input.get(inputOffset)
                inputOffset += pixelStride
            }
        }
    }

    private fun acquireBuffer(size: Int): ByteArray = synchronized(bufferPool) {
        val iterator = bufferPool.iterator()
        while (iterator.hasNext()) {
            val candidate = iterator.next()
            if (candidate.size >= size) {
                iterator.remove()
                return@synchronized candidate
            }
        }
        bufferAllocations.incrementAndGet()
        ByteArray(size)
    }

    private fun releaseBuffer(buffer: ByteArray) = synchronized(bufferPool) {
        if (bufferPool.size < workerCount + 2) bufferPool.addLast(buffer)
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
                workerCount = workerCount,
                workerBusy = workerCount - availableWorkers.availablePermits(),
                emptyDecodes = emptyDecodes.get(),
                decodeErrors = decodeErrors.get(),
                bufferAllocations = bufferAllocations.get(),
                roiMisses = roiMisses.get(),
                roiTracked = trackedRegion.get() != null,
                multiLayout = multiLayout.get()
            )
        )
    }

    companion object {
        private const val FULL_SCAN_EVERY = 24L
        // Probe for additional QR codes at a low cadence; single-code frames
        // remain fast enough to keep up with 60 FPS camera streams.
        private const val LEGACY_MULTI_SCAN_EVERY = 600L
        private const val ROI_MISS_LIMIT = 5
        private const val ROI_MARGIN = 0.35
        private const val MIN_ROI_SIZE = 320
        private const val STATS_INTERVAL_MS = 1000L
        private val DECODE_HINTS = EnumMap<DecodeHintType, Any>(DecodeHintType::class.java).apply {
            put(DecodeHintType.POSSIBLE_FORMATS, listOf(BarcodeFormat.QR_CODE))
            put(DecodeHintType.CHARACTER_SET, "ISO-8859-1")
        }
    }
}
