package com.airferrylite.receiver

import android.util.Base64
import java.util.zip.CRC32

data class TransferMeta(val session: String, val name: String, val mime: String, val size: Long, val chunkSize: Int, val total: Int, val fileCrc: Long)
data class TransferUpdate(val meta: TransferMeta?, val received: Int, val total: Int, val complete: ByteArray? = null, val error: String? = null)

class TransferAssembler {
    companion object {
        private const val MAX_FILE_SIZE = 64L * 1024L * 1024L
        private const val MAX_CHUNK_SIZE = 4096
        private const val MAX_CHUNKS = 200000
    }

    private var meta: TransferMeta? = null
    private val chunks = mutableMapOf<Int, ByteArray>()
    private val parityFrames = mutableMapOf<Int, RepairFrame>()
    private val parityLookup = mutableMapOf<Int, Int>()

    private data class RepairFrame(val groupStart: Int, val count: Int, val total: Int, val bytes: ByteArray)

    fun reset() { meta = null; chunks.clear(); parityFrames.clear(); parityLookup.clear() }

    fun accept(text: String): TransferUpdate {
        val fields = text.split("|")
        if (fields.firstOrNull() != "AFL1") return snapshot()
        return try {
            when (fields.getOrNull(1)) {
                "H" -> acceptHeader(fields)
                "D" -> acceptData(fields)
                "P" -> acceptParity(fields)
                else -> snapshot()
            }
        } catch (error: Exception) { snapshot(error.message ?: "帧格式错误") }
    }

    private fun acceptHeader(fields: List<String>): TransferUpdate {
        if (fields.size != 9) return snapshot("描述帧字段数错误")
        val size = fields[5].toLong()
        val chunkSize = fields[6].toInt()
        val total = fields[7].toInt()
        if (size !in 0..MAX_FILE_SIZE || chunkSize !in 1..MAX_CHUNK_SIZE || total !in 1..MAX_CHUNKS) return snapshot("描述帧超出接收上限")
        if (total != maxOf(1, (size + chunkSize - 1) / chunkSize).toInt()) return snapshot("描述帧分片数错误")
        val next = TransferMeta(fields[2], decodeText(fields[3]).take(255), decodeText(fields[4]).ifBlank { "application/octet-stream" }, size, chunkSize, total, fields[8].toLong(16) and 0xffffffffL)
        if (meta?.session != next.session) { chunks.clear(); parityFrames.clear(); parityLookup.clear() }
        meta = next
        return snapshot()
    }

    private fun acceptData(fields: List<String>): TransferUpdate {
        val current = meta ?: return snapshot("尚未收到描述帧")
        if (fields.size != 7 || fields[2] != current.session) return snapshot()
        val index = fields[3].toInt(); val total = fields[4].toInt()
        if (total != current.total || index !in 0 until current.total) return snapshot()
        val bytes = decodeBytes(fields[6])
        if (bytes.size != expectedChunkLength(index, current)) return snapshot("片段长度错误")
        val expected = fields[5].toLong(16) and 0xffffffffL
        if (crc(bytes) != expected) return snapshot("片段校验失败")
        if (!chunks.containsKey(index)) chunks[index] = bytes
        parityLookup[index]?.let { tryRecover(it) }
        return maybeComplete()
    }

    private fun acceptParity(fields: List<String>): TransferUpdate {
        val current = meta ?: return snapshot("尚未收到描述帧")
        if (fields.size != 8 || fields[2] != current.session) return snapshot()
        val groupStart = fields[3].toInt(); val count = fields[4].toInt(); val total = fields[5].toInt()
        if (total != current.total || groupStart !in 0 until current.total || count !in 2..32 || groupStart + count > current.total) return snapshot()
        val bytes = decodeBytes(fields[7])
        if (bytes.size != current.chunkSize) return snapshot()
        val expected = fields[6].toLong(16) and 0xffffffffL
        if (crc(bytes) != expected) return snapshot("修复帧校验失败")
        parityFrames[groupStart] = RepairFrame(groupStart, count, total, bytes)
        for (index in groupStart until groupStart + count) parityLookup[index] = groupStart
        tryRecover(groupStart)
        return maybeComplete()
    }

    private fun tryRecover(groupStart: Int) {
        val current = meta ?: return
        val repair = parityFrames[groupStart] ?: return
        val missing = (groupStart until groupStart + repair.count).filterNot { chunks.containsKey(it) }
        if (missing.size != 1) return
        val recovered = repair.bytes.copyOf()
        for (index in groupStart until groupStart + repair.count) {
            if (index == missing[0]) continue
            val chunk = chunks[index] ?: return
            for (offset in chunk.indices) recovered[offset] = (recovered[offset].toInt() xor chunk[offset].toInt()).toByte()
        }
        chunks[missing[0]] = recovered.copyOf(expectedChunkLength(missing[0], current))
    }

    private fun maybeComplete(): TransferUpdate {
        val current = meta ?: return snapshot()
        if (chunks.size != current.total) return snapshot()
        val output = ByteArray(current.size.toInt()); var offset = 0
        for (i in 0 until current.total) { val part = chunks[i] ?: return snapshot(); part.copyInto(output, offset); offset += part.size }
        if (offset.toLong() != current.size || crc(output) != current.fileCrc) return snapshot(error = "文件校验失败")
        return snapshot(complete = output)
    }

    private fun expectedChunkLength(index: Int, current: TransferMeta): Int = if (index == current.total - 1) (current.size - index.toLong() * current.chunkSize).toInt() else current.chunkSize

    fun missing(limit: Int = 40): List<Int> { val current = meta ?: return emptyList(); val output = mutableListOf<Int>(); for (index in 0 until current.total) { if (!chunks.containsKey(index)) { output += index; if (output.size == limit) break } }; return output }

    private fun snapshot(error: String? = null, complete: ByteArray? = null) = TransferUpdate(meta, chunks.size, meta?.total ?: 0, complete, error)

    private fun decodeBytes(value: String): ByteArray { val padded = value + "=".repeat((4 - value.length % 4) % 4); return Base64.decode(padded.replace('-', '+').replace('_', '/'), Base64.DEFAULT) }
    private fun decodeText(value: String) = decodeBytes(value).toString(Charsets.UTF_8)
    private fun crc(bytes: ByteArray): Long { val crc = CRC32(); crc.update(bytes); return crc.value }
}
