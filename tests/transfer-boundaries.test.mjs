import assert from "node:assert/strict";
await import("../shared/protocol.js");
const P = globalThis.AirFerryLiteProtocol;

const sizes = [0, 1, 399, 400, 401, 699, 700, 701, 4097, 16384];
for (const size of sizes) {
  const source = new Uint8Array(size);
  for (let i = 0; i < source.length; i += 1) source[i] = (i * 17 + size) & 255;
  const transfer = P.makeTransfer(source, {
    name: "boundary-" + size + ".bin",
    mime: "application/octet-stream",
    chunkSize: 700,
    session: "boundary-" + size
  });
  assert.equal(transfer.frames.length, transfer.total + 1);
  const header = P.parseFrame(transfer.frames[0]);
  assert.equal(header.size, size);
  assert.equal(header.total, transfer.total);
  assert.equal(header.fileCrc, P.crc32(source));

  const parts = transfer.frames.slice(1).map(frame => P.parseFrame(frame));
  assert.deepEqual(parts.map(part => part.index), [...Array(transfer.total).keys()]);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    assert.equal(P.crc32(part.bytes), part.chunkCrc);
    output.set(part.bytes, offset);
    offset += part.bytes.length;
  }
  assert.equal(offset, size);
  assert.deepEqual([...output], [...source]);
}

console.log("transfer boundary tests ok");
