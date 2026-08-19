package com.airferrylite.receiver

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class LumaScalerTest {
    @Test
    fun keepsFourCodeFramesAtNativeResolution() {
        assertEquals(1, LumaScaler.scaleFactor(1440, 1440, multiLayout = true))
        assertEquals(1, LumaScaler.scaleFactor(720, 720))
        assertEquals(1, LumaScaler.scaleFactor(960, 960))
    }

    @Test
    fun downscalesSingleCode1440To720() {
        assertEquals(2, LumaScaler.scaleFactor(1440, 1440))
        assertEquals(3, LumaScaler.scaleFactor(1920, 1920))
    }

    @Test
    fun averages2x2Blocks() {
        val source = byteArrayOf(
            0, 10, 20, 30,
            40, 50, 60, 70,
            80, 90, 100, 110,
            120, 130.toByte(), 140.toByte(), 150.toByte()
        )
        val output = ByteArray(4)
        val size = LumaScaler.downscale(source, 4, 4, 2, output)
        assertEquals(2 to 2, size)
        assertArrayEquals(byteArrayOf(25, 45, 105, 125), output)
    }
}
