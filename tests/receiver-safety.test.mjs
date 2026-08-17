import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");
new vm.Script(source);
for (const needle of [
  "const MAX_FILE_SIZE = 64 * 1024 * 1024;",
  "const MAX_CHUNKS = 200000;",
  "function updateScanRegion",
  "detectorErrors >= 3",
  "missing = new Set",
  "frame.bytes.length === expectedLength",
  "function acceptParityFrame",
  "function tryRecoverGroup"
]) assert.ok(source.includes(needle), "missing receiver guard: " + needle);
console.log("receiver safety checks ok");
