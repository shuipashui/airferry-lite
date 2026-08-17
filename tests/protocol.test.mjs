import assert from "node:assert/strict";
await import("../shared/protocol.js");
const P = globalThis.AirFerryLiteProtocol;
const source = new Uint8Array(4097);
for (let i = 0; i < source.length; i += 1) source[i] = (i * 31 + 7) & 255;
const transfer = P.makeTransfer(source, { name: "测试.bin", mime: "application/octet-stream", chunkSize: 700, session: "test-session" });
assert.equal(transfer.total, 6);
const header = P.parseFrame(transfer.frames[0]);
assert.equal(header.name, "测试.bin");
const parts = transfer.frames.slice(1).map(frame => P.parseFrame(frame));
assert.equal(parts.length, transfer.total);
const output = new Uint8Array(source.length);
let offset = 0;
for (const part of parts.sort((a, b) => a.index - b.index)) { output.set(part.bytes, offset); offset += part.bytes.length; }
assert.deepEqual([...output], [...source]);
assert.equal(P.crc32(output), header.fileCrc);
console.log("protocol round-trip ok");
