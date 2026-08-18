(() => {
  const P = window.AirFerryLiteProtocol;
  const el = id => document.getElementById(id);
  const fileInput = el("fileInput");
  const dropZone = el("dropZone");
  const fileLabel = el("fileLabel");
  const mode = el("mode");
  const chunkSize = el("chunkSize");
  const fps = el("fps");
  const prepareBtn = el("prepareBtn");
  const playBtn = el("playBtn");
  const resetBtn = el("resetBtn");
  const canvas = el("qrCanvas");
  const overlay = el("overlay");
  const statusText = el("statusText");
  const sessionText = el("sessionText");
  const frameText = el("frameText");
  const progressBar = el("progressBar");
  const receiverUrl = el("receiverUrl");
  const receiverQrCanvas = el("receiverQrCanvas");
  const RECEIVER_URL = "https://shuipashui.github.io/airferry-lite/";
  const PROFILES = {
    stable: { chunk: 400, fps: 6, headerEvery: 8 },
    balanced: { chunk: 700, fps: 8, headerEvery: 10 },
    fast: { chunk: 900, fps: 12, headerEvery: 16 }
  };
  const QR_CACHE_LIMIT = 64;
  let file = null;
  let transfer = null;
  let timer = null;
  let playbackIndex = 0;
  let emitted = 0;
  let round = 0;
  let nextTickAt = 0;
  let intervalMs = 125;
  const qrCache = new Map();

  function applyProfile() {
    const profile = PROFILES[mode.value] || PROFILES.balanced;
    chunkSize.value = String(profile.chunk);
    fps.value = String(profile.fps);
  }

  function selectFile(next) {
    file = next || null;
    fileLabel.textContent = file ? file.name + " · " + formatBytes(file.size) : "选择或拖入一个文件";
    prepareBtn.disabled = !file;
    resetBtn.disabled = !file;
    statusText.textContent = file ? "文件已选择" : "等待文件";
  }

  mode.addEventListener("change", applyProfile);
  fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
  ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove("drag");
  }));
  dropZone.addEventListener("drop", event => {
    if (event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]);
  });

  prepareBtn.addEventListener("click", async () => {
    if (!file) return;
    stop();
    statusText.textContent = "正在读取文件";
    prepareBtn.disabled = true;
    try {
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      const prepared = await P.preparePayload(sourceBytes);
      transfer = P.makeTransfer(prepared.bytes, {
        name: file.name,
        mime: file.type || "application/octet-stream",
        chunkSize: Number(chunkSize.value),
        encoding: prepared.encoding,
        originalSize: prepared.originalSize,
        originalFileCrc: prepared.originalFileCrc
      });
      playbackIndex = 0;
      emitted = 0;
      round = 0;
      qrCache.clear();
      sessionText.textContent = transfer.session;
      frameText.textContent = "0 / " + transfer.total;
      progressBar.style.width = "0%";
      drawFrame(transfer.frames[0]);
      overlay.classList.add("hidden");
      statusText.textContent = prepared.encoding === "gzip" ? "已压缩 " + Math.round(prepared.savedBytes / prepared.originalSize * 100) + "% · 二维码流已生成" : "二维码流已生成";
      playBtn.disabled = false;
      playBtn.textContent = "开始播放";
      resetBtn.disabled = false;
    } catch (error) {
      statusText.textContent = "生成失败：" + error.message;
      prepareBtn.disabled = false;
    }
  });

  playBtn.addEventListener("click", () => timer ? stop() : start());
  resetBtn.addEventListener("click", () => {
    stop();
    file = null;
    transfer = null;
    fileInput.value = "";
    selectFile(null);
    playBtn.disabled = true;
    resetBtn.disabled = true;
    sessionText.textContent = "—";
    frameText.textContent = "—";
    progressBar.style.width = "0%";
    overlay.classList.remove("hidden");
    clearCanvas();
  });

  function start() {
    if (!transfer || timer) return;
    intervalMs = 1000 / Math.max(1, Number(fps.value));
    nextTickAt = performance.now();
    statusText.textContent = "正在循环播放";
    playBtn.textContent = "暂停";
    scheduleTick();
  }

  function scheduleTick() {
    if (!transfer || timer) return;
    const now = performance.now();
    if (nextTickAt < now - intervalMs * 2) nextTickAt = now;
    timer = setTimeout(() => {
      timer = null;
      tick();
      nextTickAt += intervalMs;
      scheduleTick();
    }, Math.max(0, nextTickAt - now));
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (transfer) {
      statusText.textContent = "已暂停";
      playBtn.textContent = "继续播放";
    }
  }

  function tick() {
    const profile = PROFILES[mode.value] || PROFILES.balanced;
    const showHeader = emitted % profile.headerEvery === 0;
    if (showHeader) {
      drawFrame(transfer.frames[0]);
      frameText.textContent = "元数据 / 第 " + (round + 1) + " 轮";
    } else {
      const sequence = transfer.playbackFrames || transfer.frames.slice(1);
      let frame = sequence[playbackIndex];
      const parsed = P.parseFrame(frame);
      if (parsed?.kind === "parity" && typeof P.makeRepairFrame === "function") frame = P.makeRepairFrame(transfer, parsed.groupStart, round + 1);
      drawFrame(frame);
      playbackIndex = (playbackIndex + 1) % sequence.length;
      if (playbackIndex === 0) round += 1;
      if (parsed?.kind === "parity") {
        frameText.textContent = "修复帧 / 第 " + (round + 1) + " 轮";
      } else {
        frameText.textContent = (parsed.index + 1) + " / " + transfer.total + " · 第 " + (round + 1) + " 轮";
        progressBar.style.width = ((parsed.index + 1) / transfer.total) * 100 + "%";
      }
    }
    emitted += 1;
  }

  function getQrPattern(text) {
    const hit = qrCache.get(text);
    if (hit) return hit;
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    const count = qr.getModuleCount();
    const dark = new Uint8Array(count * count);
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        dark[row * count + col] = qr.isDark(row, col) ? 1 : 0;
      }
    }
    const pattern = { count, dark };
    if (qrCache.size >= QR_CACHE_LIMIT) qrCache.delete(qrCache.keys().next().value);
    qrCache.set(text, pattern);
    return pattern;
  }

  function drawFrame(text) {
    try {
      const pattern = getQrPattern(text);
      const quiet = 4;
      const size = canvas.width;
      const cell = Math.floor(size / (pattern.count + quiet * 2));
      const used = cell * (pattern.count + quiet * 2);
      const offset = Math.floor((size - used) / 2);
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#000";
      for (let row = 0; row < pattern.count; row += 1) {
        for (let col = 0; col < pattern.count; col += 1) {
          if (pattern.dark[row * pattern.count + col]) {
            context.fillRect(offset + (col + quiet) * cell, offset + (row + quiet) * cell, cell, cell);
          }
        }
      }
    } catch (error) {
      stop();
      statusText.textContent = "二维码过密，请降低每帧数据";
      console.error(error);
    }
  }

  function drawLinkQr(text) {
    try {
      const pattern = getQrPattern(text);
      const context = receiverQrCanvas.getContext("2d", { alpha: false });
      const quiet = 4;
      const cell = Math.floor(receiverQrCanvas.width / (pattern.count + quiet * 2));
      const used = cell * (pattern.count + quiet * 2);
      const offset = Math.floor((receiverQrCanvas.width - used) / 2);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, receiverQrCanvas.width, receiverQrCanvas.height);
      context.fillStyle = "#000";
      for (let row = 0; row < pattern.count; row += 1) for (let col = 0; col < pattern.count; col += 1) {
        if (pattern.dark[row * pattern.count + col]) context.fillRect(offset + (col + quiet) * cell, offset + (row + quiet) * cell, cell, cell);
      }
    } catch (_) {
      receiverQrCanvas.hidden = true;
    }
  }

  function clearCanvas() {
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  applyProfile();
  receiverUrl.href = RECEIVER_URL;
  receiverUrl.textContent = RECEIVER_URL;
  drawLinkQr(RECEIVER_URL);
  clearCanvas();
})();
