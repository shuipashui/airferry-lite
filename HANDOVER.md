# AirFerry Lite 工程交接

给后续接手的人：当前怎么跑、发送/接收怎么实现、对照速度、哪些路不能再走、怎么发到 GitHub Pages。

对外说明只写 [README.md](README.md)。不要在 README 里放版本号、实测 KB/s、Worker / VideoFrame 细节或本文链接。

**交接时点：** 2026-08-22。网页接收端 **v85**。Android APK **0.8.23**。当前最快：双码 **1732 B · 60 FPS** 会话 **190.4 KB/s**（V30 上限约 201）。四码 **1465 B · 30 FPS 整屏同换** 会话 **168.9**。发送端打开双码预填 1732·60，打开四码预填 1465·30。以 Pages 上的 `sender/dist/airferry-lite-sender.html` 为准。

## 1. 项目一句话

电脑浏览器把文件打成连续 QR，手机摄像头扫回来，无服务器。当前发送走 **AFL2**（Decimen v0.3 MIT：二进制帧 + LT 喷泉码）。网页和 APK 都能收；旧 **AFL1** 文本流只作兼容。

仓库：https://github.com/shuipashui/airferry-lite  
网页接收：https://shuipashui.github.io/airferry-lite/  
发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html  

工作副本：`C:\codex_project\airferry-lite`。默认分支 `main`。不要 force-push。

## 2. 人、机、测法

- 用户：**蓝**，软件工程师。直接改代码、看诊断、迭代。不要主动 commit/push，除非这次明确要求，或走本仓库「只测 Pages」的发布循环。
- 主力测试机：Xiaomi / 红米（M098FE, songyuan）· Android 16 · Chrome 151。相机 **0–60 FPS**，预览常为 **1440×1920 竖屏**。UA 经常是 `Android 10; K`。
- 电脑屏：**60 Hz**。不要在这台机上追 120 FPS 发送。四码必须 **四个码都进取景框**；拿太近只看见 1–2 格会明显掉速。
- 网页**只在 GitHub Pages 上测**，本地 `index.html` 没有摄像头 HTTPS。改接收端必须升 `RECEIVER_BUILD` / `index.html?v=` / `sw.js` 的 `CACHE_NAME`，同步 `web-receiver/`，跑 `npm test`，再推 `main`。
- 发送端 UI/布局改完跑 `node sender/build.mjs`，再推。不必升接收端版本。
- Node：仓库内 `.tools/node`（已 gitignore）。`github.com:443` 偶尔不通时用 `gh api` 写 blob/tree/commit/ref；**parent 必须是 GitHub 上当前 `main` SHA**。推完删临时脚本。等 Pages `built` 后核对线上 `app.js` 的 `RECEIVER_BUILD`。

## 3. 当前冻结面

| 部件 | 版本 | 对照 |
|---|---|---|
| 网页接收端 | **v85** | 预览可选手动 30/60 FPS（默认 60）。四码 33 ms · inflight 1；锁格后 Worker 切格 |
| Android APK | **0.8.23**（versionCode 38） | 红米窗口 · 相机 60。扫码路径同 0.8.18。杀后台后再进：约 1 s 仍无有效码则自动重开相机（等同清空）。**0.8.19 已否定** |
| 发送端 | AFL2 单文件 HTML | 打开单码预填 **2953 B · 30 FPS**；打开四码预填 **1465 B · 30 FPS**（整屏同换）；打开双码预填 **1732 B · 60 FPS**。QR 在 Worker 里生成。60 FPS 四码仍交错。无 45 FPS |

诊断第一行必须是 `网页：v85` 或 `App 0.8.23`。

## 4. 实测对照（只认这些）

电脑 **60 Hz**。同一台红米。第二次扫描（相机已稳）。

### 网页

发送 **2331 B · 30 FPS**。

| 布局 | 预览 | 对照 | 会话 |
|---|---|---|---|
| 单码 | 60 FPS | 必须保住 | **53.8 KB/s** |
| 四码 | 30 FPS · 全屏 | 33 ms · inflight 1 · 切格 | **43.3 KB/s** |

网页四码卡在分析约 15 FPS（1 帧在飞），不是卡在每帧只打中 1 个码。v74 每帧约 2.30。不要用更旧的网页数字当目标。

### APK 0.8.20 对照（0.8.23 仍认这些数）

相机 **60**。电脑 **60 Hz**。非全屏。解块完成。收完后诊断可能变成 ROI 全图 / 跟踪中（未命中累计），那是停播/挪开之后，不是中途掉锁。

60 Hz 上 V30 唯一载荷上限约 **201 KB/s**（`1712 × 120 唯一码/秒 / 1024`）。V27 仍是约 **169**。

| 发送 | 距离 | 采集 / 分析 | 每帧 | ROI | 唯一 / 重复 | 实时 / 平均 / 会话 |
|---|---|---|---|---|---|---|
| **1732 B · 60 FPS · 双码同刷** | 窗口 | 59.5 / 59.5 · 10.3 ms | **1.88** | 格 2 | 1449 / 267 | 201.7 / 200.7 / **190.4 KB/s** |
| 1465 B · 30 FPS · 四码整屏同换 | 窗口 | 59.1 / 59.1 · 7.3 ms | **2.94** | 格 4 | 2230 / 2421 | 162.9 / 166.6 / **168.9 KB/s** |
| 1465 B · 60 FPS · 双码同刷 | 窗口 | 59.9 / 59.9 · 10.2 ms | **1.90** | 格 2 | 1687 / 191 | 161.9 / 166.5 / **168.6 KB/s** |
| 1465 B · 60 FPS · 四码交错 | 窗口 | 59.9 / 59.9 · 16.6 ms | 1.93 | 收完跟踪中 | 1846 / 441 | 166.8 / 164.5 / **154.4 KB/s** |

0.8.22 杀后台再进会没速度，点清空并放远后能回到约 200 KB/s。0.8.23：冷启动约 1 s 仍无有效码则自动 `restartScanner`（重建 zxing + 重绑）；回前台也走这条，不只 `bindCamera`。看门狗把「绑上后从未出过诊断」也当卡住。扫描中不要因半速自动重绑。**不要再做 0.8.19**。双码必须走两格 `maxSymbols=1` 裁剪。

不要交错双码 60 FPS（约 84 KB/s）。不要 60 Hz 四码四格同刷。

### 四码旧对照（交错，已被 30 整屏同换替代）

| 发送 | 距离 | 采集 / 分析 | 每帧 | ROI | 唯一 / 重复 | 实时 / 平均 / 会话 |
|---|---|---|---|---|---|---|
| 30 FPS 交错 | 窗口常规 | 57.8 / 57.8 · 9.8 ms | 2.68 | 收完后全图 | 1188 / 784 | 163.5 / 166.1 / **152.8 KB/s** |
| 60 FPS 交错 | **拿远，四格都进框** | 58.8 / 58.8 · 11.2 ms | 1.92 | 格 3 | 1223 / 773 | 169.9 / 169.3 / **155.3 KB/s** |
| 60 FPS 交错 | 偏近 | 59.9 / 59.9 · 11.4 ms | 1.88 | 格 3 | 1234 / 1187 | 127.9 / 126.0 / 125.6 KB/s |

- 60 FPS 拿近掉到 125.6，是取景框装不下 2×2。
- 「唯一载荷」对应会话 KB/s；「光学」含重复和帧头。
- 0.8.8 峰值约 193 KB/s 高于当前 60 Hz V27 上限，不能当目标。
- 动手前红米 A/B：双码 1732·60 不能低于 **190.4 KB/s**；四码 1465·30 整屏同换不能低于 **168.9**；双码 1465·60 对照 **168.6**。久播双码不应掉到约 84。

### 怎么读诊断

- 网页「每帧」= 每次 WASM 打中的码数，不是相机帧数。
- 界面「平均」是近 3 秒滚动；会话平均含瞄准段。
- 理论光学载荷 = `(每码字节 − 20) × 码数 × FPS / 1024`。四码 1465 B · 30 FPS ≈ **169 KB/s**；LT 约 1.15× 后文件通量约 **147 KB/s**。1273 B · 30 则约为 147 / 128。

## 5. 发送端实现

源码：`sender/app.js`、`sender/styles.css`、`sender/template.html`。产物：`sender/dist/airferry-lite-sender.html`。改源码后必须 `node sender/build.mjs`。

1. `packFile`：≥768 B、MIME 不是已压缩格式、gzip 再省 ≥64 B 才压。界面「传输」格单独显示，不要塞进状态栏。
2. `LTEncoder` 按 `每帧数据 − 20` 切块。四码 `QUAD_MAX_FRAME_BYTES = 1465`（V27）。双码 `DUAL_FRAME_BYTES = 1732`（V30）。打开双码预填 **1732 B · 60 FPS**。每帧下拉：四码 1003 / 1273 / 1465，单码 1465 / 2331 / 2953，双码 1003 / 1273 / 1465 / 1732。帧率下拉：单码 20 / 24 / 30；四码另加 60 / 90 / 120（高刷）；双码 20 / 24 / 30 / 60。**不要 45 FPS**。`qr.make(4)` 必须钉死版本号（1465→27、1273→25、1732→30、2953→40），不要 `qrcode(0)` 从 1 扫到 N。双码 **`layoutCodes = 4`**，只占 2×2 上排。下排复制已实测否定。**不要把双码设成打开页面的默认布局**（默认仍是单码）。
3. `requestAnimationFrame` 按测得刷新率对齐整数 vsync。卡顿超过三个间隔就丢积压节拍。采样必须包含 240 Hz（约 4 ms），不要 `dt > 8 ms`。QR 图案在 **3 个 Worker** 里 `make(4)`，主线程只打包喷泉帧和 blit。Worker 失败则回退主线程。不要 `setTimeout`。
4. 60 Hz 上单码超过 30 FPS 拉回 30。四码 60 会提示改 30。双码 60 Hz 预填 60 FPS。
5. **整数倍模块：** `integerModuleScale` 取能放进 viewer 的最大整数设备像素/模块。CSS 不要 `96vmin` / `max-width:100%` 再拉糊。viewer 尺寸变化要 relayout。
6. **四码：** 30 FPS **整屏同换 4 格**（间隔 `vsyncsPerQr`）。APK 0.8.17 窗口收完：每帧 **2.94**，格 4，会话 **168.9 KB/s**。**60 FPS 仍交错换对角**（窗口 154.4，解码 16.6 ms，看门狗曾恢复 1 次），不要四格同刷。
7. **双码：** **60 FPS 必须两格同时更新**。1732·60 窗口收完会话 **190.4 KB/s**（实时 201.7，贴 V30 上限）。1465·60 对照 **168.6**。30 FPS 才交错一格。

画布：单码静区 2，四码/双码静区 4；窗口 `100dvh` + `overflow:hidden`。整数放大后四周留白正常。全屏只是模块更大。入口页接收 URL 小码静区 4，不要圆角裁定位点。

| 场景 | 参数 |
|---|---|
| 单码 | 2953 B · 30 FPS（60 Hz 预填；也可 2331 / 1465） |
| 四码 | 1465 B · 30 FPS（拿远四格都进框时 60 FPS 也可） |
| 双码 | **1732 B · 60 FPS**（60 Hz 预填；只占上排两格。1465 B 也可） |
| 远或不稳 | 单码 1465 B，或四码 1003 / 1273 B |

## 6. 网页接收端实现

根目录 `index.html` + `app.js` + `sw.js` 即 GitHub Pages。`web-receiver/` 必须 byte-identical（换行除外），改完跑 `node sync-receiver.mjs`。

高速路径：`requestVideoFrameCallback` → `scanWithHighSpeedWorkers`。Worker 忙则丢最新帧。页面加载预热 WASM，Stop 不要 terminate。Android 先 1 个 Worker，就绪后再起第 2 个。桌面最多 4 个。

### 单码（不要改这条取帧）

1. 未锁定：整幅 `createImageBitmap(video, 0, 0, vw, vh, { resize 960 })`。
2. WASM 锁 ROI。高速扫描不要对 `video` 做 `BarcodeDetector.detect`。
3. 锁定后：`createImageBitmap(video, x, y, widthSrc, heightSrc, { resize 720 })`。
4. 失败不要 `captureViaCanvas`，不要二次裁已拿到的 bitmap，不要给单码加 33 ms 间隔。

### 四码

1. 对 2×2 并集 **一次** `createImageBitmap(video, …, { resize 720 })`。不要页面线程 `getImageData`，不要每格读 video，不要 1440 atlas。
2. 未锁格：整张 720、`maxSymbols: 4`。已有 ≥2 格：Worker 按格 `maxSymbols: 1`。
3. `HIGH_QUAD_INFLIGHT = 1`，`HIGH_QUAD_GRAB_MS = 33`。预览可以 60 FPS，不要 16 ms 连抠。
4. `lockQuadSlots`：至少 2 个命中才锁；满 4 格后只 `followContainedQuadHits`。不要 `rebuildQuadFromHits`，不要一个四码命中把 ROI 缩成单码，不要用原生框 `inferMissing` 冻格。
5. 保留 `tileCenter`。格子存原始框，扫描时 `inflateRect` 一次。packed luma 只作 ImageBitmap 失败回退。

### 相机

- Android 预览界面选 30 或 60（默认 60）。不要 120，不要横屏 `1920×1440`。四码建议 30，单码建议 60。不要锁 `manual/none/single-shot` 对焦。不要强开 `focusMode: continuous`。
- 开始扫描若预览已死（1.5 s 无新帧），先 `closeCamera` 再 `getUserMedia`。扫描中开始按钮保持可点。不要自动 `closeCamera`。
- 假 `ended`：轨仍 live 且未 mute、video 在播且有帧时忽略。不要在 `ended` 上自动重试 getUserMedia。
- 停止：冻最后一帧到 `#cameraFreeze` 再清 `srcObject`。`finishing` 时不要清布局字段。
- SW：`claim` 即可。不要 `client.navigate`，不要 `controllerchange` 时 `reload`。WASM 第一次用再缓存。

## 7. Android APK 实现（0.8.23）

源码：`android-receiver/app/src/main/java/com/airferrylite/receiver/`。构建：`android-receiver/build-local.ps1` 或 GitHub Actions `Build Android receiver`。Java 17，SDK 35。`versionName 0.8.23` / `versionCode 38`。不要改解码选项（`tryHarder` / rotate / invert / downscale / `isPure`），除非明确要求动分析管线。

APK 比网页快，是因为同一帧 Y 平面上原生 zxing-cpp 能扫多个码，CameraX 丢旧帧，没有 `createImageBitmap` 整帧读回。网页不要搬 APK 的 midX/midY 重排。

- 分析流：**1920×1440** · `YUV_420_888` · `KEEP_ONLY_LATEST`。标题行 30/60/120 只改 AE 档。高速录像管道不能扫码。
- `NativeQrDecoder`：先拷 Y 平面再 `readYBuffer`，**rotation 0**。不要 `ImageProxy.read()`（会旋转）。`tryHarder` / rotate / invert / downscale 全关。先 `LOCAL_AVERAGE`，空再 `GLOBAL_HISTOGRAM`。`LumaScaler` 热路径不用。
- 帧头 `0x0d` / `0x0f` 或一帧 ≥2 个传输码 → 多码；否则单码 `maxSymbols = 1`。未确认前 `maxSymbols = 4`。
- 四码：已有格子则 4 路并行；锁满且本帧 ≥3 命中则返回，不再串行补扫。≥3 命中才 `tilesFromHits`。四码 1–2 命中只 `followContainedHits`。**已锁 ≤2 格且本帧 ≥2 命中则重排格子**。**已锁 ≥2 格却只命中 1 枚：整幅补扫；连续 3 帧不够则丢格**。不要双码整幅 `maxSymbols=4`（0.8.19 已否定）。空扫：无锁 2 次清；已锁 4 格要 6 次。
- 长时间开着会卡：解码超过 400 ms 或相机时间戳不涨或诊断心跳 >2 s，或绑上后从未出过诊断，看门狗重绑 CameraX 并重建 zxing 线程。切到后台会 `unbindAll`，回前台走 `restartScanner`（重建解码器）。冷启动约 1 s 仍无有效码则自动再走一次（杀后台后不用再点清空）。**「清空重收」会重绑相机**（5 s 冷却）。不要在扫描中因双码半速自动重绑。不要为了省电自动关分析流。
- 收完点「保存文件」，不要自动写盘。诊断 ROI 显示 `格 N`。进度只在内存。

## 8. 架构

```text
sender/                         浏览器发送：测刷新率、lookahead、画 QR
  dist/airferry-lite-sender.html  提交用的单文件产物
index.html + app.js + sw.js     GitHub Pages 网页接收端
web-receiver/                   根目录镜像，必须 byte-identical
android-receiver/               Kotlin + CameraX + zxing-cpp（0.8.23）
shared/ + highspeed-protocol.js AFL1 / AFL2
vendor/decimen/                 WASM Worker 与 zxing wasm
third_party/decimen-v0.3/       MIT 源，不要混入后续 AGPL Decimen
tests/                          npm test
```

## 9. 不要做

测试针在 `tests/receiver-safety.test.mjs`，不要为了新功能删掉，除非行为真的改了并有实测。

**网页单码**

- 不要 `track.clone()` / `MediaStreamTrackProcessor` / `new VideoFrame(video)` 当快路径。
- 不要整幅取帧再从 bitmap 裁 720；不要不带源矩形的 `createImageBitmap(video, { resize })`。
- 不要锁码后再在主线程裁一次；不要因框 ≥700 把单码全图压到 720。
- 不要给单码加 33 ms 间隔或把 Android inflight 打成 1。

**网页四码**

- 不要用 1 个命中替换整张 2×2；不要删 `tileCenter`。
- 不要每格 `createImageBitmap(video)`、1440 atlas、页面线程 `getImageData`、16 ms + inflight 2。
- 不要高速扫描时 `BarcodeDetector.detect(video)`；不要一个四码命中缩 ROI；不要原生框冻格；不要 `rebuildQuadFromHits`。
- 不要 1.5 s 看门狗自动关相机；不要 Stop 时 terminate Worker；不要升版删 `airferry-lite-wasm`。
- 网页不要搬 APK 的 ≥3 命中 mid 重排。

**APK / 发送 / 发布**

- 不要 `ImageProxy.read()`、不要高速录像接到 ImageAnalysis、不要 `LumaScaler` 回热路径。
- 不要锁 AF 为 manual/none；不要把四码分析流改成 30；不要 60 Hz 四码四格同刷。
- 不要 60 Hz 上四码 60 FPS **又拿太近**（1465 偏近会话 125.6；拿远四格都进框是 155.3）。
- 不要网页要 120 FPS 或横屏 1920×1440。不要 SW `navigate` / `reload`。不要 60 Hz 上 120 FPS 发送。
- 不要 commit `.env`、密钥、`.tools/`。不要改 git config，不要 `--force` 推 `main`。

## 10. 怎么改网页、怎么上线

1. 改根目录 `app.js` / `index.html` / `sw.js`（发送端改 `sender/` 再 `node sender/build.mjs`）。
2. 接收端升 `RECEIVER_BUILD`、标题、`CACHE_NAME`、`index.html` 的 `app.js?v=`、测试里的版本针。
3. `node sync-receiver.mjs`，`npm test`。
4. `git push origin HEAD`。GitHub 不通时对当前 `main` 做 tree 补丁。
5. Pages `built` 后拉 `app.js?v=N` 确认 `RECEIVER_BUILD`。标签页还显示旧版就手动刷新或清站点数据。

## 11. 已知缺口

1. 网页四码要到 100 KB/s，必须约 82 个唯一码/秒。当前约 43 KB/s。不要再 16 ms 连抠，不要为四码换 RaptorQ / AFL3。
2. AFL2 进度只在内存。IndexedDB 只服务 AFL1。文件上限 64 MiB。

## 12. 画布未做的优化

来源：2026-08-21 Cursor 画布 `apk-sender-speed-levers`（未进 git）。已落地：整数放大、交错换对角、1–2 命中跟格、锁满后跳过补扫、Worker 生成、双码 **1732·60**（190.4）、四码 **1465·30 整屏同换**（168.9）。下面不要当回归清单自动执行。

不要做（实测否定）：四码分析改 30；60 Hz 四码 60 FPS **拿太近**（125.6）；**60 Hz 四码四格同刷**；**60 Hz 双码 60 FPS 交错一格**（约 84 KB/s）；**双码整幅 maxSymbols=4**（0.8.19：1732 每帧 0.01）。

仍不必做：

- **四码 60 整屏同换**：60 FPS 交错已经 16.6 ms 解码、会话 154。
- **`isPure=true` / 锁 AE·AWB**：静区不够会 0 命中；红米 CameraX 重绑过脆。
- **Brotli**：不抬会话 KB/s；APK 仍只认 gzip。
- **RaptorQ**：光学已近 V30 上限，换 FEC 不涨会话 KB/s。

| 优先级 | 侧 | 改动 | 注意 |
|---|---|---|---|
| P2 | 发送端 | gzip+Brotli 选更小 | 离线（`scripts/compare-brotli.mjs`，quality 6）：README 比 gzip 再小 14%、JS 5%、重复文本 56%；随机字节 gzip 都跳过。APK 仍只认 gzip。未进协议 |
| P2 | APK | 锁格后只锁 AE/AWB | 必须能丢锁 |
| P2 | APK | 格子贴紧后 `isPure=true` | 静区不够会 0 命中 |
| P2 | 发送端 | QR 生成进 Worker | **已落地。** 3 个 Worker + 主线程回退。缓存 256。为 1732·60 解开发送瓶颈 |
| P2 | 发送端 | 双码 1732·60 | **已落地。** 每帧 1.88，实时 201.7，会话 **190.4 KB/s**。打开双码预填 1732·60 |
| P2 | 发送端 | 四码 30 整屏同换 | **已落地。** 每帧 2.94，格 4，会话 **168.9 KB/s**。60 FPS 仍交错（154.4） |
| P2 | 发送端 | 双码 1465·60 | **已落地。** 每帧 1.90，会话 **168.6 KB/s**。久播约 84 是跟丢一格；不要再用整幅 maxSymbols=4 修 |
| P3 | 协议 | LT → RaptorQ（MIT/Apache） | 不要 AGPL Decimen；现在不是瓶颈 |

## 13. 许可证

MIT。第三方见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。只使用 Decimen **v0.3.0 MIT**。后来的 AGPL Decimen（RaptorQ / 官方四码）不能直接搬。
