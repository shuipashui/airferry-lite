package com.airferrylite.receiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

class LumaContrastTest {
    @Test
    fun wallIsNotDenseQr() {
        assertFalse(LumaContrast.looksLikeDenseQr(filled(128)))
    }

    @Test
    fun screenQrIsDense() {
        assertTrue(
            LumaContrast.looksLikeDenseQr(
                patterned { x, y -> if ((x / 8 + y / 8) % 2 == 0) 0 else 255 }
            )
        )
    }

    @Test
    fun dualWhiteBottomStillCounts() {
        assertTrue(
            LumaContrast.looksLikeDenseQr(
                patterned { x, y ->
                    if (y >= 72) 255
                    else if ((x / 6 + y / 6) % 2 == 0) 16 else 240
                }
            )
        )
    }

    private fun filled(value: Int): LumaSnapshot {
        val width = 160
        val height = 144
        val bytes = ByteArray(width * height) { value.toByte() }
        return LumaSnapshot(ByteBuffer.wrap(bytes), width, 1, width, height)
    }

    private fun patterned(pixel: (Int, Int) -> Int): LumaSnapshot {
        val width = 160
        val height = 144
        val bytes = ByteArray(width * height)
        for (y in 0 until height) {
            for (x in 0 until width) {
                bytes[y * width + x] = pixel(x, y).toByte()
            }
        }
        return LumaSnapshot(ByteBuffer.wrap(bytes), width, 1, width, height)
    }
}
