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
    fun twoCodeCoverGridDoesNotStayOnOneRow() {
        val two = listOf(
            100f to 100f, 300f to 100f, 100f to 300f, 300f to 300f,
            700f to 100f, 900f to 100f, 700f to 300f, 900f to 300f
        )
        val tight = ScanLayout.regionFromPoints(two, 1440, 1440, 2, coverGrid = false)!!
        val grid = ScanLayout.regionFromPoints(two, 1440, 1440, 2, coverGrid = true)!!
        assertTrue(grid.width > tight.width)
        assertTrue(grid.height >= 430)
    }

    @Test
    fun fourCodesKeepATightBox() {
        val region = ScanLayout.regionFromPoints(
            listOf(100f to 100f, 900f to 100f, 100f to 900f, 900f to 900f),
            1440,
            1440,
            4
        )!!
        assertTrue(region.width in 950..1300)
    }

    @Test
    fun tilesFromHitsOrderAsTwoByTwo() {
        val hits = listOf(
            listOf(700f to 100f, 900f to 100f, 700f to 300f, 900f to 300f),
            listOf(100f to 100f, 300f to 100f, 100f to 300f, 300f to 300f),
            listOf(100f to 700f, 300f to 700f, 100f to 900f, 300f to 900f),
            listOf(700f to 700f, 900f to 700f, 700f to 900f, 900f to 900f)
        )
        val tiles = ScanLayout.tilesFromHits(hits, 1440, 1440)
        assertEquals(4, tiles.size)
        assertTrue(tiles[0].left < tiles[1].left)
        assertTrue(tiles[0].top < tiles[2].top)
        assertTrue(tiles[1].top < tiles[3].top)
        assertTrue(tiles[2].left < tiles[3].left)
    }

    @Test
    fun unionGrowsInsteadOfCollapsingToOneCode() {
        val first = ScanRegion(100, 100, 800, 800)
        val second = ScanRegion(400, 400, 200, 200)
        val merged = ScanLayout.union(first, second, 1440, 1440)
        assertTrue(merged.width >= 800)
    }

    @Test
    fun activeRegionInflatesOnMissesThenFallsBack() {
        val tracked = ScanRegion(100, 120, 800, 800)
        assertEquals(tracked, ScanLayout.activeRegion(tracked, 0, 1440, 1440))
        val grown = ScanLayout.activeRegion(tracked, 3, 1440, 1440)
        assertTrue(grown.width > tracked.width)
        val fallback = ScanLayout.activeRegion(tracked, ScanLayout.ROI_MISS_LIMIT, 1920, 1440)
        assertEquals(ScanRegion(240, 0, 1440, 1440), fallback)
    }

    @Test
    fun followContainedHitsUpdatesOnlyTheOwningTile() {
        val tiles = listOf(
            ScanRegion(80, 80, 240, 240),
            ScanRegion(520, 80, 240, 240),
            ScanRegion(80, 520, 240, 240),
            ScanRegion(520, 520, 240, 240)
        )
        val next = ScanLayout.followContainedHits(
            tiles,
            listOf(
                listOf(600f to 120f, 780f to 120f, 600f to 280f, 780f to 280f)
            ),
            1440,
            1440
        )
        assertEquals(tiles[0], next[0])
        assertEquals(tiles[2], next[2])
        assertEquals(tiles[3], next[3])
        assertTrue(next[1].left > tiles[1].left)
        assertTrue(ScanLayout.tileIndexContaining(tiles, 690f, 200f) == 1)
    }

    @Test
    fun oneHitDoesNotClearOtherTilesViaOverlap() {
        val tiles = listOf(
            ScanRegion(0, 0, 400, 400),
            ScanRegion(400, 0, 400, 400)
        )
        val next = ScanLayout.followContainedHits(
            tiles,
            listOf(listOf(100f to 100f, 180f to 100f, 100f to 180f, 180f to 180f)),
            1440,
            1440
        )
        assertEquals(tiles[1], next[1])
        assertTrue(next[0].width >= 64)
    }

    @Test
    fun twoHitsRebuildTwoTiles() {
        val previous = listOf(
            ScanRegion(80, 80, 200, 200),
            ScanRegion(900, 80, 200, 200)
        )
        val hits = listOf(
            listOf(120f to 140f, 280f to 140f, 120f to 280f, 280f to 280f),
            listOf(620f to 140f, 780f to 140f, 620f to 280f, 780f to 280f)
        )
        val next = ScanLayout.tilesFromHits(hits, 1440, 1440)
        assertEquals(2, next.size)
        assertTrue(next[0].left < next[1].left)
        assertTrue(next[1].left + next[1].width < 1440)
        assertTrue(next[0].left != previous[0].left || next[0].width != previous[0].width)
    }

    @Test
    fun exclusiveQuadrantsAreFlush() {
        val region = ScanRegion(0, 0, 1000, 1000)
        val tiles = ScanLayout.exclusiveQuadrants(region)
        assertEquals(4, tiles.size)
        assertEquals(ScanRegion(0, 0, 500, 500), tiles[0])
        assertEquals(ScanRegion(500, 0, 500, 500), tiles[1])
        assertEquals(tiles[1].left, tiles[0].left + tiles[0].width)
        assertEquals(tiles[2].top, tiles[0].top + tiles[0].height)
    }

    @Test
    fun dualDiagonalUsesTopLeftAndBottomRight() {
        val region = ScanRegion(240, 0, 1440, 1440)
        val pair = ScanLayout.dualDiagonal(region)
        assertEquals(2, pair.size)
        val overlays = ScanLayout.overlappingQuadrants(region)
        assertEquals(overlays[0], pair[0])
        assertEquals(overlays[3], pair[1])
        assertTrue(pair[0].left < pair[1].left)
        assertTrue(pair[0].top < pair[1].top)
    }

    @Test
    fun pairFromHitPlacesSiblingToTheRightWhenThereIsRoom() {
        val points = listOf(120f to 140f, 280f to 140f, 120f to 280f, 280f to 280f)
        val pair = ScanLayout.pairFromHit(points, 1920, 1440)
        assertEquals(2, pair.size)
        assertTrue(pair[0].left < pair[1].left)
        assertTrue(pair[1].left >= pair[0].left + pair[0].width / 2)
        assertTrue(pair[1].left + pair[1].width <= 1920)
    }

    @Test
    fun pairFromHitPlacesSiblingToTheLeftNearTheRightEdge() {
        val points = listOf(1600f to 140f, 1760f to 140f, 1600f to 280f, 1760f to 280f)
        val pair = ScanLayout.pairFromHit(points, 1920, 1440)
        assertEquals(2, pair.size)
        assertTrue(pair[0].left < pair[1].left)
        assertTrue(pair[0].left + pair[0].width / 2 < 1600)
    }
}
