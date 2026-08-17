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
  const MAX_SCAN_WIDTH = 960;
  const SCAN_INTERVAL = 45;
  const DETECTOR_INTERVAL = 35;
  const SESSION_TIMEOUT = 90000;
  let stream = null;
  let scanTimer = 0;
  let meta = null;
  let chunks = new Map();
  let lastMissing = [];
  let lastDecodedText = "";
  let lastDecodedAt = 0;
  let lastFrameAt = 0;
  let barcodeDetector = null;
  let detectorBusy = false;

  startBtn.onclick = start;
  stopBtn.onclick = stop;
  resetBtn.onclick = reset;
  copyMissing.onclick = () => navigator.clipboard?.writeText(lastMissing.join(","));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) stop();
  });

  async function setupDetector() {
    barcodeDetector = null;
    if (!("BarcodeDetector" in window)) return;
    try {
      const formats = await BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) {
        barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
      }
    } catch (_) {
      barcodeDetector = null;
    }
  }

  async function start() {
    if (stream) return;
    try {
      await setupDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 540 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      hint.classList.add("hidden");
      startBtn.disabled = true;
      stopBtn.disabled = false;
      status.textContent = barcodeDetector ? "正在快速扫描" : "正在扫描";
      scan();
    } catch (err) {
      status.textContent = err.name === "NotAllowedError" ? "摄像头权限被拒绝" : "摄像头不可用";
      hint.textContent = "请在 HTTPS 页面中允许摄像头权限";
    }
  }

  function stop() {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    clearTimeout(scanTimer);
    detectorBusy = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = meta ? "已暂停" : "等待开始";
  }

  function reset() {
    stop();
    meta = null;
    chunks = new Map();
    lastMissing = [];
    lastDecodedText = "";
    lastDecodedAt = 0;
    lastFrameAt = 0;
    fileName.textContent = "-";
    progressText.textContent = "0%";
    progressBar.style.width = "0%";
    missingEl.textContent = "-";
    copyMissing.disabled = true;
    result.hidden = true;
    status.textContent = "等待开始";
  }

  async function scan() {
    if (!stream) return;
    if (barcodeDetector) {
      if (!detectorBusy) {
        detectorBusy = true;
        try {
          const codes = await barcodeDetector.detect(video);
          if (codes[0]?.rawValue) acceptDecoded(codes[0].rawValue);
        } catch (_) {
          // Some browsers expose BarcodeDetector but reject a camera frame; keep trying.
        } finally {
          detectorBusy = false;
        }
      }
    } else if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
      if (code?.data) acceptDecoded(code.data);
    }
    if (meta && performance.now() - lastFrameAt > SESSION_TIMEOUT) {
      status.textContent = "长时间未收到二维码，正在等待";
    }
    scanTimer = setTimeout(scan, barcodeDetector ? DETECTOR_INTERVAL : SCAN_INTERVAL);
  }

  function acceptDecoded(text) {
    const now = performance.now();
    if (text === lastDecodedText && now - lastDecodedAt < 250) return;
    lastDecodedText = text;
    lastDecodedAt = now;
    accept(text);
  }

  function accept(text) {
    const frame = P.parseFrame(text);
    if (!frame) return;
    lastFrameAt = performance.now();
    if (frame.kind === "header") {
      if (!meta || meta.session !== frame.session) {
        meta = frame;
        chunks = new Map();
        result.hidden = true;
        fileName.textContent = frame.name;
        status.textContent = barcodeDetector ? "已识别文件（快速模式）" : "已识别文件";
      }
      update();
      return;
    }
    if (!meta || frame.session !== meta.session || frame.total !== meta.total ||
        frame.index < 0 || frame.index >= meta.total) return;
    if (P.crc32(frame.bytes) !== frame.chunkCrc) return;
    if (!chunks.has(frame.index)) chunks.set(frame.index, frame.bytes);
    update();
    if (chunks.size === meta.total) finish();
  }

  function update() {
    if (!meta || !meta.total) return;
    const percent = Math.floor(chunks.size / meta.total * 100);
    progressText.textContent = percent + "% (" + chunks.size + "/" + meta.total + ")";
    progressBar.style.width = percent + "%";
    lastMissing = [];
    for (let i = 0; i < meta.total; i += 1) if (!chunks.has(i)) lastMissing.push(i);
    missingEl.textContent = lastMissing.length ? lastMissing.slice(0, 80).join(", ") : "全部片段已收到";
    copyMissing.disabled = !lastMissing.length;
    status.textContent = chunks.size === meta.total ? "正在校验" : "接收中";
  }

  function finish() {
    if (!result.hidden) return;
    const bytes = new Uint8Array(meta.size);
    let offset = 0;
    for (let i = 0; i < meta.total; i += 1) {
      const chunk = chunks.get(i);
      if (!chunk) return;
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== meta.size || P.crc32(bytes) !== meta.fileCrc) {
      status.textContent = "校验失败，请继续扫描";
      return;
    }
    const blob = new Blob([bytes], { type: meta.mime });
    if (download.href) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(blob);
    download.download = meta.name;
    resultInfo.textContent = formatBytes(bytes.length) + " · CRC-32 校验通过";
    result.hidden = false;
    status.textContent = "接收完成";
  }

  function formatBytes(n) {
    return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
  }
})();
