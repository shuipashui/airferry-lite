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

async function bridgeMessage(event) {
  const data = event.data || {};
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
