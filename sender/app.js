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
  const hudPlayBtn = el("hudPlayBtn");
  const hudFsBtn = el("hudFsBtn");
  const viewerHud = el("viewerHud");
  const canvas = el("qrCanvas");
  const overlay = el("overlay");
  const compressText = el("compressText");
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
  const QUAD_MAX_FRAME_BYTES = 1465;
  const FPS_CHOICES = {
    single: [
      ["20", "20 FPS"],
      ["24", "24 FPS"],
      ["30", "30 FPS"]
    ],
    quad: [
      ["20", "20 FPS"],
      ["24", "24 FPS"],
      ["30", "30 FPS"],
      ["60", "60 FPS（高刷）"],
      ["90", "90 FPS（高刷）"],
      ["120", "120 FPS（高刷）"]
    ]
  };
  const CHUNK_CHOICES = {
    single: [
      ["1465", "1465 B"],
      ["2331", "2331 B"],
      ["2953", "2953 B"]
    ],
    quad: [
      ["1003", "1003 B"],
      ["1273", "1273 B"],
      ["1465", "1465 B"]
    ]
  };
  const HIGH_QUEUE_LIMIT = 8;
  const QUIET_MODULES = 2;
  const QUAD_QUIET_MODULES = 4;
  const LINK_QUIET_MODULES = 4;
  const COMMON_HZ = [60, 75, 90, 120, 144, 165, 240];
  const QUAD_PAIRS = [[0, 3], [1, 2]];
  let file = null;
  let transfer = null;
  let animationFrame = 0;
  let emitted = 0;
  let lastTickAt = 0;
  let intervalMs = 125;
  const qrCache = new Map();
  const highQueue = [];
  let highNextSeq = 0;
  let highNextPair = 0;
  let codesPerScreen = 1;
  let lastPatterns = null;
  let livePatterns = [null, null, null, null];
  let liveSeqs = [0, 0, 0, 0];
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
    if (compressText) compressText.textContent = "—";
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
      highNextPair = 0;
      livePatterns = [null, null, null, null];
      liveSeqs = [0, 0, 0, 0];
      emitted = 0;
      qrCache.clear();
      if (codesPerScreen === 4) {
        fillHighQueue(2);
        paintQueued(highQueue.shift());
        paintQueued(highQueue.shift());
        fillHighQueue(4);
      } else {
        fillHighQueue(4);
        drawScreen(highQueue[0].patterns);
      }
      sessionText.textContent = transfer.session;
      frameText.textContent = "0 / " + transfer.total;
      progressBar.style.width = "0%";
      overlay.classList.add("hidden");
      renderRateHint();
      const gzip = packed.compression === "gzip";
      const savedPct = gzip ? Math.max(0, Math.round(prepared.savedBytes / prepared.originalSize * 100)) : 0;
      if (compressText) {
        compressText.textContent = gzip
          ? "gzip 已压缩 " + savedPct + "% · 传 " + formatBytes(packed.transmittedSize)
          : "未压缩 · 原文件发送";
      }
      fileLabel.textContent = file.name + " · " + formatBytes(file.size) + (gzip ? " · 已压缩 " + savedPct + "%" : " · 未压缩");
      statusText.textContent = "二维码流已生成，可开始播放";
      playBtn.disabled = false;
      if (hudPlayBtn) hudPlayBtn.disabled = false;
      setPlayLabel("开始播放");
      resetBtn.disabled = false;
      if (fullscreenBtn) fullscreenBtn.disabled = false;
      if (viewerHud) viewerHud.hidden = false;
    } catch (error) {
      statusText.textContent = "生成失败：" + error.message;
      prepareBtn.disabled = false;
    }
  });

  playBtn.addEventListener("click", () => animationFrame ? stop() : start());
  if (hudPlayBtn) hudPlayBtn.addEventListener("click", () => animationFrame ? stop() : start());
  if (hudFsBtn) {
    hudFsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
  }
  document.addEventListener("keydown", event => {
    if (event.code !== "Space" && event.key !== " ") return;
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return;
    if (!transfer || playBtn.disabled) return;
    event.preventDefault();
    if (animationFrame) stop();
    else start();
  });
  resetBtn.addEventListener("click", () => {
    stop();
    file = null;
    transfer = null;
    fileInput.value = "";
    selectFile(null);
    playBtn.disabled = true;
    if (hudPlayBtn) hudPlayBtn.disabled = true;
    resetBtn.disabled = true;
    if (fullscreenBtn) fullscreenBtn.disabled = true;
    if (viewerHud) viewerHud.hidden = true;
    setPlayLabel("开始播放");
    sessionText.textContent = "—";
    frameText.textContent = "—";
    if (compressText) compressText.textContent = "—";
    progressBar.style.width = "0%";
    overlay.classList.remove("hidden");
    lastPatterns = null;
    livePatterns = [null, null, null, null];
    liveSeqs = [0, 0, 0, 0];
    highNextPair = 0;
    document.documentElement.classList.remove("quad-send");
    document.body.classList.remove("quad-send");
    const viewer = canvas.closest(".viewer");
    if (viewer) viewer.classList.remove("quad");
    canvas.style.width = "";
    canvas.style.height = "";
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
      const full = !!(document.fullscreenElement || document.webkitFullscreenElement);
      fullscreenBtn.textContent = full ? "退出全屏" : "全屏";
      if (hudFsBtn) hudFsBtn.textContent = "退出全屏";
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
    statusText.textContent = playbackStatus();
    setPlayLabel("暂停");
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
            statusText.textContent = playbackStatus();
          } else {
            vsyncsPerQr = next;
          }
        }
      }
    }
    lastRafAt = timestamp;
    vsyncPhase += 1;
    if (vsyncPhase >= updateIntervalVsyncs()) {
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
      setPlayLabel("继续播放");
    }
  }

  function setPlayLabel(label) {
    playBtn.textContent = label;
    if (hudPlayBtn) hudPlayBtn.textContent = label;
  }

  function playbackStatus() {
    const playing = codesPerScreen === 4
      ? "正在循环播放 · 四码交错换对角"
      : "正在循环播放";
    if (!measuredRefreshHz) return playing;
    const interval = updateIntervalVsyncs();
    const unit = codesPerScreen === 4 ? "一对" : "一屏";
    return playing + " · 屏 " + measuredRefreshHz + " Hz · 每 " + interval + " vsync 换" + unit;
  }

  function updateIntervalVsyncs() {
    if (codesPerScreen === 4) return Math.max(1, Math.round(vsyncsPerQr / 2));
    return vsyncsPerQr;
  }

  function tick() {
    const next = highQueue.shift();
    if (!next) {
      fillHighQueue(1);
      return;
    }
    paintQueued(next);
    emitted += next.seqs.length;
    frameText.textContent = codesPerScreen === 4
      ? "四码 " + liveSeqs.join(",") + " · K=" + transfer.total
      : "喷泉帧 " + next.seqs.join(",") + " · K=" + transfer.total;
    progressBar.style.width = Math.min(100, emitted / Math.ceil(transfer.total * 1.15) * 100) + "%";
    fillHighQueue(2);
  }

  function paintQueued(item) {
    if (!item) return;
    if (codesPerScreen === 4 && item.indices) {
      for (let index = 0; index < item.indices.length; index += 1) {
        liveSeqs[item.indices[index]] = item.seqs[index];
        livePatterns[item.indices[index]] = item.patterns[index];
      }
      drawScreen(livePatterns);
      return;
    }
    drawScreen(item.patterns);
  }

  function nextFrameSeq() {
    const ordinal = highNextSeq++;
    return ordinal < transfer.total
      ? (0x80000000 | ordinal) >>> 0
      : ordinal - transfer.total;
  }

  function encodeNextCode() {
    const seq = nextFrameSeq();
    const bytes = H.packFrame({ ...transfer.header, seq }, transfer.encoder.encode(seq));
    return { seq, pattern: getHighSpeedQrPattern(bytes, seq) };
  }

  function fillHighQueue(max) {
    if (!transfer) return;
    for (let count = 0; count < max && highQueue.length < HIGH_QUEUE_LIMIT; count += 1) {
      if (codesPerScreen === 4) {
        const pair = highNextPair;
        highNextPair ^= 1;
        const indices = QUAD_PAIRS[pair];
        const seqs = [];
        const patterns = [];
        for (let code = 0; code < indices.length; code += 1) {
          const encoded = encodeNextCode();
          seqs.push(encoded.seq);
          patterns.push(encoded.pattern);
        }
        highQueue.push({ pair, indices, seqs, patterns });
        continue;
      }
      const encoded = encodeNextCode();
      highQueue.push({ seqs: [encoded.seq], patterns: [encoded.pattern] });
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

  function rasterize(pattern, quiet) {
    pattern.tiles = pattern.tiles || {};
    if (pattern.tiles[quiet]) return pattern.tiles[quiet];
    const size = pattern.count + quiet * 2;
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
        const pixel = ((row + quiet) * size + (col + quiet)) * 4;
        data[pixel] = data[pixel + 1] = data[pixel + 2] = 0;
      }
    }
    context.putImageData(image, 0, 0);
    pattern.tiles[quiet] = tile;
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

  function viewerContentSide(viewer) {
    const style = getComputedStyle(viewer);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const width = Math.max(0, viewer.clientWidth - padX);
    const height = Math.max(0, viewer.clientHeight - padY);
    return Math.floor(Math.min(width, height));
  }

  function devicePixelRatioValue() {
    const value = window.devicePixelRatio;
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function cssBudgetSide() {
    const viewer = canvas.closest(".viewer") || canvas.parentElement;
    if (!viewer) return 256;
    return Math.max(1, viewerContentSide(viewer));
  }

  function integerModuleScale(cssBudget, dpr, moduleCount) {
    const budget = Math.max(1, cssBudget);
    const ratio = dpr > 0 ? dpr : 1;
    const count = Math.max(1, moduleCount);
    let scale = Math.max(1, Math.floor((budget * ratio) / count));
    while ((count * (scale + 1) / ratio) <= budget) scale += 1;
    while (scale > 1 && (count * scale / ratio) > budget) scale -= 1;
    return scale;
  }

  function layoutMetrics(patterns) {
    const quad = patterns.length === 4;
    const columns = quad ? 2 : 1;
    const quiet = quad ? QUAD_QUIET_MODULES : QUIET_MODULES;
    const modules = patterns[0].count + quiet * 2;
    const dpr = devicePixelRatioValue();
    const cssBudget = cssBudgetSide();
    const scale = integerModuleScale(cssBudget, dpr, modules * columns);
    const tilePx = modules * scale;
    const canvasPx = tilePx * columns;
    return { quad, columns, quiet, scale, tilePx, canvasPx, cssSide: canvasPx / dpr };
  }

  function syncCanvasSize(patterns) {
    const viewer = canvas.closest(".viewer") || canvas.parentElement;
    if (!viewer) return layoutMetrics(patterns);
    const quad = patterns.length === 4;
    document.documentElement.classList.toggle("quad-send", quad);
    document.body.classList.toggle("quad-send", quad);
    viewer.classList.toggle("quad", quad);
    const metrics = layoutMetrics(patterns);
    canvas.style.maxWidth = "none";
    canvas.style.maxHeight = "none";
    canvas.style.width = metrics.cssSide + "px";
    canvas.style.height = metrics.cssSide + "px";
    if (canvas.width !== metrics.canvasPx || canvas.height !== metrics.canvasPx) {
      canvas.width = metrics.canvasPx;
      canvas.height = metrics.canvasPx;
    }
    return metrics;
  }

  function drawScreen(patterns) {
    try {
      lastPatterns = patterns;
      const metrics = syncCanvasSize(patterns);
      const context = canvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      patterns.forEach((pattern, index) => {
        if (!pattern) return;
        const col = index % metrics.columns;
        const row = Math.floor(index / metrics.columns);
        drawPatternTile(context, pattern, col * metrics.tilePx, row * metrics.tilePx, metrics.quiet, metrics.scale);
      });
    } catch (error) {
      stop();
      statusText.textContent = "二维码过密，请降低每帧数据";
      console.error(error);
    }
  }

  function drawPatternTile(context, pattern, x, y, quiet, scale) {
    const tile = rasterize(pattern, quiet);
    const dest = tile.width * scale;
    if (dest < 1) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(tile, 0, 0, tile.width, tile.height, x, y, dest, dest);
  }

  function drawLinkQr(text) {
    try {
      const pattern = getQrPattern(text);
      const context = receiverQrCanvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = false;
      const quiet = LINK_QUIET_MODULES;
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
    const quiet = codes === 4 ? QUAD_QUIET_MODULES : QUIET_MODULES;
    const columns = codes === 4 ? 2 : 1;
    const modules = qrModules(bytes) + quiet * 2;
    const dpr = devicePixelRatioValue();
    const cssBudget = cssBudgetSide();
    const scale = integerModuleScale(cssBudget, dpr, modules * columns);
    return {
      codes,
      bytes,
      fps: frameRate,
      screen: bytes * codes * frameRate,
      payload: Math.max(0, bytes - header) * codes * frameRate,
      cell: scale / dpr,
      scale
    };
  }

  function renderRateHint() {
    if (!rateHint) return;
    const rate = currentLayout();
    let text = "理论速度：" + formatRate(rate.screen) + "（" + rate.bytes + " B × " + rate.codes + " 码 × " + rate.fps + " FPS）· 载荷约 " + formatRate(rate.payload);
    if (rate.scale) text += " · 每模块 " + rate.scale + " 设备像素（整数）";
    if (rate.codes === 4) text += "。四码交错换对角，每次只换两个";
    if (rate.codes === 4 && rate.cell && rate.cell < 3) text += "。模块偏小，请全屏后再播";
    if (rate.codes === 4 && rate.fps >= 60 && (measuredRefreshHz || 60) < 90) text += "。60 Hz 屏上四码 60 FPS 容易拖影，改用 30 FPS 通常更快";
    if (rate.codes === 1 && rate.fps > 30) text += "。单码超过 30 FPS 时相机会拍到换码拖影，通常更慢";
    if (rate.fps > 60) text += "。分析流约 60 FPS，更高发送帧率不会增加唯一码";
    rateHint.textContent = text;
  }

  function layoutName() {
    return qrMode.value === "quad" ? "quad" : "single";
  }

  function fillSelect(select, choices) {
    select.replaceChildren();
    for (const [value, label] of choices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
  }

  function fillChunkChoices(layout) {
    fillSelect(chunkSize, CHUNK_CHOICES[layout] || CHUNK_CHOICES.single);
  }

  function fillFpsChoices(layout) {
    fillSelect(fps, FPS_CHOICES[layout] || FPS_CHOICES.single);
  }

  function fastestChunk(layout) {
    const choices = CHUNK_CHOICES[layout] || CHUNK_CHOICES.single;
    return choices[choices.length - 1][0];
  }

  function fastestFps(layout) {
    const hz = measuredRefreshHz || 60;
    const allowed = (FPS_CHOICES[layout] || FPS_CHOICES.single).map((item) => Number(item[0]));
    let cap = Math.max(20, Math.floor(hz / 2));
    if (layout === "single") cap = Math.min(cap, 30);
    if (layout === "quad" && hz < 90) cap = Math.min(cap, 30);
    const picked = [...allowed].reverse().find((value) => value <= cap);
    return String(picked || 30);
  }

  function applyFastestLayout() {
    const layout = layoutName();
    fillChunkChoices(layout);
    fillFpsChoices(layout);
    chunkSize.value = fastestChunk(layout);
    fps.value = fastestFps(layout);
    renderRateHint();
  }

  function probeRefreshHz() {
    const samples = [];
    let last = 0;
    function step(timestamp) {
      if (last) {
        const dt = timestamp - last;
        if (dt > 3 && dt < 22) samples.push(dt);
      }
      last = timestamp;
      if (samples.length >= 8) {
        const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        const hz = snapRefreshHz(1000 / avg);
        if (hz !== measuredRefreshHz) {
          measuredRefreshHz = hz;
          applyFastestLayout();
        }
        return;
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  chunkSize.addEventListener("change", renderRateHint);
  fps.addEventListener("change", renderRateHint);
  qrMode.addEventListener("change", applyFastestLayout);
  function relayoutQr() {
    if (lastPatterns) drawScreen(lastPatterns);
    renderRateHint();
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(relayoutQr).observe(canvas.closest(".viewer") || canvas.parentElement || canvas);
  }
  window.addEventListener("resize", relayoutQr);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", relayoutQr);
  receiverUrl.href = RECEIVER_URL;
  receiverUrl.textContent = RECEIVER_URL;
  if (openReceiver) openReceiver.href = RECEIVER_URL;
  drawLinkQr(RECEIVER_URL);
  clearCanvas();
  applyFastestLayout();
  probeRefreshHz();
})();
