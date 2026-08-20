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
  ,"const RECEIVER_BUILD = \"v75\";"
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
  ,"function grabQuadPackedBitmap"
  ,"function scanQuadCrops"
  ,"function postBitmapToWorker"
  ,"function idleHighWorkerSlots"
  ,"function pickQuadCrops"
  ,"function rememberQuadHits"
  ,"function followContainedQuadHits"
  ,"function transferHitTile"
  ,"function slotContainingHit"
  ,"function grabMaxSideForSource"
  ,"const HIGH_SINGLE_INFLIGHT = 4;"
  ,"const HIGH_QUAD_INFLIGHT = 2;"
  ,"const HIGH_QUAD_GRAB_MS = 16;"
  ,"function chooseQuadRegion"
  ,"function readCropsFromPacked"
  ,"function tileCovered"
  ,"highJobWaiters"
  ,"highSingleConfirmed"
  ,"function lockQuadSlots"
  ,"function tileCenter"
  ,"HIGH_QUAD_FROZEN_MISS_LIMIT"
  ,"let highQuadFrozen = false;"
  ,"if (highQuadFrozen)"
  ,"followContainedQuadHits(transferHits)"
  ,"if (highGrabInFlight)"
  ,"if (!fresh || fresh.length < 2) return;"
  ,"quadPackCanvas"
  ,"highGrabInFlight = false;"
  ,"highScanRoi = null;"
  ,"if (!androidCam)"
  ,"let startInFlight = false;"
  ,"function bindCameraEnded"
  ,"function cameraPreviewLive"
  ,"function freezeCameraPreview"
  ,"cameraEndedWhileStarting"
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
  ,"function getHighSpeedSource"
  ,"function overlappingQuadrants"
  ,"function tilesFromHits"
  ,"function clampScanRegion"
  ,"function scanSizeForSource"
  ,"function grabFullVideoBitmap"
  ,"function cropBitmapToSource"
  ,"function clampBitmapRect"
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
assert.ok(indexHtml.includes("app.js?v=75"), "index.html must cache-bust app.js with the current receiver build");
assert.ok(indexHtml.includes('id="cameraFreeze"'), "stop must freeze the last preview frame instead of flashing black");
assert.ok(!source.includes("highMultiLayout || !highSingleConfirmed"), "single-code acquire must not be replaced by quadrant crops");
assert.ok(!source.includes("dueRelock"), "quad must not fall back to overlapping quadrants after empty misses");
assert.ok(!source.includes("HIGH_MULTI_FULL_DECODE_EVERY"), "quad must not periodic-relock the whole ROI");
assert.ok(source.includes("!highMultiLayout && (!highScanRoi || highScanMisses >= 3)"), "native locate is only for unlocked single-code ROI");
assert.ok(!source.includes("highMultiLayout && locked < 4"), "quad must not keep BarcodeDetector.detect(video) running after layout is known");
assert.ok(source.includes("tiles.length === 1 && !highMultiLayout"), "single-code acquire must use BarcodeDetector to lock an ROI before V34 WASM searches 1440");
assert.ok(source.includes("if (full) return HIGH_TRACK_SIZE;"), "unlocked single-code full frames must acquire at 960, not 1440");
assert.ok(source.includes("if (!finishing)"), "completed transfers must keep layout diagnostics after the camera stops");
assert.ok(!source.includes("HIGH_QUAD_TRACK_MS"), "locked quad must not keep running full-frame BarcodeDetector");
assert.ok(!source.includes("}, HIGH_TILE_PAD));"), "tracked quad boxes must not be stored with the scan pad");
assert.ok(source.includes("if (highMultiLayout) return grabBitmapPacked(source);"), "packed luma remains a fallback if ImageBitmap grab fails");
assert.ok(source.includes("add(await scanQuadCrops(crops, false));") || source.includes("const hits = await scanQuadCrops(crops, false);"), "quad must keep the v70 pipeline around scanQuadCrops");
assert.ok(source.includes("const grabbed = await grabQuadPackedBitmap(region);"), "quad must snapshot the 2x2 once and post the bitmap, not getImageData on the page");
assert.ok(source.includes("highGrabInFlight = false") && source.includes("return pending;"), "quad must release the camera grab before waiting for WASM decode");
assert.ok(source.includes("highWorkerBusy.filter(Boolean).length >= HIGH_QUAD_INFLIGHT"), "quad must cap overlapping 720 video bitmaps");
assert.ok(!source.includes("if (highGrabInFlight || highWorkerBusy.some(Boolean))"), "quad must not wait for every worker before grabbing the next camera frame");
assert.ok(!source.includes("scanQuadCrops(retries, true)"), "quad must not hold the camera frame for a second decode pass");
assert.ok(!source.includes("frameRate: { ideal: 30, max: 30 }"), "Android preview must be allowed to run at 60 FPS again");
assert.ok(source.includes("cameraRequestedFps = 60;"), "Android camera request must report a 60 FPS cap");
assert.ok(!source.includes("function grabQuadTileBitmaps"), "v71 atlas crops from a 1440 video snapshot made this phone stutter");
assert.ok(!source.includes("function grabQuadTileBitmap"), "quad must not issue one createImageBitmap per tile from the live video");
assert.ok(!source.includes("function dropDeadCamera"), "a stalled decode must not stop the camera track");
assert.ok(!source.includes("nudgeFrozenTiles"), "quad tiles must not be nudged by neighbor hits");
assert.ok(!source.includes("function rebuildQuadFromHits"), "locked quad must not rebuild the 2x2 from sparse WASM hits");
assert.ok(source.includes("width: { ideal: 1440 }"), "Android camera must request portrait 1440x1920 instead of landscape 1920x1440");
assert.ok(source.includes("cameraEndedWhileStarting"), "startup ended events must not immediately close the camera");
assert.ok(source.includes("if (track.readyState === \"live\" && !track.muted && !video.paused && video.readyState >= 2 && video.videoWidth)"), "spurious ended must not close the camera while the preview still has a frame");
assert.ok(source.includes("cameraEndedBound"), "the camera ended listener must only bind once per track");
assert.ok(source.includes("startBtn.disabled = false;"), "Start must stay clickable so a dead preview can be reopened");
assert.ok(source.includes("if (cameraPreviewLive()) return;"), "Start must replace a dead camera instead of no-op");
assert.ok(source.includes("function cameraPreviewLive"), "Start must inspect muted/paused preview, not only track.readyState");
assert.ok(!source.includes("if (live && live.readyState === \"live\") return;"), "a live-but-black track must not block Start");
assert.ok(!source.includes("Promise.all(jobs.map(crop => grabQuadTileBitmap(crop)))"), "quad must not issue one createImageBitmap per tile from the live video");
assert.ok(source.includes("bindCameraEnded(activeStream)"), "spurious ended must re-arm the camera listener");
assert.ok(!source.includes("HIGH_TILE_PAD_LOCK"), "quad tiles must not use a second lock pad");
assert.ok(source.includes("highQuadFrozen ? HIGH_QUAD_FROZEN_MISS_LIMIT : HIGH_QUAD_TILE_MISS_LIMIT"), "frozen quad grid must survive brief handshake misses");
assert.ok(source.includes("const useLuma = highMultiLayout &&"), "single-code scans must not use the quad luma grab");
assert.ok(!source.includes("probeMulti"), "single-code scans must not be shredded into quad quadrants");
assert.ok(!source.includes("if (lastHitBox >= 700) return Math.min(HIGH_TILE_SIZE, longest);"), "close single-code full frames must not be capped at 720");
assert.ok(source.includes("if (highScanMisses > 0) return inflateRect(highScanRoi, 1.2 + highScanMisses * 0.2);"), "single-code tracking must keep an ROI so WASM does not search the whole portrait");
assert.ok(source.includes("if (tile || highMultiLayout || highScanRoi) return Math.min(HIGH_TILE_SIZE, longest);"), "locked single-code ROI must scan at 720 like v26, not 960/1440");
assert.ok(source.includes("createImageBitmap(video, 0, 0, vw, vh,"), "unlocked single-code acquire must snapshot the full frame");
assert.ok(source.includes("!tile && !highMultiLayout && !highScanRoi"), "locked single-code must not keep snapshotting the full 1440 frame");
assert.ok(source.includes("createImageBitmap(video, x, y, widthSrc, heightSrc,"), "locked single-code must crop the video to the ROI like quad packed grabs");
assert.ok(!source.includes("MediaStreamTrackProcessor"), "single-code must not clone or consume the camera track");
assert.ok(!source.includes("live.clone()"), "cloning the camera track flashes this Chrome preview");
assert.ok(!source.includes("postedFrame = new VideoFrame(video)"), "new VideoFrame(video) is a full-frame readback and must not be the single-code path");
assert.ok(source.includes(" · 取帧 "), "diagnostics must show whether bitmap or canvas captured the frame");
assert.ok(!source.includes("createImageBitmap(full.bitmap"), "locked single-code must not make a second main-thread ImageBitmap crop");
assert.ok(!source.includes("await cropBitmapToSource"), "ROI geometry must not await a main-thread bitmap crop");
assert.ok(source.includes("retryBinarizer, crop }"), "ImageBitmap posts must include the worker crop field");
assert.ok(!source.includes("if (highScanMisses >= 12) captureViaCanvas"), "decode misses must not stick the session on the canvas path");
assert.ok(!source.includes("createImageBitmap(video, {"), "ImageBitmap grabs must pass a source rectangle so Chrome can GPU-scale");
assert.ok(!source.includes("if (!highMultiLayout && !highScanRoi) return;"), "single-code speed must not wait for an ROI crop before counting bytes");
assert.ok(source.includes("navigator.serviceWorker.register(\"sw.js?v=\" + RECEIVER_BUILD)"), "the page must still register the versioned service worker");
assert.ok(!source.includes("controllerchange"), "a new service worker must not reload the page and kill getUserMedia");
assert.ok(!source.includes("location.reload()"), "the receiver must not reload itself when the worker activates");
assert.ok(serviceWorker.includes("self.clients.claim()"), "the new service worker must still take over open pages");
assert.ok(!serviceWorker.includes("client.navigate(client.url)"), "activating the worker must not navigate the page and kill getUserMedia");
assert.ok(serviceWorker.includes("ASSETS.filter((path) => !path.endsWith(\".wasm\"))") || serviceWorker.includes("ASSETS.filter(path => !path.endsWith(\".wasm\"))"), "install must not wait to download WASM before the page can open the camera");
assert.ok(serviceWorker.includes('const CACHE_NAME = "airferry-lite-v75";'), "service worker cache version was not bumped");
assert.ok(serviceWorker.includes('path.endsWith(".wasm")'), "service worker must cache WASM/worker files instead of no-store");
assert.ok(serviceWorker.includes('"./highspeed-protocol.js"') && serviceWorker.includes('"./vendor/decimen/highspeed-decoder-worker.js"') && serviceWorker.includes('"./vendor/decimen/multi-decoder-worker.js"') && serviceWorker.includes('"./vendor/decimen/zxing_reader-EOacYbLr.wasm"'), "high-speed receiver assets are not cached");
assert.equal(mirrorSource, source, "web-receiver app.js drifted from the published root receiver");
assert.equal(mirrorServiceWorker, serviceWorker, "web-receiver sw.js drifted from the published root receiver");
console.log("receiver safety checks ok");
