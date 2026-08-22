package com.airferrylite.receiver

import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

internal object ZipListing {
    fun names(bytes: ByteArray): List<String>? {
        if (bytes.size < 4 || bytes[0] != 0x50.toByte() || bytes[1] != 0x4b.toByte()) return null
        return try {
            ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
                val names = ArrayList<String>()
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (!entry.isDirectory) {
                        val raw = entry.name.replace('\\', '/')
                        val name = raw.substringAfterLast('/').ifBlank { raw }
                        if (name.isNotBlank() && name != "." && name != "..") names += name
                    }
                    zip.closeEntry()
                }
                names.takeIf { it.isNotEmpty() }
            }
        } catch (_: Throwable) {
            null
        }
    }
}
