package com.airferrylite.receiver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanLayoutTest {
    @Test
    fun centerSquareUsesTheShorterSide() {
        val region = ScanLayout.centerSquare(1920, 1440)
        assertEquals(ScanRegion(240, 0, 1440, 1440), region)
    }

    @Test
    fun overlappingQuadrantsCoverTheMidline() {
        val region = ScanRegion(0, 0, 1000, 1000)
        val quads = ScanLayout.overlappingQuadrants(region)
        assertEquals(4, quads.size)
        val crop = ((0.5f + ScanLayout.QUAD_OVERLAP) * 1000).toInt()
        assertEquals(crop, quads[0].width)
        assertTrue("top-left and top-right must overlap", quads[0].left + quads[0].width > quads[1].left)
        val center = 500
        assertTrue(quads.any { center in it.left until (it.left + it.width) && center in it.top until (it.top + it.height) })
    }

    @Test
    fun oneCodeGridRoiCoversNeighborTiles() {
        val region = ScanLayout.regionFromPoints(
            listOf(100f to 100f, 300f to 100f, 100f to 300f, 300f to 300f),
            1440,
            1440,
            1,
            coverGrid = true
        )!!
        assertTrue("one four-code hit must expand to the whole 2x2", region.width >= 760)
        assertTrue(region.left + region.width <= 1440)
        assertTrue(region.top + region.height <= 1440)
    }

    @Test
    fun fourCodesKeepATightBox() {
        val region = ScanLayout.regionFromPoints(
            listOf(100f to 100f, 900f to 100f, 100f to 900f, 900f to 900f),
            1440,
            1440,
            4
        )!!
        assertTrue(region.width in 800..1200)
    }

    @Test
    fun unionGrowsInsteadOfCollapsingToOneCode() {
        val first = ScanRegion(100, 100, 800, 800)
        val second = ScanRegion(400, 400, 200, 200)
        val merged = ScanLayout.union(first, second, 1440, 1440)
        assertTrue(merged.width >= 800)
    }

    @Test
    fun exclusiveQuadrantsDoNotOverlap() {
        val region = ScanRegion(0, 0, 1000, 1000)
        val tiles = ScanLayout.exclusiveQuadrants(region)
        assertEquals(4, tiles.size)
        assertEquals(ScanRegion(0, 0, 500, 500), tiles[0])
        assertEquals(ScanRegion(500, 0, 500, 500), tiles[1])
        assertEquals(tiles[1].left, tiles[0].left + tiles[0].width)
        assertEquals(tiles[2].top, tiles[0].top + tiles[0].height)
    }
}
