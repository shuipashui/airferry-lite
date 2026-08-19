import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const mirror = path.join(root, "web-receiver");
const files = [
  "app.js",
  "decoder-worker.js",
  "highspeed-decoder-worker.js",
  "highspeed-protocol.js",
  "index.html",
  "manifest.webmanifest",
  "protocol.js",
  "receiver-storage.js",
  "styles.css",
  "sw.js"
];

function synchronize(source, target) {
  const next = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target);
    if (current.equals(next)) return;
  }
  fs.writeFileSync(target, next);
}

for (const file of files) synchronize(path.join(root, file), path.join(mirror, file));
for (const file of ["jsQR.js", "jsQR-LICENSE.txt"]) {
  synchronize(path.join(root, "vendor", file), path.join(mirror, "vendor", file));
}
for (const file of ["decoder-worker.js", "zxing_reader-EOacYbLr.wasm"]) {
  synchronize(path.join(root, "vendor", "decimen", file), path.join(mirror, "vendor", "decimen", file));
}
for (const file of ["multi-decoder-worker.js"]) {
  synchronize(path.join(root, "vendor", "decimen", file), path.join(mirror, "vendor", "decimen", file));
}

console.log(`Synchronized ${files.length + 4} receiver files`);
