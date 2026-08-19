/* Moves camera RGBA extraction off the page's main thread before ZXing WASM decoding.
   Prefer vendor/decimen/highspeed-decoder-worker.js as the Worker URL so the WASM
   file resolves next to this script. This root entry exists for older cached pages. */
importScripts("vendor/decimen/multi-decoder-worker.js");
const decodeMessage = self.onmessage;
let captureCanvas = null;
let captureContext = null;

async function bridgeMessage(event) {
  const { bitmap, id, maxSymbols, retryBinarizer } = event.data || {};
  if (!bitmap) {
    decodeMessage(event);
    return;
  }

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!captureCanvas || captureCanvas.width !== width || captureCanvas.height !== height) {
      captureCanvas = new OffscreenCanvas(width, height);
      captureContext = captureCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    }
    captureContext.imageSmoothingEnabled = false;
    captureContext.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = captureContext.getImageData(0, 0, width, height);
    decodeMessage({ data: { id, buf: image.data.buffer, w: width, h: height, maxSymbols, retryBinarizer } });
  } catch (_) {
    try { bitmap.close(); } catch (_) {}
    self.postMessage({ id, bytes: null });
  }
}

self.onmessage = bridgeMessage;
