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
  const statusText = el("statusText");
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
  const QR_CACHE_LIMIT = 256;
  const QR_WORKER_COUNT = 4;
  const QUAD_MAX_FRAME_BYTES = 1465;
  const DUAL_FRAME_BYTES = 2068;
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
    ],
    dual: [
      ["20", "20 FPS"],
      ["24", "24 FPS"],
      ["30", "30 FPS"],
      ["60", "60 FPS"]
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
    ],
    dual: [
      ["1003", "1003 B"],
      ["1273", "1273 B"],
      ["1465", "1465 B"],
      ["1732", "1732 B"],
      ["1952", "1952 B"],
      ["2068", "2068 B"]
    ]
  };
  const HIGH_QUEUE_LIMIT = 8;
  const QUIET_MODULES = 2;
  const QUAD_QUIET_MODULES = 4;
  const LINK_QUIET_MODULES = 4;
  const COMMON_HZ = [60, 75, 90, 120, 144, 165, 240];
  const QUAD_PAIRS = [[0, 3], [1, 2]];
  const DUAL_SLOTS = [0, 1];
  let files = [];
  let transfer = null;
  let animationFrame = 0;
  let emitted = 0;
  let lastTickAt = 0;
  let intervalMs = 125;
  const qrCache = new Map();
  const highQueue = [];
  const encodeReady = new Map();
  const queueWaiters = [];
  const qrWorkerJobs = new Map();
  const qrWorkerWait = [];
  const qrWorkerAssigned = new Map();
  const qrWorkers = [];
  const qrWorkerIdle = [];
  let qrWorkerNextId = 1;
  let encodeGeneration = 0;
  let encodeSerial = 0;
  let queueSerial = 0;
  let encodeInflight = 0;
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

  function codesForMode(mode) {
    if (mode === "quad") return 4;
    if (mode === "dual") return 2;
    return 1;
  }

  function layoutShape(codes) {
    if (codes === 4) return { columns: 2, rows: 2, quiet: QUAD_QUIET_MODULES };
    if (codes === 4 || codes === 2) return { columns: 2, rows: 2, quiet: QUAD_QUIET_MODULES };
    return { columns: 1, rows: 1, quiet: QUIET_MODULES };
  }

  function capFrameBytes(codes, frameBytes) {
    if (codes === 4) return Math.min(frameBytes, QUAD_MAX_FRAME_BYTES);
    if (codes === 2) return Math.min(frameBytes, DUAL_FRAME_BYTES);
    return frameBytes;
  }

  function zipEntryName(file, used) {
    const base = String(file && file.name || "file.bin").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim() || "file.bin";
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const dot = base.lastIndexOf(".");
      name = dot > 0 ? base.slice(0, dot) + " (" + n + ")" + base.slice(dot) : base + " (" + n + ")";
      n += 1;
    }
    used.add(name.toLowerCase());
    return name;
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let crc = i;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      table[i] = crc >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concatBytes(chunks) {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }

  function zipStore(entries) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = entry.bytes;
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      local[0] = 0x50; local[1] = 0x4b; local[2] = 3; local[3] = 4;
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      central[0] = 0x50; central[1] = 0x4b; central[2] = 1; central[3] = 2;
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    }
    const centralDir = concatBytes(centrals);
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 5; eocd[3] = 6;
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralDir.length, true);
    eocdView.setUint32(16, offset, true);
    return concatBytes(locals.concat([centralDir, eocd]));
  }

  async function packSelectedFiles(selected) {
    const limit = H && H.MAX_FILE_BYTES || 67108864;
    const total = selected.reduce((sum, item) => sum + item.size, 0);
    if (!selected.length) throw new Error("请先选择文件");
    if (total > limit) throw new Error("合计超过 64 MB");
    if (selected.length === 1) {
      const item = selected[0];
      return {
        name: item.name,
        type: item.type || "application/octet-stream",
        bytes: new Uint8Array(await item.arrayBuffer()),
        label: item.name + " · " + formatBytes(item.size)
      };
    }
    const used = new Set();
    const entries = [];
    for (const item of selected) {
      entries.push({
        name: zipEntryName(item, used),
        bytes: new Uint8Array(await item.arrayBuffer())
      });
    }
    const bytes = zipStore(entries);
    return {
      name: selected.length + "个文件.zip",
      type: "application/zip",
      bytes,
      label: selected.length + " 个文件 · " + formatBytes(total)
    };
  }

  function selectFiles(list) {
    files = list && list.length ? Array.from(list).filter(item => item && item.size > 0) : [];
    const total = files.reduce((sum, item) => sum + item.size, 0);
    if (!files.length) {
      fileLabel.textContent = "选择或拖入一个或多个文件";
      prepareBtn.disabled = true;
      resetBtn.disabled = true;
      statusText.textContent = "等待文件";
    } else if (files.length === 1) {
      fileLabel.textContent = files[0].name + " · " + formatBytes(files[0].size);
      prepareBtn.disabled = false;
      resetBtn.disabled = false;
      statusText.textContent = "文件已选择";
    } else {
      fileLabel.textContent = files.length + " 个文件 · " + formatBytes(total) + "\n" + files.map(item => item.name).join("\n");
      prepareBtn.disabled = false;
      resetBtn.disabled = false;
      statusText.textContent = files.length + " 个文件已选择";
    }
    if (compressText) compressText.textContent = "—";
  }

  fileInput.addEventListener("change", () => selectFiles(fileInput.files));
  ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove("drag");
  }));
  dropZone.addEventListener("drop", event => {
    if (event.dataTransfer.files.length) selectFiles(event.dataTransfer.files);
  });

  prepareBtn.addEventListener("click", async () => {
    if (!files.length) return;
    stop();
    statusText.textContent = "正在读取文件";
    prepareBtn.disabled = true;
    try {
      const payload = await packSelectedFiles(files);
      if (!H) throw new Error("高速协议未加载");
      const packed = await H.packFile(payload.name, payload.type, payload.bytes);
      codesPerScreen = codesForMode(qrMode.value);
      const frameBytes = Number(chunkSize.value);
      const effectiveFrameBytes = capFrameBytes(codesPerScreen, frameBytes);
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
          layoutCodes: codesPerScreen === 1 ? 1 : codesPerScreen === 2 ? 2 : 4,
          systematic: true
        },
        session: sessionId.toString(16).padStart(4, "0"),
        total: encoder.k,
        compression: packed.compression,
        transmittedSize: packed.transmittedSize
      };
      const prepared = { encoding: packed.compression, originalSize: payload.bytes.length, savedBytes: payload.bytes.length - packed.transmittedSize };
      resetEncodePipeline();
      highNextSeq = 0;
      highNextPair = 0;
      livePatterns = [null, null, null, null];
      liveSeqs = [0, 0, 0, 0];
      emitted = 0;
      qrCache.clear();
      statusText.textContent = "正在生成二维码流";
      startQrWorkers();
      pumpEncode();
      if (quadRefreshesAll()) {
        await waitForQueueDepth(1);
        paintQueued(highQueue.shift());
        pumpEncode();
        await waitForQueueDepth(4);
      } else if (codesPerScreen === 4 || dualStaggers()) {
        await waitForQueueDepth(2);
        paintQueued(highQueue.shift());
        paintQueued(highQueue.shift());
        pumpEncode();
        await waitForQueueDepth(4);
      } else if (codesPerScreen === 2) {
        await waitForQueueDepth(1);
        paintQueued(highQueue.shift());
        pumpEncode();
        await waitForQueueDepth(4);
      } else {
        await waitForQueueDepth(4);
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
      fileLabel.textContent = payload.label + (gzip ? " · 已压缩 " + savedPct + "%" : " · 未压缩");
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
    files = [];
    transfer = null;
    fileInput.value = "";
    selectFiles([]);
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
      ? (quadRefreshesAll() ? "正在循环播放 · 四码整屏同换" : "正在循环播放 · 四码交错换对角")
      : codesPerScreen === 2
        ? (dualUpdatesBoth() ? "正在循环播放 · 双码上排同时更新" : "正在循环播放 · 双码上排交替更新")
        : "正在循环播放";
    if (!measuredRefreshHz) return playing;
    const interval = updateIntervalVsyncs();
    const unit = codesPerScreen === 4
      ? (quadRefreshesAll() ? "一屏" : "一对")
      : codesPerScreen === 2 ? (dualUpdatesBoth() ? "一屏" : "一格") : "一屏";
    return playing + " · 屏 " + measuredRefreshHz + " Hz · 每 " + interval + " vsync 换" + unit;
  }

  function dualUpdatesBoth() {
    return codesPerScreen === 2 && Number(fps.value) >= 60;
  }

  function dualStaggers() {
    return codesPerScreen === 2 && Number(fps.value) < 60;
  }

  function quadRefreshesAll() {
    return codesPerScreen === 4 && Number(fps.value) < 60;
  }

  function updateIntervalVsyncs() {
    if (quadRefreshesAll()) return vsyncsPerQr;
    if (codesPerScreen === 4 || dualStaggers()) return Math.max(1, Math.round(vsyncsPerQr / 2));
    return vsyncsPerQr;
  }

  function tick() {
    const next = highQueue.shift();
    pumpEncode();
    if (!next) return;
    paintQueued(next);
    emitted += next.seqs.length;
    frameText.textContent = codesPerScreen === 4
      ? "四码 " + liveSeqs.join(",") + " · K=" + transfer.total
      : codesPerScreen === 2
        ? "双码 " + DUAL_SLOTS.map((slot) => liveSeqs[slot]).join(",") + " · K=" + transfer.total
        : "喷泉帧 " + next.seqs.join(",") + " · K=" + transfer.total;
    progressBar.style.width = Math.min(100, emitted / Math.ceil(transfer.total * 1.15) * 100) + "%";
  }

  function paintQueued(item) {
    if (!item) return;
    if ((codesPerScreen === 4 || codesPerScreen === 2) && item.indices) {
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

  function takePackedCode() {
    const seq = nextFrameSeq();
    const bytes = H.packFrame({ ...transfer.header, seq }, transfer.encoder.encode(seq));
    return { seq, bytes };
  }

  function nextScreenJob() {
    if (codesPerScreen === 4) {
      if (quadRefreshesAll()) {
        const indices = [0, 1, 2, 3];
        const packed = indices.map(() => takePackedCode());
        return { indices, seqs: packed.map((item) => item.seq), packed };
      }
      const pair = highNextPair;
      highNextPair ^= 1;
      const indices = QUAD_PAIRS[pair];
      const packed = indices.map(() => takePackedCode());
      return { pair, indices, seqs: packed.map((item) => item.seq), packed };
    }
    if (codesPerScreen === 2) {
      if (dualUpdatesBoth()) {
        const packed = DUAL_SLOTS.map(() => takePackedCode());
        return { indices: DUAL_SLOTS, seqs: packed.map((item) => item.seq), packed };
      }
      const slot = DUAL_SLOTS[highNextPair & 1];
      highNextPair ^= 1;
      const packed = [takePackedCode()];
      return { indices: [slot], seqs: packed.map((item) => item.seq), packed };
    }
    const packed = [takePackedCode()];
    return { seqs: packed.map((item) => item.seq), packed };
  }

  function resetEncodePipeline() {
    encodeGeneration += 1;
    encodeSerial = 0;
    queueSerial = 0;
    encodeInflight = 0;
    encodeReady.clear();
    highQueue.length = 0;
    queueWaiters.length = 0;
  }

  function flushQueueWaiters() {
    for (let index = queueWaiters.length - 1; index >= 0; index -= 1) {
      if (highQueue.length >= queueWaiters[index].count) {
        queueWaiters[index].resolve();
        queueWaiters.splice(index, 1);
      }
    }
  }

  function waitForQueueDepth(count) {
    if (highQueue.length >= count) return Promise.resolve();
    pumpEncode();
    return new Promise((resolve, reject) => {
      const waiter = {
        count,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        const at = queueWaiters.indexOf(waiter);
        if (at >= 0) queueWaiters.splice(at, 1);
        reject(new Error("生成超时。请用 Chrome 打开 sender/dist/airferry-lite-sender.html，不要用 Internet Explorer"));
      }, 20000);
      queueWaiters.push(waiter);
    });
  }

  function pumpEncode() {
    if (!transfer) return;
    while (highQueue.length + encodeInflight < HIGH_QUEUE_LIMIT) {
      const job = nextScreenJob();
      const generation = encodeGeneration;
      const serial = encodeSerial;
      encodeSerial += 1;
      encodeInflight += 1;
      Promise.all(job.packed.map((item) => encodeQrPattern(item.bytes, item.seq).catch(() => getHighSpeedQrPattern(item.bytes, item.seq)))).then((patterns) => {
        encodeInflight -= 1;
        if (generation !== encodeGeneration) {
          pumpEncode();
          return;
        }
        encodeReady.set(serial, {
          pair: job.pair,
          indices: job.indices,
          seqs: job.seqs,
          patterns
        });
        while (encodeReady.has(queueSerial)) {
          highQueue.push(encodeReady.get(queueSerial));
          encodeReady.delete(queueSerial);
          queueSerial += 1;
        }
        flushQueueWaiters();
        pumpEncode();
      });
    }
  }

  function qrEncodeWorkerMain() {
    self.onmessage = function (event) {
      const job = event.data;
      const qr = qrcode(job.version, "L");
      qr.addBytes(new Uint8Array(job.bytes));
      qr.make(4);
      const count = qr.getModuleCount();
      const dark = new Uint8Array(count * count);
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          dark[row * count + col] = qr.isDark(row, col) ? 1 : 0;
        }
      }
      self.postMessage({ id: job.id, seq: job.seq, count, dark }, [dark.buffer]);
    };
  }

  function qrcodeLibrarySource() {
    const scripts = document.scripts || [];
    for (let index = 0; index < scripts.length; index += 1) {
      const text = scripts[index].textContent || "";
      if (text.indexOf("QRErrorCorrectLevel") >= 0 && text.indexOf("addBytes") >= 0) return text;
    }
    return "";
  }

  function startQrWorkers() {
    if (qrWorkers.length || typeof Worker !== "function" || typeof Blob !== "function") return;
    const lib = qrcodeLibrarySource();
    if (!lib) return;
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([lib + "\n(" + qrEncodeWorkerMain.toString() + ")();"], { type: "text/javascript" }));
      for (let index = 0; index < QR_WORKER_COUNT; index += 1) {
        const worker = new Worker(url);
        worker.onmessage = (event) => completeQrWorker(worker, event.data);
        worker.onerror = () => failQrWorker(worker);
        qrWorkers.push(worker);
        qrWorkerIdle.push(worker);
      }
    } catch (error) {
      qrWorkers.length = 0;
      qrWorkerIdle.length = 0;
      if (url) URL.revokeObjectURL(url);
    }
  }

  function recycleQrWorker(worker) {
    qrWorkerAssigned.delete(worker);
    if (qrWorkerIdle.indexOf(worker) < 0) qrWorkerIdle.push(worker);
    dispatchQrWorker();
  }

  function failQrWorker(worker) {
    const jobId = qrWorkerAssigned.get(worker);
    qrWorkerAssigned.delete(worker);
    const idleAt = qrWorkerIdle.indexOf(worker);
    if (idleAt >= 0) qrWorkerIdle.splice(idleAt, 1);
    const liveAt = qrWorkers.indexOf(worker);
    if (liveAt >= 0) qrWorkers.splice(liveAt, 1);
    try { worker.terminate(); } catch (error) {}
    const job = jobId != null ? qrWorkerJobs.get(jobId) : null;
    if (job) {
      qrWorkerJobs.delete(jobId);
      job.resolve(getHighSpeedQrPattern(job.bytes, job.seq));
    }
    if (!qrWorkers.length) {
      while (qrWorkerWait.length) {
        const pending = qrWorkerWait.shift();
        pending.resolve(getHighSpeedQrPattern(pending.bytes, pending.seq));
      }
      return;
    }
    dispatchQrWorker();
  }

  function completeQrWorker(worker, data) {
    recycleQrWorker(worker);
    const job = qrWorkerJobs.get(data.id);
    if (!job) return;
    qrWorkerJobs.delete(data.id);
    const pattern = { count: data.count, dark: data.dark };
    rememberQrPattern(job.key, pattern);
    job.resolve(pattern);
  }

  function dispatchQrWorker() {
    while (qrWorkerIdle.length && qrWorkerWait.length) {
      const worker = qrWorkerIdle.shift();
      const job = qrWorkerWait.shift();
      qrWorkerJobs.set(job.id, job);
      qrWorkerAssigned.set(worker, job.id);
      const copy = job.bytes.slice();
      try {
        worker.postMessage({ id: job.id, seq: job.seq, version: job.version, bytes: copy.buffer }, [copy.buffer]);
      } catch (error) {
        qrWorkerJobs.delete(job.id);
        qrWorkerAssigned.delete(worker);
        recycleQrWorker(worker);
        job.resolve(getHighSpeedQrPattern(job.bytes, job.seq));
      }
    }
  }

  function encodeQrPattern(bytes, seq) {
    const key = "h:" + seq;
    const hit = qrCache.get(key);
    if (hit) return Promise.resolve(hit);
    startQrWorkers();
    if (!qrWorkers.length) return Promise.resolve(getHighSpeedQrPattern(bytes, seq));
    const version = qrVersionForBytes(bytes.length);
    return new Promise((resolve) => {
      const id = qrWorkerNextId;
      qrWorkerNextId += 1;
      let settled = false;
      const finish = (pattern) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(pattern);
      };
      const timer = setTimeout(() => finish(getHighSpeedQrPattern(bytes, seq)), 2500);
      qrWorkerWait.push({ id, seq, version, bytes, key, resolve: finish });
      dispatchQrWorker();
    });
  }

  function rememberQrPattern(key, pattern) {
    if (qrCache.has(key)) return;
    if (qrCache.size >= QR_CACHE_LIMIT) qrCache.delete(qrCache.keys().next().value);
    qrCache.set(key, pattern);
  }

  function qrVersionForBytes(frameBytes) {
    if (frameBytes === 2953) return 40;
    if (frameBytes === 2068) return 33;
    if (frameBytes === 1952) return 32;
    if (frameBytes === 1732) return 30;
    if (frameBytes === 1465) return 27;
    if (frameBytes === 1273) return 25;
    if (frameBytes === 1003) return 22;
    return 0;
  }

  function getHighSpeedQrPattern(bytes, seq) {
    const key = "h:" + seq;
    const hit = qrCache.get(key);
    if (hit) return hit;
    const frameBytes = bytes.length;
    const qr = qrcode(qrVersionForBytes(frameBytes), "L");
    qr.addBytes(bytes);
    qr.make(4);
    const pattern = extractPattern(qr);
    rememberQrPattern(key, pattern);
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

  function viewerContentBox() {
    const viewer = canvas.closest(".viewer") || canvas.parentElement;
    if (!viewer) return { width: 256, height: 256 };
    const style = getComputedStyle(viewer);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return {
      width: Math.max(1, viewer.clientWidth - padX),
      height: Math.max(1, viewer.clientHeight - padY)
    };
  }

  function devicePixelRatioValue() {
    const value = window.devicePixelRatio;
    return Number.isFinite(value) && value > 0 ? value : 1;
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
    const codes = patterns.length;
    const shape = layoutShape(codes);
    const quiet = shape.quiet;
    const modules = patterns[0].count + quiet * 2;
    const dpr = devicePixelRatioValue();
    const box = viewerContentBox();
    const scale = Math.min(
      integerModuleScale(box.width, dpr, modules * shape.columns),
      integerModuleScale(box.height, dpr, modules * shape.rows)
    );
    const tilePx = modules * scale;
    const canvasW = tilePx * shape.columns;
    const canvasH = tilePx * shape.rows;
    return {
      quad: codes === 4,
      dual: codes === 2,
      columns: shape.columns,
      rows: shape.rows,
      quiet,
      scale,
      tilePx,
      canvasW,
      canvasH,
      cssWidth: canvasW / dpr,
      cssHeight: canvasH / dpr
    };
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
    canvas.style.width = metrics.cssWidth + "px";
    canvas.style.height = metrics.cssHeight + "px";
    if (canvas.width !== metrics.canvasW || canvas.height !== metrics.canvasH) {
      canvas.width = metrics.canvasW;
      canvas.height = metrics.canvasH;
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
    if (bytes <= 1732) return 137;
    if (bytes <= 1952) return 145;
    if (bytes <= 2068) return 149;
    if (bytes <= 2188) return 153;
    if (bytes <= 2303) return 157;
    if (bytes <= 2431) return 161;
    return 177;
  }

  function currentLayout() {
    const codes = codesForMode(qrMode.value);
    const frameBytes = Number(chunkSize.value);
    const bytes = capFrameBytes(codes, frameBytes);
    const frameRate = Number(fps.value);
    const header = H?.HEADER_LEN || HEADER_LEN;
    const shape = layoutShape(codes);
    const modules = qrModules(bytes) + shape.quiet * 2;
    const dpr = devicePixelRatioValue();
    const box = viewerContentBox();
    const scale = Math.min(
      integerModuleScale(box.width, dpr, modules * shape.columns),
      integerModuleScale(box.height, dpr, modules * shape.rows)
    );
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
    if (rate.codes === 4) text += "。30 FPS 四码整屏同换；60 FPS 仍交错换对角，避免四格同刷拖影";
    if (rate.codes === 2) text += "。双码只占 2×2 上排。60 FPS 两格同时更新。打开预填 2068 B · 60 FPS";
    if (rate.codes === 4 && rate.cell && rate.cell < 3) text += "。模块偏小，请全屏后再播";
    if (rate.codes === 2 && rate.cell && rate.cell < 3) text += "。模块偏小，请全屏后再播";
    if (rate.codes === 4 && rate.fps >= 60 && (measuredRefreshHz || 60) < 90) text += "。60 Hz 屏上四码 60 FPS 容易拖影，改用 30 FPS 通常更快";
    if (rate.codes === 1 && rate.fps > 30) text += "。单码超过 30 FPS 时相机会拍到换码拖影，通常更慢";
    if (rate.fps > 60) text += "。分析流约 60 FPS，更高发送帧率不会增加唯一码";
    rateHint.textContent = text;
  }

  function layoutName() {
    const mode = qrMode.value;
    return mode === "quad" || mode === "dual" ? mode : "single";
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
    if (layout === "dual") cap = Math.min(hz, 60);
    const picked = [...allowed].reverse().find((value) => value <= cap);
    return String(picked || 30);
  }

  function applyFastestLayout() {
    const layout = layoutName();
    fillChunkChoices(layout);
    fillFpsChoices(layout);
    fps.value = fastestFps(layout);
    chunkSize.value = fastestChunk(layout);
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
