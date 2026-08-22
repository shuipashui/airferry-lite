package com.airferrylite.receiver

internal object LumaContrast {
    fun looksLikeDenseQr(luma: LumaSnapshot): Boolean {
        val buffer = luma.buffer.duplicate().apply { rewind() }
        val limit = buffer.limit()
        val stepX = 32.coerceAtMost(luma.width.coerceAtLeast(1))
        val stepY = 32.coerceAtMost(luma.height.coerceAtLeast(1))
        var samples = 0
        var dark = 0
        var bright = 0
        var y = 0
        while (y < luma.height) {
            val row = y * luma.rowStride
            var x = 0
            while (x < luma.width) {
                val index = row + x * luma.pixelStride
                if (index in 0 until limit) {
                    val value = buffer.get(index).toInt() and 0xff
                    samples += 1
                    if (value < 48) dark += 1
                    else if (value > 208) bright += 1
                }
                x += stepX
            }
            y += stepY
        }
        if (samples < 40) return false
        return dark * 100 / samples >= 12 && bright * 100 / samples >= 18
    }
}
