package com.airferrylite.receiver

import kotlin.math.max
import kotlin.math.min

internal data class ScanRegion(val left: Int, val top: Int, val width: Int, val height: Int)

/** Geometric crops for 2×2 sender tiles that rarely line up with the camera midline. */
internal object ScanLayout {
    const val QUAD_OVERLAP = 0.18f
    const val ROI_MISS_LIMIT = 8
    private const val MIN_SIDE = 64

    fun usesTightTiles(hitCount: Int) = hitCount >= 3

    fun centerSquare(width: Int, height: Int): ScanRegion {
        val side = min(width, height).coerceAtLeast(1)
        return ScanRegion((width - side) / 2, (height - side) / 2, side, side)
    }

    fun exclusiveQuadrants(region: ScanRegion): List<ScanRegion> {
        val halfW = (region.width / 2).coerceAtLeast(1)
        val halfH = (region.height / 2).coerceAtLeast(1)
        val right = region.left + region.width - halfW
        val bottom = region.top + region.height - halfH
        return listOf(
            ScanRegion(region.left, region.top, halfW, halfH),
            ScanRegion(right, region.top, halfW, halfH),
            ScanRegion(region.left, bottom, halfW, halfH),
            ScanRegion(right, bottom, halfW, halfH)
        )
    }

    fun overlappingQuadrants(region: ScanRegion): List<ScanRegion> {
        val cropW = ((0.5f + QUAD_OVERLAP) * region.width).toInt().coerceIn(1, region.width)
        val cropH = ((0.5f + QUAD_OVERLAP) * region.height).toInt().coerceIn(1, region.height)
        val right = region.left + region.width - cropW
        val bottom = region.top + region.height - cropH
        return listOf(
            ScanRegion(region.left, region.top, cropW, cropH),
            ScanRegion(right, region.top, cropW, cropH),
            ScanRegion(region.left, bottom, cropW, cropH),
            ScanRegion(right, bottom, cropW, cropH)
        )
    }

    fun regionFromPoints(
        points: List<Pair<Float, Float>>,
        imageWidth: Int,
        imageHeight: Int,
        codeCount: Int,
        coverGrid: Boolean = false
    ): ScanRegion? {
        if (points.isEmpty() || imageWidth <= 0 || imageHeight <= 0) return null
        var minX = Float.POSITIVE_INFINITY
        var minY = Float.POSITIVE_INFINITY
        var maxX = Float.NEGATIVE_INFINITY
        var maxY = Float.NEGATIVE_INFINITY
        for ((x, y) in points) {
            minX = min(minX, x)
            minY = min(minY, y)
            maxX = max(maxX, x)
            maxY = max(maxY, y)
        }
        val boxW = (maxX - minX).coerceAtLeast(1f)
        val boxH = (maxY - minY).coerceAtLeast(1f)
        val cx = (minX + maxX) / 2f
        val cy = (minY + maxY) / 2f
        val side = when {
            codeCount >= 4 -> max(boxW, boxH) * 1.40f
            coverGrid && codeCount >= 2 -> max(boxW, boxH) * 2.15f
            coverGrid -> max(boxW, boxH) * 3.8f
            codeCount >= 2 -> max(boxW, boxH) * 1.70f
            else -> max(boxW, boxH) * 1.35f
        }
        val half = side / 2f
        val left = (cx - half).toInt()
        val top = (cy - half).toInt()
        return clamp(ScanRegion(left, top, side.toInt().coerceAtLeast(MIN_SIDE), side.toInt().coerceAtLeast(MIN_SIDE)), imageWidth, imageHeight)
    }

    fun union(first: ScanRegion?, second: ScanRegion, imageWidth: Int, imageHeight: Int): ScanRegion {
        if (first == null) return clamp(second, imageWidth, imageHeight)
        val left = min(first.left, second.left)
        val top = min(first.top, second.top)
        val right = max(first.left + first.width, second.left + second.width)
        val bottom = max(first.top + first.height, second.top + second.height)
        val side = max(right - left, bottom - top)
        return clamp(ScanRegion(left, top, side, side), imageWidth, imageHeight)
    }

    fun clamp(region: ScanRegion, width: Int, height: Int): ScanRegion {
        if (width <= 0 || height <= 0) return centerSquare(1, 1)
        val left = region.left.coerceIn(0, (width - 1).coerceAtLeast(0))
        val top = region.top.coerceIn(0, (height - 1).coerceAtLeast(0))
        val cropW = region.width.coerceAtLeast(1).coerceAtMost(width - left)
        val cropH = region.height.coerceAtLeast(1).coerceAtMost(height - top)
        val side = min(cropW, cropH)
        if (side < MIN_SIDE) return centerSquare(width, height)
        return ScanRegion(left, top, side, side)
    }

    fun tilesFromHits(
        hits: List<List<Pair<Float, Float>>>,
        imageWidth: Int,
        imageHeight: Int
    ): List<ScanRegion> {
        val tiles = hits.mapNotNull { points ->
            regionFromPoints(points, imageWidth, imageHeight, 1)?.let {
                inflate(it, 1.18f, imageWidth, imageHeight)
            }
        }
        if (tiles.size <= 1) return tiles
        val midX = tiles.map { it.left + it.width / 2.0 }.average()
        val midY = tiles.map { it.top + it.height / 2.0 }.average()
        return tiles.sortedWith(
            compareBy<ScanRegion> { if (it.top + it.height / 2.0 < midY) 0 else 1 }
                .thenBy { if (it.left + it.width / 2.0 < midX) 0 else 1 }
        )
    }

    fun tileIndexContaining(tiles: List<ScanRegion>, x: Float, y: Float): Int {
        var owner = -1
        for (index in tiles.indices) {
            val tile = tiles[index]
            if (x >= tile.left && x < tile.left + tile.width && y >= tile.top && y < tile.top + tile.height) {
                if (owner >= 0) return -1
                owner = index
            }
        }
        return owner
    }

    fun followContainedHits(
        tiles: List<ScanRegion>,
        hits: List<List<Pair<Float, Float>>>,
        imageWidth: Int,
        imageHeight: Int
    ): List<ScanRegion> {
        if (tiles.isEmpty() || hits.isEmpty()) return tiles
        val next = tiles.toMutableList()
        val claimed = BooleanArray(tiles.size)
        for (points in hits) {
            if (points.isEmpty()) continue
            val cx = points.map { it.first }.average().toFloat()
            val cy = points.map { it.second }.average().toFloat()
            val index = tileIndexContaining(tiles, cx, cy)
            if (index < 0 || claimed[index]) continue
            val tile = regionFromPoints(points, imageWidth, imageHeight, 1)?.let {
                inflate(it, 1.18f, imageWidth, imageHeight)
            } ?: continue
            claimed[index] = true
            next[index] = tile
        }
        return next
    }

    fun inflate(region: ScanRegion, factor: Float, width: Int, height: Int): ScanRegion {
        val side = (max(region.width, region.height) * factor.coerceAtLeast(1f)).toInt().coerceAtLeast(MIN_SIDE)
        val cx = region.left + region.width / 2
        val cy = region.top + region.height / 2
        return clamp(ScanRegion(cx - side / 2, cy - side / 2, side, side), width, height)
    }

    fun activeRegion(tracked: ScanRegion?, misses: Int, width: Int, height: Int): ScanRegion {
        if (tracked == null || misses >= ROI_MISS_LIMIT) return centerSquare(width, height)
        val clamped = clamp(tracked, width, height)
        if (misses <= 0) return clamped
        return inflate(clamped, 1f + misses * 0.22f, width, height)
    }
}
