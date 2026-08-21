import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({ArrayBuffer, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, TextEncoder, TextDecoder, Math, Date, console, btoa, atob, crypto: globalThis.crypto});
context.globalThis = context; context.self = context; context.window = context;
for (const path of [new URL("../sender/vendor/qrcode.js", import.meta.url), new URL("../web-receiver/vendor/jsQR.js", import.meta.url), new URL("../shared/protocol.js", import.meta.url)]) vm.runInContext(fs.readFileSync(path, "utf8"), context);
function makeFrame(size, seed) { const bytes = new Uint8Array(size); for (let i = 0; i < size; i++) bytes[i] = (i * 31 + seed * 17) & 255; return context.AirFerryLiteProtocol.makeData("density-test", seed, 99, bytes); }
function render(text, cell) {
  const qr = context.qrcode(0, "M"); qr.addData(text, "Byte"); qr.make();
  const quiet = 4, modules = qr.getModuleCount(), size = (modules + quiet * 2) * cell, rgba = new Uint8ClampedArray(size * size * 4); rgba.fill(255);
  for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) if (qr.isDark(row, col)) for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) { const p = (((row + quiet) * cell + y) * size + (col + quiet) * cell + x) * 4; rgba[p] = rgba[p + 1] = rgba[p + 2] = 0; }
  return { rgba, size, modules };
}
for (const item of [{size: 700, max: 117}, {size: 900, max: 133}, {size: 1000, max: 137}]) for (let seed = 0; seed < 3; seed++) {
  const frame = makeFrame(item.size, seed), image = render(frame, 2); assert.ok(image.modules <= item.max);
  const decoded = context.jsQR(image.rgba, image.size, image.size, {inversionAttempts: "dontInvert"});
  assert.equal(decoded?.data, frame, item.size + " B frame did not decode at 2 px/module");
}
const fast = render(makeFrame(900, 0), 1); assert.ok(Math.floor(900 / (fast.modules + 8)) >= 6, "fast profile is too dense for the sender canvas");
const template = fs.readFileSync(new URL("../sender/template.html", import.meta.url), "utf8");
const senderStyles = fs.readFileSync(new URL("../sender/styles.css", import.meta.url), "utf8");
assert.ok(template.indexOf('id="qrCanvas"') < template.indexOf('class="receiver-link"'), "receiver URL QR must live in the right viewer");
assert.ok(template.indexOf('id="overlay"') < template.indexOf('class="receiver-link"'), "receiver URL QR must disappear with the generated-file overlay");
assert.ok(senderStyles.includes("grid-template-columns:minmax(300px,380px)"), "sender controls must keep the narrower desktop width");
assert.ok(senderStyles.includes(".overlay.hidden{display:none}"), "generated file QR must replace the receiver entry");
assert.ok(senderStyles.includes("overflow:visible") && senderStyles.includes("width:200px;height:200px"), "receiver QR safety area may not be clipped");
assert.ok(senderStyles.includes("#qrCanvas{") && senderStyles.includes("border-radius:0"), "file QR corners must not clip finder patterns");
const senderApp = fs.readFileSync(new URL("../sender/app.js", import.meta.url), "utf8");
assert.ok(senderApp.includes("QUIET_MODULES = 2"), "single-code QR quiet zone should stay tight so modules can use the canvas");
assert.ok(senderApp.includes("QUAD_QUIET_MODULES = 4"), "quad codes need a spec quiet zone so adjacent finders do not merge");
assert.ok(senderApp.includes("codes === 4 || codes === 2) return { columns: 2, rows: 2, quiet: QUAD_QUIET_MODULES }"), "dual must use the same square 2x2 canvas as quad so both codes stay in frame");
assert.ok(!senderStyles.includes("html.quad-send,body.quad-send{height:auto"), "quad sender must keep the same fixed window as single-code");
assert.ok(!senderApp.includes("size * 0.04"), "quad tiles should fill the original 2x2 canvas instead of shrinking for an extra gutter");
assert.ok(!senderApp.includes("offsetY, side, side)"), "file QR must not stretch modules to a non-integer pixel size");
assert.ok(senderApp.includes("function integerModuleScale"), "QR size must pick the largest integer device-pixel module scale that fits the viewer");
assert.ok(senderApp.includes("viewer.clientWidth") && senderApp.includes("viewer.clientHeight"), "QR budget must follow the viewer box, including windowed mode");
assert.ok(!senderStyles.includes("max-width:96vmin"), "windowed QR must not be capped at 96vmin");
assert.ok(senderApp.includes("tile.width * scale"), "QR blit destination must be integer module scale");
assert.ok(senderApp.includes("QUAD_PAIRS = [[0, 3], [1, 2]]"), "quad playback must stagger checkerboard pairs");
assert.ok(senderApp.includes("Math.round(vsyncsPerQr / 2)"), "quad pair updates must keep the same unique-code rate as four-at-once");
assert.ok(senderApp.includes("function setPlayLabel"));
assert.ok(senderApp.includes("hudPlayBtn"));
assert.ok(senderStyles.includes(".viewer-hud") && senderStyles.includes(".viewer:fullscreen .viewer-hud"));
console.log("QR density tests ok");
