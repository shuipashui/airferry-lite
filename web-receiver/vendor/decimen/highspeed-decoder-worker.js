/* Bitmap/RGBA bridge. Must live next to zxing_reader-*.wasm so relative locateFile works. */
importScripts("./multi-decoder-worker.js");
const decodeMessage = self.onmessage;
const nativePost = self.postMessage.bind(self);
let decodeWaiter = null;
let captureCanvas = null;
let captureContext = null;

self.postMessage = function patchedPost(msg, transfer) {
  if (decodeWaiter) {
    const resolve = decodeWaiter;
    decodeWaiter = null;
    resolve(msg);
    return;
  }
  return nativePost(msg, transfer);
};

function drawBitmapToCanvas(bitmap, crop) {
  let width = bitmap.width;
  let height = bitmap.height;
  if (crop && crop.w >= 1 && crop.h >= 1) {
    width = Math.max(1, Math.round(crop.dw || crop.w));
    height = Math.max(1, Math.round(crop.dh || crop.h));
  }
  if (!captureCanvas || captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas = new OffscreenCanvas(width, height);
    captureContext = captureCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  }
  captureContext.imageSmoothingEnabled = false;
  if (crop && crop.w >= 1 && crop.h >= 1) {
    captureContext.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  } else {
    captureContext.drawImage(bitmap, 0, 0);
  }
  return { width, height };
}

async function bitmapFromFrame(frame, crop) {
  const dw = Math.max(1, Math.round(crop && crop.dw ? crop.dw : (crop && crop.w) || frame.displayWidth || frame.codedWidth));
  const dh = Math.max(1, Math.round(crop && crop.dh ? crop.dh : (crop && crop.h) || frame.displayHeight || frame.codedHeight));
  const x = crop && crop.w >= 1 ? crop.x : 0;
  const y = crop && crop.h >= 1 ? crop.y : 0;
  const w = crop && crop.w >= 1 ? crop.w : (frame.displayWidth || frame.codedWidth);
  const h = crop && crop.h >= 1 ? crop.h : (frame.displayHeight || frame.codedHeight);
  return createImageBitmap(frame, x, y, w, h, {
    resizeWidth: dw,
    resizeHeight: dh,
    resizeQuality: "pixelated",
    colorSpaceConversion: "none"
  });
}

function cropImageData(image, x, y, w, h) {
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const src = image.data;
  const sw = image.width;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const start = ((top + row) * sw + left) * 4;
    out.set(src.subarray(start, start + width * 4), row * width * 4);
  }
  return new ImageData(out, width, height);
}

function offsetPosition(position, dx, dy) {
  if (!position) return position;
  const next = {};
  for (const key of ["topLeft", "topRight", "bottomRight", "bottomLeft"]) {
    const point = position[key];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      next[key] = { x: point.x + dx, y: point.y + dy };
    }
  }
  return next;
}

function hitList(msg) {
  const bytes = msg && msg.bytes;
  if (!bytes) return [];
  const items = Array.isArray(bytes) ? bytes : [bytes];
  return items.filter(Boolean).map(item => {
    if (item && item.bytes) return { bytes: item.bytes, position: item.position || null };
    return { bytes: item, position: null };
  });
}

function hitKey(hit) {
  const bytes = hit && hit.bytes;
  if (!bytes) return "";
  if (typeof bytes === "string") return bytes;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
  if (view.length < 8) return String(view.length);
  return view[0] + ":" + view[1] + ":" + view[4] + ":" + view[5] + ":" + view[6] + ":" + view[7] + ":" + view.length;
}

function decodeOnce(payload) {
  return new Promise(resolve => {
    decodeWaiter = resolve;
    try {
      const result = decodeMessage({ data: payload });
      if (result && typeof result.then === "function") {
        result.catch(() => {
          if (decodeWaiter === resolve) {
            decodeWaiter = null;
            resolve({ id: payload.id, bytes: null });
          }
        });
      }
    } catch (_) {
      decodeWaiter = null;
      resolve({ id: payload.id, bytes: null });
    }
  });
}

async function decodePackedTiles(id, image, tiles, retryBinarizer) {
  const merged = [];
  const seen = new Set();
  for (const tile of tiles) {
    const x = Math.max(0, Math.floor(tile.x || 0));
    const y = Math.max(0, Math.floor(tile.y || 0));
    const w = Math.max(1, Math.floor(tile.w || tile.width || 0));
    const h = Math.max(1, Math.floor(tile.h || tile.height || 0));
    if (x >= image.width || y >= image.height) continue;
    const width = Math.min(w, image.width - x);
    const height = Math.min(h, image.height - y);
    if (width < 24 || height < 24) continue;
    const crop = cropImageData(image, x, y, width, height);
    const msg = await decodeOnce({
      id,
      buf: crop.data.buffer,
      w: width,
      h: height,
      maxSymbols: 1,
      retryBinarizer
    });
    for (const hit of hitList(msg)) {
      const key = hitKey(hit);
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push({
          bytes: hit.bytes,
          position: offsetPosition(hit.position, x, y)
        });
      }
    }
    if (merged.length >= 4) break;
  }
  nativePost({ id, bytes: merged.length ? merged : null });
}

async function decodeBitmap(data) {
  const { bitmap, id, maxSymbols, retryBinarizer, crop, tiles } = data;
  const sized = drawBitmapToCanvas(bitmap, crop);
  bitmap.close();
  const image = captureContext.getImageData(0, 0, sized.width, sized.height);
  if (tiles && tiles.length >= 2) {
    await decodePackedTiles(id, image, tiles, retryBinarizer);
    return;
  }
  decodeMessage({ data: { id, buf: image.data.buffer, w: sized.width, h: sized.height, maxSymbols, retryBinarizer } });
}

async function bridgeMessage(event) {
  const data = event.data || {};
  if (data.frame) {
    const { frame, id, maxSymbols, retryBinarizer, crop } = data;
    try {
      const bitmap = await bitmapFromFrame(frame, crop);
      frame.close();
      await decodeBitmap({ bitmap, id, maxSymbols, retryBinarizer, crop: null, tiles: data.tiles });
    } catch (_) {
      try { frame.close(); } catch (_) {}
      nativePost({ id, bytes: null });
    }
    return;
  }
  if (data.lum || !data.bitmap) {
    decodeMessage(event);
    return;
  }
  try {
    await decodeBitmap(data);
  } catch (_) {
    try { data.bitmap.close(); } catch (_) {}
    nativePost({ id: data.id, bytes: null });
  }
}

self.onmessage = bridgeMessage;
