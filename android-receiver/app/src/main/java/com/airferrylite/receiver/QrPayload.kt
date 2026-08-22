package com.airferrylite.receiver

internal object QrPayload {
    fun bytesFrom(bytes: ByteArray?, text: String?): ByteArray? = when {
        bytes != null && bytes.isNotEmpty() -> bytes
        !text.isNullOrEmpty() -> text.toByteArray(Charsets.ISO_8859_1)
        else -> null
    }

    fun isLegacyFrame(bytes: ByteArray) =
        bytes.size >= 5 &&
            bytes[0] == 'A'.code.toByte() &&
            bytes[1] == 'F'.code.toByte() &&
            bytes[2] == 'L'.code.toByte() &&
            bytes[3] == '1'.code.toByte() &&
            bytes[4] == '|'.code.toByte()

    fun isTransfer(bytes: ByteArray?) =
        bytes != null && (HighSpeedAssembler.looksLikeFrame(bytes) || isLegacyFrame(bytes))

    fun isMultiLayout(bytes: ByteArray?) =
        bytes != null && HighSpeedAssembler.isMultiLayoutFrame(bytes)

    fun isDualLayout(bytes: ByteArray?) =
        bytes != null && HighSpeedAssembler.isDualLayoutFrame(bytes)

    fun isQuadLayout(bytes: ByteArray?) =
        bytes != null && HighSpeedAssembler.isQuadLayoutFrame(bytes)

    fun frameKey(bytes: ByteArray?): String? {
        if (bytes == null || bytes.size < 8) return null
        if ((bytes[0].toInt() and 0xff) != 0xd1) return null
        return bytes.sliceArray(2 until 8).joinToString(":")
    }
}
