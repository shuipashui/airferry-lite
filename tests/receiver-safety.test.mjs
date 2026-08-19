import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");
const indexHtml = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
assert.ok(indexHtml.includes('id="openSender"') && indexHtml.includes("sender/dist/airferry-lite-sender.html"), "receiver must link to the sender");
const serviceWorker = await fs.readFile(new URL("../sw.js", import.meta.url), "utf8");
const mirrorSource = await fs.readFile(new URL("../web-receiver/app.js", import.meta.url), "utf8");
const mirrorServiceWorker = await fs.readFile(new URL("../web-receiver/sw.js", import.meta.url), "utf8");
const storage = await fs.readFile(new URL("../receiver-storage.js", import.meta.url), "utf8");
const worker = await fs.readFile(new URL("../decoder-worker.js", import.meta.url), "utf8");
const multiWorker = await fs.readFile(new URL("../vendor/decimen/multi-decoder-worker.js", import.meta.url), "utf8");
new vm.Script(source);
new vm.Script(storage);
new vm.Script(worker);
assert.ok(multiWorker.includes("d.lum") && multiWorker.includes("d.maxSymbols"), "multi-code worker must expand Y-plane luma and accept a per-frame symbol limit");
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
  ,"const HIGH_ACQUIRE_SIZE = 1440;"
  ,"const HIGH_TRACK_SIZE = 960;"
  ,"const HIGH_TILE_SIZE = 720;"
  ,"const HIGH_QUAD_TILE_SIZE = 720;"
  ,"const HIGH_QUAD_PACKED_SIZE = 720;"
  ,">= 4 ? 4 : 2"
  ,"!/Android/i.test(navigator.userAgent || \"\")"
  ,"const RECEIVER_BUILD = \"v57\";"
  ,"function grabLumaRegion"
  ,"function cropLuma"
  ,"function downscaleLuma"
  ,"function postLumaToWorker"
  ,"function scanQuadFromLuma"
  ,"function grabCanvasPacked"
  ,"function rgbaToLuma"
  ,"function grabBitmapPacked"
  ,"function grabPackedRegion"
  ,"function unionScanCrops"
  ,"function decodeQuadFrame"
  ,"function rememberQuadHits"
  ,"function chooseQuadRegion"
  ,"function readCropsFromPacked"
  ,"function tileCovered"
  ,"highJobWaiters"
  ,"highSingleConfirmed"
  ,"function lockQuadSlots"
  ,"function tileCenter"
  ,"HIGH_QUAD_FROZEN_MISS_LIMIT"
  ,"let highQuadFrozen = false;"
  ,"if (highMultiLayout && transferHits.length && !highQuadFrozen)"
  ,"if (highGrabInFlight || highWorkerBusy.some(Boolean))"
  ,"if (!fresh || fresh.length < 2) return;"
  ,"quadPackCanvas"
  ,"highGrabInFlight = false;"
  ,"highScanRoi = null;"
  ,"if (!androidCam)"
  ,"let startInFlight = false;"
  ,"function waitForCameraVideo"
  ,"hideStopTimer"
  ,"inferMissingQuadTiles(highTrackedTiles)"
  ,"let highGrabInFlight = false;"
  ,"lockQuadSlots(tiles, true)"
  ,"lum: copy.buffer"
  ,"function locateQuadWithNative"
  ,"function nativeCodesToTiles"
  ,"function mergeVideoTiles"
  ,"function slotTilesByCluster"
  ,"wasProven"
  ,"function quadGridSlot"
  ,"function nextQuadSource"
  ,"function inferMissingQuadTiles"
  ,"function exclusiveQuadrants"
  ,"known.length < 2"
  ,"function currentHighScanSize"
  ,"function nextHighScanJobs"
  ,"function overlappingQuadrants"
  ,"function tilesFromHits"
  ,"function clampScanRegion"
  ,"function scanSizeForSource"
  ,"function postHighSpeedRegion"
  ,"let captureViaCanvas = false;"
  ,"maxSymbols"
  ,"highMultiLayout"
  ,"function fullFrameSource"
  ,"function inflateRect"
  ,"updateHighScanRoiFromHits"
  ,"const HIGH_ROI_MISS_LIMIT = 8;"
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
assert.ok(indexHtml.includes("app.js?v=57"), "index.html must cache-bust app.js with the current receiver build");
assert.ok(!source.includes("highMultiLayout || !highSingleConfirmed"), "single-code acquire must not be replaced by quadrant crops");
assert.ok(!source.includes("dueRelock"), "quad must not fall back to overlapping quadrants after empty misses");
assert.ok(!source.includes("HIGH_MULTI_FULL_DECODE_EVERY"), "quad must not periodic-relock the whole ROI");
assert.ok(source.includes("locked < 4 && now - lastNativeLocate > HIGH_QUAD_ACQUIRE_MS"), "native locate must stop once four tiles are locked");
assert.ok(!source.includes("HIGH_QUAD_TRACK_MS"), "locked quad must not keep running full-frame BarcodeDetector");
assert.ok(!source.includes("}, HIGH_TILE_PAD));"), "tracked quad boxes must not be stored with the scan pad");
assert.ok(source.includes("if (highMultiLayout) return grabBitmapPacked(source);"), "quad packed grabs must use a single resized ImageBitmap");
assert.ok(!source.includes("nudgeFrozenTiles"), "quad tiles must not be nudged by neighbor hits");
assert.ok(!source.includes("HIGH_TILE_PAD_LOCK"), "quad tiles must not use a second lock pad");
assert.ok(source.includes("highQuadFrozen ? HIGH_QUAD_FROZEN_MISS_LIMIT : HIGH_QUAD_TILE_MISS_LIMIT"), "frozen quad grid must survive brief handshake misses");
assert.ok(source.includes("const useLuma = highMultiLayout &&"), "single-code scans must not use the quad luma grab");
assert.ok(!source.includes("probeMulti"), "single-code scans must not be shredded into quad quadrants");
assert.ok(!source.includes("if (lastHitBox >= 700) return Math.min(HIGH_TILE_SIZE, longest);"), "close single-code full frames must not be capped at 720");
assert.ok(source.includes("const close = !highMultiLayout && box >= view * HIGH_CLOSE_BOX_RATIO"), "close single codes must keep a padded QR crop instead of scanning the whole portrait frame");
assert.ok(!source.includes("box >= view * HIGH_CLOSE_BOX_RATIO && !highMultiLayout"), "close single codes must not drop ROI and decode the full 1440x1920 frame");
assert.ok(source.includes("if (!highMultiLayout && !highScanRoi) return;"), "single-code speed clocks must wait until the QR crop is locked");
assert.ok(source.includes("let swRefreshing = false;"), "service worker updates must reload even when the previous build already recorded a refresh");
assert.ok(serviceWorker.includes("client.navigate(client.url)"), "new service worker must navigate open pages off a stuck old build");
assert.ok(serviceWorker.includes('const CACHE_NAME = "airferry-lite-v57";'), "service worker cache version was not bumped");
assert.ok(serviceWorker.includes('path.endsWith(".wasm")'), "service worker must cache WASM/worker files instead of no-store");
assert.ok(serviceWorker.includes('"./highspeed-protocol.js"') && serviceWorker.includes('"./vendor/decimen/highspeed-decoder-worker.js"') && serviceWorker.includes('"./vendor/decimen/multi-decoder-worker.js"') && serviceWorker.includes('"./vendor/decimen/zxing_reader-EOacYbLr.wasm"'), "high-speed receiver assets are not cached");
assert.equal(mirrorSource, source, "web-receiver app.js drifted from the published root receiver");
assert.equal(mirrorServiceWorker, serviceWorker, "web-receiver sw.js drifted from the published root receiver");
console.log("receiver safety checks ok");
