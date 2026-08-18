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
assert.ok(worker.includes("zxing_reader-EOacYbLr.wasm"));
assert.ok(worker.includes("SPDX-License-Identifier: MIT"));

const template = fs.readFileSync(new URL("../sender/template.html", import.meta.url), "utf8");
const sender = fs.readFileSync(new URL("../sender/app.js", import.meta.url), "utf8");
assert.ok(template.includes('<option value="highspeed" selected>'));
assert.ok(template.includes('<option value="2331" selected>'));
assert.ok(template.includes('<option value="30" selected>'));
assert.ok(template.includes('<option value="60">60 FPS'));
assert.ok(sender.includes('highspeed: { chunk: 2331, fps: 30'));
assert.ok(sender.includes('qrcode(frameBytes === 2953 ? 40 : 0, "L")'));
assert.ok(sender.includes("qr.make(4)"));

const rootBundle = fs.readFileSync(new URL("../highspeed-protocol.js", import.meta.url));
const mirrorBundle = fs.readFileSync(new URL("../web-receiver/highspeed-protocol.js", import.meta.url));
assert.deepEqual(rootBundle, mirrorBundle);
console.log("high-speed binary protocol, fountain recovery and V40-L QR tests ok");
