(() => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const P = window.AirFerryLiteProtocol;
  const video = document.getElementById("video");
  const canvas = document.getElementById("scanCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const resetBtn = document.getElementById("resetBtn");
  const copyMissing = document.getElementById("copyMissing");
  const status = document.getElementById("status");
  const fileName = document.getElementById("fileName");
  const progressText = document.getElementById("progressText");
  const progressBar = document.getElementById("progressBar");
  const missingEl = document.getElementById("missing");
  const hint = document.getElementById("cameraHint");
  const result = document.getElementById("result");
  const resultInfo = document.getElementById("resultInfo");
  const download = document.getElementById("download");

  const FULL_SCAN_WIDTH = 800;
  const ROI_SCAN_WIDTH = 640;
  const FULL_SCAN_EVERY = 12;
  const ROI_MISS_LIMIT = 5;
  const SCAN_INTERVAL = 35;
  const DETECTOR_INTERVAL = 30;
  const SESSION_TIMEOUT = 90000;
  const MAX_FILE_SIZE = 64 * 1024 * 1024;
  const MAX_CHUNKS = 200000;
  const MAX_CHUNK_SIZE = 4096;

  let stream = null;
  let scanTimer = 0;
  let scanFrameCallback = 0;
  let meta = null;
  let chunks = new Map();
  let parityFrames = new Map();
  let parityLookup = new Map();
  let missing = new Set();
  let receivedCount = 0;
  let recoveredCount = 0;
  let lastDecodedText = "";
  let lastDecodedAt = 0;
  let lastFrameAt = 0;
  let barcodeDetector = null;
  let detectorErrors = 0;
  let scanRegion = null;
  let scanSequence = 0;
  let roiMisses = 0;
  let sessionHeaderText = "";
  let scanErrors = 0;
  let lastScanStartedAt = -Infinity;

  startBtn.onclick = start;
  stopBtn.onclick = stop;
  resetBtn.onclick = reset;
  copyMissing.onclick = copyMissingIndexes;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) stop("页面已切到后台");
  });

  async function setupDetector() {
    barcodeDetector = null;
    detectorErrors = 0;
    if (!("BarcodeDetector" in window)) return;
    try {
      const formats = await BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (_) {
      barcodeDetector = null;
    }
  }

  async function start() {
    if (stream) return;
    try {
      await setupDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (!barcodeDetector && typeof window.jsQR !== "function") throw new Error("DecoderUnavailable");
      configureCameraTrack(stream);
      video.srcObject = stream;
      await video.play();
      hint.classList.add("hidden");
      startBtn.disabled = true;
      stopBtn.disabled = false;
      status.textContent = barcodeDetector ? "正在快速扫描" : "正在扫描";
      scheduleScan();
    } catch (err) {
      closeCamera();
      status.textContent = err.message === "DecoderUnavailable" ? "二维码解码器加载失败" : err.name === "NotAllowedError" ? "摄像头权限被拒绝" : "摄像头不可用";
      hint.textContent = err.message === "DecoderUnavailable" ? "请检查网络后刷新页面" : "请在 HTTPS 页面中允许摄像头权限";
    }
  }

  function configureCameraTrack(activeStream) {
    const track = activeStream.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener("ended", () => {
      if (stream !== activeStream) return;
      closeCamera();
      status.textContent = "摄像头连接已中断，请重新开始";
    }, { once: true });
    try {
      const capabilities = track.getCapabilities?.();
      if (capabilities?.focusMode?.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      }
    } catch (_) {}
  }

  function closeCamera() {
    clearTimeout(scanTimer);
    scanTimer = 0;
    if (scanFrameCallback && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(scanFrameCallback);
    }
    scanFrameCallback = 0;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    scanRegion = null;
    scanSequence = 0;
    roiMisses = 0;
    lastScanStartedAt = -Infinity;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }

  function stop(message) {
    if (!stream) return;
    closeCamera();
    status.textContent = message || (meta ? "已暂停" : "等待开始");
  }

  function reset() {
    closeCamera();
    meta = null;
    chunks = new Map();
    parityFrames = new Map();
    parityLookup = new Map();
    missing = new Set();
    receivedCount = 0;
    recoveredCount = 0;
    lastDecodedText = "";
    lastDecodedAt = 0;
    lastFrameAt = 0;
    scanRegion = null;
    scanSequence = 0;
    roiMisses = 0;
    sessionHeaderText = "";
    scanErrors = 0;
    lastScanStartedAt = -Infinity;
    fileName.textContent = "-";
    progressText.textContent = "0%";
    progressBar.style.width = "0%";
    missingEl.textContent = "-";
    copyMissing.disabled = true;
    result.hidden = true;
    if (download.href) URL.revokeObjectURL(download.href);
    download.removeAttribute("href");
    status.textContent = "等待开始";
  }

  function scheduleScan() {
    if (!stream || scanTimer || scanFrameCallback) return;
    const interval = barcodeDetector ? DETECTOR_INTERVAL : SCAN_INTERVAL;
    if (typeof video.requestVideoFrameCallback === "function") {
      scanFrameCallback = video.requestVideoFrameCallback(() => {
        scanFrameCallback = 0;
        const now = performance.now();
        if (now - lastScanStartedAt < interval) {
          scheduleScan();
          return;
        }
        lastScanStartedAt = now;
        scan();
      });
      return;
    }
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      lastScanStartedAt = performance.now();
      scan();
    }, interval);
  }

  async function scan() {
    if (!stream) return;
    try {
      if (barcodeDetector) await scanWithBarcodeDetector();
      else scanWithJsQR();
      scanErrors = 0;
      if (meta && performance.now() - lastFrameAt > SESSION_TIMEOUT) status.textContent = "长时间未收到二维码，请重新对准屏幕";
    } catch (_) {
      scanErrors += 1;
      scanRegion = null;
      roiMisses = 0;
      if (scanErrors >= 10) stop("扫描连续失败，请重新开始");
      else if (scanErrors >= 3) status.textContent = "扫描暂时失败，正在重试";
    } finally {
      scheduleScan();
    }
  }

  async function scanWithBarcodeDetector() {
    try {
      const codes = await barcodeDetector.detect(video);
      detectorErrors = 0;
      if (codes[0]?.rawValue) acceptDecoded(codes[0].rawValue);
    } catch (_) {
      detectorErrors += 1;
      if (detectorErrors >= 3) {
        barcodeDetector = null;
        scanRegion = null;
        status.textContent = "已切换兼容扫描模式";
      }
    }
  }

  function scanWithJsQR() {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    scanSequence += 1;
    const forceFull = !scanRegion || scanSequence % FULL_SCAN_EVERY === 0;
    const source = getSourceRegion(forceFull);
    const targetWidth = source.full ? FULL_SCAN_WIDTH : ROI_SCAN_WIDTH;
    const scale = Math.min(1, targetWidth / source.width);
    const nextWidth = Math.max(1, Math.round(source.width * scale));
    const nextHeight = Math.max(1, Math.round(source.height * scale));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    ctx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
    if (code?.data) {
      roiMisses = 0;
      updateScanRegion(code.location, source);
      acceptDecoded(code.data);
    } else if (!source.full) {
      roiMisses += 1;
      if (roiMisses >= ROI_MISS_LIMIT) {
        scanRegion = null;
        roiMisses = 0;
      }
    }
  }

  function getSourceRegion(forceFull) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (forceFull || !scanRegion) return { x: 0, y: 0, width, height, full: true };
    return {
      x: Math.round(scanRegion.x * width),
      y: Math.round(scanRegion.y * height),
      width: Math.max(1, Math.round(scanRegion.width * width)),
      height: Math.max(1, Math.round(scanRegion.height * height)),
      full: false
    };
  }

  function updateScanRegion(location, source) {
    if (!location) return;
    const points = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner];
    if (points.some((point) => !point)) return;
    const xs = points.map((point) => source.x + point.x / canvas.width * source.width);
    const ys = points.map((point) => source.y + point.y / canvas.height * source.height);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const side = Math.max(maxX - minX, maxY - minY) * 2.2;
    const x = Math.max(0, centerX - side / 2);
    const y = Math.max(0, centerY - side / 2);
    const right = Math.min(video.videoWidth, centerX + side / 2);
    const bottom = Math.min(video.videoHeight, centerY + side / 2);
    scanRegion = {
      x: x / video.videoWidth,
      y: y / video.videoHeight,
      width: Math.max(1, right - x) / video.videoWidth,
      height: Math.max(1, bottom - y) / video.videoHeight
    };
  }

  function acceptDecoded(text) {
    const now = performance.now();
    if (text === lastDecodedText && now - lastDecodedAt < 250) return;
    lastDecodedText = text;
    lastDecodedAt = now;
    if (isRedundantDecoded(text)) {
      lastFrameAt = now;
      return;
    }
    accept(text);
  }

  function isRedundantDecoded(text) {
    if (!meta || typeof text !== "string" || !text.startsWith("AFL1|")) return false;
    if (text === sessionHeaderText) return true;
    const kind = text.charAt(5);
    if ((kind !== "D" && kind !== "P") || text.charAt(6) !== "|") return false;
    const sessionEnd = text.indexOf("|", 7);
    if (sessionEnd < 0 || text.slice(7, sessionEnd) !== meta.session) return false;
    const keyEnd = text.indexOf("|", sessionEnd + 1);
    if (keyEnd < 0) return false;
    const key = Number(text.slice(sessionEnd + 1, keyEnd));
    if (!Number.isSafeInteger(key)) return false;
    return kind === "D" ? chunks.has(key) : parityFrames.has(key);
  }

  function accept(text) {
    const frame = P.parseFrame(text);
    if (!frame) return;
    lastFrameAt = performance.now();
    if (frame.kind === "header") {
      if (!isValidHeader(frame)) {
        status.textContent = "文件描述无效或超出网页接收上限";
        return;
      }
      if (!meta || meta.session !== frame.session) beginSession(frame, text);
      update();
      return;
    }
    if (frame.kind === "parity") {
      acceptParityFrame(frame);
      return;
    }
    if (frame.kind !== "data" || !isValidDataFrame(frame)) return;
    if (P.crc32(frame.bytes) !== frame.chunkCrc) return;
    if (!chunks.has(frame.index)) {
      storeChunk(frame.index, frame.bytes, false);
      const groupStart = parityLookup.get(frame.index);
      if (groupStart !== undefined) tryRecoverGroup(groupStart);
      update();
      if (receivedCount === meta.total) finish();
    }
  }

  function isValidHeader(frame) {
    if (!Number.isSafeInteger(frame.size) || frame.size < 0 || frame.size > MAX_FILE_SIZE) return false;
    if (!Number.isSafeInteger(frame.chunkSize) || frame.chunkSize < 1 || frame.chunkSize > MAX_CHUNK_SIZE) return false;
    if (!Number.isSafeInteger(frame.total) || frame.total < 1 || frame.total > MAX_CHUNKS) return false;
    if (frame.total !== Math.max(1, Math.ceil(frame.size / frame.chunkSize))) return false;
    if (typeof frame.session !== "string" || frame.session.length < 4 || frame.session.length > 64) return false;
    if (typeof frame.name !== "string" || frame.name.length < 1 || frame.name.length > 255) return false;
    return Number.isInteger(frame.fileCrc);
  }

  function beginSession(frame, headerText) {
    meta = frame;
    sessionHeaderText = headerText;
    chunks = new Map();
    parityFrames = new Map();
    parityLookup = new Map();
    missing = new Set();
    for (let index = 0; index < frame.total; index += 1) missing.add(index);
    receivedCount = 0;
    recoveredCount = 0;
    result.hidden = true;
    fileName.textContent = frame.name;
    status.textContent = barcodeDetector ? "已识别文件（快速模式）" : "已识别文件";
  }

  function acceptParityFrame(frame) {
    if (!meta || frame.session !== meta.session || frame.total !== meta.total) return;
    if (!Number.isSafeInteger(frame.groupStart) || frame.groupStart < 0 || frame.groupStart >= meta.total) return;
    if (!Number.isSafeInteger(frame.count) || frame.count < 2 || frame.count > 32) return;
    if (frame.groupStart + frame.count > meta.total || frame.bytes.length !== meta.chunkSize) return;
    if (P.crc32(frame.bytes) !== frame.parityCrc) return;
    parityFrames.set(frame.groupStart, frame);
    for (let index = frame.groupStart; index < frame.groupStart + frame.count; index += 1) {
      parityLookup.set(index, frame.groupStart);
    }
    if (tryRecoverGroup(frame.groupStart)) {
      update();
      if (receivedCount === meta.total) finish();
    }
  }

  function tryRecoverGroup(groupStart) {
    const repair = parityFrames.get(groupStart);
    if (!repair) return false;
    let missingIndex = -1;
    for (let index = groupStart; index < groupStart + repair.count; index += 1) {
      if (!chunks.has(index)) {
        if (missingIndex !== -1) return false;
        missingIndex = index;
      }
    }
    if (missingIndex === -1) return false;
    const recovered = repair.bytes.slice();
    for (let index = groupStart; index < groupStart + repair.count; index += 1) {
      if (index === missingIndex) continue;
      const chunk = chunks.get(index);
      if (!chunk) return false;
      for (let offset = 0; offset < chunk.length; offset += 1) recovered[offset] ^= chunk[offset];
    }
    storeChunk(missingIndex, recovered.slice(0, expectedChunkLength(missingIndex)), true);
    return true;
  }

  function storeChunk(index, bytes, recovered) {
    chunks.set(index, bytes);
    missing.delete(index);
    receivedCount += 1;
    if (recovered) recoveredCount += 1;
  }

  function expectedChunkLength(index) {
    return index === meta.total - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
  }

  function isValidDataFrame(frame) {
    if (!meta || frame.session !== meta.session || frame.total !== meta.total) return false;
    if (!Number.isSafeInteger(frame.index) || frame.index < 0 || frame.index >= meta.total) return false;
    const expectedLength = expectedChunkLength(frame.index);
    return frame.bytes.length === expectedLength;
  }

  function update() {
    if (!meta || !meta.total) return;
    const percent = Math.floor(receivedCount / meta.total * 100);
    progressText.textContent = percent + "% (" + receivedCount + "/" + meta.total + ")";
    progressBar.style.width = percent + "%";
    const preview = [];
    for (const index of missing) {
      preview.push(index);
      if (preview.length === 80) break;
    }
    missingEl.textContent = missing.size ? preview.join(", ") + (missing.size > preview.length ? " ..." : "") : "全部片段已收到";
    copyMissing.disabled = !missing.size;
    status.textContent = receivedCount === meta.total ? "正在校验" : recoveredCount ? "接收中（已修复 " + recoveredCount + " 片）" : "接收中";
  }

  async function copyMissingIndexes() {
    if (!missing.size) return;
    try {
      await navigator.clipboard.writeText(Array.from(missing).join(","));
      status.textContent = "缺失编号已复制";
    } catch (_) {
      status.textContent = "复制失败，请手动记录缺失编号";
    }
  }

  function finish() {
    if (!result.hidden) return;
    const bytes = new Uint8Array(meta.size);
    let offset = 0;
    for (let index = 0; index < meta.total; index += 1) {
      const chunk = chunks.get(index);
      if (!chunk) return;
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== meta.size || P.crc32(bytes) !== meta.fileCrc) {
      status.textContent = "校验失败，请清空后重新扫描";
      return;
    }
    const blob = new Blob([bytes], { type: meta.mime });
    if (download.href) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(blob);
    download.download = meta.name;
    resultInfo.textContent = formatBytes(bytes.length) + " · CRC-32 校验通过";
    result.hidden = false;
    closeCamera();
    status.textContent = "接收完成";
  }

  function formatBytes(n) {
    return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
  }
})();
