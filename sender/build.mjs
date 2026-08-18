import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const read = value => fs.readFileSync(value, "utf8");

let html = read(path.join(here, "template.html"));
const inject = (marker, file) => html = html.replace(marker, () => read(file));
inject("/*__STYLES__*/", path.join(here, "styles.css"));
inject("/*__QRCODE__*/", path.join(here, "vendor", "qrcode.js"));
inject("/*__HIGHSPEED_PROTOCOL__*/", path.join(root, "shared", "highspeed-protocol.js"));
inject("/*__APP__*/", path.join(here, "app.js"));

const output = path.join(here, "dist", "airferry-lite-sender.html");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(`Built ${output} (${Buffer.byteLength(html)} bytes)`);
