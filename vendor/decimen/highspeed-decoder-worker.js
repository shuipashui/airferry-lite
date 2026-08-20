/* Bitmap/RGBA bridge. Must live next to zxing_reader-*.wasm so relative locateFile works. */
importScripts("./multi-decoder-worker.js");
const decodeMessage = self.onmessage;
let captureCanvas = null;
let captureContext = null;

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

async function bridgeMessage(event) {
  const data = event.data || {};
  if (data.frame) {
    const { frame, id, maxSymbols, retryBinarizer, crop } = data;
    try {
      const bitmap = await bitmapFromFrame(frame, crop);
      frame.close();
      const sized = drawBitmapToCanvas(bitmap, null);
      bitmap.close();
      const image = captureContext.getImageData(0, 0, sized.width, sized.height);
      decodeMessage({ data: { id, buf: image.data.buffer, w: sized.width, h: sized.height, maxSymbols, retryBinarizer } });
    } catch (_) {
      try { frame.close(); } catch (_) {}
      self.postMessage({ id, bytes: null });
    }
    return;
  }
  if (data.lum || !data.bitmap) {
    decodeMessage(event);
    return;
  }
  const { bitmap, id, maxSymbols, retryBinarizer, crop } = data;

  try {
    const sized = drawBitmapToCanvas(bitmap, crop);
    bitmap.close();
    const image = captureContext.getImageData(0, 0, sized.width, sized.height);
    decodeMessage({ data: { id, buf: image.data.buffer, w: sized.width, h: sized.height, maxSymbols, retryBinarizer } });
  } catch (_) {
    try { bitmap.close(); } catch (_) {}
    self.postMessage({ id, bytes: null });
  }
}

self.onmessage = bridgeMessage;
