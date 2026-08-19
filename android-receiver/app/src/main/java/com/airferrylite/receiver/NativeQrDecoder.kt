package com.airferrylite.receiver

import androidx.camera.core.ImageProxy
import java.lang.reflect.Method
import java.nio.ByteBuffer
import zxingcpp.BarcodeReader

internal data class NativeHit(
    val bytes: ByteArray?,
    val text: String?,
    val points: List<Pair<Float, Float>>,
    val originLeft: Int = 0,
    val originTop: Int = 0
)

/**
 * CameraX Y-plane reader on top of zxing-cpp. The published Kotlin wrapper only
 * exposes ImageProxy.read() (which rotates) so we call the Y-buffer JNI with
 * rotation 0, matching the Java ZXing path that already worked on this device.
 */
internal class NativeQrDecoder {
    private val reader = BarcodeReader().apply {
        options.formats = setOf(BarcodeReader.Format.QR_CODE)
        options.tryHarder = false
        options.tryRotate = false
        options.tryInvert = false
        options.tryDownscale = false
        options.isPure = false
        options.binarizer = BarcodeReader.Binarizer.LOCAL_AVERAGE
        options.textMode = BarcodeReader.TextMode.PLAIN
        options.maxNumberOfSymbols = 4
        options.returnErrors = false
    }
    private var packed: ByteBuffer? = null

    fun read(image: ImageProxy, region: ScanRegion, maxSymbols: Int): List<NativeHit> {
        reader.options.maxNumberOfSymbols = maxSymbols.coerceIn(1, 4)
        val plane = image.planes[0]
        val source = plane.buffer
        reader.options.binarizer = BarcodeReader.Binarizer.LOCAL_AVERAGE
        var results = readOnce(plane, source, region)
        if (results.isEmpty()) {
            reader.options.binarizer = BarcodeReader.Binarizer.GLOBAL_HISTOGRAM
            results = readOnce(plane, source, region)
        }
        return results.mapNotNull { toHit(it, region.left, region.top) }
    }

    private fun readOnce(
        plane: ImageProxy.PlaneProxy,
        source: ByteBuffer,
        region: ScanRegion
    ): List<BarcodeReader.Result> {
        return if (plane.pixelStride == 1 && source.isDirect && source.position() == 0) {
            invokeReadY(source, plane.rowStride, region.left, region.top, region.width, region.height)
        } else {
            val packedBuffer = acquirePacked(region.width * region.height)
            copyPacked(source, plane.rowStride, plane.pixelStride, region, packedBuffer)
            invokeReadY(packedBuffer, region.width, 0, 0, region.width, region.height)
        }
    }

    private fun acquirePacked(size: Int): ByteBuffer {
        val existing = packed
        if (existing != null && existing.capacity() >= size) {
            existing.clear()
            existing.limit(size)
            return existing
        }
        val created = ByteBuffer.allocateDirect(size)
        packed = created
        return created
    }

    @Suppress("UNCHECKED_CAST")
    private fun invokeReadY(
        yBuffer: ByteBuffer,
        rowStride: Int,
        left: Int,
        top: Int,
        width: Int,
        height: Int
    ): List<BarcodeReader.Result> {
        val raw = READ_Y_BUFFER.invoke(
            reader,
            yBuffer,
            rowStride,
            left,
            top,
            width,
            height,
            0,
            reader.options
        ) as? List<BarcodeReader.Result>
        return raw.orEmpty()
    }

    private fun toHit(result: BarcodeReader.Result, originLeft: Int, originTop: Int): NativeHit? {
        if (result.error != null || result.format != BarcodeReader.Format.QR_CODE) return null
        val position = result.position
        return NativeHit(
            bytes = result.bytes,
            text = result.text,
            points = listOf(
                position.topLeft.x.toFloat() to position.topLeft.y.toFloat(),
                position.topRight.x.toFloat() to position.topRight.y.toFloat(),
                position.bottomRight.x.toFloat() to position.bottomRight.y.toFloat(),
                position.bottomLeft.x.toFloat() to position.bottomLeft.y.toFloat()
            ),
            originLeft = originLeft,
            originTop = originTop
        )
    }

    private fun copyPacked(
        source: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        region: ScanRegion,
        output: ByteBuffer
    ) {
        val input = source.duplicate()
        val inputStart = input.position()
        output.clear()
        val rowBytes = ByteArray(region.width)
        for (row in 0 until region.height) {
            var inputOffset = inputStart + (region.top + row) * rowStride + region.left * pixelStride
            if (pixelStride == 1) {
                input.position(inputOffset)
                input.get(rowBytes)
                output.put(rowBytes)
                continue
            }
            for (column in 0 until region.width) {
                output.put(input.get(inputOffset))
                inputOffset += pixelStride
            }
        }
        output.position(0)
    }

    companion object {
        private val READ_Y_BUFFER: Method = BarcodeReader::class.java.getDeclaredMethod(
            "readYBuffer",
            ByteBuffer::class.java,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            BarcodeReader.Options::class.java
        ).apply { isAccessible = true }
    }
}
