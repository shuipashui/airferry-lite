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

  const worker = fs.readFileSync(new URL("../vendor/decimen/decoder-worker.js", import.meta.url), "utf8");
  const workerBridge = fs.readFileSync(new URL("../vendor/decimen/highspeed-decoder-worker.js", import.meta.url), "utf8");
  assert.ok(worker.includes("zxing_reader-EOacYbLr.wasm"));
  assert.ok(worker.includes("SPDX-License-Identifier: MIT"));
  assert.ok(workerBridge.includes('importScripts("./multi-decoder-worker.js")'));
  const publishedApp = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(publishedApp.includes('new Worker("vendor/decimen/highspeed-decoder-worker.js")'), "WASM worker must start from vendor/decimen so locateFile finds the wasm");
  const multiWorker = fs.readFileSync(new URL("../vendor/decimen/multi-decoder-worker.js", import.meta.url), "utf8");
  assert.ok(multiWorker.includes("maxNumberOfSymbols:4"), "multi-code worker must request up to four symbols");
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

const template = fs.readFileSync(new URL("../sender/template.html", import.meta.url), "utf8");
const sender = fs.readFileSync(new URL("../sender/app.js", import.meta.url), "utf8");
assert.ok(!template.includes('id="mode"'), "legacy compatibility modes must not be exposed by the sender");
assert.ok(!template.includes("兼容稳定") && !template.includes("兼容均衡") && !template.includes("兼容快速"));
assert.ok(template.includes('<option value="2331" selected>'));
assert.ok(template.includes('<option value="30" selected>'));
assert.ok(template.includes('<option value="60">60 FPS'));
assert.ok(template.includes('<option value="45">45 FPS'));
assert.ok(template.includes('<option value="90">90 FPS') && template.includes('<option value="120">120 FPS'));
assert.ok(template.includes('id="qrMode"') && template.includes('value="quad"'));
assert.ok(!sender.includes("PROFILES") && !sender.includes('el("mode")'));
assert.ok(sender.includes('qrcode(frameBytes === 2953 ? 40 : 0, "L")'));
  assert.ok(sender.includes("qr.make(4)"));
  assert.ok(sender.includes("requestAnimationFrame(playLoop)"));
  assert.ok(sender.includes("codesPerScreen = qrMode.value === \"quad\" ? 4 : 1"));
  assert.ok(sender.includes("Math.min(frameBytes, 1005)"));
  assert.ok(sender.includes("drawPatternTile"));
  assert.ok(sender.includes("drawScreen(next.patterns)"));
  assert.ok(!sender.includes("setTimeout"), "sender playback must stay synchronized with display refresh");

const rootBundle = fs.readFileSync(new URL("../highspeed-protocol.js", import.meta.url));
const mirrorBundle = fs.readFileSync(new URL("../web-receiver/highspeed-protocol.js", import.meta.url));
assert.deepEqual(rootBundle, mirrorBundle);
console.log("high-speed binary protocol, fountain recovery and V40-L QR tests ok");
