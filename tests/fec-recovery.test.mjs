import assert from "node:assert/strict";
await import("../shared/protocol.js");
const P = globalThis.AirFerryLiteProtocol;

const source = new Uint8Array(20_001);
for (let i = 0; i < source.length; i += 1) source[i] = (i * 13 + 19) & 255;
const transfer = P.makeTransfer(source, {
  name: "fec.bin",
  mime: "application/octet-stream",
  chunkSize: 700,
  parityGroupSize: 8,
  session: "fec-session"
});
assert.ok(transfer.repairFrames.length >= 3);
assert.equal(transfer.playbackFrames.length, transfer.total + transfer.repairFrames.length);

const data = transfer.dataFrames.map((frame) => P.parseFrame(frame));
const repairs = transfer.repairFrames.map((frame) => P.parseFrame(frame));
for (const repair of repairs) {
  const lostIndex = repair.groupStart + Math.min(1, repair.count - 1);
  let missing = new Uint8Array(repair.bytes);
  for (let index = repair.groupStart; index < repair.groupStart + repair.count; index += 1) {
    if (index === lostIndex) continue;
    const part = data[index].bytes;
    for (let offset = 0; offset < part.length; offset += 1) missing[offset] ^= part[offset];
  }
  const expectedStart = lostIndex * transfer.chunkSize;
  const expectedLength = lostIndex === transfer.total - 1 ? source.length - expectedStart : transfer.chunkSize;
  const recovered = missing.slice(0, expectedLength);
  assert.deepEqual([...recovered], [...source.slice(expectedStart, expectedStart + expectedLength)]);
}
console.log("fec recovery tests ok");
