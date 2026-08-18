package com.airferrylite.receiver

import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HighSpeedAssemblerTest {
    @Test
    fun decodesGoldenFramesGeneratedByTheWebSender() {
        val assembler = HighSpeedAssembler()
        val frames = listOf(
            "0QwxSgAAAAAHABAAbgAAACLGYlvjOimgt5OYL00SrR+Mlm92",
            "0QwxSgEAAAAHABAAbgAAACLGYlsAv9a8vUXIPKMR21C7firi",
            "0QwxSgIAAAAHABAAbgAAACLGYlv+4okaANkQV+Yce19p7lWG",
            "0QwxSgMAAAAHABAAbgAAACLGYltjYXRpb24vb2N0ZXQtc3Ry",
            "0QwxSgQAAAAHABAAbgAAACLGYlvjOimgt5OYL00SrR+Mlm92",
            "0QwxSgUAAAAHABAAbgAAACLGYltfJCleZG9uNmJybmFwa2xp",
            "0QwxSgYAAAAHABAAbgAAACLGYltfJCleZG9uNmJybmFwa2xp",
            "0QwxSgcAAAAHABAAbgAAACLGYlt+BgJvZWFvK2traGRzdWRg",
            "0QwxSggAAAAHABAAbgAAACLGYlsGABlqbmouamp2Y3Eudnx7",
            "0QwxSgkAAAAHABAAbgAAACLGYluneW+St5mYN00JrR+MjW92",
            "0QwxSgoAAAAHABAAbgAAACLGYlvYyaEpAt8VTO0DeVlp+F2P"
        )
        var update = HighSpeedUpdate(false)
        for (frame in frames) {
            update = assembler.accept(Base64.getDecoder().decode(frame))
            assertNull(update.error)
        }
        val file = update.complete
        assertNotNull(file)
        assertTrue(update.solvedBlocks == update.totalBlocks)
        assertArrayEquals(Base64.getDecoder().decode("AwEEAQUJAgYFAwUICQcJAwIDCAQGAgYEAwMI"), file!!.bytes)
        assertTrue(file.name == "golden.bin")
        assertTrue(file.mime == "application/octet-stream")
    }
}
