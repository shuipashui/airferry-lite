import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

await import("../shared/protocol.js");
const P = globalThis.AirFerryLiteProtocol;

const compressible = new TextEncoder().encode("AirFerry Lite compression test\n".repeat(800));
const prepared = await P.preparePayload(compressible);
assert.equal(prepared.encoding, "gzip", "compressible input should use gzip");
assert.ok(prepared.bytes.length < compressible.length);

const transfer = P.makeTransfer(prepared.bytes, {
  name: "compressed.txt",
  mime: "text/plain",
  chunkSize: 700,
  session: "advanced-test",
  encoding: prepared.encoding,
  originalSize: prepared.originalSize,
  originalFileCrc: prepared.originalFileCrc
});
const header = P.parseFrame(transfer.frames[0]);
assert.equal(transfer.frames[0].split("|").length, 12);
assert.equal(header.encoding, "gzip");
assert.equal(header.originalSize, compressible.length);
assert.equal(header.originalFileCrc, P.crc32(compressible));
assert.deepEqual(await P.restorePayload(prepared.bytes, header), compressible);

const small = new Uint8Array([1, 2, 3, 4]);
assert.equal((await P.preparePayload(small)).encoding, "raw");
const legacy = P.parseFrame(P.makeTransfer(small, { name: "legacy.bin", chunkSize: 2, session: "legacy-test" }).frames[0]);
assert.equal(legacy.encoding, "raw");
assert.equal(legacy.originalSize, small.length);

for (const file of ["../receiver-storage.js", "../decoder-worker.js"]) {
  const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
  new vm.Script(source);
}

console.log("advanced compression and receiver feature checks ok");
