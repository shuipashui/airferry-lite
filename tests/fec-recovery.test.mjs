import assert from "node:assert/strict";
await import("../shared/protocol.js");
const P = globalThis.AirFerryLiteProtocol;

const source = new Uint8Array(20_001);
for (let i = 0; i < source.length; i += 1) source[i] = (i * 13 + 19) & 255;
const transfer = P.makeTransfer(source, { name: "fec.bin", mime: "application/octet-stream", chunkSize: 700, parityGroupSize: 8, session: "fec-session" });
assert.ok(transfer.repairFrames.length >= 3);
const first = P.parseFrame(transfer.repairFrames[0]);
const nextText = P.makeRepairFrame(transfer, first.groupStart, 1);
const next = P.parseFrame(nextText);
assert.notEqual(first.seed, next.seed, "repair frames must not repeat their seed");
assert.notDeepEqual([...first.bytes], [...next.bytes], "repair payloads must not repeat");

function recover(repairs, lost) {
  const rows = repairs.map((repair) => {
    const coeff = repair.coefficients;
    const rhs = repair.bytes.slice();
    for (let offset = 0; offset < repair.count; offset += 1) {
      const index = repair.groupStart + offset;
      if (lost.includes(index)) continue;
      const part = P.parseFrame(transfer.dataFrames[index]).bytes;
      for (let byte = 0; byte < part.length; byte += 1) rhs[byte] ^= P.gfMul(coeff[offset], part[byte]);
    }
    return { coeff: lost.map((index) => coeff[index - repair.groupStart]), rhs };
  });
  for (let col = 0; col < lost.length; col += 1) {
    const pivot = rows.findIndex((row, index) => index >= col && row.coeff[col]);
    assert.notEqual(pivot, -1, "repair equations must have full rank");
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const inverse = P.gfInv(rows[col].coeff[col]);
    for (let c = col; c < lost.length; c += 1) rows[col].coeff[c] = P.gfMul(inverse, rows[col].coeff[c]);
    for (let byte = 0; byte < rows[col].rhs.length; byte += 1) rows[col].rhs[byte] = P.gfMul(inverse, rows[col].rhs[byte]);
    for (let row = 0; row < rows.length; row += 1) if (row !== col) {
      const factor = rows[row].coeff[col];
      for (let c = col; c < lost.length; c += 1) rows[row].coeff[c] ^= P.gfMul(factor, rows[col].coeff[c]);
      for (let byte = 0; byte < rows[row].rhs.length; byte += 1) rows[row].rhs[byte] ^= P.gfMul(factor, rows[col].rhs[byte]);
    }
  }
  return rows.slice(0, lost.length).map((row, n) => row.rhs.slice(0, lost[n] === transfer.total - 1 ? source.length - lost[n] * transfer.chunkSize : transfer.chunkSize));
}

const groupStart = first.groupStart;
const lost = [groupStart + 1, groupStart + 3];
const recovered = recover([first, next], lost);
for (let i = 0; i < lost.length; i += 1) {
  const start = lost[i] * transfer.chunkSize;
  assert.deepEqual([...recovered[i]], [...source.slice(start, start + recovered[i].length)]);
}
console.log("fec recovery tests ok");
