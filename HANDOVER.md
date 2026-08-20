# AirFerry Lite 工程交接

给后续接手的人：当前怎么跑、发送/接收怎么实现、对照速度、哪些路不能再走、怎么发到 GitHub Pages。

对外说明只写 [README.md](README.md)。不要在 README 里放版本号、实测 KB/s、Worker / VideoFrame 细节或本文链接。

**交接时点：** 2026-08-20。网页接收端 **v83**。Android APK 冻结 **0.8.12**。发送端是根目录 `sender/` 打出的单文件 HTML，无独立版本号，以 Pages 上的 `sender/dist/airferry-lite-sender.html` 为准。

## 1. 项目一句话

电脑浏览器把文件打成连续 QR，手机摄像头扫回来，无服务器。当前发送走 **AFL2**（Decimen v0.3 MIT：二进制帧 + LT 喷泉码）。网页和 APK 都能收；旧 **AFL1** 文本流只作兼容。

仓库：https://github.com/shuipashui/airferry-lite  
网页接收：https://shuipashui.github.io/airferry-lite/  
发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html  

工作副本：`C:\codex_project\airferry-lite`。默认分支 `main`。不要 force-push。

## 2. 人、机、测法

- 用户：**蓝**，软件工程师。直接改代码、看诊断、迭代。不要主动 commit/push，除非这次明确要求，或走本仓库「只测 Pages」的发布循环。
- 主力测试机：Xiaomi / 红米 · Android 16 · Chrome 151。相机 **0–60 FPS**，预览常为 **1440×1920 竖屏**。UA 经常是 `Android 10; K`。
- 电脑屏：**60 Hz**。不要在这台机上追 120 FPS 发送。
- 网页**只在 GitHub Pages 上测**，本地 `index.html` 没有摄像头 HTTPS。改接收端必须升 `RECEIVER_BUILD` / `index.html?v=` / `sw.js` 的 `CACHE_NAME`，同步 `web-receiver/`，跑 `npm test`，再推 `main`。
- 发送端 UI/布局改完跑 `node sender/build.mjs`（把 `template.html` + `styles.css` + `app.js` 打进 `sender/dist/airferry-lite-sender.html`），再推。不必升接收端版本。
- Node：仓库内 `.tools/node`（已 gitignore）。`github.com:443` 偶尔不通时用 `gh api` 写 blob/tree/commit/ref；**parent 必须是 GitHub 上当前 `main` SHA**。推完删临时脚本。等 Pages `built` 后核对线上 `app.js` 的 `RECEIVER_BUILD`。

## 3. 当前冻结面

| 部件 | 版本 | 对照 |
|---|---|---|
| 网页接收端 | **v83** | 预览 60 FPS。单码回到 v81 取帧（inflight 4，不限 33 ms）。四码仍 33 ms · inflight 1 |
| Android APK | **0.8.12**（versionCode 27） | 未经明确要求不要改。历史峰值 **0.8.8：60 Hz 四码约 193 KB/s** |
| 发送端 | AFL2 单文件 HTML | 默认 2331 B · 30 FPS · 单码；四码每码上限 **1273 B** |

诊断第一行必须是 `网页：v83`（改版后变成 `网页：vN`）。

## 4. 实测对照（回归用这些，不要用更旧的数）

发送参数除非另写：**2331 B · 30 FPS**。电脑 **60 Hz**。同一台红米网页。

### 单码（当前路径，v66 取帧 + v67 相机 + v68 停相机冻帧）

第二次开始扫描（相机已稳定）：

- 采集 **51.9** · 有效 **30.9** · 解码 **37.6 ms** · 取帧 **bitmap**
- 实时 **65.0 KB/s** · 会话 **53.8 KB/s**

这是网页单码在 **60 FPS 预览** 下必须保住的数。v73–v80 曾把 Android 预览锁在 30 FPS；v81 预览回到 60 FPS，四码取帧仍是 33 ms、inflight 1。采集掉到约 10、忙时丢弃 0，就是主线程取帧把 `requestVideoFrameCallback` 卡住了。

### 四码（当前对照是 v74）

v74 Pages 实测（2331 B · 30 FPS · 四码 · 全屏，相机 1920×1440 **30 FPS** · Worker 2）：

- **格 4** · 采集 **30.5** · 分析 14.8 · 有效 **35.4 FPS**
- 解码 **36.0 ms** · 取帧 bitmap · 扫描 720 · **每帧 2.30**
- 忙时丢弃 **276** · 实时 **44.2** · 平均 47.5 · 会话 **43.3 KB/s** · 解块 334/1117
- **页面不卡，相机能打开。** 一张 720 图进 Worker 能打中约 2.3 个码；分析 14.8 是因为 `HIGH_QUAD_INFLIGHT = 1`，第二个 Worker 闲着。

v64 解完对照（当时 60 FPS 预览，720 packed luma 切四格，解码约 10 ms）：解完 **1117/1117** · 采集 39 · 有效 55 · 会话 **45.7 KB/s**。v74 会话已经回到这个量级，不要为了追 10 ms 解码退回主线程 `getImageData`。

v75 Pages 实测（同上参数，但预览 **60 FPS**、inflight 2、间隔 16 ms）：

- 四码：采集 55.0 · 分析 40.0 · 有效 **5.0 FPS** · 每帧 **0.26** · 会话 **11.8 KB/s** · 又卡
- 单码：采集 46.1 · 分析 39.3 · 有效 0.0 · 扫描 **1440 全图** · 解码 72.4 ms · 会话 **28.6 KB/s**
- 60 FPS 相机会拍到 30 FPS 发送的换帧间隙，WASM 打不中；主线程还要按 40–55 次/秒抠 720/1440。不要再要 60 FPS 预览。

v76 Pages 实测（30 FPS 预览 + inflight 2 + 间隔 33 ms）：

- 采集 **30.0** · 分析 21.3 · 有效 **18.4 FPS** · 解码 **71.3 ms** · **每帧 0.66**
- 实时 27.7 · 平均 27.6 · 会话 **17.5 KB/s** · 格 4 · 还是有点卡
- 两个 720 bitmap 并行把解码从 36 ms 拖到 71 ms，命中率也掉了。单码速度回来了。刚开始几秒相机正常但完全扫不到码（WASM 还在编译）。

v77：inflight 退回 **1**，页面加载预热 WASM。开头几秒相机正常了，但诊断没有「格 4」。采集 30 · 分析 16.5 · 有效 **0.0** · 解码 61.5 ms · **每帧 0.42** · 会话 **6.0 KB/s** · 还是有点卡。原因：WASM 一就绪就扫到 1 个四码，ROI 缩到那一码周围，并关掉原生定位，后面再也锁不成 2×2。

v78 Pages 实测（同上参数，acquire 修好了所以有格 4）：

- 格 4 · 采集 30.0 · 分析 12.6 · 有效 21.3 · 解码 **58.0 ms** · **每帧 0.78**
- 实时 22.3 · 平均 17.6 · 会话 **10.9 KB/s** · 忙时丢弃 481
- 格锁上了，但 720 图里码不够锐。原因：`BarcodeDetector` 两格一到就 `lockQuadSlots(..., true)`，`inferMissingQuadTiles` 直接冻成格 4，后续只 `followContainedQuadHits`，并集被放大。另有十几秒「正在加载解码器」：每次 Stop 都 `terminate` Worker，升版 SW 还把 hashed wasm 从缓存里删掉。

v79：原生定位只帮到 2 格、不冻格。Stop 不清 WASM。加载解码器不再卡住。但预览里码发糊、一卡一卡，扫几秒又糊：WASM 扫描时还在 `BarcodeDetector.detect(video)`，再叠加 Android 默认连续对焦对着 30 FPS 闪码拉焦。

v80：高速路径不再对 `video` 做 `detect`。但又把 Android 对焦/曝光锁成 `manual/none/single-shot`，红米对不上焦，预览一直糊。

v81 Pages 实测（60 FPS 预览，不锁 AF，四码仍 33 ms inflight 1）：**页面不卡。**

- 四码：采集 59.9 · 分析 20.6 · 有效 29.5 · 解码 **29.3 ms** · **每帧 1.36** · 格 4 · 实时 37.4 · 会话 **35.0 KB/s** · 解块 556/1117
- 单码：采集 59.0 · 分析 43.0 · 有效 25.0 · 解码 29.0 ms · **每帧 0.54** · 实时 **53.8** · 会话 **48.1 KB/s** · 解完 606/606
- 单码没到 v66 的 65 KB/s：60 FPS 预览按相机帧连抠，一半扫在 30 FPS 发送的换帧间隙上，重复 55、每帧 0.54。

v82 Pages 实测（单码也 33 ms、Android inflight 1）：采集 58 · 分析 **20.0** · 有效 **9.0 FPS** · 每帧仍 0.51 · 实时 **22.5** · 会话 **23.2 KB/s**。限速没有把每帧打上去，只是少扫了，变慢。不要再给单码加 33 ms 间隔。

v83：单码取帧退回 v81（`HIGH_SINGLE_INFLIGHT = 4`，不限 33 ms）。四码仍 33 ms · inflight 1。不要锁 AF。诊断第一行 `网页：v83`。

不要再走的路（都已 Pages 打过）：

- v69 / v70：每格对 `video` 做 `createImageBitmap`（720 或四次并行）。会话可以到 44.8，但这台机会闪退。
- v71：1440 atlas 再切格 + 1.5 s 无帧看门狗。更卡，还会误关相机。
- v72：主线程 `getImageData` 720 packed。卡。
- v73：SW `navigate` + `reload` 让刚进页面黑屏。不要强制刷新。
- v75：60 FPS 预览 **加上** inflight 2、间隔 16 ms。四码每帧掉到 0.26、会话 11.8、又卡。60 FPS 预览可以，不要再 16 ms 连抠。

### 怎么读诊断

- 网页「每帧」= `sessionValidCodes / sessionDecodedFrames`。v74 四码约 **2.30**，表示每次 WASM 大约打中 2.3 个码，不是 2.3 个相机帧。
- 界面「平均」是近 3 秒滚动；诊断里另有整段会话平均。会话平均低于实时，是因为锁格 / 锁 ROI 之前的瞄准段也算进去。
- 理论速度 = `每码字节 × 码数 × FPS`，喷泉码大约再加 15% 帧。四码 30 FPS、每码 1253 B 时屏幕上限约 `1253 × 4 × 30 ≈ 147 KB/s`。网页现在卡在分析约 15 FPS（1 帧在飞、解码 36 ms），不是卡在每帧只打中 1 个码。

### APK（0.8.12，同一台红米）

- CameraX 分析流约 **60 FPS**（最新帧）。120/240/480 是高速录像管道，不能给 ImageAnalysis。
- 诊断里「每帧」是每相机帧打中的码数，0.8.x 四码大约 **2.6–3+**。网页 v74 同一指标大约 **2.30**，但网页分析只有约 15 FPS，APK 分析约 60，不要直接比 KB/s。
- 历史峰值 **0.8.8：60 Hz 四码约 193 KB/s**。当前冻结 **0.8.12**，不要为网页实验去改。

## 5. 发送端实现

源码：`sender/app.js`、`sender/styles.css`、`sender/template.html`。产物：`sender/dist/airferry-lite-sender.html`。CI 要求产物可复现，改源码后必须 `node sender/build.mjs`。

### 打包与播放

1. `packFile`（AFL2）：文件 ≥ 768 B、MIME 不是已经压缩的格式、gzip 还能再省 ≥ 64 B 才压。界面「传输」格（`#compressText`）单独显示 gzip / 未压缩，不要再塞进状态栏（会被 ellipsis 裁掉）。
2. `LTEncoder` 按 `每帧数据 − 20` 切块。四码时 `QUAD_MAX_FRAME_BYTES = 1273`（QR V25）；选 2331 不会让四码变成 V34。
3. `requestAnimationFrame` 播放，按测得的刷新率对齐到整数个 vsync。浏览器卡顿超过三个播放间隔时丢弃积压节拍。采样必须包含 240 Hz（约 4 ms）的 vsync，不要再用 `dt > 8 ms`。
4. 60 Hz 上单码超过 30 FPS 会拉回 30。四码 60 FPS 容易拖影，界面会提示改 30 FPS。

### 画布与静区

- **单码**：按右侧 viewer 可用区域画正方形，铺满，静区 **2** 格。窗口锁定 `100dvh` + `overflow:hidden`，避免底边定位点被切掉。
- **四码**：窗口和单码一样锁死，不能滚动。画布上限 **96vmin**，塞进右侧固定区；全屏仍是 **100vmin**。静区 **4** 格，2×2 铺满。四码请全屏。
- 入口页右侧的接收端 URL 小码仍用 4 格静区，不要被圆角裁定位点。

### 推荐参数（和 README 一致）

| 场景 | 参数 |
|---|---|
| 单码 | 2331 B · 30 FPS |
| 四码 | 全屏 · 2331 B · 30 FPS（每码实际 1273 B） |
| 近、画面清 | 2953 B · 30 FPS（仅单码） |
| 远或不稳 | 1465 B，或四码 1003 B |

## 6. 网页接收端实现

根目录 `index.html` + `app.js` + `sw.js` 即 GitHub Pages。`web-receiver/` 是 byte-identical 镜像（换行除外），改完必跑 `node sync-receiver.mjs`。

高速路径：`requestVideoFrameCallback` → `scanWithHighSpeedWorkers`。Worker 忙则丢最新帧，不排队。页面加载就预热 WASM Worker，Stop 不要 terminate。Android 先起 1 个 Worker，就绪后再起第 2 个。桌面最多 4 个。

### 单码（不要改这条取帧）

1. 未锁定：整幅 `createImageBitmap(video, 0, 0, vw, vh, { resize 960 })`。
2. WASM 锁 ROI。不要在高速扫描时对 `video` 做 `BarcodeDetector.detect`（和预览抢相机，这台机会糊、会卡）。
3. 锁定后：`createImageBitmap(video, x, y, widthSrc, heightSrc, { resize 720 })`。
4. 失败不要 `captureViaCanvas = true`，不要二次 `createImageBitmap` 裁已经拿到的 bitmap。不要给单码加 33 ms 间隔（v82 有效码从 25 掉到 9）。

### 四码（锁格不变；v73 一张图进 Worker）

1. `grabQuadPackedBitmap`：对 2×2 并集 **一次** `createImageBitmap(video, …, { resize 720 })`，把 bitmap 交给 **1 个** Worker，`maxSymbols: 4`。不要在页面线程 `getImageData` / `rgbaToLuma`。不要每格各读 video，不要 1440 atlas。
2. 同时只允许 `HIGH_QUAD_INFLIGHT = 1` 帧在飞，取帧间隔 `HIGH_QUAD_GRAB_MS = 33`。v76 的 inflight 2 把解码拖到 71 ms、每帧掉到 0.66，不要再开。预览可以 60 FPS，但不要按 16 ms 连抠。页面加载时预热 Worker。
3. 同帧不再二次补扫。不要 `dueRelock`，不要周期性重锁整幅 ROI。
4. `lockQuadSlots`：至少 **2** 个命中才锁；满 4 格冻结。格 4 之后只用 `followContainedQuadHits`。不要 `rebuildQuadFromHits`。高速 WASM 扫描不要再 `BarcodeDetector.detect(video)`。原生 `lockQuadSlots(tiles, true)` 若被调用 **不得** `inferMissing` 或冻格。一个四码命中不要把 ROI 缩到那一码周围。
5. 保留 `function tileCenter`。格子里存原始框，只在扫描时 `inflateRect` 一次。
6. packed luma 只作 ImageBitmap 失败时的回退。

### 相机

- Android 预览请求 **60 FPS**（`frameRate: { ideal: 60, max: 60 }`），不要 120、不要横屏 `1920×1440`（用 `1440×1920`）。不要锁 `manual/none/single-shot` 对焦（v80 对不上焦）。不要对 Android 强开 `focusMode: continuous` 约束，让相机自己对焦。Android 只开 **2** 个 WASM Worker，错开启动。Stop 不要 terminate。v75 翻车是 16 ms + inflight 2，不是 60 FPS 预览。
- `cameraPreviewLive()`：轨 `live`、未 mute、video 在播且有宽高；1.5 s 没有新的视频帧则视为死预览。开始扫描若预览已死，先 `closeCamera` 再 `getUserMedia`。不要只看 `track.readyState === "live"` 就 return。
- 扫描中开始按钮保持可点。不要因为主线程卡了就自动 `closeCamera`（v71 的 `dropDeadCamera` 会把活相机杀掉）。
- 假 `ended` 只在轨仍 `live` 且未 mute、video 未暂停且有帧时忽略。`WeakSet` 每条轨只绑一次。
- 不要在 `ended` 上自动重试 getUserMedia。
- 停止：`freezeCameraPreview()` 把最后一帧画到 `#cameraFreeze`，再 `srcObject = null`，避免闪黑。
- `finishing` 时 `closeCamera` 不要清布局字段，否则完成后诊断会变成「单码 · 全图」。
- 首次安装或替换 Service Worker：`claim` 即可。**不要** `client.navigate`，**不要** `controllerchange` 时 `location.reload()`（每次升版本都会黑屏并把 getUserMedia 掐掉）。HTML 已是 `fetch(no-store)`，进新版页面就是新 JS。若标签页还停在更旧的缓存，手动刷新或清站点数据。
- install 不要 `cache.addAll` 整个 WASM；Worker 第一次用再缓存。

## 7. Android APK 实现（0.8.12，冻结）

源码：`android-receiver/app/src/main/java/com/airferrylite/receiver/`。构建：`android-receiver/build-local.ps1`，Java 17，SDK 35。`versionName 0.8.12` / `versionCode 27`。未经明确要求不要改。

APK 比网页快，主要不是锁格算法更聪明，而是：**同一帧 Y 平面上原生 zxing-cpp 能扫多个码，CameraX 按最新帧丢旧帧，没有浏览器 `createImageBitmap` 整帧读回。** 原版 [AirFerry](https://github.com/UR-SillyB/AirFerry) 只作思路参考。网页不要直接搬 APK 的四码重排。

### 相机

- Preview + `ImageAnalysis`。分析流目标 **1920×1440**、`YUV_420_888`、`STRATEGY_KEEP_ONLY_LATEST`。
- 优先固定 AE 档 60 / 90 / 120；这台红米分析流实际大约 60 FPS。诊断会单独列出「高速录像能力」，那条管道不能拿来扫码。
- 网页端不要对 Android `getUserMedia` 要 120 FPS 或横屏 1920×1440。APK 的 1920×1440 是 CameraX 分析分辨率，和网页预览约束不是一回事。

### 解码

- `NativeQrDecoder`：zxing-cpp JNI **`readYBuffer`**，直接吃 CameraX Y 平面，**rotation 0**。Kotlin 包装的 `ImageProxy.read()` 会旋转，这台机上已经证明不能用。
- `tryHarder` / `tryRotate` / `tryInvert` / `tryDownscale` 全关。先 `LOCAL_AVERAGE`，空再 `GLOBAL_HISTOGRAM`。
- `pixelStride == 1` 且 direct buffer 时零拷贝裁区域；否则打包装进 direct `ByteBuffer`。
- `LumaScaler` 是旧 Java ZXing 缩图残留，**热路径不用**。不要为了 cpp 再开一轮主线程缩 Y。

### 单码 / 四码怎么切换

帧头 AFL2 `0x0d` / `0x0f` 表示四码布局；或者一帧里 ≥2 个传输码，就锁多码。否则确认单码，`maxSymbols = 1`，只扫跟踪 ROI（没有 ROI 则画面中心方块）。未确认前 `maxSymbols = 4`，避免一上来就把四码当成单码。

### 四码扫描（`QrFrameAnalyzer`）

同一张 `ImageProxy` 上，4 个 `NativeQrDecoder` + 固定线程池：

1. 已有 `trackedTiles`：四个裁块**并行**扫，命中中心落在格子里就算该格有了。
2. 还不满 4：对当前 ROI 做 **18% 重叠象限**串行补扫（码很少对齐相机中线）。
3. 仍不满：把空的独占象限放大 1.28×，开 binarizer 重试。
4. **≥3 个命中**时 `ScanLayout.tilesFromHits` 按 midX / midY 排成 2×2，作为下一帧的 `trackedTiles`。

ROI：4 个命中用点包围盒 ×1.40；3 个命中和上一帧并集；更少则退回中心方块。连续空扫会胀 ROI，满 8 次 miss 放弃跟踪。连续 2 次空扫清掉 `trackedTiles`。

**不要把第 4 步搬进网页。** 网页 WASM 每相机帧常常只有 1 个命中，按 mid 重排会把还没锁住的格子打乱，诊断里没有「格 4」。网页继续用 `lockQuadSlots`（≥2 命中）+ 格 4 后 `followContainedQuadHits`。

### 组包

- `HighSpeedAssembler`：AFL2 LT + gzip 解压 + SHA-256。进度只在内存，杀进程即丢。
- `TransferAssembler`：旧 AFL1 文本帧。
- 文件上限同样 64 MiB。

## 8. 架构

```text
sender/                         浏览器发送：测刷新率、lookahead、画 QR
  dist/airferry-lite-sender.html  提交用的单文件产物
index.html + app.js + sw.js     GitHub Pages 网页接收端（根目录即线上）
web-receiver/                   根目录接收端镜像，必须 byte-identical
android-receiver/               Kotlin + CameraX + zxing-cpp（0.8.12 冻结）
  QrFrameAnalyzer.kt            最新帧、四格并行、重叠象限补扫
  NativeQrDecoder.kt            Y 平面 readYBuffer，rotation 0
  ScanLayout.kt                 ROI / tilesFromHits（网页不要搬）
  HighSpeedAssembler.kt         AFL2 LT + gzip
shared/ + highspeed-protocol.js AFL1 / AFL2
vendor/decimen/                 WASM Worker 与 zxing wasm
third_party/decimen-v0.3/       MIT 源，不要混入后续 AGPL Decimen
tests/                          npm test：协议 / 安全 / 运行时针
```

## 9. 不要做（已验证会掉速或黑屏）

测试针在 `tests/receiver-safety.test.mjs`，不要为了新功能删掉这些断言，除非行为真的改了并有实测。

**单码取帧**

- 不要 `track.clone()` / `MediaStreamTrackProcessor`（预览闪退，然后粘在 canvas，采集约 9）。
- 不要 `postedFrame = new VideoFrame(video)` 当单码快路径（仍是整帧读回，采集约 10）。
- 不要整幅取帧再从 bitmap 裁 720（采集约 12、命中率 0.45）。
- 不要 `createImageBitmap(video, { resize })` 不带源矩形。
- 不要锁码后再在主线程裁一次图。瞄准快、锁码慢，就是多了这一次。
- 不要因 `lastHitBox >= 700` 把单码全图压到 720。
- 不要给单码加 33 ms 取帧间隔或把 Android inflight 打成 1（v82：有效码 25→9，会话 48→23 KB/s）。

**四码锁格**

- 不要用 1 个命中替换整张 2×2。`lockQuadSlots` 必须 `fresh.length < 2` 直接 return。
- 不要删 `tileCenter`（格 1 时对 `undefined` 取中心，卡死）。
- 不要 nearest-neighbor nudge、不要 `dueRelock`、不要在 WASM 高速扫描时跑全图 BarcodeDetector。
- 不要按相机中线切 2×2，不要把并排两个码当成完整 2×2。
- 不要每格对 video 做 `createImageBitmap`，不要 1440 atlas 再切格，不要在页面线程对 720 packed 做 `getImageData`。一张 720 bitmap 进 Worker、`maxSymbols: 4` 是 v73 主路径。
- 不要用 1.5 s 无帧看门狗自动 `closeCamera`。
- 不要在 WASM 高速扫描中 `BarcodeDetector.detect(video)`（v79：预览发糊、一卡一卡）。格 4 靠 WASM 中心方块 + 禁止单码缩 ROI。
- 不要用一个四码命中把 ROI 缩到单码周围（v77：每帧 0.42、会话 6 KB/s）。
- 不要用原生定位框 `inferMissingQuadTiles` 冻成格 4（v78：每帧 0.78、会话 10.9 KB/s）。冻格只许 WASM。
- 不要在 `closeCamera` 里 `stopHighSpeedWorkers`。不要升版时删掉 `airferry-lite-wasm`。不要两个 Worker 一起编译。
- 不要用稀疏 WASM 命中 `rebuildQuadFromHits` 重排 2×2（会打乱未锁住的格子，诊断里没有格 4）。
- 网页不要搬 APK 的「≥3 命中按 midX/midY 重排」：WASM 每帧常常只有 1 个命中。
- APK 不要改回 `ImageProxy.read()`（会旋转）。不要把高速录像 session 接到 ImageAnalysis。不要把已不用的 `LumaScaler` 接回热路径。

**其它**

- 不要 Android 120 FPS 请求 / 横屏 1920×1440 相机约束。不要把对焦锁成 manual/none（v80 对不上焦）。
- 不要运行中假 `ended` 立刻 `closeCamera()`（会黑屏）。
- 不要在 SW `activate` 里 `client.navigate`，不要 `controllerchange` 时 `location.reload()`。
- 不要 60 Hz 屏上 120 FPS 发送。
- 不要 commit `.env`、密钥、`.tools/`。不要改 git config，不要 `--force` 推 `main`。`protocol.js` 若只有 CRLF 脏改，不要提交。

## 10. 怎么改网页、怎么上线

1. 改根目录 `app.js` / `index.html` / `sw.js`（发送端则改 `sender/` 再 `node sender/build.mjs`）。
2. 接收端：升 `RECEIVER_BUILD`、标题、`CACHE_NAME`、**`index.html` 里 `app.js?v=`**、`tests/receiver-safety.test.mjs` 里的版本针。不要 `controllerchange` / `navigate` 强制刷新。
3. `node sync-receiver.mjs`（或 `npm run build:receiver`）。
4. `npm test`。
5. commit 后 `git push origin HEAD`。GitHub 不通时对当前 `main` 做 tree 补丁，不要假设本地 `origin/main` 等于 GitHub。
6. `gh api repos/shuipashui/airferry-lite/pages/builds` 等到 `built`。
7. 拉 `https://shuipashui.github.io/airferry-lite/app.js?v=N` 确认 `RECEIVER_BUILD`。新 SW 不会再强制刷新。若标签页还显示旧版，手动刷新一次或清掉该站数据。

## 11. 已知缺口

1. **网页四码 100 KB/s**：2331 B · 30 FPS · 四码每码 1253 B，屏幕上限约 `1253 × 4 × 30 ≈ 147 KB/s`，所以 100 KB/s 在发送侧够得着，但网页现在 35–43 KB/s。要 100 KB/s 必须约 **82 个唯一码/秒**，也就是几乎每一发帧打中 **2.7 / 4** 个码。v74 最好是分析 15 × 每帧 2.30 ≈ 35 码/秒（43 KB/s）。v81 解码已经 29 ms，但每帧只有 1.36。这台机上为提分析率走过的路都翻了：16 ms + inflight 2（卡、每帧 0.26）、每格 `createImageBitmap`（闪退）、主线程 `getImageData`（卡）。APK 0.8.8 能到 **193 KB/s**，靠的是 CameraX 最新帧 Y 平面 + 原生 zxing-cpp 约 60 FPS 分析，网页没有这条管线。开源对照：Decimen 父实验 ~128 KB/s 是 120 Hz 屏 + 更密帧 + 叠码；[RaptorQR](https://github.com/infrost/RaptorQR) 标 183–254 KB/s 用 RaptorQ（后来的 AGPL Decimen 同系，**不能搬**）和四码并行，短文件数字会偏乐观；[QRFerry](https://github.com/deedy/qr-data-transfer) 明确避开四码格、改双通道交替，因为四码获取成本高。网页要到 100 KB/s，下一步只能是 **提高 720 并集里每帧命中（回到 v74 的 2.3）** 或 **换发送侧**（60 FPS 四码，但这台 60 Hz 屏容易拖影），不要再 16 ms 连抠。单码取帧不要顺手改。
2. AFL2 进度只在内存，刷新即丢。IndexedDB 只服务 AFL1。
3. 文件上限 64 MiB。
4. 本地 `origin/main` 和 GitHub `main` 的 SHA 偶尔对不齐（API 推送），以 GitHub API 的 ref 为准。

## 12. 许可证

MIT。第三方见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。只使用 Decimen **v0.3.0 MIT**。后来的 AGPL Decimen（RaptorQ / 官方四码）不能直接搬。

---

当前网页 **v83**，APK **0.8.12**。预览 60 FPS。单码取帧同 v81（inflight 4）。四码 33 ms · inflight 1。单码对照 v66 实时 **65.0 KB/s**，四码对照 v74 **43.3 KB/s**。不要再锁 AF，不要单码 33 ms 限速。以 Pages 诊断第一行 `网页：v83` 为准。
