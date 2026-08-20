(() => {
  const RECEIVER_BUILD = "v63";
  if ("serviceWorker" in navigator) {
    let swRefreshing = false;
    Promise.resolve(navigator.serviceWorker.register("sw.js?v=" + RECEIVER_BUILD)).then(reg => {
      reg?.update?.()?.catch?.(() => {});
    }).catch(() => {});
    navigator.serviceWorker.addEventListener?.("controllerchange", () => {
      if (swRefreshing) return;
      swRefreshing = true;
      location.reload();
    });
  }

  const P = window.AirFerryLiteProtocol;
  const H = window.AirFerryHighSpeed;
  const Storage = window.AirFerryLiteStorage;
  const utf8Decoder = new TextDecoder();
  const video = document.getElementById("video");
  const canvas = document.getElementById("scanCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const quadPackCanvas = document.createElement("canvas");
  const quadPackCtx = quadPackCanvas.getContext("2d", { willReadFrequently: true });
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const resetBtn = document.getElementById("resetBtn");
  const copyMissing = document.getElementById("copyMissing");
  const copyDiagnostics = document.getElementById("copyDiagnostics");
  const copyDiagnosticsCard = document.getElementById("copyDiagnosticsCard");
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
  const HIGH_SPEED_WORKERS = (navigator.hardwareConcurrency || 4) >= 4 ? 4 : 2;
  const HIGH_WORKER_TIMEOUT = 2500;
  const HIGH_ACQUIRE_SIZE = 1440;
  const HIGH_TRACK_SIZE = 960;
  const HIGH_TILE_SIZE = 720;
  const HIGH_QUAD_TILE_SIZE = 720;
  const HIGH_QUAD_PACKED_SIZE = 720;
  const HIGH_FULL_SCAN_EVERY_MISSES = 12;
  const HIGH_ROI_MISS_LIMIT = 8;
  const HIGH_CLOSE_BOX_RATIO = 0.5;
  const HIGH_QUAD_OVERLAP = 0.18;
  const HIGH_LOCATE_EVERY = 5;
  const HIGH_TILE_PAD = 1.35;
  const HIGH_QUAD_ACQUIRE_MS = 100;
  const HIGH_QUAD_TILE_MISS_LIMIT = 6;
  const HIGH_QUAD_FROZEN_MISS_LIMIT = 24;
  const HIGH_SINGLE_INFLIGHT = 2;

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
  let sessionStartedAt = 0;
  let sessionUniqueBytes = 0;
  let sessionAverageBps = 0;
  const rollingRates = [0, 0, 0];
  let rollingCount = 0;
  let rollingIndex = 0;
  let latestSpeedLabel = "实时 — · 平均 —";
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
  let highMultiLayout = false;
  let scanStatsStartedAt = 0;
  let capturedFrames = 0;
  let decodedFrames = 0;
  let validQrFrames = 0;
  let sessionDecodedFrames = 0;
  let sessionValidCodes = 0;
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
  let captureViaCanvas = false;
  let lastUsedLuma = false;
  let lumaUnavailable = false;
  let highGrabInFlight = false;
  let lastNativeLocate = 0;
  let highTileProven = [false, false, false, false];
  let highQuadFrozen = false;
  let highQuadCursor = 0;
  let highSingleConfirmed = false;
  let startInFlight = false;
  let cameraEndedWhileStarting = false;
  let hideStopTimer = 0;
  let highScanRoi = null;
  let highTrackedTiles = null;
  let lastHitBox = 0;
  let lastPostedScanSize = 0;
  let highBitmapLock = false;
  let highLocateLock = false;
  let highLocateTick = 0;
  const highDecodeMeta = new Map();
  const highJobWaiters = new Map();

  startBtn.onclick = start;
  stopBtn.onclick = stop;
  resetBtn.onclick = reset;
  copyMissing.onclick = copyMissingIndexes;
  copyDiagnostics?.addEventListener("click", copyDiagnosticsText);
  copyDiagnosticsCard?.addEventListener("click", copyDiagnosticsText);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hideStopTimer) {
      clearTimeout(hideStopTimer);
      hideStopTimer = 0;
    }
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

  function waitForCameraVideo() {
    if (video.readyState >= 1 && video.videoWidth) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        video.removeEventListener("loadedmetadata", onReady);
        reject(new Error("CameraTimeout"));
      }, 4000);
      function onReady() {
        clearTimeout(timer);
        video.removeEventListener("loadedmetadata", onReady);
        resolve();
      }
      video.addEventListener("loadedmetadata", onReady);
    });
  }

  async function start() {
    if (stream || startInFlight) return;
    if (restoring) {
      status.textContent = "正在恢复断点，请稍候";
      return;
    }
    startInFlight = true;
    cameraEndedWhileStarting = false;
    startBtn.disabled = true;
    try {
      await setupDetector();
      const androidCam = /Android/i.test(navigator.userAgent || "");
      const camera = androidCam
        ? { facingMode: { ideal: "environment" }, width: { ideal: 1440 }, height: { ideal: 1920 } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } };
      if (!androidCam) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { ...camera, frameRate: { ideal: 120 } },
            audio: false
          });
          cameraRequestedFps = 120;
        } catch (_) {
          stream = null;
        }
      }
      if (!stream) {
        cameraRequestedFps = 60;
        stream = await navigator.mediaDevices.getUserMedia({ video: camera, audio: false });
      }
      lastUsedLuma = false;
      lumaUnavailable = false;
      resetScanStats();
      configureCameraTrack(stream);
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      await waitForCameraVideo();
      try {
        await video.play();
      } catch (playErr) {
        if (playErr && playErr.name === "AbortError") await video.play();
        else throw playErr;
      }
      const liveTrack = stream.getVideoTracks?.()[0];
      if (cameraEndedWhileStarting && (!liveTrack || liveTrack.readyState === "ended")) {
        throw new Error("CameraEnded");
      }
      cameraEndedWhileStarting = false;
      bindCameraEnded(stream);
      startHighSpeedWorkers();
      if (highWorkers.length) {
        lastDecodeBackend = "AFL2 WASM Worker";
        lastWorkerCount = highWorkers.length;
      } else {
        lastDecodeBackend = barcodeDetector ? "BarcodeDetector" : (workerDisabled ? "jsQR 主线程" : "AFL1 Worker");
        lastWorkerCount = 0;
      }
      if (!highWorkers.length && !barcodeDetector && typeof window.jsQR !== "function") throw new Error("DecoderUnavailable");
      hint.classList.add("hidden");
      stopBtn.disabled = false;
      status.textContent = highWorkers.length ? "正在高速扫描" : barcodeDetector ? "正在快速扫描" : "正在扫描";
      scheduleScan();
    } catch (err) {
      closeCamera();
      status.textContent = err.message === "DecoderUnavailable" ? "二维码解码器加载失败" : err.message === "CameraEnded" ? "摄像头连接已中断，请重新开始" : err.name === "NotAllowedError" ? "摄像头权限被拒绝" : "摄像头不可用";
      hint.textContent = err.message === "DecoderUnavailable" ? "请检查网络后刷新页面" : "请在 HTTPS 页面中允许摄像头权限";
    } finally {
      startInFlight = false;
    }
  }

  function bindCameraEnded(activeStream) {
    const track = activeStream.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener("ended", () => {
      if (stream !== activeStream) return;
      if (startInFlight) {
        cameraEndedWhileStarting = true;
        return;
      }
      if (track.readyState === "live") return;
      closeCamera();
      status.textContent = "摄像头连接已中断，请重新开始";
    }, { once: true });
  }

  function configureCameraTrack(activeStream) {
    const track = activeStream.getVideoTracks()[0];
    if (!track) return;
    bindCameraEnded(activeStream);
    try {
      const settings = track.getSettings?.();
      cameraSettings = settings || null;
      cameraFrameRate = Number(settings?.frameRate) || 0;
      const capabilities = track.getCapabilities?.();
      cameraCapabilities = capabilities || null;
      if (capabilities?.focusMode?.includes("continuous") && !/Android/i.test(navigator.userAgent || "")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      }
    } catch (_) {}
  }

  function closeCamera() {
    if (hideStopTimer) {
      clearTimeout(hideStopTimer);
      hideStopTimer = 0;
    }
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
    if (!finishing) {
      highMultiLayout = false;
      highScanRoi = null;
      highTrackedTiles = null;
      lastHitBox = 0;
      highQuadCursor = 0;
      highSingleConfirmed = false;
      lastPostedScanSize = 0;
      highTileProven = [false, false, false, false];
      highQuadFrozen = false;
      lastUsedLuma = false;
    }
    highDecodeMeta.clear();
    lastScanStartedAt = -Infinity;
    highBitmapLock = false;
    highGrabInFlight = false;
    highLocateLock = false;
    highLocateTick = 0;
    lastNativeLocate = 0;
    lumaUnavailable = false;
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
    finishing = false;
    highDecoder = null;
    highStreamKey = "";
    highHeader = null;
    highStartedAt = 0;
    highSpeedActive = false;
    resetSpeed();
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
      const decoded = event.data?.bytes;
      decodedFrames += 1;
      sessionDecodedFrames += 1;
      const origin = highDecodeMeta.get(event.data?.id);
      if (event.data?.id != null) highDecodeMeta.delete(event.data.id);
      const decodeStarted = origin?.postedAt || startedAt;
      if (decodeStarted) {
        decodeTimeMs += Math.max(0, performance.now() - decodeStarted);
        decodeSamples += 1;
      }
      const codes = normalizeDecodedCodes(decoded);
      validQrFrames += codes.length;
      sessionValidCodes += codes.length;
      for (const code of codes) acceptDecodedBytes(code.bytes);
      const waiter = event.data?.id != null ? highJobWaiters.get(event.data.id) : null;
      if (waiter) {
        highJobWaiters.delete(event.data.id);
        clearTimeout(waiter.timer);
        waiter.resolve(codes.map(code => ({ bytes: code.bytes, position: code.position, origin })));
        return;
      }
      if (codes.length) {
        highScanMisses = 0;
        if (origin) updateHighScanRoiFromHits(codes, origin);
      } else {
        highScanMisses += 1;
        if (!highMultiLayout && highScanMisses >= HIGH_ROI_MISS_LIMIT) {
          highScanRoi = null;
          highTrackedTiles = null;
          highTileProven = [false, false, false, false];
          highQuadFrozen = false;
        }
        if (highScanMisses >= 12) captureViaCanvas = true;
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

  function clearJobWaiters() {
    for (const waiter of highJobWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
    }
    highJobWaiters.clear();
  }

  function stopHighSpeedWorkers() {
    clearJobWaiters();
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

  function scanWithHighSpeedWorkers() {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    if (!highWorkerReady.some(Boolean)) return;
    const now = performance.now();
    for (let index = 0; index < highWorkers.length; index += 1) {
      if (highWorkerBusy[index] && now - highWorkerStartedAt[index] > HIGH_WORKER_TIMEOUT) restartHighSpeedWorker(index);
    }
    const locked = highTrackedTiles ? highTrackedTiles.filter(Boolean).length : 0;
    if (barcodeDetector && !highLocateLock && now - lastNativeLocate > HIGH_QUAD_ACQUIRE_MS) {
      const needQuad = highMultiLayout && locked < 4;
      const needSingle = !highMultiLayout && (!highScanRoi || highScanMisses >= 3);
      if (needQuad || needSingle) {
        lastNativeLocate = now;
        void locateQuadWithNative();
      }
    }
    if (highMultiLayout) {
      decodeQuadFrame();
      return;
    }
    if (highGrabInFlight) return;
    if (highWorkerBusy.filter(Boolean).length >= HIGH_SINGLE_INFLIGHT) return;
    const slot = highWorkerBusy.findIndex((busy, index) => !busy && highWorkerReady[index]);
    if (slot < 0) {
      workerBusyDrops += 1;
      return;
    }
    let jobs;
    try {
      jobs = nextHighScanJobs();
    } catch (_) {
      return;
    }
    const job = jobs[0];
    highGrabInFlight = true;
    void postHighSpeedRegion(slot, job.source, job.maxSymbols, job.retry, job.tile).finally(() => {
      highGrabInFlight = false;
    });
  }

  function nextHighScanJobs() {
    const retry = highMultiLayout ? highScanMisses >= 2 : highScanMisses > 0;
    if (highMultiLayout) {
      return [{ source: nextQuadSource(), maxSymbols: 1, retry, tile: true }];
    }
    return [{ source: getHighSpeedSource(), maxSymbols: 1, retry, tile: false }];
  }

  function quadGridSlot(x, y, tiles) {
    const filled = (tiles || highTrackedTiles || []).filter(Boolean);
    if (filled.length >= 2) {
      const midX = filled.reduce((sum, tile) => sum + tile.x + tile.width / 2, 0) / filled.length;
      const midY = filled.reduce((sum, tile) => sum + tile.y + tile.height / 2, 0) / filled.length;
      return (y < midY ? 0 : 2) + (x < midX ? 0 : 1);
    }
    const grid = centerSquareSource();
    return (y < grid.y + grid.height / 2 ? 0 : 2) + (x < grid.x + grid.width / 2 ? 0 : 1);
  }

  function nextQuadSource() {
    const slot = highQuadCursor % 4;
    highQuadCursor = (highQuadCursor + 1) % 4;
    const filled = (highTrackedTiles || []).filter(Boolean).length;
    if (filled >= 2) {
      const inferred = inferMissingQuadTiles(highTrackedTiles);
      const known = inferred[slot];
      if (known) return clampScanRegion(inflateRect(known, HIGH_TILE_PAD));
    }
    return overlappingQuadrants(chooseQuadRegion())[slot];
  }

  function exclusiveQuadrants(source) {
    const halfW = Math.max(1, Math.round(source.width / 2));
    const halfH = Math.max(1, Math.round(source.height / 2));
    return [
      { x: source.x, y: source.y, width: halfW, height: halfH },
      { x: source.x + source.width - halfW, y: source.y, width: halfW, height: halfH },
      { x: source.x, y: source.y + source.height - halfH, width: halfW, height: halfH },
      { x: source.x + source.width - halfW, y: source.y + source.height - halfH, width: halfW, height: halfH }
    ].map(clampScanRegion);
  }

  function tileCenter(tile) {
    return { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 };
  }

  function copyTileAt(template, cx, cy) {
    return clampScanRegion({
      x: cx - template.width / 2,
      y: cy - template.height / 2,
      width: template.width,
      height: template.height
    });
  }

  function inferMissingQuadTiles(tiles) {
    const slots = tiles && tiles.length === 4 ? tiles.slice() : [null, null, null, null];
    const known = [];
    for (let index = 0; index < 4; index += 1) if (slots[index]) known.push(index);
    if (known.length < 2 || known.length === 4) return slots;
    if (known.length === 3) {
      const missing = [0, 1, 2, 3].find(index => !slots[index]);
      const c = [0, 1, 2, 3].map(index => slots[index] && tileCenter(slots[index]));
      const cx = missing === 0 || missing === 3
        ? c[1].x + c[2].x - c[missing === 0 ? 3 : 0].x
        : c[0].x + c[3].x - c[missing === 1 ? 2 : 1].x;
      const cy = missing === 0 || missing === 3
        ? c[1].y + c[2].y - c[missing === 0 ? 3 : 0].y
        : c[0].y + c[3].y - c[missing === 1 ? 2 : 1].y;
      slots[missing] = copyTileAt(slots[known[0]], cx, cy);
      return slots;
    }
    const [i, j] = known;
    const a = tileCenter(slots[i]);
    const b = tileCenter(slots[j]);
    const pitchX = Math.max(Math.abs(b.x - a.x), Math.max(slots[i].width, slots[j].width) * 1.08);
    const pitchY = Math.max(Math.abs(b.y - a.y), Math.max(slots[i].height, slots[j].height) * 1.08);
    const key = i < j ? i + "," + j : j + "," + i;
    if (key === "0,1") {
      slots[2] = copyTileAt(slots[0], a.x, a.y + pitchY);
      slots[3] = copyTileAt(slots[1], b.x, b.y + pitchY);
    } else if (key === "2,3") {
      slots[0] = copyTileAt(slots[2], a.x, a.y - pitchY);
      slots[1] = copyTileAt(slots[3], b.x, b.y - pitchY);
    } else if (key === "0,2") {
      slots[1] = copyTileAt(slots[0], a.x + pitchX, a.y);
      slots[3] = copyTileAt(slots[2], b.x + pitchX, b.y);
    } else if (key === "1,3") {
      slots[0] = copyTileAt(slots[1], a.x - pitchX, a.y);
      slots[2] = copyTileAt(slots[3], b.x - pitchX, b.y);
    } else if (key === "0,3") {
      slots[1] = copyTileAt(slots[0], b.x, a.y);
      slots[2] = copyTileAt(slots[0], a.x, b.y);
    } else if (key === "1,2") {
      slots[0] = copyTileAt(slots[1], b.x, a.y);
      slots[3] = copyTileAt(slots[1], a.x, b.y);
    }
    return slots;
  }

  async function locateQuadWithNative() {
    if (!barcodeDetector || highLocateLock) return;
    highLocateLock = true;
    try {
      const codes = await barcodeDetector.detect(video);
      const tiles = nativeCodesToTiles(codes);
      if (tiles.length >= 2) {
        highMultiLayout = true;
        lockQuadSlots(tiles, true);
      } else if (tiles.length === 1 && !highMultiLayout) {
        highScanRoi = clampScanRegion(inflateRect(tiles[0], 1.4));
        highScanMisses = 0;
      }
    } catch (_) {
    } finally {
      highLocateLock = false;
    }
  }

  function nativeCodesToTiles(codes) {
    const tiles = [];
    for (const code of codes || []) {
      if (code.format && code.format !== "qr_code") continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of code.cornerPoints || []) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const box = code.boundingBox;
      if (!Number.isFinite(minX) && box) {
        minX = box.x;
        minY = box.y;
        maxX = box.x + box.width;
        maxY = box.y + box.height;
      }
      if (!Number.isFinite(minX)) continue;
      tiles.push({
        x: minX,
        y: minY,
        width: Math.max(64, maxX - minX),
        height: Math.max(64, maxY - minY)
      });
    }
    return tiles;
  }

  function mergeVideoTiles(fresh, sighting) {
    const current = (highTrackedTiles || []).filter(Boolean);
    const wasProven = [];
    for (let index = 0; index < 4; index += 1) {
      if (highTrackedTiles && highTrackedTiles[index] && highTileProven[index]) {
        wasProven.push(tileCenter(highTrackedTiles[index]));
      }
    }
    for (const tile of fresh || []) {
      let best = -1;
      let bestDist = Infinity;
      for (let index = 0; index < current.length; index += 1) {
        const a = tileCenter(current[index]);
        const b = tileCenter(tile);
        const dist = (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      }
      const radius = Math.max(tile.width, tile.height) * 0.34;
      if (best >= 0 && bestDist <= radius * radius) {
        if (!sighting) current[best] = tile;
      } else if (current.length < 4) {
        current.push(tile);
      }
    }
    highTrackedTiles = slotTilesByCluster(current);
    const nextProven = [false, false, false, false];
    for (let index = 0; index < 4; index += 1) {
      const tile = highTrackedTiles[index];
      if (!tile) continue;
      const c = tileCenter(tile);
      const radius = Math.max(tile.width, tile.height) * 0.34;
      const near = (point) => {
        const dx = point.x - c.x;
        const dy = point.y - c.y;
        return dx * dx + dy * dy <= radius * radius;
      };
      if (wasProven.some(near)) nextProven[index] = true;
      if (!sighting) {
        for (const hit of fresh || []) {
          if (near(tileCenter(hit))) nextProven[index] = true;
        }
      }
    }
    highTileProven = nextProven;
  }

  function lockQuadSlots(fresh, sighting) {
    if (!fresh || fresh.length < 2) return;
    mergeVideoTiles(fresh, sighting);
    if ((highTrackedTiles || []).filter(Boolean).length >= 2) {
      highTrackedTiles = inferMissingQuadTiles(highTrackedTiles);
      highTileProven = (highTrackedTiles || []).map(tile => !!tile);
    }
    highQuadFrozen = (highTrackedTiles || []).filter(Boolean).length >= 4;
  }

  function evenRect(x, y, width, height, maxW, maxH) {
    x = Math.max(0, x & ~1);
    y = Math.max(0, y & ~1);
    width = Math.max(2, Math.min(maxW - x, width) & ~1);
    height = Math.max(2, Math.min(maxH - y, height) & ~1);
    return { x, y, width, height };
  }

  function rgbaToLuma(data, width, height, stride) {
    stride = stride || width * 4;
    const lum = new Uint8Array(width * height);
    for (let row = 0; row < height; row += 1) {
      const off = row * stride;
      const dest = row * width;
      for (let col = 0; col < width; col += 1) {
        const i = off + col * 4;
        lum[dest + col] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      }
    }
    return lum;
  }

  async function grabLumaRegion(source) {
    if (lumaUnavailable || typeof VideoFrame !== "function") return null;
    let frame = null;
    try {
      frame = new VideoFrame(video);
      const vis = frame.visibleRect || {
        x: 0,
        y: 0,
        width: frame.codedWidth || frame.displayWidth || video.videoWidth,
        height: frame.codedHeight || frame.displayHeight || video.videoHeight
      };
      const vw = Math.max(1, video.videoWidth || vis.width);
      const vh = Math.max(1, video.videoHeight || vis.height);
      const scaleX = vis.width / vw;
      const scaleY = vis.height / vh;
      const rect = evenRect(
        vis.x + Math.round(source.x * scaleX),
        vis.y + Math.round(source.y * scaleY),
        Math.round(source.width * scaleX),
        Math.round(source.height * scaleY),
        vis.x + vis.width,
        vis.y + vis.height
      );
      const pack = (lum, px, py, pw, ph) => ({
        lum,
        width: pw,
        height: ph,
        x: (px - vis.x) / scaleX,
        y: (py - vis.y) / scaleY,
        regionW: pw / scaleX,
        regionH: ph / scaleY
      });
      const extractPlane = async (format, useRect) => {
        const opts = useRect ? { format, rect } : { format };
        const buf = new Uint8Array(frame.allocationSize(opts));
        const planes = await frame.copyTo(buf, opts);
        const yPlane = planes && planes[0];
        const offset = yPlane?.offset || 0;
        const w = useRect ? rect.width : Math.max(1, vis.width || frame.displayWidth || vw);
        const h = useRect ? rect.height : Math.max(1, vis.height || frame.displayHeight || vh);
        const originX = useRect ? rect.x : vis.x;
        const originY = useRect ? rect.y : vis.y;
        if (format === "RGBA" || format === "RGBX") {
          return pack(rgbaToLuma(buf.subarray(offset), w, h, yPlane?.stride || w * 4), originX, originY, w, h);
        }
        const stride = yPlane?.stride || w;
        if (stride === w) return pack(buf.subarray(offset, offset + w * h), originX, originY, w, h);
        const lum = new Uint8Array(w * h);
        for (let row = 0; row < h; row += 1) {
          lum.set(buf.subarray(offset + row * stride, offset + row * stride + w), row * w);
        }
        return pack(lum, originX, originY, w, h);
      };
      let packed = null;
      for (const attempt of [["RGBA", true], ["RGBX", true], ["I420", true], ["NV12", true], ["RGBA", false], ["I420", false]]) {
        try {
          packed = await extractPlane(attempt[0], attempt[1]);
          if (packed) break;
        } catch (_) {}
      }
      frame.close();
      frame = null;
      if (!packed) throw new Error("no-y");
      lastUsedLuma = true;
      return packed;
    } catch (_) {
      try { frame?.close(); } catch (ignore) {}
      lumaUnavailable = true;
      lastUsedLuma = false;
      return null;
    }
  }

  function cropLuma(packed, tile) {
    const sx = packed.width / Math.max(packed.regionW || packed.width, 1);
    const sy = packed.height / Math.max(packed.regionH || packed.height, 1);
    const x = Math.max(0, Math.round((tile.x - packed.x) * sx));
    const y = Math.max(0, Math.round((tile.y - packed.y) * sy));
    const width = Math.max(1, Math.min(Math.round(tile.width * sx), packed.width - x));
    const height = Math.max(1, Math.min(Math.round(tile.height * sy), packed.height - y));
    if (width < 16 || height < 16) return null;
    const lum = new Uint8Array(width * height);
    for (let row = 0; row < height; row += 1) {
      const start = (y + row) * packed.width + x;
      lum.set(packed.lum.subarray(start, start + width), row * width);
    }
    return {
      lum,
      width,
      height,
      source: {
        x: packed.x + x / sx,
        y: packed.y + y / sy,
        width: width / sx,
        height: height / sy
      }
    };
  }

  function grabCanvasPacked(source, maxSide) {
    const packCanvas = highMultiLayout ? quadPackCanvas : canvas;
    const packCtx = highMultiLayout ? quadPackCtx : ctx;
    const srcW = Math.max(1, source.width);
    const srcH = Math.max(1, source.height);
    const scale = maxSide ? Math.min(1, maxSide / Math.max(srcW, srcH, 1)) : 1;
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    if (packCanvas.width !== width || packCanvas.height !== height) {
      packCanvas.width = width;
      packCanvas.height = height;
    }
    packCtx.imageSmoothingEnabled = false;
    packCtx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, width, height);
    const image = packCtx.getImageData(0, 0, width, height);
    lastUsedLuma = true;
    return {
      lum: rgbaToLuma(image.data, width, height),
      width,
      height,
      x: source.x,
      y: source.y,
      regionW: source.width,
      regionH: source.height
    };
  }

  async function grabBitmapPacked(source) {
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    const x = Math.max(0, Math.min(vw - 1, Math.round(source.x)));
    const y = Math.max(0, Math.min(vh - 1, Math.round(source.y)));
    const widthIn = Math.max(1, Math.round(source.width));
    const heightIn = Math.max(1, Math.round(source.height));
    const widthSrc = Math.max(1, Math.min(widthIn, vw - x));
    const heightSrc = Math.max(1, Math.min(heightIn, vh - y));
    const scale = Math.min(1, HIGH_QUAD_PACKED_SIZE / Math.max(widthSrc, heightSrc, 1));
    const width = Math.max(1, Math.round(widthSrc * scale));
    const height = Math.max(1, Math.round(heightSrc * scale));
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(video, x, y, widthSrc, heightSrc, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "pixelated",
          colorSpaceConversion: "none"
        });
        if (quadPackCanvas.width !== width || quadPackCanvas.height !== height) {
          quadPackCanvas.width = width;
          quadPackCanvas.height = height;
        }
        quadPackCtx.imageSmoothingEnabled = false;
        quadPackCtx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const image = quadPackCtx.getImageData(0, 0, width, height);
        lastUsedLuma = true;
        return {
          lum: rgbaToLuma(image.data, width, height),
          width,
          height,
          x,
          y,
          regionW: widthSrc,
          regionH: heightSrc
        };
      } catch (_) {}
    }
    return grabCanvasPacked({ x, y, width: widthSrc, height: heightSrc }, HIGH_QUAD_PACKED_SIZE);
  }

  async function grabPackedRegion(source) {
    if (highMultiLayout) return grabBitmapPacked(source);
    let packed = await grabLumaRegion(source);
    if (!packed) packed = grabCanvasPacked(source);
    if (packed && (packed.regionW > source.width * 1.08 || packed.regionH > source.height * 1.08)) {
      const cropped = cropLuma(packed, source);
      if (cropped) {
        return {
          lum: cropped.lum,
          width: cropped.width,
          height: cropped.height,
          x: cropped.source.x,
          y: cropped.source.y,
          regionW: cropped.source.width,
          regionH: cropped.source.height
        };
      }
    }
    return packed;
  }

  function grabPackedCenter() {
    return grabPackedRegion(centerSquareSource());
  }

  function downscaleLuma(lum, width, height, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(width, height, 1));
    if (scale >= 0.995) return { lum, width, height };
    const nextW = Math.max(1, Math.round(width * scale));
    const nextH = Math.max(1, Math.round(height * scale));
    const out = new Uint8Array(nextW * nextH);
    for (let row = 0; row < nextH; row += 1) {
      const srcY = Math.min(height - 1, Math.round(row / scale));
      for (let col = 0; col < nextW; col += 1) {
        const srcX = Math.min(width - 1, Math.round(col / scale));
        out[row * nextW + col] = lum[srcY * width + srcX];
      }
    }
    return { lum: out, width: nextW, height: nextH };
  }

  function postLumaToWorker(slot, sized, source, maxSymbols, retryBinarizer) {
    highWorkerBusy[slot] = true;
    highWorkerStartedAt[slot] = performance.now();
    lastPostedScanSize = Math.max(sized.width, sized.height);
    const id = ++highFrameId;
    const copy = sized.lum.byteOffset === 0 && sized.lum.byteLength === sized.lum.buffer.byteLength
      ? sized.lum
      : sized.lum.slice();
    highDecodeMeta.set(id, {
      x: source.x,
      y: source.y,
      srcW: source.width,
      srcH: source.height,
      outW: sized.width,
      outH: sized.height,
      postedAt: performance.now()
    });
    highWorkers[slot].postMessage({
      id,
      lum: copy.buffer,
      w: sized.width,
      h: sized.height,
      maxSymbols,
      retryBinarizer
    }, [copy.buffer]);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (!highJobWaiters.has(id)) return;
        highJobWaiters.delete(id);
        highWorkerBusy[slot] = false;
        resolve([]);
      }, HIGH_WORKER_TIMEOUT);
      highJobWaiters.set(id, { resolve, timer });
    });
  }

  function unionScanCrops(crops) {
    if (!crops.length) return centerSquareSource();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const crop of crops) {
      minX = Math.min(minX, crop.x);
      minY = Math.min(minY, crop.y);
      maxX = Math.max(maxX, crop.x + crop.width);
      maxY = Math.max(maxY, crop.y + crop.height);
    }
    return clampScanRegion({
      x: minX,
      y: minY,
      width: Math.max(64, maxX - minX),
      height: Math.max(64, maxY - minY)
    });
  }

  function acquireQuadRegion() {
    return centerSquareSource();
  }

  function chooseQuadRegion() {
    if (highScanRoi && highScanMisses < HIGH_ROI_MISS_LIMIT) {
      if (highScanMisses > 0) return inflateRect(highScanRoi, 1 + highScanMisses * 0.22);
      return highScanRoi;
    }
    return acquireQuadRegion();
  }

  function transferHitKey(hit) {
    if (!hit?.bytes || !H?.parseFrame) return null;
    const parsed = H.parseFrame(hit.bytes);
    if (!parsed) return null;
    return parsed.header.sessionId + ":" + parsed.header.seq;
  }

  function transferCount(hits) {
    return hits.filter(hit => transferHitKey(hit)).length;
  }

  function hitCenter(hit) {
    const corners = mappedCorners(hit, hit.origin || { x: 0, y: 0, srcW: 1, srcH: 1, outW: 1, outH: 1 });
    if (!corners.length) return null;
    return {
      x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
      y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length
    };
  }

  function tileCovered(tile, hits) {
    for (const hit of hits) {
      const center = hitCenter(hit);
      if (!center) continue;
      if (center.x >= tile.x && center.x < tile.x + tile.width && center.y >= tile.y && center.y < tile.y + tile.height) return true;
    }
    return false;
  }

  async function readCropsFromPacked(packed, crops, retryBinarizer) {
    const hits = [];
    let offset = 0;
    while (offset < crops.length) {
      const batch = [];
      for (let slot = 0; slot < highWorkers.length && offset < crops.length; slot += 1) {
        if (highWorkerBusy[slot] || !highWorkerReady[slot]) continue;
        const crop = crops[offset];
        offset += 1;
        const cropped = cropLuma(packed, crop);
        if (!cropped) continue;
        const sized = downscaleLuma(cropped.lum, cropped.width, cropped.height, HIGH_QUAD_TILE_SIZE);
        batch.push(postLumaToWorker(slot, sized, cropped.source, 1, retryBinarizer));
      }
      if (!batch.length) break;
      const parts = await Promise.all(batch);
      for (const list of parts) hits.push(...list);
    }
    return hits;
  }

  function transferHitTile(hit) {
    const mapped = mappedCorners(hit, hit.origin || { x: 0, y: 0, srcW: 1, srcH: 1, outW: 1, outH: 1 });
    if (mapped.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of mapped) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return {
      x: minX,
      y: minY,
      width: Math.max(64, maxX - minX),
      height: Math.max(64, maxY - minY)
    };
  }

  function slotContainingHit(hit) {
    const center = hitCenter(hit);
    if (!center || !highTrackedTiles) return -1;
    let owner = -1;
    for (let index = 0; index < 4; index += 1) {
      const tile = highTrackedTiles[index];
      if (!tile) continue;
      const scan = inflateRect(tile, HIGH_TILE_PAD);
      if (center.x >= scan.x && center.x < scan.x + scan.width && center.y >= scan.y && center.y < scan.y + scan.height) {
        if (owner >= 0) return -1;
        owner = index;
      }
    }
    return owner;
  }

  function followContainedQuadHits(hits) {
    if (!highTrackedTiles) return;
    const next = highTrackedTiles.slice();
    const claimed = [false, false, false, false];
    for (const hit of hits) {
      const tile = transferHitTile(hit);
      const slot = slotContainingHit(hit);
      if (!tile || slot < 0 || claimed[slot]) continue;
      claimed[slot] = true;
      next[slot] = tile;
    }
    highTrackedTiles = next;
  }

  function rememberQuadHits(hits) {
    const transferHits = hits.filter(hit => transferHitKey(hit));
    if (!transferHits.length) {
      const missLimit = highQuadFrozen ? HIGH_QUAD_FROZEN_MISS_LIMIT : HIGH_QUAD_TILE_MISS_LIMIT;
      if (highScanMisses + 1 >= missLimit) {
        highTrackedTiles = null;
        highTileProven = [false, false, false, false];
        highQuadFrozen = false;
      }
      highScanMisses += 1;
      return;
    }
    highScanMisses = 0;
    const quadFrame = transferHits.some(hit => H.parseFrame(hit.bytes)?.header.layoutCodes === 4);
    if (quadFrame || transferHits.length >= 2) {
      highMultiLayout = true;
      highSingleConfirmed = false;
    } else {
      highSingleConfirmed = true;
    }
    const corners = [];
    for (const hit of transferHits) corners.push(...mappedCorners(hit, hit.origin || { x: 0, y: 0, srcW: 1, srcH: 1, outW: 1, outH: 1 }));
    if (corners.length && !highQuadFrozen) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of corners) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      lastHitBox = Math.max(maxX - minX, maxY - minY, 64);
      const boxW = Math.max(1, maxX - minX);
      const boxH = Math.max(1, maxY - minY);
      const pad = transferHits.length >= 4 ? 1.4 : highMultiLayout && transferHits.length < 4 ? (transferHits.length >= 2 ? 2.15 : 3.8) : 1.35;
      const next = clampScanRegion({
        x: minX - boxW * (pad - 1) / 2,
        y: minY - boxH * (pad - 1) / 2,
        width: boxW * pad,
        height: boxH * pad
      });
      if (transferHits.length >= 4) highScanRoi = next;
      else if (transferHits.length >= 3) highScanRoi = unionHighScanRoi(highScanRoi || next, next);
      else highScanRoi = next;
    }
    if (highMultiLayout && transferHits.length) {
      if (highQuadFrozen) {
        followContainedQuadHits(transferHits);
      } else {
        const tiles = [];
        for (const hit of transferHits) {
          const tile = transferHitTile(hit);
          if (tile) tiles.push(tile);
        }
        if (tiles.length >= 2) lockQuadSlots(tiles, false);
        if (transferHits.length >= 4 && (highTrackedTiles || []).filter(Boolean).length >= 4) highQuadFrozen = true;
      }
    }
  }

  function decodeQuadFrame() {
    if (highGrabInFlight || highWorkerBusy.some(Boolean)) {
      workerBusyDrops += 1;
      return;
    }
    if (!highWorkerReady.some(Boolean)) return;
    highGrabInFlight = true;
    void (async () => {
      try {
        const inferred = inferMissingQuadTiles(highTrackedTiles).filter(Boolean).map(tile => clampScanRegion(inflateRect(tile, HIGH_TILE_PAD)));
        const region = inferred.length >= 3 ? unionScanCrops(inferred) : chooseQuadRegion();
        const packed = await grabPackedRegion(region);
        if (!stream || !packed) return;
        const hits = [];
        const seen = new Set();
        const add = list => {
          for (const hit of list) {
            const key = transferHitKey(hit);
            if (key) {
              if (seen.has(key)) continue;
              seen.add(key);
            }
            hits.push(hit);
          }
        };
        const crops = inferred.length >= 3 ? inferred : overlappingQuadrants(region);
        add(await readCropsFromPacked(packed, crops, false));
        rememberQuadHits(hits);
      } finally {
        highGrabInFlight = false;
      }
    })();
  }

  function scanQuadFromLuma() {
    decodeQuadFrame();
  }

  function clampBitmapRect(x, y, w, h, maxW, maxH) {
    x = Math.max(0, Math.floor(x));
    y = Math.max(0, Math.floor(y));
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (x + w > maxW) w = Math.max(1, maxW - x);
    if (y + h > maxH) h = Math.max(1, maxH - y);
    return { x, y, w, h };
  }

  async function grabFullVideoBitmap(maxSide) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, maxSide / Math.max(vw, vh, 1));
    const width = Math.max(1, Math.round(vw * scale));
    const height = Math.max(1, Math.round(vh * scale));
    const bitmap = await createImageBitmap(video, 0, 0, vw, vh, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "pixelated",
      colorSpaceConversion: "none"
    });
    return { bitmap, width, height, vw, vh };
  }

  function grabMaxSideForSource(source) {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const full = source.x <= 1 && source.y <= 1 && source.x + source.width >= vw - 1 && source.y + source.height >= vh - 1;
    if (full) return HIGH_TRACK_SIZE;
    const roiLong = Math.max(source.width, source.height, 64);
    const scaled = Math.ceil(Math.max(vw, vh, 1) * HIGH_TILE_SIZE / roiLong);
    return Math.max(HIGH_TILE_SIZE, Math.min(HIGH_ACQUIRE_SIZE, scaled));
  }

  function cropBitmapToSource(full, source, scanSize) {
    const rect = clampBitmapRect(
      source.x * full.width / full.vw,
      source.y * full.height / full.vh,
      source.width * full.width / full.vw,
      source.height * full.height / full.vh,
      full.width,
      full.height
    );
    const outScale = Math.min(1, scanSize / Math.max(rect.w, rect.h, 1));
    const width = Math.max(1, Math.round(rect.w * outScale));
    const height = Math.max(1, Math.round(rect.h * outScale));
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, width, height };
  }

  async function postHighSpeedRegion(slot, source, maxSymbols, retryBinarizer, tile) {
    const cap = scanSizeForSource(source, tile);
    const useLuma = highMultiLayout && Math.max(source.width, source.height) <= HIGH_TILE_SIZE + 16;
    const luma = useLuma ? await grabLumaRegion(source) : null;
    if (luma && (Math.max(luma.width, luma.height) <= cap + 1 || luma.width * luma.height <= HIGH_TILE_SIZE * HIGH_TILE_SIZE * 2)) {
      const sized = downscaleLuma(luma.lum, luma.width, luma.height, cap);
      return postLumaToWorker(slot, sized, { x: luma.x, y: luma.y, width: luma.regionW || luma.width, height: luma.regionH || luma.height }, maxSymbols, retryBinarizer);
    }
    lastUsedLuma = false;
    highWorkerBusy[slot] = true;
    highWorkerStartedAt[slot] = performance.now();
    const scanSize = scanSizeForSource(source, tile);
    const scale = Math.min(1, scanSize / Math.max(source.width, source.height));
    let width = Math.max(1, Math.round(source.width * scale));
    let height = Math.max(1, Math.round(source.height * scale));
    lastPostedScanSize = Math.max(width, height);
    let postedBitmap = null;
    try {
      const id = ++highFrameId;
      highDecodeMeta.set(id, { x: source.x, y: source.y, srcW: source.width, srcH: source.height, outW: width, outH: height });
      const useBitmap = !captureViaCanvas && typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function";
      if (useBitmap) {
        let bitmap;
        let crop = null;
        if (!tile && !highMultiLayout) {
          const full = await grabFullVideoBitmap(grabMaxSideForSource(source));
          bitmap = full.bitmap;
          width = full.width;
          height = full.height;
          const cropped = source.x > 1 || source.y > 1 || source.x + source.width < full.vw - 1 || source.y + source.height < full.vh - 1;
          if (cropped) {
            const next = cropBitmapToSource(full, source, scanSize);
            crop = { x: next.x, y: next.y, w: next.w, h: next.h, dw: next.width, dh: next.height };
            width = next.width;
            height = next.height;
          }
        } else {
          bitmap = await createImageBitmap(video, source.x, source.y, source.width, source.height, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: "pixelated",
            colorSpaceConversion: "none"
          });
        }
        postedBitmap = bitmap;
        lastPostedScanSize = Math.max(width, height);
        const meta = highDecodeMeta.get(id);
        if (meta) {
          meta.outW = width;
          meta.outH = height;
          meta.postedAt = performance.now();
        }
        highWorkers[slot].postMessage({ id, bitmap, maxSymbols, retryBinarizer, crop }, [bitmap]);
        return true;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const meta = highDecodeMeta.get(id);
      if (meta) meta.postedAt = performance.now();
      highWorkers[slot].postMessage({
        id,
        buf: image.data.buffer,
        w: width,
        h: height,
        maxSymbols,
        retryBinarizer
      }, [image.data.buffer]);
      return true;
    } catch (_) {
      captureViaCanvas = true;
      highDecodeMeta.delete(highFrameId);
      try { postedBitmap?.close(); } catch (_) {}
      restartHighSpeedWorker(slot);
      return false;
    }
  }

  function scanSizeForSource(source, tile) {
    const longest = Math.max(source.width, source.height, 64);
    if (tile || highMultiLayout || highScanRoi) return Math.min(HIGH_TILE_SIZE, longest);
    return Math.min(HIGH_ACQUIRE_SIZE, longest);
  }

  function currentHighScanSize() {
    return lastPostedScanSize || (highMultiLayout ? HIGH_QUAD_TILE_SIZE : highScanRoi ? HIGH_TILE_SIZE : HIGH_ACQUIRE_SIZE);
  }

  function centerSquareSource() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const side = Math.max(1, Math.min(width, height));
    return {
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side
    };
  }

  function fullFrameSource() {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, video.videoWidth || 1),
      height: Math.max(1, video.videoHeight || 1)
    };
  }

  function getHighSpeedSource() {
    if (highScanRoi && highScanMisses < HIGH_ROI_MISS_LIMIT) {
      if (highScanMisses > 0) return inflateRect(highScanRoi, 1.2 + highScanMisses * 0.2);
      return highScanRoi;
    }
    return fullFrameSource();
  }

  function overlappingQuadrants(source) {
    const overlap = HIGH_QUAD_OVERLAP;
    const cropW = Math.max(1, Math.round(source.width * (0.5 + overlap)));
    const cropH = Math.max(1, Math.round(source.height * (0.5 + overlap)));
    return [
      { x: source.x, y: source.y, width: cropW, height: cropH },
      { x: source.x + source.width - cropW, y: source.y, width: cropW, height: cropH },
      { x: source.x, y: source.y + source.height - cropH, width: cropW, height: cropH },
      { x: source.x + source.width - cropW, y: source.y + source.height - cropH, width: cropW, height: cropH }
    ].map(clampScanRegion);
  }

  function clampScanRegion(region) {
    const width = video.videoWidth || 1;
    const height = video.videoHeight || 1;
    let w = Math.max(64, Math.round(region.width));
    let h = Math.max(64, Math.round(region.height));
    let left = Math.round(region.x);
    let top = Math.round(region.y);
    if (left < 0) {
      w += left;
      left = 0;
    }
    if (top < 0) {
      h += top;
      top = 0;
    }
    if (left + w > width) w = width - left;
    if (top + h > height) h = height - top;
    w = Math.max(64, Math.min(w, width));
    h = Math.max(64, Math.min(h, height));
    if (left + w > width) left = Math.max(0, width - w);
    if (top + h > height) top = Math.max(0, height - h);
    return { x: left, y: top, width: w, height: h };
  }

  function inflateRect(region, factor) {
    const cx = region.x + region.width / 2;
    const cy = region.y + region.height / 2;
    return clampScanRegion({
      x: cx - region.width * factor / 2,
      y: cy - region.height * factor / 2,
      width: region.width * factor,
      height: region.height * factor
    });
  }

  function inflateRegion(region, factor) {
    const cx = region.x + region.width / 2;
    const cy = region.y + region.height / 2;
    const side = Math.round(Math.max(region.width, region.height) * factor);
    return clampScanRegion({ x: cx - side / 2, y: cy - side / 2, width: side, height: side });
  }

  function normalizeDecodedCodes(decoded) {
    if (!decoded) return [];
    const items = Array.isArray(decoded) ? decoded : [decoded];
    return items.map(item => {
      if (!item) return null;
      if (item instanceof Uint8Array) return { bytes: item, position: null };
      if (ArrayBuffer.isView(item)) return { bytes: new Uint8Array(item.buffer, item.byteOffset, item.byteLength), position: null };
      if (item.bytes) {
        const bytes = item.bytes instanceof Uint8Array ? item.bytes : new Uint8Array(item.bytes);
        return { bytes, position: item.position || null };
      }
      if (item.buffer) return { bytes: new Uint8Array(item), position: null };
      return null;
    }).filter(Boolean);
  }

  function updateHighScanRoiFromHits(codes, origin) {
    const corners = [];
    for (const code of codes) {
      const position = code.position;
      if (!position) continue;
      for (const point of [position.topLeft, position.topRight, position.bottomRight, position.bottomLeft]) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        corners.push({
          x: origin.x + point.x * origin.srcW / origin.outW,
          y: origin.y + point.y * origin.srcH / origin.outH
        });
      }
    }
    if (!corners.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of corners) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const view = Math.min(video.videoWidth, video.videoHeight);
    const box = Math.max(maxX - minX, maxY - minY, 64);
    lastHitBox = box;
    const close = !highMultiLayout && box >= view * HIGH_CLOSE_BOX_RATIO;
    const pad = highMultiLayout
      ? (codes.length >= 4 ? 1.35 : codes.length >= 2 ? 2.15 : 3.8)
      : (close ? 1.18 : 1.4);
    highScanRoi = clampScanRegion({
      x: minX - (maxX - minX) * (pad - 1) / 2,
      y: minY - (maxY - minY) * (pad - 1) / 2,
      width: (maxX - minX) * pad,
      height: (maxY - minY) * pad
    });
    if (highMultiLayout || codes.length >= 2) rememberTilesFromHits(codes, origin);
    else if (!highMultiLayout) highTrackedTiles = null;
  }

  function mappedCorners(code, origin) {
    const position = code.position;
    if (!position) return [];
    const corners = [];
    for (const point of [position.topLeft, position.topRight, position.bottomRight, position.bottomLeft]) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      corners.push({
        x: origin.x + point.x * origin.srcW / origin.outW,
        y: origin.y + point.y * origin.srcH / origin.outH
      });
    }
    return corners;
  }

  function tilesFromHits(codes, origin) {
    const tiles = [];
    for (const code of codes) {
      const corners = mappedCorners(code, origin);
      if (corners.length < 2) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of corners) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      tiles.push(inflateRegion({
        x: minX,
        y: minY,
        width: Math.max(64, maxX - minX),
        height: Math.max(64, maxY - minY)
      }, 1.18));
    }
    if (tiles.length <= 1) return tiles;
    const midX = tiles.reduce((sum, tile) => sum + tile.x + tile.width / 2, 0) / tiles.length;
    const midY = tiles.reduce((sum, tile) => sum + tile.y + tile.height / 2, 0) / tiles.length;
    return tiles.sort((a, b) => {
      const aTop = a.y + a.height / 2 < midY ? 0 : 1;
      const bTop = b.y + b.height / 2 < midY ? 0 : 1;
      if (aTop !== bTop) return aTop - bTop;
      const aLeft = a.x + a.width / 2 < midX ? 0 : 1;
      const bLeft = b.x + b.width / 2 < midX ? 0 : 1;
      return aLeft - bLeft;
    });
  }

  function rememberTilesFromHits(codes, origin) {
    const fresh = tilesFromHits(codes, origin);
    if (highMultiLayout) {
      if (fresh.length >= 2) mergeVideoTiles(fresh, false);
      return;
    }
    for (const tile of fresh) mergeTrackedTile(tile);
    if (highTrackedTiles && highTrackedTiles.length < 2) highTrackedTiles = null;
  }

  function slotTilesByCluster(tiles) {
    const filled = (tiles || []).filter(Boolean);
    const slots = [null, null, null, null];
    if (!filled.length) return slots;
    if (filled.length === 1) {
      slots[quadGridSlot(filled[0].x + filled[0].width / 2, filled[0].y + filled[0].height / 2)] = filled[0];
      return slots;
    }
    if (filled.length === 2) {
      const a = filled[0];
      const b = filled[1];
      const dx = b.x + b.width / 2 - (a.x + a.width / 2);
      const dy = b.y + b.height / 2 - (a.y + a.height / 2);
      if (Math.abs(dx) >= Math.abs(dy)) {
        const left = a.x + a.width / 2 < b.x + b.width / 2 ? a : b;
        const right = left === a ? b : a;
        slots[0] = left;
        slots[1] = right;
      } else {
        const top = a.y + a.height / 2 < b.y + b.height / 2 ? a : b;
        const bottom = top === a ? b : a;
        slots[0] = top;
        slots[2] = bottom;
      }
      return slots;
    }
    const midX = filled.reduce((sum, tile) => sum + tile.x + tile.width / 2, 0) / filled.length;
    const midY = filled.reduce((sum, tile) => sum + tile.y + tile.height / 2, 0) / filled.length;
    for (const tile of filled) {
      slots[(tile.y + tile.height / 2 < midY ? 0 : 2) + (tile.x + tile.width / 2 < midX ? 0 : 1)] = tile;
    }
    return slots;
  }

  function mergeTrackedTile(tile) {
    if (!highTrackedTiles) {
      highTrackedTiles = [tile];
      return;
    }
    const cx = tile.x + tile.width / 2;
    const cy = tile.y + tile.height / 2;
    let best = -1;
    let bestDist = Infinity;
    for (let index = 0; index < highTrackedTiles.length; index += 1) {
      const current = highTrackedTiles[index];
      const dx = current.x + current.width / 2 - cx;
      const dy = current.y + current.height / 2 - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    }
    const radius = Math.max(tile.width, tile.height) * 0.65;
    if (best >= 0 && bestDist <= radius * radius) highTrackedTiles[best] = tile;
    else if (highTrackedTiles.length < 4) highTrackedTiles.push(tile);
  }

  function unionHighScanRoi(first, second) {
    if (!first) return second;
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const right = Math.max(first.x + first.width, second.x + second.width);
    const bottom = Math.max(first.y + first.height, second.y + second.height);
    const side = Math.min(video.videoWidth, video.videoHeight, Math.max(right - left, bottom - top, 64));
    return {
      x: Math.max(0, Math.min(video.videoWidth - side, left)),
      y: Math.max(0, Math.min(video.videoHeight - side, top)),
      width: side,
      height: side
    };
  }

  function resetScanStats() {
    scanStatsStartedAt = performance.now();
    capturedFrames = 0;
    decodedFrames = 0;
    validQrFrames = 0;
    sessionDecodedFrames = 0;
    sessionValidCodes = 0;
    cameraFrameRate = 0;
    cameraSettings = null;
    cameraCapabilities = null;
    workerBusyDrops = 0;
    workerRestarts = 0;
    workerErrors = 0;
    decodeTimeMs = 0;
    decodeSamples = 0;
    highFramesSeen = 0;
    highMultiLayout = false;
    highScanRoi = null;
    highTrackedTiles = null;
    lastHitBox = 0;
    lastPostedScanSize = 0;
    highBitmapLock = false;
    highGrabInFlight = false;
    highLocateLock = false;
    highLocateTick = 0;
    highQuadCursor = 0;
    highSingleConfirmed = false;
    lastNativeLocate = 0;
    highTileProven = [false, false, false, false];
    highQuadFrozen = false;
    lastUsedLuma = false;
    highDecodeMeta.clear();
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
      if (parsed.header.layoutCodes === 4) highMultiLayout = true;
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
      resetSpeed();
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
      renderDiagnostics();
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
    resetSpeed();
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

  function resetSpeed() {
    speedWindowStartedAt = 0;
    speedWindowBytes = 0;
    speedBps = 0;
    sessionStartedAt = 0;
    sessionUniqueBytes = 0;
    sessionAverageBps = 0;
    rollingCount = 0;
    rollingIndex = 0;
    rollingRates.fill(0);
    latestSpeedLabel = "实时 — · 平均 —";
    speedText.textContent = latestSpeedLabel;
  }

  function updateSpeed(byteCount) {
    const now = performance.now();
    if (!sessionStartedAt) sessionStartedAt = now;
    if (!speedWindowStartedAt) speedWindowStartedAt = now;
    sessionUniqueBytes += byteCount;
    speedWindowBytes += byteCount;
    const elapsed = now - speedWindowStartedAt;
    if (elapsed < 1000) return;
    const sample = speedWindowBytes / (elapsed / 1000);
    speedBps = sample;
    rollingRates[rollingIndex] = sample;
    rollingIndex = (rollingIndex + 1) % rollingRates.length;
    rollingCount = Math.min(rollingRates.length, rollingCount + 1);
    let rollingSum = 0;
    for (let index = 0; index < rollingCount; index += 1) rollingSum += rollingRates[index];
    const rolling = rollingSum / rollingCount;
    sessionAverageBps = sessionUniqueBytes / Math.max(0.001, (now - sessionStartedAt) / 1000);
    latestSpeedLabel = "实时 " + formatRate(speedBps) + " · 平均 " + formatRate(rolling);
    speedText.textContent = latestSpeedLabel;
    speedWindowStartedAt = now;
    speedWindowBytes = 0;
  }

  function perFrameLabel() {
    if (!sessionDecodedFrames || !sessionValidCodes) return "";
    return " · 每帧 " + (sessionValidCodes / sessionDecodedFrames).toFixed(2);
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
    const backend = highWorkers.length ? (lastUsedLuma ? "AFL2 zxing-cpp Y" : "AFL2 WASM RGBA") : lastDecodeBackend;
    const workerCount = highWorkers.length || lastWorkerCount;
    const avgDecode = decodeSamples ? (decodeTimeMs / decodeSamples).toFixed(1) + " ms" : "—";
    diagnosticsEl.textContent = [
      "网页：" + RECEIVER_BUILD + " · Worker " + (highWorkers.length || lastWorkerCount) + " · 原生定位 " + (barcodeDetector ? "开" : "关"),
      "相机：" + (settings.width || video.videoWidth || "?") + "×" + (settings.height || video.videoHeight || "?") +
        " · 实际/报告 " + (cameraFrameRate || settings.frameRate || "?") + " FPS · 请求上限 " + cameraRequestedFps,
      "相机能力：FPS " + fpsRange + " · facingMode " + (settings.facingMode || "未知"),
      "实时：采集 " + lastCaptureFps.toFixed(1) + " · 分析 " + lastDecodeFps.toFixed(1) + " · 有效码 " + lastValidFps.toFixed(1) + " FPS",
      "解码：" + backend + " · Worker " + workerCount + " · 平均 " + avgDecode +
        " · 扫描 " + currentHighScanSize() + " · 布局 " + (highMultiLayout ? "四码" : "单码") +
        (highScanRoi ? " · ROI" : " · 全图") +
        (highTrackedTiles ? " · 格 " + highTrackedTiles.filter(Boolean).length : "") + perFrameLabel(),
      "调度：Worker 就绪 " + highWorkerReady.filter(Boolean).length + "/" + workerCount +
        " · 忙时丢弃 " + workerBusyDrops + " · 重启 " + workerRestarts + " · 错误 " + workerErrors +
        " · 连续未识别 " + highScanMisses,
      "协议：识别 " + highFramesSeen + " · 唯一 " + highUniqueFrames + " · 重复 " + highDuplicateFrames +
        " · 无效 " + highInvalidFrames + " · 序列跳跃 " + highSequenceGaps +
        " · 解块 " + (highDecoder?.solvedCount || 0) + "/" + (highDecoder?.k || 0),
      "高速会话：最近帧 " + (highLastFrameAt ? Math.max(0, Math.round(performance.now() - highLastFrameAt)) + " ms" : "—") +
        " · 有效载荷 " + formatBytes(highProtocolBytes) + " · 速度 " + latestSpeedLabel +
        " · 会话 " + formatRate(sessionAverageBps) + " · 流 " + (highHeader ? H.streamIdentity(highHeader) : "—"),
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
