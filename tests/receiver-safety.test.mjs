import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");
const serviceWorker = await fs.readFile(new URL("../sw.js", import.meta.url), "utf8");
const mirrorSource = await fs.readFile(new URL("../web-receiver/app.js", import.meta.url), "utf8");
const mirrorServiceWorker = await fs.readFile(new URL("../web-receiver/sw.js", import.meta.url), "utf8");
new vm.Script(source);
for (const needle of [
  "const MAX_FILE_SIZE = 64 * 1024 * 1024;",
  "const MAX_CHUNKS = 200000;",
  "function updateScanRegion",
  "function scheduleScan",
  "requestVideoFrameCallback",
  "canvas.width !== nextWidth",
  "function isRedundantDecoded",
  "function configureCameraTrack",
  'new Error("DecoderUnavailable")',
  "scanErrors >= 10",
  "detectorErrors >= 3",
  "missing = new Set",
  "frame.bytes.length === expectedLength",
  "function acceptParityFrame",
  "function tryRecoverGroup"
]) assert.ok(source.includes(needle), "missing receiver guard: " + needle);
assert.ok(serviceWorker.includes('const CACHE_NAME = "airferry-lite-v4";'), "service worker cache version was not bumped");
assert.equal(mirrorSource, source, "web-receiver app.js drifted from the published root receiver");
assert.equal(mirrorServiceWorker, serviceWorker, "web-receiver sw.js drifted from the published root receiver");
console.log("receiver safety checks ok");
