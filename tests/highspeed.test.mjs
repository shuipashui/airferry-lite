import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({
  ArrayBuffer, Blob, CompressionStream, DecompressionStream, DataView, Date,
  Float64Array, Math, Promise, Response, Set, TextDecoder, TextEncoder,
  Uint8Array, Uint8ClampedArray, Uint32Array, crypto: globalThis.crypto
});
context.globalThis = context;
context.self = context;
context.window = context;
for (const file of ["../shared/highspeed-protocol.js", "../sender/vendor/qrcode.js"]) {
  vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), "utf8"), context);
}

const H = context.AirFerryHighSpeed;
const source = new TextEncoder().encode("AirFerry high-speed fountain test\n".repeat(240));
const packed = await H.packFile("speed-test.txt", "text/plain", source);
const unpacked = await H.unpackFile(packed.container);
assert.deepEqual(Array.from(unpacked.bytes), Array.from(source));
assert.equal(await H.verifyFile(unpacked), true);

const sessionId = 0x4a31;
const blockLen = 2933;
const encoder = new H.LTEncoder(packed.container, blockLen, sessionId);
const header = { sessionId, seq: 0, k: encoder.k, blockLen, totalLen: packed.container.length, payloadFnv: H.fnv1a(packed.container) };
const first = H.packFrame(header, encoder.encode(0));
const parsed = H.parseFrame(first);
assert.equal(first.length, 2953);
assert.equal(parsed.header.sessionId, sessionId);
assert.deepEqual(Array.from(parsed.block), Array.from(encoder.encode(0)));
const quad = H.packFrame({ ...header, layoutCodes: 4 }, encoder.encode(0));
const parsedQuad = H.parseFrame(quad);
assert.equal(quad[1], 0x0d, "quad frames must carry the AFL2 layout marker");
assert.equal(parsedQuad.header.layoutCodes, 4);
assert.notEqual(H.streamIdentity(parsed.header), H.streamIdentity(parsedQuad.header));
const dualPacked = H.packFrame({ ...header, layoutCodes: 2 }, encoder.encode(0));
const parsedDual = H.parseFrame(dualPacked);
assert.equal(dualPacked[1], 0x1c, "dual frames must carry the AFL2 dual layout marker");
assert.equal(parsedDual.header.layoutCodes, 2);
assert.notEqual(H.streamIdentity(parsedDual.header), H.streamIdentity(parsedQuad.header));
const systematicHeader = { ...header, systematic: true };
const systematic = H.packFrame(systematicHeader, encoder.encode((0x80000000 | 2) >>> 0));
assert.equal(systematic[1], 0x0e);
assert.equal(H.parseFrame(systematic).header.systematic, true);
assert.deepEqual(Array.from(H.frameIndices(encoder.k, H.solitonCdf(encoder.k), sessionId, (0x80000000 | 2) >>> 0)), [2 % encoder.k]);

const systematicDecoder = new H.LTDecoder(encoder.k, blockLen, sessionId, packed.container.length);
for (let index = 0; index < encoder.k; index += 1) {
  const seq = (0x80000000 | index) >>> 0;
  systematicDecoder.addFrame(seq, encoder.encode(seq));
}
assert.equal(systematicDecoder.isComplete, true, "systematic source frames must complete in exactly K unique frames");
assert.deepEqual(Array.from(systematicDecoder.assemble()), Array.from(packed.container));

const decoder = new H.LTDecoder(encoder.k, blockLen, sessionId, packed.container.length);
for (let seq = 1; seq < Math.max(200, encoder.k * 8) && !decoder.isComplete; seq += 1) {
  if (seq % 7 === 0) continue;
  decoder.addFrame(seq, encoder.encode(seq));
}
assert.equal(decoder.isComplete, true, "LT decoder did not recover after dropped frames");
assert.deepEqual(Array.from(decoder.assemble()), Array.from(packed.container));

const qr = context.qrcode(40, "L");
qr.addBytes(first);
qr.make(4);
assert.equal(qr.getModuleCount(), 177, "2953-byte frame must fit QR V40-L");

const quadFrame = new Uint8Array(1273);
const quadQr = context.qrcode(0, "L");
quadQr.addBytes(quadFrame);
quadQr.make(4);
assert.equal(quadQr.getModuleCount(), 117, "1273-byte quad frame must fit QR V25-L");
const denseQuad = new Uint8Array(1465);
const denseQuadQr = context.qrcode(0, "L");
denseQuadQr.addBytes(denseQuad);
denseQuadQr.make(4);
assert.equal(denseQuadQr.getModuleCount(), 125, "1465-byte quad frame must fit QR V27-L");
const dualFrame = new Uint8Array(1732);
const dualQr = context.qrcode(30, "L");
dualQr.addBytes(dualFrame);
dualQr.make(4);
assert.equal(dualQr.getModuleCount(), 137, "1732-byte dual frame must fit QR V30-L");
const dualV32 = new Uint8Array(1952);
const dualV32Qr = context.qrcode(32, "L");
dualV32Qr.addBytes(dualV32);
dualV32Qr.make(4);
assert.equal(dualV32Qr.getModuleCount(), 145, "1952-byte dual frame must fit QR V32-L");
const dualV33 = new Uint8Array(2068);
const dualV33Qr = context.qrcode(33, "L");
dualV33Qr.addBytes(dualV33);
dualV33Qr.make(4);
assert.equal(dualV33Qr.getModuleCount(), 149, "2068-byte dual frame must fit QR V33-L");

  const worker = fs.readFileSync(new URL("../vendor/decimen/decoder-worker.js", import.meta.url), "utf8");
  const workerBridge = fs.readFileSync(new URL("../vendor/decimen/highspeed-decoder-worker.js", import.meta.url), "utf8");
  assert.ok(worker.includes("zxing_reader-EOacYbLr.wasm"));
  assert.ok(worker.includes("SPDX-License-Identifier: MIT"));
  assert.ok(workerBridge.includes('importScripts("./multi-decoder-worker.js")'));
  assert.ok(workerBridge.includes("maxSymbols"), "bitmap bridge must forward maxSymbols to the WASM decoder");
  assert.ok(workerBridge.includes("data.tiles"), "bitmap bridge must decode locked quad tiles from one packed bitmap");
  assert.ok(workerBridge.includes("function cropImageData"), "quad tiles must be sliced from the packed ImageData, not grabbed from live video");
  assert.ok(workerBridge.includes("function decodePackedTiles"), "locked quad must scan each packed tile with maxSymbols 1");
  assert.ok(workerBridge.includes("maxSymbols: 1"), "packed tile scans must not use maxSymbols 4 on each crop");
  assert.ok(workerBridge.includes("data.lum"), "bitmap bridge must forward packed luma without a canvas round-trip");
  assert.ok(workerBridge.includes("if (data.frame)"), "bitmap bridge must handle transferred VideoFrame before the luma fallback");
  assert.ok(workerBridge.includes("bitmapFromFrame"), "bitmap bridge must crop and resize a transferred VideoFrame off the main thread");
  assert.ok(workerBridge.includes("crop.w") && workerBridge.includes("drawImage(bitmap, crop.x, crop.y, crop.w, crop.h"), "bitmap bridge must crop locked single-code ROI off the main thread");
  const publishedApp = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(publishedApp.includes('new Worker("vendor/decimen/highspeed-decoder-worker.js")'), "WASM worker must start from vendor/decimen so locateFile finds the wasm");
  const multiWorker = fs.readFileSync(new URL("../vendor/decimen/multi-decoder-worker.js", import.meta.url), "utf8");
  assert.ok(multiWorker.includes("d.maxSymbols"), "multi-code worker must accept a per-frame symbol limit");
  assert.ok(multiWorker.includes("d.lum") && multiWorker.includes("new ImageData(rgba,M,c)"), "multi-code worker must expand Y-plane luma to RGBA for zxing-wasm 2.2.4");
  let bridgedMessage = null;
  const bridgeSelf = {
    onmessage: null,
    postMessage() {}
  };
  vm.runInNewContext(workerBridge, {
    self: bridgeSelf,
    importScripts() { bridgeSelf.onmessage = event => { bridgedMessage = event.data; }; }
  });
  await bridgeSelf.onmessage({ data: { id: 77, buf: new ArrayBuffer(4), w: 1, h: 1 } });
  assert.equal(bridgedMessage.id, 77, "worker bridge did not forward messages to the warmed decoder");
  await bridgeSelf.onmessage({ data: { id: 88, lum: new ArrayBuffer(8), w: 2, h: 4, maxSymbols: 1 } });
  assert.equal(bridgedMessage.id, 88, "worker bridge must forward luma payloads without a canvas round-trip");
  assert.equal(bridgedMessage.w, 2);
  assert.ok(bridgedMessage.lum);

const template = fs.readFileSync(new URL("../sender/template.html", import.meta.url), "utf8");
const sender = fs.readFileSync(new URL("../sender/app.js", import.meta.url), "utf8");
assert.ok(!template.includes('id="mode"'), "legacy compatibility modes must not be exposed by the sender");
assert.ok(!template.includes("兼容稳定") && !template.includes("兼容均衡") && !template.includes("兼容快速"));
assert.ok(template.includes('id="chunkSize"'));
assert.ok(sender.includes('quad: [') && sender.includes('["1465", "1465 B"]'));
assert.ok(sender.includes("QUAD_MAX_FRAME_BYTES = 1465"));
assert.ok(sender.includes("DUAL_FRAME_BYTES = 2068"));
assert.ok(sender.includes("QR_WORKER_COUNT = 4"));
assert.ok(sender.includes('["2068", "2068 B"]'));
assert.ok(sender.includes("function applyFastestLayout"));
assert.ok(sender.includes("function fillChunkChoices"));
assert.ok(sender.includes("function fillFpsChoices"));
assert.ok(sender.includes("function fastestFps"));
assert.ok(sender.includes("FPS_CHOICES"));
assert.ok(sender.includes("const CHUNK_CHOICES"));
assert.ok(!sender.includes('["45"') && !template.includes("45 FPS"));
assert.ok(template.includes('option value="2331"') && template.includes('option value="2953" selected'));
assert.ok(template.includes('option value="30" selected'));
assert.ok(sender.includes('["30", "30 FPS"]'));
assert.ok(sender.includes('["60", "60 FPS（高刷）"]'));
new Function(sender);
assert.ok(sender.includes("gzip 已压缩"), "sender must report gzip savings after generate");
assert.ok(sender.includes("未压缩 · 原文件发送"), "sender must report when gzip was skipped");
assert.ok(template.includes('id="fullscreenBtn"'));
assert.ok(template.includes('id="compressText"'), "sender must show whether gzip was used after packing");
assert.ok(template.includes('id="qrMode"') && template.includes('value="quad"'));
assert.ok(template.includes('value="dual">双码</option>'), "dual must be a normal layout option");
assert.ok(!sender.includes("PROFILES") && !sender.includes('el("mode")'));
assert.ok(sender.includes("function qrVersionForBytes"));
assert.ok(sender.includes("frameBytes === 2953) return 40"));
assert.ok(sender.includes("frameBytes === 2068) return 33"));
assert.ok(sender.includes("bytes <= 2068) return 149"));
assert.ok(sender.includes("frameBytes === 1952) return 32"));
assert.ok(sender.includes("frameBytes === 1732) return 30"));
assert.ok(sender.includes("frameBytes === 1273) return 25"));
assert.ok(sender.includes("function pumpEncode"));
assert.ok(sender.includes("function qrEncodeWorkerMain"));
assert.ok(sender.includes("new Worker(url)"));
assert.ok(!sender.includes("function syncDualChunkToFps"));
assert.ok(!sender.includes("DUAL_60FPS_MAX_BYTES"));
  assert.ok(sender.includes("qr.make(4)"));
  assert.ok(sender.includes("requestAnimationFrame(playLoop)"));
  assert.ok(sender.includes("function codesForMode"));
  assert.ok(sender.includes('if (mode === "dual") return 2'));
  assert.ok(sender.includes("QUAD_MAX_FRAME_BYTES = 1465"));
  assert.ok(sender.includes("Math.min(frameBytes, QUAD_MAX_FRAME_BYTES)"));
  assert.ok(sender.includes("function vsyncsForFps"));
  assert.ok(sender.includes("hz / rounded > fps * 1.12"));
  assert.ok(sender.includes("dt > 3 && dt < 22"), "rAF sampling must include 240 Hz (~4 ms) vsyncs");
  assert.ok(sender.includes("单码超过 30 FPS"));
  assert.ok(sender.includes("分析流约 60 FPS"));
  assert.ok(!sender.includes("dt > 8 && dt < 50"));
  assert.ok(sender.includes("imageSmoothingEnabled = false"));
  assert.ok(sender.includes("drawPatternTile"));
assert.ok(sender.includes("2068 B · 60 FPS"));
assert.ok(sender.includes("QUAD_PAIRS"));
assert.ok(sender.includes("function updateIntervalVsyncs"));
assert.ok(!sender.includes("drawScreen(next.patterns)"));
assert.ok(!sender.includes("setTimeout(playLoop"), "sender playback must stay synchronized with display refresh");
assert.ok(!sender.includes("setInterval("), "sender playback must not use setInterval");
assert.ok(template.includes('id="rateHint"'), "sender must show theoretical rate for the selected parameters");
assert.ok(sender.includes("function currentLayout"));
assert.ok(sender.includes("function renderRateHint"));
assert.ok(sender.includes("formatRate(rate.screen)"));
assert.ok(sender.includes("function applyFastestLayout"));
assert.ok(!sender.includes("function syncFpsToLayout"));
assert.ok(!sender.includes('fps.value = "60"'));
assert.ok(sender.includes("60 Hz 屏上四码"));
assert.ok(template.includes("按这台屏能稳定达到的最高速度预填"));
assert.ok(template.includes("四码每帧只列出 1003 / 1273 / 1465 B"));
assert.ok(template.includes("双码预填 2068 B · 60 FPS"));
assert.ok(template.includes("双码只占 2×2 上排"));
assert.ok(sender.includes("layout === \"dual\""));
assert.ok(sender.includes("双码上排同时更新"));
assert.ok(sender.includes("双码上排交替更新"));
assert.ok(sender.includes("function dualUpdatesBoth"));
assert.ok(sender.includes("Number(fps.value) >= 60"));
assert.ok(sender.includes("DUAL_SLOTS = [0, 1]"));
assert.ok(sender.includes("DUAL_SLOTS[highNextPair & 1]"));
assert.ok(sender.includes("function quadRefreshesAll"));
assert.ok(sender.includes("四码整屏同换"));
assert.ok(sender.includes("codesPerScreen === 4 && Number(fps.value) < 60"));
assert.ok(sender.includes("layoutCodes: codesPerScreen === 1 ? 1 : codesPerScreen === 2 ? 2 : 4"));
assert.ok(!sender.includes("function drawDualBallast"));
assert.ok(template.includes('id="hudPlayBtn"') && template.includes('id="hudFsBtn"'));
assert.ok(sender.includes('if (layout === "dual") cap = Math.min(hz, 60)'));
assert.ok(template.includes('id="fileInput"') && template.includes("multiple"), "sender must allow selecting several files");
assert.ok(template.includes("选择或拖入一个或多个文件"));
assert.ok(sender.includes("function zipStore"));
assert.ok(sender.includes("function packSelectedFiles"));
assert.ok(sender.includes("个文件.zip"));
assert.ok(sender.includes("function selectFiles"));
assert.ok(template.includes('id="openReceiver"'), "sender must link to the receiver");
assert.ok(sender.includes("openReceiver.href = RECEIVER_URL"));

const rootBundle = fs.readFileSync(new URL("../highspeed-protocol.js", import.meta.url));
const mirrorBundle = fs.readFileSync(new URL("../web-receiver/highspeed-protocol.js", import.meta.url));
assert.deepEqual(rootBundle, mirrorBundle);
console.log("high-speed binary protocol, fountain recovery and V40-L QR tests ok");
