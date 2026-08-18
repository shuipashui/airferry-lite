import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const banner = "/*! Derived from Decimen Optical Transfer v0.3.0, Copyright (c) 2026 Evan Crawley (Bash Alarmist), MIT License */";
const output = path.join(root, "shared", "highspeed-protocol.js");

const sourceDir = path.join(root, "third_party", "decimen-v0.3");
const protocol = fs.readFileSync(path.join(sourceDir, "protocol.ts"), "utf8").replaceAll("export ", "");
const fountain = fs.readFileSync(path.join(sourceDir, "fountain.ts"), "utf8")
  .replace(/import\s+\{\s*splitmix32\s*\}\s+from\s+["']\.\/protocol["'];?/, "")
  .replaceAll("export ", "");
const entry = fs.readFileSync(path.join(sourceDir, "entry.js"), "utf8")
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+["']\.\/protocol\.ts["'];?/, "")
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+["']\.\/fountain\.ts["'];?/, "");
const compiled = await transform(`${protocol}\n${fountain}\n${entry}`, {
  loader: "ts",
  format: "iife",
  target: "es2021",
  minify: true
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${banner}\n${compiled.code}`);

for (const target of [
  path.join(root, "highspeed-protocol.js"),
  path.join(root, "web-receiver", "highspeed-protocol.js")
]) {
  fs.copyFileSync(output, target);
}

console.log(`Built ${output} (${fs.statSync(output).size} bytes)`);
