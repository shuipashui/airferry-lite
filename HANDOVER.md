# AirFerry Lite 工程交接

本文给后续接手的人：当前能跑什么、什么不能动、哪些路已经烧死、网页怎么发到 GitHub Pages。用户向文档见 [README.md](README.md)。

**交接时点：** 2026-08-20。网页接收端当前 **v58**。单码必须全图 ImageBitmap、扫描 1440；锁 ROI 再裁 `createImageBitmap` 会在这台红米上把采集从 60 掉到约 12。四码仍裁四个窗口。Android APK 冻结 **0.8.12**。

## 1. 项目一句话

电脑浏览器把文件打成连续 QR，手机摄像头扫回来，无服务器。当前发送走 **AFL2**（Decimen v0.3 MIT：二进制帧 + LT 喷泉码）。网页和 APK 都能收；旧 **AFL1** 文本流只作兼容。

仓库：https://github.com/shuipashui/airferry-lite  
网页接收：https://shuipashui.github.io/airferry-lite/  
发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html  

本地路径：`C:\Users\UU\airferry-lite`。默认分支 `main`。不要 force-push。

## 2. 人、机、测法

- 用户：**蓝**，软件工程师。直接改代码、看诊断、迭代。不要主动 commit/push，除非这次这样明确要求，或本仓库「用户只测 Pages」的发布循环。
- 主力测试机：Xiaomi M098FE / 红米 · Android 16 · Chrome 151。相机 **0–60 FPS**，预览常为 **1440×1920 竖屏**。UA 经常是 `Android 10; K`。
- 电脑屏：**60 Hz**。不要在这台机上追 120 FPS 发送。
- 网页用户**只在 GitHub Pages 上测**，本地 `index.html` 没有摄像头 HTTPS。每改一版必须升 `RECEIVER_BUILD` / `index.html?v=` / `sw.js` 缓存名，同步 `web-receiver/`，跑 `npm test`，再推 `main`。
- Node：仓库内 `.tools/node`（已 gitignore）。`github.com:443` 经常不通，改用 `gh api` 写 blob/tree/commit/ref；**parent 必须是 GitHub 上当前 `main` SHA**，不是本地 `origin/main`。推完删 `.git/push-via-api.mjs`。等 Pages `built` 后核对线上 `app.js` 的 `RECEIVER_BUILD`。

## 3. 当前冻结面

| 部件 | 版本 | 状态 |
|---|---|---|
| 网页接收端 | **v58** | 单码全图 ImageBitmap（不裁 ROI）。四码仍是 v53 冻结格子。SW `client.navigate` 强制换版 |
| Android APK | **0.8.12**（versionCode 27） | 未经明确要求不要改。峰值是 **0.8.8：60 Hz 四码约 193 KB/s** |
| 发送端 | AFL2，单文件 HTML | 60 Hz 上单码超过 30 FPS 会拉回 30；四码每码上限 **1273 B** |

v54（2026-08-20）尝试「≥3 命中重排 2×2 + 格子内跟随」以提高四码每帧命中，已按要求整版回退。不要在没新证据时再合回去。

**v56/v57** 命中后裁 ROI 再 `createImageBitmap(video, x, y, w, h)`：开始全图约 60 KB/s，锁 ROI 后采集掉到约 12、解码约 69 ms、实时约 27。这台 Chrome 裁切取帧很慢，4 个 Worker 闲着（忙时丢弃 1）。**v58** 单码改回 v43/v55 的做法：始终全图、不裁切、扫描 1440，靠 4 个 Worker 消化约 50 ms 解码。四码窗口裁切不走这条 ImageBitmap 路径。

## 4. 实测基线（请当回归标准）

发送参数除非另写：**2331 B · 30 FPS**。电脑 **60 Hz**。

### 网页 v53 · 四码（回退前最后一组好数）

- 采集 **58.8** · 分析 113.7 · 有效码 **42.2 FPS**
- AFL2 zxing-cpp Y · 平均 **9.0 ms** · 扫描 369 · 四码 · ROI · **格 4** · **每帧 0.31**
- 忙时丢弃 940 · 连续未识别 0
- 识别 1212 · 唯一 1207 · 重复 5 · 序列跳跃 3592 · 解块 657/1695
- 实时 **56.1** · 平均 **48.7** · 会话 **38.0 KB/s** · 流 `…:1253:…:4:1`

单码回归标准：ImageBitmap **全图不裁切**、扫描 **1440**、采集约 60、实时约 **60 KB/s**（v55 那组：采集 57.9、有效 25、实时 64.6）。v56/v57 锁 ROI 后采集 12 不是回归标准。v53 全图压到 720 也不是。

### 网页诊断里的「每帧」

`sessionValidCodes / sessionDecodedFrames`。四码一帧相机会派 **4 个 Worker 任务**，所以 0.31 ≈ 每相机帧打中 **1.2** 个码，不是 0.31 个。APK 的「每帧」是每相机帧的码数（0.8.x 四码大约 2.6–3+）。不要靠改分母把网页「每帧」做漂亮。

会话平均低于实时，是因为锁格 4 之前的瞄准段也算进去。

### APK（历史，0.8.8 峰值）

同一台红米、CameraX 分析流约 60 FPS。0.8.8 四码曾到约 193 KB/s。0.8.12 冻结后不要为了网页去改 APK。

## 5. 架构

```text
sender/                         浏览器发送：测刷新率、lookahead、画 QR
  dist/airferry-lite-sender.html  提交用的单文件产物，CI 要求可复现
index.html + app.js + sw.js     GitHub Pages 网页接收端（根目录即线上）
web-receiver/                   根目录接收端文件的镜像，必须 byte-identical（换行除外 sw）
android-receiver/               Kotlin + CameraX + zxing-cpp
shared/ + highspeed-protocol.js AFL1 / AFL2
vendor/decimen/                 WASM Worker 与 zxing wasm
third_party/decimen-v0.3/       MIT 源，不要混入后续 AGPL Decimen
tests/                          npm test 串起来的协议/安全/运行时针
```

网页高速路径：`requestVideoFrameCallback` → `scanWithHighSpeedWorkers`。单码走 `getHighSpeedSource` + `createImageBitmap`；四码走 `decodeQuadFrame`（一张打包 bitmap，四个窗口）。Worker 忙则丢最新帧，不排队。

`sync-receiver.mjs` 把根目录接收端文件拷进 `web-receiver/`。改完必跑。

## 6. 硬约束（违反过就会立刻掉速或黑屏）

### 单码（ImageBitmap 全图，不要裁切）

- 不要动 `postHighSpeedRegion` 的 ImageBitmap 路径。单码用 `createImageBitmap(video, { resize... })` **不带 x,y,w,h**。
- `useLuma = highMultiLayout && size <= HIGH_TILE_SIZE+16`。单码不要走四码的 VideoFrame/Y。
- `getHighSpeedSource()` 始终 `fullFrameSource()`。命中后不要改去裁 ROI——这台红米上裁切取帧会把采集从 60 掉到约 12。
- 不要切竖屏中心方块。
- **不要** `if (lastHitBox >= 700) return 720`。
- 不要 `probeMulti`，不要把一张单码切成四象限。
- 诊断第一行必须是 `网页：vN`。index.html 的 `app.js?v=` 必须一起升。

### 四码

- 不要用 1 个命中去替换整张 2×2（v52 格 1）。`lockQuadSlots` 必须 `fresh.length < 2` 直接 return。
- **保留 `function tileCenter`**。v50 删掉后，`inferMissingQuadTiles` 在格 1 时对 `undefined` 取中心，解不出来、卡死格 1。
- 不要 nearest-neighbor **nudge**（v50：邻码被拽进自己的槽）。
- 不要把 pad 存进格子再扫时再 pad 一次（v48：扫描区胀到 720）。存原始框，只在扫描时 `inflateRect(..., HIGH_TILE_PAD)` 一次。
- 不要 `dueRelock` / `HIGH_MULTI_FULL_DECODE_EVERY`（v45：重叠象限扫整 ROI，峰值 70 然后掉到 20）。
- 格 4 之后不要再跑全图 `BarcodeDetector`（v46：解码 16→61 ms，采集 39→15）。
- 不要一边昂贵 `VideoFrame.copyTo`+RGBA→Y，一边 WASM 解码。
- 不要每布局 `createImageBitmap(video)` 三次，会堵住 rVFC。
- 不要按相机中线切 2×2（码不在画面正中）。
- 不要先把整幅 2×2 缩到 720 再切（v31：V22 只剩约 200 px）。
- 不要把并排两个码当成完整 2×2（v37）。
- v39：在布局未确认前不要 `highMultiLayout || !highSingleConfirmed` 就 `decodeQuadFrame()`。

### 相机 / Android 网页

- **不要**对 Android `getUserMedia` 要 120 FPS（非 Android 可以试，失败再 60）。
- **不要**在 Android UA 上 `focusMode: continuous`（v38 会把 track ended）。
- **不要**页面隐藏时自动停摄像头。
- **不要**在 `ended` 上自动重试 getUserMedia。
- 这台机 120/240/480 是高速录像管道，不能给 ImageAnalysis / 网页分析流。

### Git / 协议文件

- `protocol.js` 等若只有 CRLF 脏改，不要提交。
- 不要改 git config，不要 `--force` 推 `main`。
- 不要 commit `.env`、密钥、`.tools/`。

## 7. 网页 v58 四码 / 单码实际在做什么

- 采集：`grabBitmapPacked`，一张 `createImageBitmap`，最大 `HIGH_QUAD_PACKED_SIZE` 720，画在 **`quadPackCanvas`** 上（不是 `#scanCanvas`）。
- 调度：`highGrabInFlight || highWorkerBusy.some(Boolean)` 就丢帧。不和 WASM 重叠抓帧。
- 锁定：`BarcodeDetector` 仅在 `locked < 4` 且间隔 `HIGH_QUAD_ACQUIRE_MS`（100 ms）。格 4 后停止。
- 冻结：4 个槽填满后 `highQuadFrozen`，之后**不再**用命中去 merge 格子。空窗 miss：冻结 24，未冻结 6。
- 扫描 pad：`HIGH_TILE_PAD = 1.35`，只在 decode 时 inflate。
- 单码：`nextHighScanJobs` 只有 `getHighSpeedSource()` / `tile: false`。始终全图、扫描 1440、`createImageBitmap(video)` 不带裁切。四码不走这条。

四码剩余缺口：冻结窗口不跟手抖，每帧约 0.31。下一步若还做四码，优先「只加大冻结后扫描边距、存的框不动」；不要再 nearest-neighbor。v54 那套重建网格已经回退。单码不要再加 `lastHitBox >= 700` 的 720 帽，也不要命中后再裁 ROI 取帧。

## 8. 发送端要点

- 默认 2331 B · 30 FPS · 单码。
- 四码每码 `QUAD_MAX_FRAME_BYTES = 1273`（QR V25）；选 2331 不会让四码变 V34。
- 60 Hz + 四码 60 FPS 容易拖影，界面会提示改 30 FPS。
- vsync 对齐已修（含 240 Hz）。不要再把 `dt > 8 ms` 当采样。

## 9. 怎么改网页、怎么上线

1. 改根目录 `app.js` / `index.html` / `sw.js`。
2. 升 `RECEIVER_BUILD`、标题、`CACHE_NAME`、**`index.html` 里 `app.js?v=`**、`tests/receiver-safety.test.mjs` 里的版本针。不要再用 `sessionStorage === RECEIVER_BUILD` 跳过刷新。
3. `node sync-receiver.mjs`（或 `npm run build:receiver`）。
4. `$env:Path = "C:\Users\UU\airferry-lite\.tools\node;" + $env:Path; npm test`
5. 用户要求发布时再 commit。推送：对 GitHub 当前 `main` 做 tree 补丁（见历史 `.git/push-via-api.mjs` 写法），**不要**假设本地 `origin/main` 等于 GitHub。
6. `gh api repos/shuipashui/airferry-lite/pages/builds` 等到 `built`。
7. 拉 `https://shuipashui.github.io/airferry-lite/app.js?v=N` 确认 `RECEIVER_BUILD`。

测试针（`tests/receiver-safety.test.mjs`）是防止回潮的合同，不要为了新功能删掉「禁止 probeMulti / dueRelock / HIGH_QUAD_TRACK_MS」这类断言，除非行为真的改了并有实测。

## 10. Android

- 构建：`android-receiver/build-local.ps1`，Java 17，SDK 35。
- 分析流目标 1920×1440、最新帧。四码：`ScanLayout.tilesFromHits` 在 **≥3** 个命中时按 midX/midY 排序重建；少于 2 个才清格子。这是 APK 每帧能到 2.6+ 的原因，网页还没稳稳做到。
- 不要为网页实验去改 0.8.12。

## 11. 已知缺口（按优先级）

1. **网页四码每帧命中**（0.31 vs APK ~2.7）。这是网页吞吐离 APK 最远的地方。单码保持全图 1440 ImageBitmap。
2. 会话平均被瞄准段拉低；锁格 4 之前偏慢。
3. AFL2 进度只在内存，刷新即丢。IndexedDB 只服务 AFL1。
4. 文件上限 64 MiB。
5. 本地 `origin/main` 和 GitHub `main` 的 SHA 经常对不齐（API 推送），但 tree 应一致。以 GitHub API 的 ref 为准。

## 12. 不要做的「优化」清单（摘要）

`dueRelock`、全图 BarcodeDetector 跟踪、YUV `copyTo` 当快路径、四次 `createImageBitmap`、双倍 pad、nudge、probeMulti、删 `tileCenter`、1 个命中锁格、Android 连续对焦、Android 120 FPS 请求、visibility 停相机、120 FPS 发送（60 Hz 屏）、单码全图因 `lastHitBox >= 700` 压到 720、单码命中后裁 ROI 再 `createImageBitmap(video, x, y, w, h)`。

## 13. 许可证

MIT。第三方见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。只使用 Decimen **v0.3.0 MIT**。后来的 AGPL Decimen（RaptorQ / 官方四码）不能直接搬。

---

交接时网页应为 **v58**，APK **0.8.12**。单码应看到 **全图**、扫描 **1440**、采集 **50+**、实时约 **60 KB/s**。诊断必须是 `网页：v58`。四码先保住格 4 的峰值，再谈每帧。
