import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, "vendor", "decimen", "decoder-worker.js");
const outputPath = path.join(root, "vendor", "decimen", "multi-decoder-worker.js");
let source = fs.readFileSync(sourcePath, "utf8");
const oldOptions = '{formats:["QRCode"],maxNumberOfSymbols:1}';
const newOptions = '{formats:["QRCode"],maxNumberOfSymbols:4}';
const oldResult = '.find(O=>O.isValid&&O.bytes.length>0)';
const newResult = '.filter(O=>O.isValid&&O.bytes.length>0).slice(0,4)';
const oldPost = 'ct.postMessage({id:p,bytes:x?x.bytes:null})';
const newPost = 'ct.postMessage({id:p,bytes:x.map(O=>O.bytes)})';
if (!source.includes(oldOptions) || !source.includes(oldResult) || !source.includes(oldPost)) {
  throw new Error("Unexpected ZXing worker layout; multi-decoder patch was not applied");
}
source = source.replace(oldOptions, newOptions).replace(oldResult, newResult).replace(oldPost, newPost);
fs.writeFileSync(outputPath, source);
console.log(`Built ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
