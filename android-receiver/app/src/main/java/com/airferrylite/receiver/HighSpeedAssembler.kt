package com.airferrylite.receiver

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

data class HighSpeedFile(val name: String, val mime: String, val bytes: ByteArray)
data class HighSpeedUpdate(
    val active: Boolean,
    val session: String? = null,
    val receivedFrames: Int = 0,
    val solvedBlocks: Int = 0,
    val totalBlocks: Int = 0,
    val complete: HighSpeedFile? = null,
    val error: String? = null
)

/** Decodes the binary AFL2 frames produced by the web high-speed sender. */
class HighSpeedAssembler {
    companion object {
        private const val FRAME_HEADER_SIZE = 20
        private const val FILE_HEADER_SIZE = 49
        private const val MAX_FILE_SIZE = 64 * 1024 * 1024
        private const val MAX_CONTAINER_SIZE = MAX_FILE_SIZE + FILE_HEADER_SIZE + 2 * 65_535
        private const val MAX_BLOCK_SIZE = 4096
        private const val MAX_BLOCKS = 65_535
        private const val FRAME_SEED_FACTOR = 0x9e3779b1.toInt()
        private const val PRNG_INCREMENT = 0x9e3779b9.toInt()
        private const val MIX_A = 0x21f0aaad
        private const val MIX_B = 0x735a2d97
        private const val FRAME_MIX = 0xc2b2ae35.toInt()

        fun looksLikeFrame(bytes: ByteArray): Boolean {
            if (bytes.size <= FRAME_HEADER_SIZE || u8(bytes[0]) != 0xd1) return false
            val magic = u8(bytes[1])
            return magic in 0x0c..0x0f || magic == 0x1c || magic == 0x1d
        }

        fun isMultiLayoutFrame(bytes: ByteArray) = looksLikeFrame(bytes) && layoutCodesOf(bytes) >= 2

        fun isDualLayoutFrame(bytes: ByteArray) = looksLikeFrame(bytes) && layoutCodesOf(bytes) == 2

        private fun layoutCodesOf(bytes: ByteArray) = layoutCodesFromMagic(u8(bytes[1]))

        private fun layoutCodesFromMagic(magic: Int) = when (magic) {
            0x0d, 0x0f -> 4
            0x1c, 0x1d -> 2
            else -> 1
        }

        private fun u8(value: Byte) = value.toInt() and 0xff
        private fun u16le(bytes: ByteArray, offset: Int) = u8(bytes[offset]) or (u8(bytes[offset + 1]) shl 8)
        private fun u32le(bytes: ByteArray, offset: Int): Long =
            (u8(bytes[offset]).toLong()) or
                (u8(bytes[offset + 1]).toLong() shl 8) or
                (u8(bytes[offset + 2]).toLong() shl 16) or
                (u8(bytes[offset + 3]).toLong() shl 24)
        private fun unsigned(value: Int) = value.toLong() and 0xffffffffL
        private fun fnv1a(bytes: ByteArray): Long {
            var hash = 0x811c9dc5.toInt()
            for (byte in bytes) {
                hash = hash xor u8(byte)
                hash *= 0x01000193
            }
            return unsigned(hash)
        }

        private fun frameIndexes(count: Int, cdf: DoubleArray, sessionId: Int, sequence: Int): List<Int> {
            if ((sequence ushr 31) != 0) return listOf((sequence and Int.MAX_VALUE) % count)
            var seed = (sessionId + 1) * FRAME_SEED_FACTOR xor (sequence + 0x85ebca6b.toInt())
            seed = (seed xor (seed ushr 13)) * FRAME_MIX
            seed = seed xor (seed ushr 16)
            val random = Prng(seed)
            val sample = unsigned(random.next()).toDouble() / 4294967296.0
            var low = 0
            var high = count - 1
            while (low < high) {
                val middle = (low + high) ushr 1
                if (cdf[middle] >= sample) high = middle else low = middle + 1
            }
            val degree = min(count, low + 1)
            if (degree > (count ushr 3)) {
                val pool = IntArray(count) { it }
                return List(degree) { offset ->
                    val pick = offset + (unsigned(random.next()) % (count - offset)).toInt()
                    val value = pool[pick]
                    pool[pick] = pool[offset]
                    pool[offset] = value
                    value
                }
            }
            val selected = HashSet<Int>()
            while (selected.size < degree) selected.add((unsigned(random.next()) % count).toInt())
            return selected.toList()
        }

        private fun solitonCdf(count: Int): DoubleArray {
            val cdf = DoubleArray(count)
            if (count == 1) {
                cdf[0] = 1.0
                return cdf
            }
            val delta = 0.5
            val c = 0.1
            val beta = max(1.0, c * deterministicLog(count / delta) * sqrt(count.toDouble()))
            val threshold = min(count, ceil(count / beta).toInt())
            var sum = 0.0
            for (degree in 1..count) {
                val ideal = if (degree == 1) 1.0 / count else 1.0 / (degree * (degree - 1))
                val robust = when {
                    degree < threshold -> beta / (degree * count)
                    degree == threshold -> beta * max(0.0, deterministicLog(beta / delta)) / count
                    else -> 0.0
                }
                sum += ideal + robust
                cdf[degree - 1] = sum
            }
            for (index in cdf.indices) cdf[index] /= sum
            cdf[cdf.lastIndex] = 1.0
            return cdf
        }


        private fun deterministicLog(input: Double): Double {
            var exponent = 0
            var value = input
            while (value >= 1.5) {
                value /= 2.0
                exponent += 1
            }
            while (value < 0.75) {
                value *= 2.0
                exponent -= 1
            }
            val ratio = (value - 1.0) / (value + 1.0)
            val squared = ratio * ratio
            var term = ratio
            var sum = 0.0
            for (odd in 1..21 step 2) {
                sum += term / odd
                term *= squared
            }
            return exponent * 0.6931471805599453 + 2.0 * sum
        }
    }

    private data class FrameHeader(
        val sessionId: Int,
        val sequence: Int,
        val blocks: Int,
        val blockLength: Int,
        val totalLength: Int,
        val payloadFnv: Long,
        val layoutCodes: Int,
        val systematic: Boolean
    )

    private var streamKey: String? = null
    private var header: FrameHeader? = null
    private var decoder: LtDecoder? = null
    private var complete: HighSpeedFile? = null

    fun reset() {
        streamKey = null
        header = null
        decoder = null
        complete = null
    }

    fun accept(bytes: ByteArray): HighSpeedUpdate {
        val frame = parseFrame(bytes) ?: return snapshot(error = "高速二维码帧格式错误")
        val key = "${frame.sessionId}:${frame.blocks}:${frame.blockLength}:${frame.totalLength}:${frame.payloadFnv}:${frame.layoutCodes}:${if (frame.systematic) 1 else 0}"
        if (streamKey != key) {
            streamKey = key
            header = frame
            decoder = LtDecoder(frame.blocks, frame.blockLength, frame.sessionId, frame.totalLength)
            complete = null
        }
        val activeDecoder = decoder ?: return snapshot(error = "高速接收器初始化失败")
        activeDecoder.addFrame(frame.sequence, bytes.copyOfRange(FRAME_HEADER_SIZE, bytes.size))
        if (activeDecoder.isComplete && complete == null) {
            complete = try {
                val container = activeDecoder.assemble() ?: throw IllegalStateException("高速数据尚未完整")
                if (fnv1a(container) != frame.payloadFnv) throw IllegalStateException("高速流校验失败")
                unpackFile(container)
            } catch (error: Throwable) {
                return snapshot(error = error.message ?: "高速文件恢复失败")
            }
        }
        return snapshot()
    }

    private fun parseFrame(bytes: ByteArray): FrameHeader? {
        if (!looksLikeFrame(bytes)) return null
        val sessionId = u16le(bytes, 2)
        val sequence = u32le(bytes, 4).toInt()
        val blocks = u16le(bytes, 8)
        val blockLength = u16le(bytes, 10)
        val totalLength = u32le(bytes, 12)
        val payloadFnv = u32le(bytes, 16)
        if (blocks !in 1..MAX_BLOCKS || blockLength !in 1..MAX_BLOCK_SIZE || totalLength !in 1..MAX_CONTAINER_SIZE) return null
        if (blocks != ceil(totalLength.toDouble() / blockLength).toInt()) return null
        if (bytes.size != FRAME_HEADER_SIZE + blockLength) return null
        val magic = u8(bytes[1])
        val layoutCodes = layoutCodesFromMagic(magic)
        val systematic = magic == 0x0e || magic == 0x0f || magic == 0x1d
        return FrameHeader(sessionId, sequence, blocks, blockLength, totalLength.toInt(), payloadFnv, layoutCodes, systematic)
    }

    private fun snapshot(error: String? = null): HighSpeedUpdate {
        val activeDecoder = decoder
        val activeHeader = header
        return HighSpeedUpdate(
            active = activeDecoder != null,
            session = streamKey,
            receivedFrames = activeDecoder?.framesNew ?: 0,
            solvedBlocks = activeDecoder?.solvedCount ?: 0,
            totalBlocks = activeHeader?.blocks ?: 0,
            complete = complete,
            error = error
        )
    }

    private fun unpackFile(container: ByteArray): HighSpeedFile {
        if (container.size < FILE_HEADER_SIZE || container[0] != 'D'.code.toByte() || container[1] != 'C'.code.toByte() || container[2] != 'F'.code.toByte() || container[3] != '2'.code.toByte()) {
            throw IllegalArgumentException("高速文件头无效")
        }
        val flags = u8(container[4])
        if (flags !in 0..1) throw IllegalArgumentException("高速文件压缩格式不受支持")
        val nameLength = u16le(container, 5)
        val mimeLength = u16le(container, 7)
        val originalSize = u32le(container, 9)
        val transmittedSize = u32le(container, 13)
        val dataOffset = FILE_HEADER_SIZE + nameLength + mimeLength
        if (originalSize !in 1L..MAX_FILE_SIZE.toLong() || transmittedSize !in 1L..MAX_FILE_SIZE.toLong() || dataOffset > container.size || dataOffset + transmittedSize != container.size.toLong()) {
            throw IllegalArgumentException("高速文件长度无效")
        }
        val digest = container.copyOfRange(17, 49)
        val name = container.copyOfRange(FILE_HEADER_SIZE, FILE_HEADER_SIZE + nameLength).toString(Charsets.UTF_8)
        val mime = container.copyOfRange(FILE_HEADER_SIZE + nameLength, dataOffset).toString(Charsets.UTF_8).ifBlank { "application/octet-stream" }
        val payload = container.copyOfRange(dataOffset, container.size)
        val output = if (flags == 1) gunzip(payload, originalSize.toInt()) else payload
        if (output.size.toLong() != originalSize) throw IllegalArgumentException("高速原文件长度校验失败")
        if (!MessageDigest.getInstance("SHA-256").digest(output).contentEquals(digest)) throw IllegalArgumentException("高速原文件 SHA-256 校验失败")
        return HighSpeedFile(safeName(name), mime, output)
    }

    private fun gunzip(payload: ByteArray, expectedSize: Int): ByteArray {
        GZIPInputStream(ByteArrayInputStream(payload)).use { input ->
            val output = ByteArrayOutputStream(expectedSize)
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size() + count > expectedSize) throw IllegalArgumentException("高速解压后的文件过大")
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }

    private fun safeName(value: String): String = value.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[\\u0000-\\u001f\\u007f]"), "").trim().ifBlank { "received.bin" }

    private class Prng(seed: Int) {
        private var state = seed
        fun next(): Int {
            state += PRNG_INCREMENT
            var value = state xor (state ushr 16)
            value *= MIX_A
            value = value xor (value ushr 15)
            value *= MIX_B
            return value xor (value ushr 15)
        }
    }

    private class LtDecoder(
        private val blockCount: Int,
        private val blockLength: Int,
        private val sessionId: Int,
        private val totalLength: Int
    ) {
        private class Equation(val indexes: MutableSet<Int>, val bytes: ByteArray)
        private val cdf = HighSpeedAssembler.solitonCdf(blockCount)
        private val solved = arrayOfNulls<ByteArray>(blockCount)
        private val byBlock = HashMap<Int, MutableSet<Equation>>()
        private val seen = HashSet<Int>()
        private val received = LinkedHashMap<Int, ByteArray>()
        private var lastDenseAttemptAt = 0
        var solvedCount = 0
            private set
        var framesNew = 0
            private set

        val isComplete get() = solvedCount >= blockCount

        fun addFrame(sequence: Int, block: ByteArray) {
            if (!seen.add(sequence) || isComplete) return
            framesNew += 1
            if (blockCount <= DENSE_MAX_BLOCKS) received[sequence] = block.copyOf()
            val indexes = HighSpeedAssembler.frameIndexes(blockCount, cdf, sessionId, sequence).toMutableSet()
            val value = block.copyOf()
            for (index in indexes.toList()) {
                val known = solved[index] ?: continue
                xor(value, known)
                indexes.remove(index)
            }
            if (indexes.isEmpty()) {
                maybeDenseComplete()
                return
            }
            if (indexes.size == 1) {
                resolve(indexes.first(), value)
                maybeDenseComplete()
                return
            }
            val equation = Equation(indexes, value)
            for (index in indexes) byBlock.getOrPut(index) { HashSet() }.add(equation)
            maybeDenseComplete()
        }

        private fun maybeDenseComplete() {
            if (isComplete || blockCount > DENSE_MAX_BLOCKS) return
            val startAt = blockCount + max(2, blockCount / 25)
            if (framesNew < startAt || framesNew - lastDenseAttemptAt < DENSE_ATTEMPT_EVERY) return
            lastDenseAttemptAt = framesNew
            try {
                runDenseComplete()
            } catch (_: Throwable) {
                // A failed dense attempt must not abort the fountain peel.
            }
        }

        private fun runDenseComplete() {
            val wordCount = (blockCount + 63) / 64
            data class DenseRow(val bits: LongArray, val bytes: ByteArray)
            val pivots = arrayOfNulls<DenseRow>(blockCount)
            var rank = 0
            for ((sequence, payload) in received) {
                val bits = LongArray(wordCount)
                for (index in HighSpeedAssembler.frameIndexes(blockCount, cdf, sessionId, sequence)) {
                    bits[index ushr 6] = bits[index ushr 6] or (1L shl (index and 63))
                }
                val rhs = payload.copyOf()
                for (column in 0 until blockCount) {
                    if ((bits[column ushr 6] and (1L shl (column and 63))) == 0L) continue
                    val pivot = pivots[column]
                    if (pivot == null) {
                        pivots[column] = DenseRow(bits, rhs)
                        rank += 1
                        break
                    }
                    for (word in bits.indices) bits[word] = bits[word] xor pivot.bits[word]
                    xor(rhs, pivot.bytes)
                }
                if (rank == blockCount) break
            }
            if (rank != blockCount) return
            val denseSolved = arrayOfNulls<ByteArray>(blockCount)
            for (column in blockCount - 1 downTo 0) {
                val row = pivots[column] ?: return
                val rhs = row.bytes.copyOf()
                for (higher in column + 1 until blockCount) {
                    if ((row.bits[higher ushr 6] and (1L shl (higher and 63))) != 0L) {
                        xor(rhs, denseSolved[higher] ?: return)
                    }
                }
                denseSolved[column] = rhs
            }
            for (index in denseSolved.indices) solved[index] = denseSolved[index]
            solvedCount = blockCount
            byBlock.clear()
            received.clear()
        }

        fun assemble(): ByteArray? {
            if (!isComplete) return null
            val output = ByteArray(totalLength)
            for (index in 0 until blockCount) {
                val block = solved[index] ?: return null
                val offset = index * blockLength
                val length = min(blockLength, totalLength - offset)
                block.copyInto(output, offset, 0, length)
            }
            return output
        }

        private fun resolve(index: Int, bytes: ByteArray) {
            val queue = ArrayDeque<Pair<Int, ByteArray>>()
            queue.add(index to bytes)
            while (queue.isNotEmpty()) {
                val (solvedIndex, solvedBytes) = queue.removeFirst()
                if (solved[solvedIndex] != null) continue
                solved[solvedIndex] = solvedBytes
                solvedCount += 1
                val equations = byBlock.remove(solvedIndex)?.toList() ?: continue
                for (equation in equations) {
                    xor(equation.bytes, solvedBytes)
                    equation.indexes.remove(solvedIndex)
                    if (equation.indexes.size == 1) {
                        val remaining = equation.indexes.first()
                        byBlock[remaining]?.remove(equation)
                        if (solved[remaining] == null) queue.add(remaining to equation.bytes)
                    }
                }
            }
        }

        private fun xor(target: ByteArray, source: ByteArray) {
            for (index in target.indices) target[index] = (target[index].toInt() xor source[index].toInt()).toByte()
        }

        companion object {
            private const val DENSE_MAX_BLOCKS = 768
            private const val DENSE_ATTEMPT_EVERY = 8
        }
    }

}
