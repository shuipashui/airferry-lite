import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({ArrayBuffer, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, TextEncoder, TextDecoder, Math, Date, console, btoa, atob, crypto: globalThis.crypto});
context.globalThis = context; context.self = context; context.window = context;
for (const path of [new URL("../sender/vendor/qrcode.js", import.meta.url), new URL("../web-receiver/vendor/jsQR.js", import.meta.url), new URL("../shared/protocol.js", import.meta.url)]) vm.runInContext(fs.readFileSync(path, "utf8"), context);
function makeFrame(size, seed) { const bytes = new Uint8Array(size); for (let i = 0; i < size; i++) bytes[i] = (i * 31 + seed * 17) & 255; return context.AirFerryLiteProtocol.makeData("density-test", seed, 99, bytes); }
function render(text, cell) {
  const qr = context.qrcode(0, "M"); qr.addData(text, "Byte"); qr.make();
  const quiet = 4, modules = qr.getModuleCount(), size = (modules + quiet * 2) * cell, rgba = new Uint8ClampedArray(size * size * 4); rgba.fill(255);
  for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) if (qr.isDark(row, col)) for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) { const p = (((row + quiet) * cell + y) * size + (col + quiet) * cell + x) * 4; rgba[p] = rgba[p + 1] = rgba[p + 2] = 0; }
  return { rgba, size, modules };
}
for (const item of [{size: 700, max: 117}, {size: 900, max: 133}, {size: 1000, max: 137}]) for (let seed = 0; seed < 3; seed++) {
  const frame = makeFrame(item.size, seed), image = render(frame, 2); assert.ok(image.modules <= item.max);
  const decoded = context.jsQR(image.rgba, image.size, image.size, {inversionAttempts: "dontInvert"});
  assert.equal(decoded?.data, frame, item.size + " B frame did not decode at 2 px/module");
}
const fast = render(makeFrame(900, 0), 1); assert.ok(Math.floor(900 / (fast.modules + 8)) >= 6, "fast profile is too dense for the sender canvas");
console.log("QR density tests ok");
