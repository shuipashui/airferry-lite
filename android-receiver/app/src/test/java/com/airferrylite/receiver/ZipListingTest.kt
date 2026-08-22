package com.airferrylite.receiver

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ZipListingTest {
    @Test
    fun listsFileNamesAndSkipsFolders() {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            zip.putNextEntry(ZipEntry("docs/"))
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("docs/a.txt"))
            zip.write("hello".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("b.txt"))
            zip.write("world".toByteArray())
            zip.closeEntry()
        }
        assertEquals(listOf("a.txt", "b.txt"), ZipListing.names(output.toByteArray()))
    }

    @Test
    fun rejectsNonZipBytes() {
        assertNull(ZipListing.names("not a zip".toByteArray()))
        assertNull(ZipListing.names(ByteArray(0)))
    }
}
