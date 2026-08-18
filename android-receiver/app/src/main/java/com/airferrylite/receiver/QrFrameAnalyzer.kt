package com.airferrylite.receiver

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
import java.util.EnumMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import kotlin.math.min

data class DecodedQr(val bytes: ByteArray?, val text: String?)

/** Copies fresh camera luma frames into a small worker pool and drops stale frames while all workers are busy. */
class QrFrameAnalyzer(private val onDecoded: (DecodedQr) -> Unit) : ImageAnalysis.Analyzer {
    private val workerCount = (Runtime.getRuntime().availableProcessors() - 1).coerceIn(2, 3)
    private val decodeExecutor = Executors.newFixedThreadPool(workerCount)
    private val availableWorkers = Semaphore(workerCount)
    private val readers = ThreadLocal.withInitial {
        MultiFormatReader().apply { setHints(DECODE_HINTS) }
    }

    override fun analyze(image: ImageProxy) {
        if (!availableWorkers.tryAcquire()) {
            image.close()
            return
        }
        val width = image.width
        val height = image.height
        val plane = image.planes[0]
        val luma = try {
            copyLuma(plane.buffer, width, height, plane.rowStride, plane.pixelStride)
        } catch (_: Exception) {
            availableWorkers.release()
            return
        } finally {
            image.close()
        }
        try {
            decodeExecutor.execute {
                try {
                    decode(luma, width, height)?.let(onDecoded)
                } finally {
                    availableWorkers.release()
                }
            }
        } catch (_: RejectedExecutionException) {
            availableWorkers.release()
        }
    }

    fun close() {
        decodeExecutor.shutdownNow()
    }

    private fun decode(luma: ByteArray, width: Int, height: Int): DecodedQr? {
        val side = min(width, height)
        val left = (width - side) / 2
        val top = (height - side) / 2
        val source = PlanarYUVLuminanceSource(luma, width, height, left, top, side, side, false)
        val reader = readers.get() ?: return null
        return try {
            toDecodedQr(reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))))
        } catch (_: Exception) {
            null
        } finally {
            reader.reset()
        }
    }

    private fun toDecodedQr(result: Result): DecodedQr {
        val segments = result.resultMetadata?.get(ResultMetadataType.BYTE_SEGMENTS) as? Iterable<*>
        val pieces = segments?.filterIsInstance<ByteArray>().orEmpty()
        val bytes = if (pieces.isEmpty()) null else ByteArray(pieces.sumOf { it.size }).also { output ->
            var offset = 0
            for (piece in pieces) {
                piece.copyInto(output, offset)
                offset += piece.size
            }
        }
        return DecodedQr(bytes, result.text)
    }

    private fun copyLuma(
        source: java.nio.ByteBuffer,
        width: Int,
        height: Int,
        rowStride: Int,
        pixelStride: Int
    ): ByteArray {
        val input = source.duplicate()
        val output = ByteArray(width * height)
        if (pixelStride == 1 && rowStride == width) {
            input.position(0)
            input.get(output, 0, min(output.size, input.remaining()))
            return output
        }
        val inputStart = input.position()
        var outputOffset = 0
        for (row in 0 until height) {
            var inputOffset = inputStart + row * rowStride
            for (column in 0 until width) {
                output[outputOffset++] = input.get(inputOffset)
                inputOffset += pixelStride
            }
        }
        return output
    }

    companion object {
        private val DECODE_HINTS = EnumMap<DecodeHintType, Any>(DecodeHintType::class.java).apply {
            put(DecodeHintType.POSSIBLE_FORMATS, listOf(BarcodeFormat.QR_CODE))
            put(DecodeHintType.CHARACTER_SET, "ISO-8859-1")
        }
    }
}
