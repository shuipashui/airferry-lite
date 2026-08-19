package com.airferrylite.receiver

import kotlin.math.max

/** Downscales camera luma so Java ZXing sees ~3-5 pixels per QR module, not a 1440px HybridBinarizer. */
internal object LumaScaler {
    const val DECODE_MAX_SIDE = 800
    const val DOWNSCALE_THRESHOLD = 960

    fun scaleFactor(width: Int, height: Int, multiLayout: Boolean = false): Int {
        if (multiLayout) return 1
        val maxSide = max(width, height)
        if (maxSide <= DOWNSCALE_THRESHOLD) return 1
        return max(2, (maxSide + DECODE_MAX_SIDE - 1) / DECODE_MAX_SIDE)
    }

    fun downscale(source: ByteArray, width: Int, height: Int, scale: Int, output: ByteArray): Pair<Int, Int> {
        require(scale >= 1)
        val outWidth = width / scale
        val outHeight = height / scale
        require(output.size >= outWidth * outHeight)
        if (scale == 1) {
            source.copyInto(output, 0, 0, outWidth * outHeight)
            return outWidth to outHeight
        }
        val area = scale * scale
        var outputOffset = 0
        for (row in 0 until outHeight) {
            val sourceRow = row * scale
            for (column in 0 until outWidth) {
                val sourceColumn = column * scale
                var sum = 0
                for (dy in 0 until scale) {
                    val rowStart = (sourceRow + dy) * width + sourceColumn
                    for (dx in 0 until scale) {
                        sum += source[rowStart + dx].toInt() and 0xff
                    }
                }
                output[outputOffset++] = (sum / area).toByte()
            }
        }
        return outWidth to outHeight
    }
}
