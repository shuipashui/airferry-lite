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
        private val GF_MUL = IntArray(256 * 256)
        private val GF_INV = IntArray(256)
        init {
            for (a in 0..255) for (b in 0..255) {
                var aa = a; var bb = b; var value = 0
                while (bb != 0) { if ((bb and 1) != 0) value = value xor aa; aa = aa shl 1; if ((aa and 0x100) != 0) aa = aa xor 0x11d; bb = bb ushr 1 }
                GF_MUL[(a shl 8) or b] = value
            }
            for (value in 1..255) for (candidate in 1..255) if (GF_MUL[(value shl 8) or candidate] == 1) { GF_INV[value] = candidate; break }
        }
        private fun mul(a: Int, b: Int) = GF_MUL[((a and 255) shl 8) or (b and 255)]
        private fun inv(a: Int) = GF_INV[a and 255]
        private fun coefficients(seed: Int, count: Int): IntArray {
            var state = if (seed == 0) 1 else seed
            return IntArray(count) { state = state xor (state shl 13); state = state xor (state ushr 17); state = state xor (state shl 5); (state and 255).let { if (it == 0) 1 else it } }
        }
    }

    private var meta: TransferMeta? = null
    private val chunks = mutableMapOf<Int, ByteArray>()
    private val parityFrames = mutableMapOf<Int, MutableMap<Int, RepairFrame>>()
    private val parityLookup = mutableMapOf<Int, Int>()
    private data class RepairFrame(val groupStart: Int, val count: Int, val total: Int, val seed: Int, val coefficients: IntArray, val bytes: ByteArray)
    private data class Equation(val coeff: IntArray, val rhs: ByteArray, var pivot: Int = -1)

    fun reset() { meta = null; chunks.clear(); parityFrames.clear(); parityLookup.clear() }

    fun accept(text: String): TransferUpdate {
        val fields = text.split("|")
        if (fields.firstOrNull() != "AFL1") return snapshot()
        return try { when (fields.getOrNull(1)) { "H" -> acceptHeader(fields); "D" -> acceptData(fields); "P" -> acceptParity(fields); else -> snapshot() } }
        catch (error: Exception) { snapshot(error.message ?: "帧格式错误") }
    }

    private fun acceptHeader(fields: List<String>): TransferUpdate {
        if (fields.size != 9) return snapshot("描述帧字段数错误")
        val size = fields[5].toLong(); val chunkSize = fields[6].toInt(); val total = fields[7].toInt()
        if (size !in 0..MAX_FILE_SIZE || chunkSize !in 1..MAX_CHUNK_SIZE || total !in 1..MAX_CHUNKS) return snapshot("描述帧超出接收上限")
        if (total != maxOf(1, (size + chunkSize - 1) / chunkSize).toInt()) return snapshot("描述帧分片数错误")
        val next = TransferMeta(fields[2], decodeText(fields[3]).take(255), decodeText(fields[4]).ifBlank { "application/octet-stream" }, size, chunkSize, total, fields[8].toLong(16) and 0xffffffffL)
        if (meta?.session != next.session) { chunks.clear(); parityFrames.clear(); parityLookup.clear() }
        meta = next; return snapshot()
    }

    private fun acceptData(fields: List<String>): TransferUpdate {
        val current = meta ?: return snapshot("尚未收到描述帧")
        if (fields.size != 7 || fields[2] != current.session) return snapshot()
        val index = fields[3].toInt(); val total = fields[4].toInt(); if (total != current.total || index !in 0 until current.total) return snapshot()
        val bytes = decodeBytes(fields[6]); if (bytes.size != expectedChunkLength(index, current)) return snapshot("片段长度错误")
        if (crc(bytes) != (fields[5].toLong(16) and 0xffffffffL)) return snapshot("片段校验失败")
        if (!chunks.containsKey(index)) chunks[index] = bytes
        parityLookup[index]?.let { tryRecover(it) }; return maybeComplete()
    }

    private fun acceptParity(fields: List<String>): TransferUpdate {
        val current = meta ?: return snapshot("尚未收到描述帧")
        if (fields.size != 8 && fields.size != 9 || fields[2] != current.session) return snapshot()
        val legacy = fields.size == 8; val groupStart = fields[3].toInt(); val count = fields[4].toInt(); val total = fields[5].toInt()
        if (total != current.total || groupStart !in 0 until current.total || count !in 2..32 || groupStart + count > current.total) return snapshot()
        val seed = if (legacy) 0 else fields[6].toLong(16).toInt(); val crcField = if (legacy) fields[6] else fields[7]; val payload = if (legacy) fields[7] else fields[8]
        val bytes = decodeBytes(payload); if (bytes.size != current.chunkSize) return snapshot(); if (crc(bytes) != (crcField.toLong(16) and 0xffffffffL)) return snapshot("修复帧校验失败")
        val frame = RepairFrame(groupStart, count, total, seed, if (legacy) IntArray(count) { 1 } else coefficients(seed, count), bytes)
        val repairs = parityFrames.getOrPut(groupStart) { mutableMapOf() }; repairs[seed] = frame
        for (index in groupStart until groupStart + count) parityLookup[index] = groupStart
        tryRecover(groupStart); return maybeComplete()
    }

    private fun tryRecover(groupStart: Int) {
        val current = meta ?: return; val repairs = parityFrames[groupStart] ?: return; val first = repairs.values.firstOrNull() ?: return
        val missing = (groupStart until groupStart + first.count).filterNot { chunks.containsKey(it) }; if (missing.isEmpty() || repairs.size < missing.size) return
        val equations = repairs.values.map { repair ->
            val coeff = IntArray(missing.size); val rhs = repair.bytes.copyOf()
            for (offset in 0 until repair.count) { val index = groupStart + offset; val factor = repair.coefficients[offset]; val missingColumn = missing.indexOf(index); val chunk = chunks[index]
                if (missingColumn >= 0) coeff[missingColumn] = factor else if (chunk != null) for (byte in chunk.indices) rhs[byte] = (rhs[byte].toInt() xor mul(factor, chunk[byte].toInt() and 255)).toByte() }
            Equation(coeff, rhs)
        }.toMutableList()
        var rank = 0
        for (column in missing.indices) { var pivot = rank; while (pivot < equations.size && equations[pivot].coeff[column] == 0) pivot++; if (pivot == equations.size) continue
            val temp = equations[rank]; equations[rank] = equations[pivot]; equations[pivot] = temp; val row = equations[rank]; val inverse = inv(row.coeff[column])
            for (c in column until row.coeff.size) row.coeff[c] = mul(inverse, row.coeff[c]); for (byte in row.rhs.indices) row.rhs[byte] = mul(inverse, row.rhs[byte].toInt() and 255).toByte()
            for (other in equations.indices) if (other != rank) { val factor = equations[other].coeff[column]; if (factor == 0) continue; for (c in column until row.coeff.size) equations[other].coeff[c] = equations[other].coeff[c] xor mul(factor, row.coeff[c]); for (byte in row.rhs.indices) equations[other].rhs[byte] = (equations[other].rhs[byte].toInt() xor mul(factor, row.rhs[byte].toInt() and 255)).toByte() }
            row.pivot = column; rank++
        }
        if (rank < missing.size) return
        for (column in missing.indices) equations.firstOrNull { it.pivot == column }?.let { chunks[missing[column]] = it.rhs.copyOf(expectedChunkLength(missing[column], current)) }
    }

    private fun maybeComplete(): TransferUpdate {
        val current = meta ?: return snapshot(); if (chunks.size != current.total) return snapshot(); val output = ByteArray(current.size.toInt()); var offset = 0
        for (i in 0 until current.total) { val part = chunks[i] ?: return snapshot(); part.copyInto(output, offset); offset += part.size }
        if (offset.toLong() != current.size || crc(output) != current.fileCrc) return snapshot(error = "文件校验失败")
        return snapshot(complete = output)
    }
    private fun expectedChunkLength(index: Int, current: TransferMeta) = if (index == current.total - 1) (current.size - index.toLong() * current.chunkSize).toInt() else current.chunkSize
    fun missing(limit: Int = 40): List<Int> { val current = meta ?: return emptyList(); val output = mutableListOf<Int>(); for (index in 0 until current.total) if (!chunks.containsKey(index)) { output += index; if (output.size == limit) break }; return output }
    private fun snapshot(error: String? = null, complete: ByteArray? = null) = TransferUpdate(meta, chunks.size, meta?.total ?: 0, complete, error)
    private fun decodeBytes(value: String): ByteArray { val padded = value + "=".repeat((4 - value.length % 4) % 4); return Base64.decode(padded.replace('-', '+').replace('_', '/'), Base64.DEFAULT) }
    private fun decodeText(value: String) = decodeBytes(value).toString(Charsets.UTF_8)
    private fun crc(bytes: ByteArray): Long { val crc = CRC32(); crc.update(bytes); return crc.value }
}
