package com.airferrylite.receiver

import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.Result
import com.google.zxing.ResultMetadataType
import com.google.zxing.common.GlobalHistogramBinarizer
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
import kotlin.math.min

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
    val lumaWidth: Int,
    val lumaHeight: Int,
    val imageWidth: Int,
    val imageHeight: Int,
    val sequence: Long,
    val scale: Int = 1
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
    private val singleLayoutConfirmed = AtomicBoolean(false)
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
        val region = chooseRegion(image.width, image.height)
        val bytes = acquireBuffer(region.width * region.height)
        val frame = try {
            val plane = image.planes[0]
            copyLumaRegion(plane.buffer, plane.rowStride, plane.pixelStride, region, bytes)
            LumaFrame(bytes, region, region.width, region.height, image.width, image.height, sequence)
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
                var scaled = frame
                try {
                    val started = System.nanoTime()
                    scaled = maybeDownscale(frame)
                    val results = decode(frame, scaled)
                    decodeNanos.addAndGet(System.nanoTime() - started)
                    decodeSamples.incrementAndGet()
                    decodedInWindow.incrementAndGet()
                    if (results.isNotEmpty()) {
                        roiMisses.set(0)
                        validQrInWindow.addAndGet(results.size.toLong())
                        if (multiLayout.get()) {
                            multiHits.addAndGet(results.size.toLong())
                        } else {
                            singleHits.addAndGet(results.size.toLong())
                        }
                        results.forEach { onDecoded(toDecodedQr(it)) }
                    } else {
                        emptyDecodes.incrementAndGet()
                        roiMisses.incrementAndGet()
                    }
                } finally {
                    if (scaled.bytes !== frame.bytes) releaseBuffer(scaled.bytes)
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
            roiMisses.set(0)
            if (enabled) singleLayoutConfirmed.set(false)
        }
    }

    fun resetSession() {
        setMultiLayout(false)
        singleLayoutConfirmed.set(false)
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
        bufferAllocations.set(0)
        frameSequence.set(0)
    }

    private fun chooseRegion(width: Int, height: Int): ScanRegion {
        val side = min(width, height)
        return ScanRegion((width - side) / 2, (height - side) / 2, side, side)
    }

    private fun maybeDownscale(frame: LumaFrame): LumaFrame {
        val scale = LumaScaler.scaleFactor(frame.lumaWidth, frame.lumaHeight, multiLayout.get())
        if (scale == 1) return frame
        val outWidth = frame.lumaWidth / scale
        val outHeight = frame.lumaHeight / scale
        val scaled = acquireBuffer(outWidth * outHeight)
        LumaScaler.downscale(frame.bytes, frame.lumaWidth, frame.lumaHeight, scale, scaled)
        return frame.copy(bytes = scaled, lumaWidth = outWidth, lumaHeight = outHeight, scale = scale)
    }

    private fun decode(original: LumaFrame, scaled: LumaFrame): List<Result> {
        val reader = readers.get() ?: return emptyList()
        return try {
            if (multiLayout.get()) {
                multiScans.incrementAndGet()
                return decodeQuadrants(original, reader).filter { isTransferResult(it) }
            }
            val single = decodeSingle(reader, lumaSource(scaled))
            if (isMultiLayoutResult(single)) {
                lockMultiLayout()
                multiScans.incrementAndGet()
                val quads = decodeQuadrants(original, reader).filter { isTransferResult(it) }
                return quads.ifEmpty { listOf(single!!) }
            }
            if (isTransferResult(single)) {
                singleLayoutConfirmed.set(true)
                return listOf(single!!)
            }
            if (!singleLayoutConfirmed.get() && original.sequence % QUADRANT_PROBE_EVERY == 0L) {
                multiScans.incrementAndGet()
                val quads = decodeQuadrants(original, reader).filter { isTransferResult(it) }
                if (quads.size >= 2 || quads.any { isMultiLayoutResult(it) }) lockMultiLayout()
                if (quads.isNotEmpty()) return quads
            }
            emptyList()
        } catch (error: Exception) {
            if (error !is ReaderException) decodeErrors.incrementAndGet()
            emptyList()
        } finally {
            reader.reset()
        }
    }

    private fun lumaSource(frame: LumaFrame) = PlanarYUVLuminanceSource(
        frame.bytes,
        frame.lumaWidth,
        frame.lumaHeight,
        0,
        0,
        frame.lumaWidth,
        frame.lumaHeight,
        false
    )

    private fun lockMultiLayout() {
        if (!multiLayout.getAndSet(true)) {
            roiMisses.set(0)
            singleLayoutConfirmed.set(false)
        }
    }

    private fun decodeSingle(reader: MultiFormatReader, source: LuminanceSource): Result? {
        reader.reset()
        try {
            return reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))
        } catch (_: ReaderException) {
            // HybridBinarizer's 8×8 windows fight V40 modules that are ~8px
            // on a 1440p crop. Histogram fallback is cheap and better for
            // a bright, uniform laptop screen.
        }
        reader.reset()
        return try {
            reader.decodeWithState(BinaryBitmap(GlobalHistogramBinarizer(source)))
        } catch (_: ReaderException) {
            null
        }
    }

    private fun decodeQuadrants(frame: LumaFrame, reader: MultiFormatReader): List<Result> {
        val width = frame.lumaWidth
        val height = frame.lumaHeight
        val halfWidth = width / 2
        val halfHeight = height / 2
        val output = ArrayList<Result>(4)
        for (row in 0..1) {
            for (column in 0..1) {
                val left = column * halfWidth
                val top = row * halfHeight
                val cropWidth = if (column == 0) halfWidth else width - left
                val cropHeight = if (row == 0) halfHeight else height - top
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
                decodeSingle(reader, source)?.let { output += it }
            }
        }
        return output
    }

    private fun toDecodedQr(result: Result) = DecodedQr(payloadBytes(result), result.text)

    private fun payloadBytes(result: Result): ByteArray? {
        val segments = result.resultMetadata?.get(ResultMetadataType.BYTE_SEGMENTS) as? Iterable<*>
        val pieces = segments?.filterIsInstance<ByteArray>().orEmpty()
        return when {
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
    }

    private fun isTransferResult(result: Result?): Boolean {
        val bytes = result?.let { payloadBytes(it) } ?: return false
        return HighSpeedAssembler.looksLikeFrame(bytes) || isLegacyFrame(bytes)
    }

    private fun isMultiLayoutResult(result: Result?): Boolean {
        val bytes = result?.let { payloadBytes(it) } ?: return false
        return HighSpeedAssembler.isMultiLayoutFrame(bytes)
    }

    private fun isLegacyFrame(bytes: ByteArray) =
        bytes.size >= 5 &&
            bytes[0] == 'A'.code.toByte() &&
            bytes[1] == 'F'.code.toByte() &&
            bytes[2] == 'L'.code.toByte() &&
            bytes[3] == '1'.code.toByte() &&
            bytes[4] == '|'.code.toByte()

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
        if (bufferPool.size < workerCount * 4) bufferPool.addLast(buffer)
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
                roiTracked = false,
                multiLayout = multiLayout.get()
            )
        )
    }

    companion object {
        private const val QUADRANT_PROBE_EVERY = 8L
        private const val STATS_INTERVAL_MS = 1000L
        private val DECODE_HINTS = EnumMap<DecodeHintType, Any>(DecodeHintType::class.java).apply {
            put(DecodeHintType.POSSIBLE_FORMATS, listOf(BarcodeFormat.QR_CODE))
            put(DecodeHintType.CHARACTER_SET, "ISO-8859-1")
        }
    }
}
