package com.airferrylite.receiver

import kotlin.math.max
import kotlin.math.min

internal data class ScanRegion(val left: Int, val top: Int, val width: Int, val height: Int)

/** Geometric crops for 2×2 sender tiles that rarely line up with the camera midline. */
internal object ScanLayout {
    const val QUAD_OVERLAP = 0.12f
    const val ROI_MISS_LIMIT = 8
    private const val MIN_SIDE = 64

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
            codeCount >= 4 -> max(boxW, boxH) * 1.18f
            codeCount >= 2 -> max(boxW, boxH) * 1.55f
            coverGrid -> max(boxW, boxH) * 3.8f
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
}
