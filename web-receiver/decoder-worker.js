/* jsQR worker used by the mobile web receiver. */
importScripts("vendor/jsQR.js");

self.onmessage = (event) => {
  const { id, buffer, width, height } = event.data || {};
  try {
    const pixels = new Uint8ClampedArray(buffer);
    const code = self.jsQR(pixels, width, height, { inversionAttempts: "dontInvert" });
    self.postMessage({ id, code: code ? { data: code.data, location: code.location } : null });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "decode failed" });
  }
};
