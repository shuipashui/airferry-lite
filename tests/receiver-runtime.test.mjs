import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

await import("../shared/protocol.js");
const baseProtocol = globalThis.AirFerryLiteProtocol;
const source = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");
const transfer = baseProtocol.makeTransfer(new Uint8Array([11, 22]), {
  name: "runtime.bin",
  mime: "application/octet-stream",
  chunkSize: 1,
  session: "runtime-test"
});

let now = 0;
let parseCalls = 0;
let focusApplied = false;
let trackEnded = null;
let frameId = 0;
let widthWrites = 0;
let heightWrites = 0;
const frameCallbacks = [];
const decodedFrames = [transfer.frames[0], transfer.frames[1], transfer.frames[1]];

const protocol = {
  ...baseProtocol,
  parseFrame(text) {
    parseCalls += 1;
    return baseProtocol.parseFrame(text);
  }
};

const track = {
  stop() {},
  addEventListener(type, callback) {
    if (type === "ended") trackEnded = callback;
  },
  getCapabilities() {
    return { focusMode: ["continuous"] };
  },
  async applyConstraints() {
    focusApplied = true;
  }
};
const stream = {
  getTracks: () => [track],
  getVideoTracks: () => [track]
};

function element(extra = {}) {
  return {
    disabled: false,
    hidden: false,
    href: "",
    textContent: "",
    style: {},
    classList: { add() {}, remove() {} },
    removeAttribute(name) {
      if (name === "href") this.href = "";
    },
    ...extra
  };
}

let canvasWidth = 300;
let canvasHeight = 150;
const canvas = element({
  get width() { return canvasWidth; },
  set width(value) { widthWrites += 1; canvasWidth = value; },
  get height() { return canvasHeight; },
  set height(value) { heightWrites += 1; canvasHeight = value; },
  getContext() {
    return {
      drawImage() {},
      getImageData() { return { data: new Uint8ClampedArray(4) }; }
    };
  }
});
const video = element({
  readyState: 2,
  videoWidth: 1280,
  videoHeight: 720,
  srcObject: null,
  async play() {},
  requestVideoFrameCallback(callback) {
    frameCallbacks.push(callback);
    frameId += 1;
    return frameId;
  },
  cancelVideoFrameCallback() {}
});

const elements = {
  video,
  scanCanvas: canvas,
  startBtn: element(),
  stopBtn: element({ disabled: true }),
  resetBtn: element(),
  copyMissing: element({ disabled: true }),
  status: element(),
  fileName: element(),
  progressText: element(),
  progressBar: element(),
  speedText: element(),
  missing: element(),
  cameraHint: element(),
  result: element({ hidden: true }),
  resultInfo: element(),
  download: element()
};

const context = vm.createContext({
  window: { AirFerryLiteProtocol: protocol, jsQR: decode },
  jsQR: decode,
  navigator: {
    serviceWorker: { register: async () => {} },
    mediaDevices: { getUserMedia: async () => stream },
    clipboard: { writeText: async () => {} }
  },
  document: {
    hidden: false,
    getElementById: id => elements[id],
    addEventListener() {}
  },
  performance: { now: () => now },
  setTimeout,
  clearTimeout,
  URL: { createObjectURL: () => "blob:runtime", revokeObjectURL() {} },
  Blob,
  Uint8Array,
  Uint8ClampedArray,
  console: { error() {} }
});

function decode() {
  const data = decodedFrames.shift();
  return data ? { data } : null;
}

async function runFrame() {
  const callback = frameCallbacks.shift();
  assert.equal(typeof callback, "function", "receiver did not request the next camera frame");
  now += 300;
  callback(now, {});
  await Promise.resolve();
  await Promise.resolve();
}

new vm.Script(source).runInContext(context);
await elements.startBtn.onclick();
assert.equal(focusApplied, true, "continuous focus was not requested when supported");
assert.equal(frameCallbacks.length, 1, "scan was not scheduled from a video frame callback");

await runFrame();
await runFrame();
const writesAfterData = widthWrites + heightWrites;
await runFrame();

assert.equal(parseCalls, 2, "an already received data frame was parsed again");
assert.equal(widthWrites + heightWrites, writesAfterData, "canvas dimensions were rewritten for an unchanged frame size");
assert.equal(typeof trackEnded, "function", "camera track interruption was not monitored");

trackEnded();
assert.equal(video.srcObject, null);
assert.equal(elements.startBtn.disabled, false);
assert.equal(elements.stopBtn.disabled, true);

console.log("receiver runtime checks ok");
