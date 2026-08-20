# AirFerry Lite 工程交接

给后续接手的人：当前怎么跑、发送/接收怎么实现、对照速度、哪些路不能再走、怎么发到 GitHub Pages。

对外说明只写 [README.md](README.md)。不要在 README 里放版本号、实测 KB/s、Worker / VideoFrame 细节或本文链接。

**交接时点：** 2026-08-20。网页接收端 **v71**。Android APK 冻结 **0.8.12**。发送端是根目录 `sender/` 打出的单文件 HTML，无独立版本号，以 Pages 上的 `sender/dist/airferry-lite-sender.html` 为准。

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
| 网页接收端 | **v71** | 单码路径同 v66/v68。四码每格 720；每批只从 video 读一次再切图。相机死轨要能重新开始 |
| Android APK | **0.8.12**（versionCode 27） | 未经明确要求不要改。历史峰值 **0.8.8：60 Hz 四码约 193 KB/s** |
| 发送端 | AFL2 单文件 HTML | 默认 2331 B · 30 FPS · 单码；四码每码上限 **1273 B** |

诊断第一行必须是 `网页：v71`（改版后变成 `网页：vN`）。

## 4. 实测对照（回归用这些，不要用更旧的数）

发送参数除非另写：**2331 B · 30 FPS**。电脑 **60 Hz**。同一台红米网页。

### 单码（当前路径，v66 取帧 + v67 相机 + v68 停相机冻帧）

第二次开始扫描（相机已稳定）：

- 采集 **51.9** · 有效 **30.9** · 解码 **37.6 ms** · 取帧 **bitmap**
- 实时 **65.0 KB/s** · 会话 **53.8 KB/s**

这是网页单码必须保住的数。采集掉到约 10、忙时丢弃 0，就是主线程取帧把 `requestVideoFrameCallback` 卡住了。

### 四码（对照仍是 v64；v69 / v70 已测，v71 减相机读回）

v64 解完对照（720 packed 整幅 2×2，每格大约只有 360 px）：

- 解完 **1117/1117** · **格 4**
- 采集 **39** · 有效 **55** · 解码约 **10 ms**
- 实时 **71.8** · 平均 **73.2** · 会话 **45.7 KB/s**

v69 Pages 实测（2331 B · 30 FPS · 四码 · 全屏，相机 1920×1440 60 FPS）：

- 采集 **44.7** · 分析 53.7 · 有效 **24.9 FPS**
- 解码 **38.7 ms** · 取帧 bitmap · 扫描 720 · **格 4** · **每帧 0.50**
- 忙时丢弃 **1301** · 实时 **29.7** · 平均 31.3 · 会话 **28.8 KB/s** · 解块 285/1117
- 放近会快：720 每格比 packed 360 更清晰，但同帧补扫 + 等 4 个 Worker 全部解完，把取帧锁了约 80 ms。
- 界面「平均」慢慢升高是近 3 秒滚动窗口，不是漏帧。

v70 Pages 实测（同上参数，相机 1920×1440 60 FPS）：

- 采集 **45.6** · 分析 69.4 · 有效 **36.7 FPS**
- 解码 **40.8 ms** · 取帧 bitmap · 扫描 720 · **格 4** · **每帧 0.57**
- 忙时丢弃 **388** · 实时 **46.5** · 平均 50.9 · 会话 **44.8 KB/s** · 解块 287/1117
- 会话回到 v64 附近，有效码仍少于 v64（解码约 40 ms vs 10 ms）。
- 四码每帧对 video 做 4 次 `createImageBitmap` 后，这台机第一次扫描几秒就会闪退；开始扫描可能没反应，要再点一两次。

v71：四码每批只从 video 读一次并集（最长边格缩到 720，atlas 上限 1440），再从 atlas 切格。流水线不变。死轨 / mute / 1.5 s 无帧则 `closeCamera` 并重新点亮开始按钮。单码取帧不要动。诊断第一行 `网页：v71`。

### 怎么读诊断

- 网页「每帧」= `sessionValidCodes / sessionDecodedFrames`。四码一帧相机最多派 4 个 Worker，0.31 ≈ 每相机帧打中约 1.2 个码，不是 0.31 个码。
- 界面「平均」是近 3 秒滚动；诊断里另有整段会话平均。会话平均低于实时，是因为锁格 / 锁 ROI 之前的瞄准段也算进去。
- 理论速度 = `每码字节 × 码数 × FPS`，喷泉码大约再加 15% 帧。四码 30 FPS、每码 1253 B 时屏幕上限约 `1253 × 4 × 30 ≈ 147 KB/s`。网页四码还远低于这个上限，卡在每相机帧大约只打中 1 个码。

### APK（0.8.12，同一台红米）

- CameraX 分析流约 **60 FPS**（最新帧）。120/240/480 是高速录像管道，不能给 ImageAnalysis。
- 诊断里「每帧」是每相机帧打中的码数，0.8.x 四码大约 **2.6–3+**。网页同一指标大约 1.2，不要拿来直接比。
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

高速路径：`requestVideoFrameCallback` → `scanWithHighSpeedWorkers`。Worker 忙则丢最新帧，不排队。先 `play()` 再启动 4 个 WASM Worker，避免和相机抢内存。

### 单码（不要改这条取帧）

1. 未锁定：整幅 `createImageBitmap(video, 0, 0, vw, vh, { resize 960 })`。
2. `BarcodeDetector` 锁 ROI。
3. 锁定后：`createImageBitmap(video, x, y, widthSrc, heightSrc, { resize 720 })`。
4. 失败不要 `captureViaCanvas = true`，不要二次 `createImageBitmap` 裁已经拿到的 bitmap。

### 四码（v69 起改取帧，锁格不变；v71 起一次读回）

1. `grabQuadTileBitmaps`：对当前批次格子求并集，**一次** `createImageBitmap(video, …)`，缩到最长格 720（atlas 不超过 1440），再从 atlas 切格发 Worker。不要每格各读一次 video。不要把整幅 2×2 压成一张 720 packed 再切。
2. 同帧不再二次补扫。有空闲 Worker 就发下一格，取帧锁在 bitmap 发出去之后立刻放开。不要 `dueRelock`，不要周期性重锁整幅 ROI。
3. `lockQuadSlots`：至少 **2** 个命中才锁；满 4 格冻结。格 4 之后只用 `followContainedQuadHits`。不要 `rebuildQuadFromHits`，不要再跑全图 `BarcodeDetector`。
4. 保留 `function tileCenter`。格子里存原始框，只在扫描时 `inflateRect` 一次。
5. packed + luma 只作 `createImageBitmap` 失败时的回退。

### 相机

- Android 不要要 120 FPS、不要 `focusMode: continuous`、不要横屏 `1920×1440`（用 `1440×1920`）。
- `cameraPreviewLive()`：轨 `live`、未 mute、video 在播且有宽高。开始扫描若预览已死，先 `closeCamera` 再 `getUserMedia`。不要只看 `track.readyState === "live"` 就 return。
- 假 `ended` 只在轨仍 `live` 且未 mute、video 未暂停且有帧时忽略。`WeakSet` 每条轨只绑一次。
- 扫描中 mute、轨 ended、或 1.5 s 没有 `requestVideoFrameCallback`：`dropDeadCamera()` → `closeCamera()`，重新点亮开始按钮。页面隐藏时不要当死轨。
- 不要在 `ended` 上自动重试 getUserMedia。
- 停止：`freezeCameraPreview()` 把最后一帧画到 `#cameraFreeze`，再 `srcObject = null`，避免闪黑。
- `finishing` 时 `closeCamera` 不要清布局字段，否则完成后诊断会变成「单码 · 全图」。

## 7. Android APK 实现（0.8.12，冻结）

源码：`android-receiver/app/src/main/java/com/airferrylite/receiver/`。构建：`android-receiver/build-local.ps1`，Java 17，SDK 35。`versionName 0.8.12` / `versionCode 27`。未经明确要求不要改。

APK 比网页快，主要不是锁格算法更聪明，而是：**同一帧 Y 平面上原生 zxing-cpp 能扫多个码，CameraX 按最新帧丢旧帧，没有浏览器 `createImageBitmap` 整帧读回。** 原版 [AirFerry](https://github.com/UR-SillyB/AirFerry) 只作思路参考。网页不要直接搬 APK 的四码重排。

### 相机

- Preview + `ImageAnalysis`。分析流目标 **1920×1440**、`YUV_420_888`、`STRATEGY_KEEP_ONLY_LATEST`。
- 优先固定 AE 档 60 / 90 / 120；这台红米分析流实际大约 60 FPS。诊断会单独列出「高速录像能力」，那条管道不能拿来扫码。
- 网页端不要对 Android `getUserMedia` 要 120 FPS 或横屏 1920×1440；APK 的 1920×1440 是 CameraX 分析分辨率，和网页预览约束不是一回事。

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
- 不要切竖屏中心方块，不要 `probeMulti`。

**四码锁格**

- 不要用 1 个命中替换整张 2×2。`lockQuadSlots` 必须 `fresh.length < 2` 直接 return。
- 不要删 `tileCenter`（格 1 时对 `undefined` 取中心，卡死）。
- 不要 nearest-neighbor nudge、不要 `dueRelock`、不要格 4 后再跑全图 BarcodeDetector。
- 不要按相机中线切 2×2，不要先把整幅 2×2 缩到 720 再切，不要把并排两个码当成完整 2×2。
- 不要用稀疏 WASM 命中 `rebuildQuadFromHits` 重排 2×2（会打乱未锁住的格子，诊断里没有格 4）。
- 网页不要搬 APK 的「≥3 命中按 midX/midY 重排」：WASM 每帧常常只有 1 个命中。
- APK 不要改回 `ImageProxy.read()`（会旋转）。不要把高速录像 session 接到 ImageAnalysis。不要把已不用的 `LumaScaler` 接回热路径。

**其它**

- 不要 Android 连续对焦 / 120 FPS 请求 / 横屏 1920×1440 相机约束。
- 不要运行中假 `ended` 立刻 `closeCamera()`（会黑屏）。
- 不要 60 Hz 屏上 120 FPS 发送。
- 不要 commit `.env`、密钥、`.tools/`。不要改 git config，不要 `--force` 推 `main`。`protocol.js` 若只有 CRLF 脏改，不要提交。

## 10. 怎么改网页、怎么上线

1. 改根目录 `app.js` / `index.html` / `sw.js`（发送端则改 `sender/` 再 `node sender/build.mjs`）。
2. 接收端：升 `RECEIVER_BUILD`、标题、`CACHE_NAME`、**`index.html` 里 `app.js?v=`**、`tests/receiver-safety.test.mjs` 里的版本针。不要再用 `sessionStorage === RECEIVER_BUILD` 跳过刷新。
3. `node sync-receiver.mjs`（或 `npm run build:receiver`）。
4. `npm test`。
5. commit 后 `git push origin HEAD`。GitHub 不通时对当前 `main` 做 tree 补丁，不要假设本地 `origin/main` 等于 GitHub。
6. `gh api repos/shuipashui/airferry-lite/pages/builds` 等到 `built`。
7. 拉 `https://shuipashui.github.io/airferry-lite/app.js?v=N` 确认 `RECEIVER_BUILD`。Chrome 若一直停在旧版，是旧 Service Worker；新 SW 激活时会强制打开页面。仍不对就清掉该站数据。

## 11. 已知缺口

1. **网页四码** v70 会话 **44.8 KB/s**，接近 v64 的 45.7，但有效码 36.7 vs 55，解码仍约 40 ms。v71 先稳住相机（每批一次 video 读回）。不要为速度再加同帧补扫或每格各读 video。不要搬 APK 的 ≥3 命中重排。单码取帧不要顺手改。
2. AFL2 进度只在内存，刷新即丢。IndexedDB 只服务 AFL1。
3. 文件上限 64 MiB。
4. 本地 `origin/main` 和 GitHub `main` 的 SHA 偶尔对不齐（API 推送），以 GitHub API 的 ref 为准。

## 12. 许可证

MIT。第三方见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。只使用 Decimen **v0.3.0 MIT**。后来的 AGPL Decimen（RaptorQ / 官方四码）不能直接搬。

---

当前网页 **v71**，APK **0.8.12**。网页单码实时 **65 KB/s**（路径未改）。四码对照仍是 v64 会话 **45.7 KB/s**；v70 实测会话 **44.8 KB/s**。以 Pages 诊断第一行 `网页：v71` 为准。
