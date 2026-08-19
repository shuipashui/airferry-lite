(() => {
  const H = window.AirFerryHighSpeed;
  const el = id => document.getElementById(id);
  const fileInput = el("fileInput");
  const dropZone = el("dropZone");
  const fileLabel = el("fileLabel");
  const chunkSize = el("chunkSize");
  const fps = el("fps");
  const qrMode = el("qrMode");
  const prepareBtn = el("prepareBtn");
  const playBtn = el("playBtn");
  const resetBtn = el("resetBtn");
  const fullscreenBtn = el("fullscreenBtn");
  const canvas = el("qrCanvas");
  const overlay = el("overlay");
  const statusText = el("statusText");
  const sessionText = el("sessionText");
  const frameText = el("frameText");
  const progressBar = el("progressBar");
  const receiverUrl = el("receiverUrl");
  const openReceiver = el("openReceiver");
  const receiverQrCanvas = el("receiverQrCanvas");
  const rateHint = el("rateHint");
  const HEADER_LEN = 20;
  const RECEIVER_URL = "https://shuipashui.github.io/airferry-lite/";
  const QR_CACHE_LIMIT = 64;
  const QUAD_MAX_FRAME_BYTES = 1273;
  const HIGH_QUEUE_LIMIT = 8;
  const QUIET_MODULES = 4;
  const COMMON_HZ = [60, 75, 90, 120, 144, 165, 240];
  let file = null;
  let transfer = null;
  let animationFrame = 0;
  let emitted = 0;
  let lastTickAt = 0;
  let intervalMs = 125;
  const qrCache = new Map();
  const highQueue = [];
  let highNextSeq = 0;
  let codesPerScreen = 1;
  let lastPatterns = null;
  let vsyncPhase = 0;
  let vsyncsPerQr = 2;
  let lastRafAt = 0;
  let measuredRefreshHz = 0;
  const rafSamples = [];

  function selectFile(next) {
    file = next || null;
    fileLabel.textContent = file ? file.name + " · " + formatBytes(file.size) : "选择或拖入一个文件";
    prepareBtn.disabled = !file;
    resetBtn.disabled = !file;
    statusText.textContent = file ? "文件已选择" : "等待文件";
  }

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
      if (!H) throw new Error("高速协议未加载");
      const packed = await H.packFile(file.name, file.type || "application/octet-stream", sourceBytes);
      codesPerScreen = qrMode.value === "quad" ? 4 : 1;
      const frameBytes = Number(chunkSize.value);
      const effectiveFrameBytes = codesPerScreen === 4 ? Math.min(frameBytes, QUAD_MAX_FRAME_BYTES) : frameBytes;
      const blockLen = effectiveFrameBytes - H.HEADER_LEN;
      const sessionId = (Math.floor(Math.random() * 0xffff) + 1) & 0xffff;
      const encoder = new H.LTEncoder(packed.container, blockLen, sessionId);
      transfer = {
        encoder,
        header: {
          sessionId,
          seq: 0,
          k: encoder.k,
          blockLen,
          totalLen: packed.container.length,
          payloadFnv: H.fnv1a(packed.container),
          layoutCodes: codesPerScreen === 4 ? 4 : 1,
          systematic: true
        },
        session: sessionId.toString(16).padStart(4, "0"),
        total: encoder.k,
        compression: packed.compression,
        transmittedSize: packed.transmittedSize
      };
      const prepared = { encoding: packed.compression, originalSize: sourceBytes.length, savedBytes: sourceBytes.length - packed.transmittedSize };
      highQueue.length = 0;
      highNextSeq = 0;
      emitted = 0;
      qrCache.clear();
      fillHighQueue(4);
      sessionText.textContent = transfer.session;
      frameText.textContent = "0 / " + transfer.total;
      progressBar.style.width = "0%";
      drawScreen(highQueue[0].patterns);
      overlay.classList.add("hidden");
      renderRateHint();
      const rate = currentLayout();
      statusText.textContent = "高速流已生成 · " + (codesPerScreen === 4 ? "四码，每码 " + effectiveFrameBytes + " B " : "单码 ") + (prepared.encoding === "gzip" ? "已压缩 " + Math.max(0, Math.round(prepared.savedBytes / prepared.originalSize * 100)) + "% · " : "未压缩 · ") + "理论 " + formatRate(rate.screen);
      playBtn.disabled = false;
      playBtn.textContent = "开始播放";
      resetBtn.disabled = false;
      if (fullscreenBtn) fullscreenBtn.disabled = false;
    } catch (error) {
      statusText.textContent = "生成失败：" + error.message;
      prepareBtn.disabled = false;
    }
  });

  playBtn.addEventListener("click", () => animationFrame ? stop() : start());
  resetBtn.addEventListener("click", () => {
    stop();
    file = null;
    transfer = null;
    fileInput.value = "";
    selectFile(null);
    playBtn.disabled = true;
    resetBtn.disabled = true;
    if (fullscreenBtn) fullscreenBtn.disabled = true;
    sessionText.textContent = "—";
    frameText.textContent = "—";
    progressBar.style.width = "0%";
    overlay.classList.remove("hidden");
    lastPatterns = null;
    clearCanvas();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      const viewer = canvas.closest(".viewer");
      if (!viewer) return;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else viewer.requestFullscreen().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      fullscreenBtn.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
      if (lastPatterns) drawScreen(lastPatterns);
    });
  }

  function start() {
    if (!transfer || animationFrame) return;
    intervalMs = 1000 / Math.max(1, Number(fps.value));
    lastTickAt = 0;
    lastRafAt = 0;
    vsyncPhase = 0;
    rafSamples.length = 0;
    measuredRefreshHz = 0;
    vsyncsPerQr = vsyncsForFps(60, Number(fps.value));
    statusText.textContent = codesPerScreen === 4
      ? "正在循环播放 · 四码请全屏"
      : "正在循环播放";
    playBtn.textContent = "暂停";
    animationFrame = requestAnimationFrame(playLoop);
  }

  function playLoop(timestamp) {
    if (!transfer || !animationFrame) return;
    if (lastRafAt) {
      const dt = timestamp - lastRafAt;
      // 240 Hz vsync is ~4.2 ms; the old dt > 8 gate treated those panels as 60 Hz.
      if (dt > 3 && dt < 22) {
        rafSamples.push(dt);
        if (rafSamples.length > 24) rafSamples.shift();
        if (rafSamples.length >= 8) {
          const avg = rafSamples.reduce((sum, value) => sum + value, 0) / rafSamples.length;
          const hz = snapRefreshHz(1000 / avg);
          const next = vsyncsForFps(hz, Number(fps.value));
          if (hz !== measuredRefreshHz || next !== vsyncsPerQr) {
            measuredRefreshHz = hz;
            vsyncsPerQr = next;
            statusText.textContent = (codesPerScreen === 4 ? "正在循环播放 · 四码请全屏" : "正在循环播放")
              + " · 屏 " + hz + " Hz · 每 " + next + " vsync 换一屏";
          } else {
            vsyncsPerQr = next;
          }
        }
      }
    }
    lastRafAt = timestamp;
    vsyncPhase += 1;
    if (vsyncPhase >= vsyncsPerQr) {
      vsyncPhase = 0;
      tick();
    }
    animationFrame = requestAnimationFrame(playLoop);
  }

  function stop() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (transfer) {
      statusText.textContent = "已暂停";
      playBtn.textContent = "继续播放";
    }
  }

  function tick() {
    const next = highQueue.shift();
    if (!next) {
      fillHighQueue(1);
      return;
    }
    drawScreen(next.patterns);
    emitted += 1;
    frameText.textContent = (codesPerScreen === 4 ? "四码帧 " : "喷泉帧 ") + next.seqs.join(",") + " · K=" + transfer.total;
    progressBar.style.width = Math.min(100, emitted / Math.ceil(transfer.total * 1.15) * 100) + "%";
    fillHighQueue(2);
  }

  function fillHighQueue(max) {
    if (!transfer) return;
    for (let count = 0; count < max && highQueue.length < HIGH_QUEUE_LIMIT; count += 1) {
      const seqs = [];
      const patterns = [];
      for (let code = 0; code < codesPerScreen; code += 1) {
        const ordinal = highNextSeq++;
        const seq = ordinal < transfer.total
          ? (0x80000000 | ordinal) >>> 0
          : ordinal - transfer.total;
        const bytes = H.packFrame({ ...transfer.header, seq }, transfer.encoder.encode(seq));
        seqs.push(seq);
        patterns.push(getHighSpeedQrPattern(bytes, seq));
      }
      highQueue.push({ seqs, patterns });
    }
  }

  function getHighSpeedQrPattern(bytes, seq) {
    const key = "h:" + seq;
    const hit = qrCache.get(key);
    if (hit) return hit;
    const frameBytes = bytes.length;
    const qr = qrcode(frameBytes === 2953 ? 40 : 0, "L");
    qr.addBytes(bytes);
    qr.make(4);
    const pattern = extractPattern(qr);
    if (qrCache.size >= QR_CACHE_LIMIT) qrCache.delete(qrCache.keys().next().value);
    qrCache.set(key, pattern);
    return pattern;
  }

  function getQrPattern(text) {
    const hit = qrCache.get(text);
    if (hit) return hit;
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    const pattern = extractPattern(qr);
    if (qrCache.size >= QR_CACHE_LIMIT) qrCache.delete(qrCache.keys().next().value);
    qrCache.set(text, pattern);
    return pattern;
  }

  function extractPattern(qr) {
    const count = qr.getModuleCount();
    const dark = new Uint8Array(count * count);
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        dark[row * count + col] = qr.isDark(row, col) ? 1 : 0;
      }
    }
    return { count, dark };
  }

  function rasterize(pattern) {
    if (pattern.tile) return pattern.tile;
    const size = pattern.count + QUIET_MODULES * 2;
    const tile = document.createElement("canvas");
    tile.width = size;
    tile.height = size;
    const context = tile.getContext("2d", { alpha: false });
    const image = context.createImageData(size, size);
    const data = image.data;
    data.fill(255);
    for (let row = 0; row < pattern.count; row += 1) {
      for (let col = 0; col < pattern.count; col += 1) {
        if (!pattern.dark[row * pattern.count + col]) continue;
        const pixel = ((row + QUIET_MODULES) * size + (col + QUIET_MODULES)) * 4;
        data[pixel] = data[pixel + 1] = data[pixel + 2] = 0;
      }
    }
    context.putImageData(image, 0, 0);
    pattern.tile = tile;
    return tile;
  }

  function drawFrame(text) {
    try {
      drawPattern(getQrPattern(text));
    } catch (error) {
      stop();
      statusText.textContent = "二维码过密，请降低每帧数据";
      console.error(error);
    }
  }

  function drawPattern(pattern) {
    drawScreen([pattern]);
  }

  function syncCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    const side = Math.max(256, Math.floor(Math.min(rect.width, rect.height)));
    if (canvas.width !== side || canvas.height !== side) {
      canvas.width = side;
      canvas.height = side;
    }
  }

  function drawScreen(patterns) {
    try {
      lastPatterns = patterns;
      syncCanvasSize();
      const size = canvas.width;
      const context = canvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, size, size);
      const columns = patterns.length === 4 ? 2 : 1;
      const rows = patterns.length === 4 ? 2 : 1;
      const tileWidth = size / columns;
      const tileHeight = size / rows;
      patterns.forEach((pattern, index) => drawPatternTile(context, pattern, index % columns * tileWidth, Math.floor(index / columns) * tileHeight, tileWidth, tileHeight));
    } catch (error) {
      stop();
      statusText.textContent = "二维码过密，请降低每帧数据";
      console.error(error);
    }
  }

  function drawPatternTile(context, pattern, x, y, width, height) {
    const tile = rasterize(pattern);
    const cell = Math.floor(Math.min(width, height) / tile.width);
    if (cell < 1) return;
    const used = cell * tile.width;
    const offsetX = Math.floor(x + (width - used) / 2);
    const offsetY = Math.floor(y + (height - used) / 2);
    context.imageSmoothingEnabled = false;
    context.drawImage(tile, 0, 0, tile.width, tile.height, offsetX, offsetY, used, used);
  }

  function drawLinkQr(text) {
    try {
      const pattern = getQrPattern(text);
      const context = receiverQrCanvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = false;
      const quiet = QUIET_MODULES;
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

  function formatRate(n) {
    return formatBytes(n) + "/s";
  }

  function snapRefreshHz(hz) {
    return COMMON_HZ.reduce((best, value) => Math.abs(value - hz) < Math.abs(best - hz) ? value : best, 60);
  }

  function vsyncsForFps(hz, frameRate) {
    const fps = Math.max(1, frameRate);
    const rounded = Math.max(1, Math.round(hz / fps));
    if (hz / rounded > fps * 1.12) return rounded + 1;
    return rounded;
  }

  function qrModules(bytes) {
    if (bytes <= 1003) return 105;
    if (bytes <= 1091) return 109;
    if (bytes <= 1171) return 113;
    if (bytes <= 1273) return 117;
    if (bytes <= 1367) return 121;
    if (bytes <= 1465) return 125;
    if (bytes <= 1952) return 145;
    if (bytes <= 2188) return 153;
    if (bytes <= 2303) return 157;
    if (bytes <= 2431) return 161;
    return 177;
  }

  function currentLayout() {
    const codes = qrMode.value === "quad" ? 4 : 1;
    const frameBytes = Number(chunkSize.value);
    const bytes = codes === 4 ? Math.min(frameBytes, QUAD_MAX_FRAME_BYTES) : frameBytes;
    const frameRate = Number(fps.value);
    const header = H?.HEADER_LEN || HEADER_LEN;
    const cell = Math.floor((canvas.width / (codes === 4 ? 2 : 1)) / (qrModules(bytes) + QUIET_MODULES * 2));
    return {
      codes,
      bytes,
      fps: frameRate,
      screen: bytes * codes * frameRate,
      payload: Math.max(0, bytes - header) * codes * frameRate,
      cell
    };
  }

  function renderRateHint() {
    if (!rateHint) return;
    const rate = currentLayout();
    let text = "理论速度：" + formatRate(rate.screen) + "（" + rate.bytes + " B × " + rate.codes + " 码 × " + rate.fps + " FPS）· 载荷约 " + formatRate(rate.payload);
    if (rate.cell) text += " · 屏上约 " + rate.cell + " px/模块";
    if (rate.codes === 4 && rate.cell && rate.cell < 4) text += "。模块偏小，请全屏后再播";
    if (rate.codes === 4 && rate.fps >= 60) text += "。60 Hz 屏上四码 60 FPS 容易拖影，改用 30 FPS 通常更快";
    if (rate.codes === 1 && rate.fps > 30) text += "。单码超过 30 FPS 时相机会拍到换码拖影，通常更慢";
    if (rate.fps > 60) text += "。分析流约 60 FPS，更高发送帧率不会增加唯一码";
    if (rate.codes === 4 && rate.bytes === QUAD_MAX_FRAME_BYTES && Number(chunkSize.value) > QUAD_MAX_FRAME_BYTES) {
      text += "。四码已限制为每码 " + QUAD_MAX_FRAME_BYTES + " B";
    }
    if (rate.fps === 45) text += "。60 Hz 屏上 45 FPS 会对齐成 30 FPS 播放";
    rateHint.textContent = text;
  }

  function syncFpsToLayout() {
    if (qrMode.value !== "quad" && Number(fps.value) > 30) fps.value = "30";
    renderRateHint();
  }

  chunkSize.addEventListener("change", renderRateHint);
  fps.addEventListener("change", () => {
    if (qrMode.value !== "quad" && Number(fps.value) > 30) fps.value = "30";
    renderRateHint();
  });
  qrMode.addEventListener("change", syncFpsToLayout);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => { if (lastPatterns) drawScreen(lastPatterns); }).observe(canvas.parentElement || canvas);
  }
  receiverUrl.href = RECEIVER_URL;
  receiverUrl.textContent = RECEIVER_URL;
  if (openReceiver) openReceiver.href = RECEIVER_URL;
  drawLinkQr(RECEIVER_URL);
  clearCanvas();
  renderRateHint();
})();
