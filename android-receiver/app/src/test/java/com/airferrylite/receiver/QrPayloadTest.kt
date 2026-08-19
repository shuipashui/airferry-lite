package com.airferrylite.receiver

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QrPayloadTest {
    @Test
    fun prefersBinaryBytesOverText() {
        val bytes = byteArrayOf(0xd1.toByte(), 0x0c, 1, 2, 3)
        assertArrayEquals(bytes, QrPayload.bytesFrom(bytes, "ignored"))
    }

    @Test
    fun fallsBackToLatin1Text() {
        assertArrayEquals(
            byteArrayOf(0xd1.toByte(), 0x0c),
            QrPayload.bytesFrom(null, "\u00d1\u000c")
        )
    }

    @Test
    fun detectsLegacyAndHighSpeedFrames() {
        val legacy = "AFL1|hello".toByteArray(Charsets.ISO_8859_1)
        assertTrue(QrPayload.isLegacyFrame(legacy))
        assertTrue(QrPayload.isTransfer(legacy))
        assertFalse(QrPayload.isMultiLayout(legacy))
    }

    @Test
    fun frameKeyUsesSessionAndSequence() {
        val first = ByteArray(20) { 0 }
        first[0] = 0xd1.toByte()
        first[4] = 7
        val second = first.copyOf()
        second[4] = 8
        assertTrue(QrPayload.frameKey(first) == QrPayload.frameKey(first.copyOf()))
        assertTrue(QrPayload.frameKey(first) != QrPayload.frameKey(second))
    }
}
