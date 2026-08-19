import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");
const serviceWorker = await fs.readFile(new URL("../sw.js", import.meta.url), "utf8");
const mirrorSource = await fs.readFile(new URL("../web-receiver/app.js", import.meta.url), "utf8");
const mirrorServiceWorker = await fs.readFile(new URL("../web-receiver/sw.js", import.meta.url), "utf8");
const storage = await fs.readFile(new URL("../receiver-storage.js", import.meta.url), "utf8");
const worker = await fs.readFile(new URL("../decoder-worker.js", import.meta.url), "utf8");
const multiWorker = await fs.readFile(new URL("../vendor/decimen/multi-decoder-worker.js", import.meta.url), "utf8");
new vm.Script(source);
new vm.Script(storage);
new vm.Script(worker);
assert.ok(multiWorker.includes("f.data.maxSymbols"), "multi-code worker was not generated");
assert.ok(multiWorker.includes("tryHarder:false") && multiWorker.includes("tryRotate:false"), "WASM decoder must skip extra screen-search passes");
assert.ok(multiWorker.includes("tryInvert:false"), "WASM decoder must not invert screen QR codes");
assert.ok(multiWorker.includes("GlobalHistogram") && multiWorker.includes("retryBinarizer"), "WASM decoder must retry GlobalHistogram only when asked");
assert.ok(!multiWorker.includes('["LocalAverage",true]'), "WASM decoder must not run invert retries");
for (const needle of [
  "const MAX_FILE_SIZE = 64 * 1024 * 1024;",
  "const MAX_CHUNKS = 200000;",
  "function updateScanRegion",
  "function scheduleScan",
  "requestVideoFrameCallback",
  "canvas.width !== nextWidth",
  "function isRedundantDecoded",
  "function configureCameraTrack",
  "ideal: 120",
  'new Error("DecoderUnavailable")',
  "scanErrors >= 10",
  "detectorErrors >= 3",
  "missing = new Set",
  "frame.bytes.length === expectedLength",
  "function acceptParityFrame",
  "function tryRecoverGroup",
  "function updateSpeed",
  "function formatRate"
  ,"function restoreSavedSession"
  ,"function decodeWithWorker"
  ,"P.restorePayload(bytes, meta)"
  ,"function acceptHighSpeedFrame"
  ,"function scanWithHighSpeedWorkers"
  ,"const HIGH_WORKER_TIMEOUT = 2500;"
  ,"function restartHighSpeedWorker"
  ,"highWorkerReady[index]"
  ,"highWorkerBusy.findIndex"
  ,'new Worker("vendor/decimen/highspeed-decoder-worker.js")'
  ,"const HIGH_MAX_SCAN = 720;"
  ,"const RECEIVER_BUILD = \"v23\";"
  ,"function currentHighScanSize"
  ,"function nextHighScanJobs"
  ,"function overlappingQuadrants"
  ,"function tilesFromHits"
  ,"function clampScanRegion"
  ,"function scanSizeForSource"
  ,"function refreshNativeBoxes"
  ,"function regionFromDetector"
  ,"function postHighSpeedRegion"
  ,"let captureViaCanvas = false;"
  ,"maxSymbols"
  ,"highMultiLayout"
  ,"box * pad"
  ,"updateHighScanRoiFromHits"
  ,"HIGH_ROI_MISS_LIMIT"
  ,"HIGH_CLOSE_BOX_RATIO"
  ,"centerSquareSource"
  ,"retryBinarizer"
  ,"resizeQuality: \"pixelated\""
  ,"colorSpaceConversion: \"none\""
  ,"copyDiagnosticsCard"
  ,"function resetSpeed"
  ,"latestSpeedLabel"
  ,"实时 — · 平均 —"
  ,"elapsed < 1000"
  ," · 每帧 "
]) assert.ok(source.includes(needle), "missing receiver guard: " + needle);
assert.ok(serviceWorker.includes('const CACHE_NAME = "airferry-lite-v23";'), "service worker cache version was not bumped");
assert.ok(serviceWorker.includes('cache: "no-store"'), "service worker must bypass HTTP cache when fetching updates");
assert.ok(serviceWorker.includes('"./highspeed-protocol.js"') && serviceWorker.includes('"./vendor/decimen/highspeed-decoder-worker.js"') && serviceWorker.includes('"./vendor/decimen/multi-decoder-worker.js"') && serviceWorker.includes('"./vendor/decimen/zxing_reader-EOacYbLr.wasm"'), "high-speed receiver assets are not cached");
assert.equal(mirrorSource, source, "web-receiver app.js drifted from the published root receiver");
assert.equal(mirrorServiceWorker, serviceWorker, "web-receiver sw.js drifted from the published root receiver");
console.log("receiver safety checks ok");
