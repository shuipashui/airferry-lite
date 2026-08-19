(() => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const P = window.AirFerryLiteProtocol;
  const H = window.AirFerryHighSpeed;
  const Storage = window.AirFerryLiteStorage;
  const utf8Decoder = new TextDecoder();
  const video = document.getElementById("video");
  const canvas = document.getElementById("scanCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const resetBtn = document.getElementById("resetBtn");
  const copyMissing = document.getElementById("copyMissing");
  const copyDiagnostics = document.getElementById("copyDiagnostics");
  const diagnosticsEl = document.getElementById("diagnostics");
  const status = document.getElementById("status");
  const fileName = document.getElementById("fileName");
  const progressText = document.getElementById("progressText");
  const progressBar = document.getElementById("progressBar");
  const speedText = document.getElementById("speedText");
  const scanRateText = document.getElementById("scanRateText");
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
  const HIGH_SPEED_WORKERS = (navigator.hardwareConcurrency || 0) >= 8 ? 3 : 2;
  const HIGH_WORKER_TIMEOUT = 2500;
  const HIGH_SCAN_SIZE = 1280;
  const HIGH_FULL_SCAN_EVERY_MISSES = 12;

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
  let speedWindowStartedAt = 0;
  let speedWindowBytes = 0;
  let speedBps = 0;
  let decodeWorker = null;
  let decodeRequestId = 0;
  let workerDisabled = typeof Worker !== "function";
  const decodeRequests = new Map();
  let storageQueue = Promise.resolve();
  let pendingChunkWrites = [];
  let chunkFlushTimer = 0;
  let restoring = false;
  let finishing = false;
  let highDecoder = null;
  let highStreamKey = "";
  let highHeader = null;
  let highStartedAt = 0;
  let highSpeedActive = false;
  let highFrameId = 0;
  let highWorkers = [];
  let highWorkerBusy = [];
  let highWorkerReady = [];
  let highWorkerStartedAt = [];
  let highWorkersDisabled = typeof Worker !== "function" || !H;
  let highScanMisses = 0;
  let scanStatsStartedAt = 0;
  let capturedFrames = 0;
  let decodedFrames = 0;
  let validQrFrames = 0;
  let cameraFrameRate = 0;
  let cameraRequestedFps = 120;
  let cameraSettings = null;
  let cameraCapabilities = null;
  let workerBusyDrops = 0;
  let workerRestarts = 0;
  let workerErrors = 0;
  let decodeTimeMs = 0;
  let decodeSamples = 0;
  let highFramesSeen = 0;
  let highUniqueFrames = 0;
  let highInvalidFrames = 0;
  let highDuplicateFrames = 0;
  let highSequenceGaps = 0;
  let highLastLogicalSequence = -1;
  let highProtocolBytes = 0;
  let highLastFrameAt = 0;
  let lastCaptureFps = 0;
  let lastDecodeFps = 0;
  let lastValidFps = 0;
  let lastDecodeBackend = "—";
  let lastWorkerCount = 0;
  let captureViaCanvas = /Android/i.test(navigator.userAgent || "");

  startBtn.onclick = start;
  stopBtn.onclick = stop;
  resetBtn.onclick = reset;
  copyMissing.onclick = copyMissingIndexes;
  copyDiagnostics?.addEventListener("click", copyDiagnosticsText);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) stop("页面已切到后台");
  });
  restoreSavedSession();

  function queueStorage(operation) {
    if (!Storage) return Promise.resolve();
    storageQueue = storageQueue.then(operation, operation).catch(() => {});
    return storageQueue;
  }

  function scheduleChunkPersist(session, index, bytes, recovered) {
    if (!Storage) return;
    pendingChunkWrites.push({ session, index, bytes: bytes.slice(), recovered });
    if (pendingChunkWrites.length >= 16) {
      flushPendingChunks();
      return;
    }
    if (!chunkFlushTimer) chunkFlushTimer = setTimeout(flushPendingChunks, 250);
  }

  function flushPendingChunks() {
    if (chunkFlushTimer) clearTimeout(chunkFlushTimer);
    chunkFlushTimer = 0;
    if (!pendingChunkWrites.length || !Storage) return storageQueue;
    const records = pendingChunkWrites;
    pendingChunkWrites = [];
    return queueStorage(() => typeof Storage.putChunks === "function"
      ? Storage.putChunks(records)
      : Promise.all(records.map(record => Storage.putChunk(record.session, record.index, record.bytes, record.recovered))));
  }

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
    if (restoring) {
      status.textContent = "正在恢复断点，请稍候";
      return;
    }
    try {
      await setupDetector();
      const camera = { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...camera, frameRate: { ideal: 120, max: 120 } }, audio: false });
      } catch (_) {
        cameraRequestedFps = 60;
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...camera, frameRate: { ideal: 60, max: 60 } }, audio: false });
      }
      startHighSpeedWorkers();
      if (highWorkers.length) {
        lastDecodeBackend = "AFL2 WASM Worker";
        lastWorkerCount = highWorkers.length;
      } else {
        lastDecodeBackend = barcodeDetector ? "BarcodeDetector" : (workerDisabled ? "jsQR 主线程" : "AFL1 Worker");
        lastWorkerCount = 0;
      }
      if (!highWorkers.length && !barcodeDetector && typeof window.jsQR !== "function") throw new Error("DecoderUnavailable");
      resetScanStats();
      configureCameraTrack(stream);
      video.srcObject = stream;
      await video.play();
      hint.classList.add("hidden");
      startBtn.disabled = true;
      stopBtn.disabled = false;
      status.textContent = highWorkers.length ? "正在高速扫描" : barcodeDetector ? "正在快速扫描" : "正在扫描";
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
      const settings = track.getSettings?.();
      cameraSettings = settings || null;
      cameraFrameRate = Number(settings?.frameRate) || 0;
      const capabilities = track.getCapabilities?.();
      cameraCapabilities = capabilities || null;
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
    stopHighSpeedWorkers();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    scanRegion = null;
    scanSequence = 0;
    roiMisses = 0;
    highScanMisses = 0;
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
    const previousSession = meta?.session;
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
    speedWindowStartedAt = 0;
    speedWindowBytes = 0;
    speedBps = 0;
    finishing = false;
    highDecoder = null;
    highStreamKey = "";
    highHeader = null;
    highStartedAt = 0;
    highSpeedActive = false;
    speedText.textContent = "—";
    scanRateText.textContent = "—";
    fileName.textContent = "-";
    progressText.textContent = "0%";
    progressBar.style.width = "0%";
    missingEl.textContent = "-";
    copyMissing.disabled = true;
    result.hidden = true;
    if (download.href) URL.revokeObjectURL(download.href);
    download.removeAttribute("href");
    status.textContent = "等待开始";
    resetScanStats();
    flushPendingChunks();
    if (previousSession) queueStorage(() => Storage.remove(previousSession));
  }

  function scheduleScan() {
    if (!stream || scanTimer || scanFrameCallback) return;
    if (highWorkers.length && typeof video.requestVideoFrameCallback === "function") {
      scanFrameCallback = video.requestVideoFrameCallback(() => {
        scanFrameCallback = 0;
        recordCapturedFrame();
        void scanWithHighSpeedWorkers();
        scheduleScan();
      });
      return;
    }
    if (highWorkers.length) {
      scanTimer = setTimeout(() => {
        scanTimer = 0;
        recordCapturedFrame();
        void scanWithHighSpeedWorkers();
        scheduleScan();
      }, 16);
      return;
    }
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

  function startHighSpeedWorkers() {
    if (highWorkersDisabled || highWorkers.length) return;
    try {
      highWorkers = new Array(HIGH_SPEED_WORKERS);
      highWorkerBusy = new Array(HIGH_SPEED_WORKERS).fill(false);
      highWorkerReady = new Array(HIGH_SPEED_WORKERS).fill(false);
      highWorkerStartedAt = new Array(HIGH_SPEED_WORKERS).fill(0);
      for (let index = 0; index < HIGH_SPEED_WORKERS; index += 1) {
        startHighSpeedWorker(index);
      }
    } catch (_) {
      disableHighSpeedWorkers();
    }
  }

  function startHighSpeedWorker(index) {
    const worker = new Worker("vendor/decimen/highspeed-decoder-worker.js");
    highWorkers[index] = worker;
    highWorkerBusy[index] = false;
    highWorkerReady[index] = false;
    highWorkerStartedAt[index] = 0;
    worker.onmessage = event => {
      if (highWorkers[index] !== worker) return;
      if (event.data?.id === -1) {
        highWorkerReady[index] = true;
        return;
      }
      const startedAt = highWorkerStartedAt[index];
      highWorkerBusy[index] = false;
      highWorkerStartedAt[index] = 0;
      if (startedAt) {
        decodeTimeMs += Math.max(0, performance.now() - startedAt);
        decodeSamples += 1;
      }
      const decoded = event.data?.bytes;
      decodedFrames += 1;
      const codes = Array.isArray(decoded) ? decoded : decoded?.length ? [decoded] : [];
      validQrFrames += codes.length;
      if (codes.length) {
        highScanMisses = 0;
        for (const bytes of codes) acceptDecodedBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      } else {
        highScanMisses += 1;
      }
    };
    worker.onerror = () => {
      workerErrors += 1;
      if (highWorkers[index] === worker) restartHighSpeedWorker(index);
    };
  }

  function restartHighSpeedWorker(index) {
    if (!stream || !highWorkers.length) return;
    highWorkers[index]?.terminate();
    workerRestarts += 1;
    try {
      startHighSpeedWorker(index);
    } catch (_) {
      disableHighSpeedWorkers();
    }
  }

  function stopHighSpeedWorkers() {
    for (const worker of highWorkers) worker?.terminate();
    highWorkers = [];
    highWorkerBusy = [];
    highWorkerReady = [];
    highWorkerStartedAt = [];
  }

  function disableHighSpeedWorkers() {
    stopHighSpeedWorkers();
    highWorkersDisabled = true;
    lastDecodeBackend = barcodeDetector ? "BarcodeDetector" : (workerDisabled ? "jsQR 主线程" : "AFL1 Worker");
    lastWorkerCount = 0;
    if (stream) status.textContent = "高速解码器不可用，已切换兼容扫描";
  }

  async function scanWithHighSpeedWorkers() {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const now = performance.now();
    for (let index = 0; index < highWorkers.length; index += 1) {
      if (highWorkerBusy[index] && now - highWorkerStartedAt[index] > HIGH_WORKER_TIMEOUT) restartHighSpeedWorker(index);
    }
    const slot = highWorkerBusy.findIndex((busy, index) => !busy && highWorkerReady[index]);
    if (slot < 0) {
      workerBusyDrops += 1;
      return;
    }
    highWorkerBusy[slot] = true;
    highWorkerStartedAt[slot] = now;
    if (highScanMisses >= HIGH_FULL_SCAN_EVERY_MISSES) captureViaCanvas = true;
    const source = getHighSpeedSource();
    const scale = Math.min(1, HIGH_SCAN_SIZE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    try {
      const id = ++highFrameId;
      const useBitmap = !captureViaCanvas && typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function";
      if (useBitmap) {
        const bitmap = await createImageBitmap(video, source.x, source.y, source.width, source.height, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "high"
        });
        highWorkers[slot].postMessage({ id, bitmap }, [bitmap]);
        return;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      highWorkers[slot].postMessage({ id, buf: image.data.buffer, w: width, h: height }, [image.data.buffer]);
    } catch (_) {
      captureViaCanvas = true;
      restartHighSpeedWorker(slot);
    }
  }

  function getHighSpeedSource() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (highScanMisses > 0 && highScanMisses % HIGH_FULL_SCAN_EVERY_MISSES === 0) {
      return { x: 0, y: 0, width, height };
    }
    const side = Math.max(1, Math.floor(Math.min(width, height) * 0.94));
    return {
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side
    };
  }

  function resetScanStats() {
    scanStatsStartedAt = performance.now();
    capturedFrames = 0;
    decodedFrames = 0;
    validQrFrames = 0;
    cameraFrameRate = 0;
    cameraSettings = null;
    cameraCapabilities = null;
    workerBusyDrops = 0;
    workerRestarts = 0;
    workerErrors = 0;
    decodeTimeMs = 0;
    decodeSamples = 0;
    highFramesSeen = 0;
    highUniqueFrames = 0;
    highInvalidFrames = 0;
    highDuplicateFrames = 0;
    highSequenceGaps = 0;
    highLastLogicalSequence = -1;
    highProtocolBytes = 0;
    highLastFrameAt = 0;
    lastCaptureFps = 0;
    lastDecodeFps = 0;
    lastValidFps = 0;
    renderDiagnostics();
  }

  function recordCapturedFrame() {
    capturedFrames += 1;
    const now = performance.now();
    const elapsed = now - scanStatsStartedAt;
    if (elapsed < 1000) return;
    const captureFps = capturedFrames * 1000 / elapsed;
    const decodeFps = decodedFrames * 1000 / elapsed;
    const validFps = validQrFrames * 1000 / elapsed;
    lastCaptureFps = captureFps;
    lastDecodeFps = decodeFps;
    lastValidFps = validFps;
    const requested = cameraFrameRate ? " / " + Math.round(cameraFrameRate) : "";
    scanRateText.textContent = "采集 " + captureFps.toFixed(0) + requested + " · 分析 " + decodeFps.toFixed(0) + " · 有效码 " + validFps.toFixed(0);
    renderDiagnostics();
    scanStatsStartedAt = now;
    capturedFrames = 0;
    decodedFrames = 0;
    validQrFrames = 0;
  }

  function acceptDecodedBytes(bytes) {
    highFramesSeen += 1;
    const parsed = H?.parseFrame(bytes);
    if (parsed) {
      const before = highDecoder?.framesNew || 0;
      acceptHighSpeedFrame(parsed);
      const after = highDecoder?.framesNew || 0;
      if (after > before) {
        highUniqueFrames += 1;
        highProtocolBytes += parsed.block.length;
        highLastFrameAt = performance.now();
        recordHighSequence(parsed.header);
      } else highDuplicateFrames += 1;
      return;
    }
    highInvalidFrames += 1;
    const text = utf8Decoder.decode(bytes);
    if (text.startsWith("AFL1|")) acceptDecoded(text);
  }

  function recordHighSequence(header) {
    const raw = header.seq >>> 0;
    const logical = (raw & 0x80000000) !== 0
      ? raw & 0x7fffffff
      : header.k + raw;
    if (highLastLogicalSequence >= 0 && logical > highLastLogicalSequence + 1) {
      highSequenceGaps += logical - highLastLogicalSequence - 1;
    }
    if (logical > highLastLogicalSequence) highLastLogicalSequence = logical;
  }

  function acceptHighSpeedFrame(parsed) {
    if (finishing) return;
    highSpeedActive = true;
    const { header, block } = parsed;
    const identity = H.streamIdentity(header);
    if (!highDecoder || highStreamKey !== identity) {
      highDecoder = new H.LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen);
      highStreamKey = identity;
      highHeader = header;
      highStartedAt = performance.now();
      meta = null;
      result.hidden = true;
      fileName.textContent = "高速文件流";
      missingEl.textContent = "喷泉码接收中，无需等待指定片段";
      copyMissing.disabled = true;
      speedWindowStartedAt = performance.now();
      speedWindowBytes = 0;
      speedBps = 0;
    }
    const before = highDecoder.framesNew;
    highDecoder.addFrame(header.seq, block);
    if (highDecoder.framesNew > before) updateSpeed(block.length);
    lastFrameAt = performance.now();
    updateHighSpeedProgress();
    if (highDecoder.isComplete) void finishHighSpeed();
  }

  function updateHighSpeedProgress() {
    if (!highDecoder) return;
    const expectedFrames = Math.max(highDecoder.k, Math.ceil(highDecoder.k * 1.15));
    const frameProgress = highDecoder.framesNew / expectedFrames;
    const solveProgress = highDecoder.solvedCount / highDecoder.k;
    const percent = Math.min(highDecoder.isComplete ? 100 : 99, Math.floor(Math.max(frameProgress, solveProgress) * 100));
    progressText.textContent = percent + "% (帧 " + highDecoder.framesNew + " · 块 " + highDecoder.solvedCount + "/" + highDecoder.k + ")";
    progressBar.style.width = percent + "%";
    status.textContent = "高速接收中";
  }

  async function finishHighSpeed() {
    if (!highDecoder || !highHeader || finishing) return;
    finishing = true;
    try {
      const container = highDecoder.assemble();
      if (!container || H.fnv1a(container) !== highHeader.payloadFnv) throw new Error("高速流校验失败");
      const opticalFile = await H.unpackFile(container);
      if (!(await H.verifyFile(opticalFile))) throw new Error("文件 SHA-256 校验失败");
      const seconds = Math.max(0.001, (performance.now() - highStartedAt) / 1000);
      const blob = new Blob([opticalFile.bytes], { type: opticalFile.type });
      if (download.href) URL.revokeObjectURL(download.href);
      download.href = URL.createObjectURL(blob);
      download.download = opticalFile.name;
      fileName.textContent = opticalFile.name;
      resultInfo.textContent = formatBytes(opticalFile.bytes.length) + " · " + formatRate(container.length / seconds) + " · SHA-256 校验通过";
      result.hidden = false;
      progressText.textContent = "100% (" + highDecoder.k + "/" + highDecoder.k + ")";
      progressBar.style.width = "100%";
      missingEl.textContent = "接收完成";
      closeCamera();
      status.textContent = "接收完成";
    } catch (error) {
      finishing = false;
      status.textContent = error.message || "高速文件恢复失败";
    }
  }

  async function scan() {
    if (!stream) return;
    try {
      if (barcodeDetector) await scanWithBarcodeDetector();
      else await scanWithJsQR();
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

  async function scanWithJsQR() {
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
    let code = null;
    if (!workerDisabled) {
      try {
        code = await decodeWithWorker(image, canvas.width, canvas.height);
      } catch (_) {
        disableDecodeWorker();
      }
    }
    if (workerDisabled && image.data.byteLength) code = jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
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

  function decodeWithWorker(image, width, height) {
    if (!decodeWorker) {
      decodeWorker = new Worker("decoder-worker.js");
      decodeWorker.onmessage = (event) => {
        const pending = decodeRequests.get(event.data?.id);
        if (!pending) return;
        decodeRequests.delete(event.data.id);
        if (event.data.error) pending.reject(new Error(event.data.error));
        else pending.resolve(event.data.code || null);
      };
      decodeWorker.onerror = () => {
        workerErrors += 1;
        disableDecodeWorker();
      };
    }
    const id = ++decodeRequestId;
    return new Promise((resolve, reject) => {
      decodeRequests.set(id, { resolve, reject });
      decodeWorker.postMessage({ id, buffer: image.data.buffer, width, height }, [image.data.buffer]);
    });
  }

  function disableDecodeWorker() {
    workerDisabled = true;
    if (decodeWorker) decodeWorker.terminate();
    decodeWorker = null;
    for (const pending of decodeRequests.values()) pending.reject(new Error("Worker unavailable"));
    decodeRequests.clear();
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
    if (highSpeedActive) return;
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
    const keyText = text.slice(sessionEnd + 1, keyEnd);
    const key = Number(keyText);
    if (!Number.isSafeInteger(key)) return false;
    if (kind === "D") return chunks.has(key);
    const fields = text.split("|");
    const repairs = parityFrames.get(key);
    return !!repairs && repairs.has(fields.length === 9 ? fields[6] : "legacy");
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
    if (!Number.isInteger(frame.fileCrc) || !Number.isInteger(frame.originalFileCrc)) return false;
    if (!Number.isSafeInteger(frame.originalSize) || frame.originalSize < 0 || frame.originalSize > MAX_FILE_SIZE) return false;
    return frame.encoding === "raw" || frame.encoding === "gzip";
  }

  function beginSession(frame, headerText) {
    const previousSession = meta?.session;
    meta = frame;
    sessionHeaderText = headerText;
    chunks = new Map();
    parityFrames = new Map();
    parityLookup = new Map();
    missing = new Set();
    for (let index = 0; index < frame.total; index += 1) missing.add(index);
    receivedCount = 0;
    recoveredCount = 0;
    speedWindowStartedAt = performance.now();
    speedWindowBytes = 0;
    speedBps = 0;
    speedText.textContent = "—";
    result.hidden = true;
    fileName.textContent = frame.name;
    status.textContent = barcodeDetector ? "已识别文件（快速模式）" : "已识别文件";
    if (!restoring && Storage) {
      if (previousSession && previousSession !== frame.session) {
        flushPendingChunks();
        queueStorage(() => Storage.remove(previousSession));
      }
      queueStorage(() => Storage.putSession(frame, headerText));
    }
  }

  function acceptParityFrame(frame) {
    if (!meta || frame.session !== meta.session || frame.total !== meta.total) return;
    if (!Number.isSafeInteger(frame.groupStart) || frame.groupStart < 0 || frame.groupStart >= meta.total) return;
    if (!Number.isSafeInteger(frame.count) || frame.count < 2 || frame.count > 32) return;
    if (frame.groupStart + frame.count > meta.total || frame.bytes.length !== meta.chunkSize) return;
    if (P.crc32(frame.bytes) !== frame.parityCrc) return;
    const repairs = parityFrames.get(frame.groupStart) || new Map();
    const repairKey = String(frame.seed || "legacy");
    const isNewRepair = !repairs.has(repairKey);
    repairs.set(repairKey, frame);
    parityFrames.set(frame.groupStart, repairs);
    for (let index = frame.groupStart; index < frame.groupStart + frame.count; index += 1) {
      parityLookup.set(index, frame.groupStart);
    }
    if (isNewRepair && !restoring && Storage) queueStorage(() => Storage.putRepair(meta.session, frame));
    if (tryRecoverGroup(frame.groupStart)) {
      update();
      if (receivedCount === meta.total) finish();
    }
  }

  function tryRecoverGroup(groupStart) {
    const repairs = parityFrames.get(groupStart);
    if (!repairs?.size) return false;
    const first = repairs.values().next().value;
    const missingIndexes = [];
    for (let index = groupStart; index < groupStart + first.count; index += 1) if (!chunks.has(index)) missingIndexes.push(index);
    if (!missingIndexes.length || repairs.size < missingIndexes.length) return false;
    const rows = [];
    for (const repair of repairs.values()) {
      const coefficients = repair.coefficients || new Uint8Array(repair.count).fill(1);
      const coeff = new Uint8Array(missingIndexes.length);
      const rhs = repair.bytes.slice();
      for (let offset = 0; offset < repair.count; offset += 1) {
        const index = groupStart + offset;
        const factor = coefficients[offset] || 1;
        const chunk = chunks.get(index);
        const missing = missingIndexes.indexOf(index);
        if (missing >= 0) coeff[missing] = factor;
        else if (chunk) for (let byte = 0; byte < chunk.length; byte += 1) rhs[byte] ^= P.gfMul(factor, chunk[byte]);
      }
      rows.push({ coeff, rhs });
    }
    let rank = 0;
    for (let column = 0; column < missingIndexes.length && rank < rows.length; column += 1) {
      let pivot = rank; while (pivot < rows.length && !rows[pivot].coeff[column]) pivot += 1;
      if (pivot === rows.length) continue;
      [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
      const row = rows[rank]; const inverse = P.gfInv(row.coeff[column]);
      for (let c = column; c < row.coeff.length; c += 1) row.coeff[c] = P.gfMul(inverse, row.coeff[c]);
      for (let byte = 0; byte < row.rhs.length; byte += 1) row.rhs[byte] = P.gfMul(inverse, row.rhs[byte]);
      for (let other = 0; other < rows.length; other += 1) {
        if (other === rank) continue;
        const factor = rows[other].coeff[column]; if (!factor) continue;
        for (let c = column; c < row.coeff.length; c += 1) rows[other].coeff[c] ^= P.gfMul(factor, row.coeff[c]);
        for (let byte = 0; byte < row.rhs.length; byte += 1) rows[other].rhs[byte] ^= P.gfMul(factor, row.rhs[byte]);
      }
      row.pivot = column; rank += 1;
    }
    if (rank < missingIndexes.length) return false;
    for (let index = 0; index < missingIndexes.length; index += 1) {
      const row = rows.find(item => item.pivot === index);
      if (row) storeChunk(missingIndexes[index], row.rhs.slice(0, expectedChunkLength(missingIndexes[index])), true);
    }
    return true;
  }

  function storeChunk(index, bytes, recovered) {
    chunks.set(index, bytes);
    updateSpeed(bytes.length);
    missing.delete(index);
    receivedCount += 1;
    if (recovered) recoveredCount += 1;
    if (!restoring && Storage) scheduleChunkPersist(meta.session, index, bytes, recovered);
  }

  function updateSpeed(byteCount) {
    const now = performance.now();
    if (!speedWindowStartedAt) speedWindowStartedAt = now;
    speedWindowBytes += byteCount;
    const elapsed = now - speedWindowStartedAt;
    if (elapsed < 350) return;
    const sample = speedWindowBytes / (elapsed / 1000);
    speedBps = speedBps ? speedBps * 0.65 + sample * 0.35 : sample;
    speedWindowStartedAt = now;
    speedWindowBytes = 0;
    speedText.textContent = formatRate(speedBps);
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

  function renderDiagnostics() {
    if (!diagnosticsEl) return;
    const settings = cameraSettings || stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
    const fpsCapability = cameraCapabilities?.frameRate;
    const fpsRange = fpsCapability
      ? ((fpsCapability.min ?? "?") + "-" + (fpsCapability.max ?? "?"))
      : "未知";
    const backend = highWorkers.length ? "AFL2 WASM Worker" : lastDecodeBackend;
    const workerCount = highWorkers.length || lastWorkerCount;
    const avgDecode = decodeSamples ? (decodeTimeMs / decodeSamples).toFixed(1) + " ms" : "—";
    diagnosticsEl.textContent = [
      "相机：" + (settings.width || video.videoWidth || "?") + "×" + (settings.height || video.videoHeight || "?") +
        " · 实际/报告 " + (cameraFrameRate || settings.frameRate || "?") + " FPS · 请求上限 " + cameraRequestedFps,
      "相机能力：FPS " + fpsRange + " · facingMode " + (settings.facingMode || "未知"),
      "实时：采集 " + lastCaptureFps.toFixed(1) + " · 分析 " + lastDecodeFps.toFixed(1) + " · 有效码 " + lastValidFps.toFixed(1) + " FPS",
      "解码：" + backend + " · Worker " + workerCount + " · 平均 " + avgDecode,
      "调度：Worker 就绪 " + highWorkerReady.filter(Boolean).length + "/" + workerCount +
        " · 忙时丢弃 " + workerBusyDrops + " · 重启 " + workerRestarts + " · 错误 " + workerErrors +
        " · 连续未识别 " + highScanMisses,
      "协议：识别 " + highFramesSeen + " · 唯一 " + highUniqueFrames + " · 重复 " + highDuplicateFrames +
        " · 无效 " + highInvalidFrames + " · 序列跳跃 " + highSequenceGaps +
        " · 解块 " + (highDecoder?.solvedCount || 0) + "/" + (highDecoder?.k || 0),
      "高速会话：最近帧 " + (highLastFrameAt ? Math.max(0, Math.round(performance.now() - highLastFrameAt)) + " ms" : "—") +
        " · 有效载荷 " + formatBytes(highProtocolBytes) + " · 会话 " + (highHeader ? H.streamIdentity(highHeader) : "—"),
      "环境：" + (navigator.userAgent || "未知")
    ].join("\n");
  }

  async function copyDiagnosticsText() {
    renderDiagnostics();
    try {
      await navigator.clipboard.writeText(diagnosticsEl?.textContent || "");
      status.textContent = "诊断信息已复制";
    } catch (_) {
      status.textContent = "复制失败，请长按诊断信息复制";
    }
  }

  async function finish() {
    if (!result.hidden || finishing) return;
    finishing = true;
    const bytes = new Uint8Array(meta.size);
    let offset = 0;
    for (let index = 0; index < meta.total; index += 1) {
      const chunk = chunks.get(index);
      if (!chunk) { finishing = false; return; }
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== meta.size || P.crc32(bytes) !== meta.fileCrc) {
      status.textContent = "校验失败，请清空后重新扫描";
      finishing = false;
      return;
    }
    let output;
    try {
      output = await P.restorePayload(bytes, meta);
    } catch (_) {
      status.textContent = meta.encoding === "gzip" ? "解压失败，请清空后重新扫描" : "文件恢复失败";
      finishing = false;
      return;
    }
    if (output.length !== meta.originalSize || P.crc32(output) !== meta.originalFileCrc) {
      status.textContent = "原文件校验失败，请清空后重新扫描";
      finishing = false;
      return;
    }
    const completedSession = meta.session;
    const blob = new Blob([output], { type: meta.mime });
    if (download.href) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(blob);
    download.download = meta.name;
    resultInfo.textContent = formatBytes(output.length) + " · CRC-32 校验通过";
    result.hidden = false;
    closeCamera();
    status.textContent = "接收完成";
    if (Storage) {
      await flushPendingChunks();
      await storageQueue;
      await queueStorage(() => Storage.remove(completedSession));
    }
  }

  async function restoreSavedSession() {
    if (!Storage) return;
    restoring = true;
    try {
      const latest = await Storage.latest();
      if (!latest) return;
      const frame = P.parseFrame(latest.headerText);
      if (!frame || frame.kind !== "header" || !isValidHeader(frame)) {
        await Storage.remove(latest.session);
        return;
      }
      const saved = await Storage.load(frame.session);
      beginSession(frame, latest.headerText);
      for (const record of saved.chunks || []) {
        const bytes = new Uint8Array(record.bytes);
        if (!Number.isSafeInteger(record.index) || record.index < 0 || record.index >= meta.total) continue;
        if (bytes.length !== expectedChunkLength(record.index) || chunks.has(record.index)) continue;
        storeChunk(record.index, bytes, !!record.recovered);
      }
      for (const record of saved.repairs || []) {
        const bytes = new Uint8Array(record.bytes);
        const coefficients = record.coefficients ? new Uint8Array(record.coefficients) : new Uint8Array(record.count).fill(1);
        const repair = {
          kind: "parity", session: frame.session, groupStart: record.groupStart, count: record.count,
          total: record.total, seed: record.seed, parityCrc: record.parityCrc, bytes, coefficients
        };
        acceptParityFrame(repair);
      }
      update();
      status.textContent = receivedCount === meta.total ? "已恢复断点，正在校验" : "已恢复断点（" + receivedCount + "/" + meta.total + "）";
    } catch (_) {
      // IndexedDB is an optional optimization; scanning remains available.
    } finally {
      restoring = false;
      if (meta && receivedCount === meta.total) finish();
    }
  }

  function formatRate(n) {
    if (!n || n < 1) return "—";
    return n < 1024 ? n.toFixed(0) + " B/s" : n < 1048576 ? (n / 1024).toFixed(1) + " KB/s" : (n / 1048576).toFixed(2) + " MB/s";
  }

  function formatBytes(n) {
    return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
  }
})();
