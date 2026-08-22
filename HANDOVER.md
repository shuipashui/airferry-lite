# AirFerry Lite 工程交接

给后续接手的人：当前怎么跑、发送/接收怎么实现、对照速度、哪些路不能再走、怎么发到 GitHub Pages。

对外说明只写 [README.md](README.md)。不要在 README 里放版本号、实测 KB/s、Worker / VideoFrame 细节或本文链接。

**交接时点：** 2026-08-22。网页接收端 **v86**。Android APK **0.8.54**。给蓝只发 Artifacts 直链。**0.8.43 冻结：** 首次 234.6、继续 238.4、强杀 236.2。**0.8.44–0.8.46 已否。** 发送端双码仍是 2×2 上排，帧头 **`layoutCodes=2`**，下排白底。**0.8.52 已否：** `dualHint` 后空帧也串行补扫 → 空白后首次 20.6 ms / 5 KB/s。**0.8.53 已否：** 未锁时 1 枚 `0x1c` 就 `acquireDualSibling` 串行八路 → 空白后首次 16.4 ms / 35 FPS / 38 KB/s，布局一直单码。**0.8.54：** 未锁只便宜 max4 + 并行半幅；同一帧 2 命中才锁双码。不要 onStop unbind。不要看门狗 unbind。

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
- Node：仓库内 `.tools/node`（已 gitignore）。`github.com:443` 偶尔不通时用 `gh api` 写 blob/tree/commit/ref；**parent 必须是 GitHub 上当前分支 SHA**。推完删临时脚本。等 Pages `built` 后核对线上 `app.js` 的 `RECEIVER_BUILD`。
- **出 APK：** 推 `android-receiver/**` 触发 `Build Android receiver`。等 run 成功后只发链接，并写清怎么点：打开该 run → 拉到最底下 **Artifacts** → 点 `airferry-lite-android-debug` 下载 zip → 解压得到 apk。需要登录 GitHub。直链格式：`https://github.com/shuipashui/airferry-lite/actions/runs/<runId>/artifacts/<artifactId>`（`gh api repos/shuipashui/airferry-lite/actions/runs/<runId>/artifacts` 取 id）。不要写 `android-receiver/dist/`。

## 3. 当前冻结面

| 部件 | 版本 | 对照 |
|---|---|---|
| 网页接收端 | **v86** | 预览可选手动 30/60 FPS（默认 60）。四码 33 ms · inflight 1；锁格后 Worker 切格。识别 `layoutCodes=2` |
| Android APK | **0.8.54**（versionCode 69） | 未锁双码不串行追兄妹。0.8.53 1-hit hunt 已否。0.8.43 满速仍要保住 |
| 发送端 | AFL2 单文件 HTML | 打开单码预填 **2953 B · 30 FPS**；打开四码预填 **1465 B · 30 FPS**（整屏同换）；打开双码预填 **2068 B · 60 FPS**（V33）。QR 在 4 个 Worker 里生成。60 FPS 四码仍交错。无 45 FPS |

诊断第一行必须是 `网页：v86` 或 `App 0.8.54`。

## 4. 实测对照（只认这些）

电脑 **60 Hz**。同一台红米。第二次扫描（相机已稳）。

### 网页

发送 **2331 B · 30 FPS**。

| 布局 | 预览 | 对照 | 会话 |
|---|---|---|---|
| 单码 | 60 FPS | 必须保住 | **53.8 KB/s** |
| 四码 | 30 FPS · 全屏 | 33 ms · inflight 1 · 切格 | **43.3 KB/s** |

网页四码卡在分析约 15 FPS（1 帧在飞），不是卡在每帧只打中 1 个码。v74 每帧约 2.30。不要用更旧的网页数字当目标。

### APK

相机 **60**。电脑 **60 Hz**。非全屏。解块完成。收完后诊断可能变成 ROI 全图 / 跟踪中（未命中累计），那是停播/挪开之后，不是中途掉锁。

60 Hz 上 V33 唯一载荷上限约 **240 KB/s**（`2048 × 120 唯一码/秒 / 1024`）。V32 约 **226**，V30 约 **201**，V27 约 **169**。

| 发送 | 距离 | 采集 / 分析 | 每帧 | ROI | 唯一 / 重复 | 实时 / 平均 / 会话 |
|---|---|---|---|---|---|---|
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.53 空白后首次 | 35.0 / 35.0 · 16.4 ms | **0.00**（多码命中 0；约 1 码/命中帧） | 跟踪中 · 单码 | 590 / 0 | 48.5 / 46.9 / **38.0 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.47 第 1 次（偏远） | 43.9 / 43.9 · 19.9 ms | **1.40** | 格 2 | 1288 / 6 | 141.0 / 134.3 / **135.4 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.47 第 2 次 | 60.3 / 60.3 · 17.1 ms | **1.57** | 格 2 | 1239 / 11 | 240.4 / 241.0 / **154.6 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.47 第 3 次（放近） | 59.9 / 59.9 · 14.3 ms | **1.69** | 格 2 | 1220 / 8 | 242.1 / 212.8 / **205.3 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.47 第 4 次 | 58.5 / 58.5 · 13.7 ms | **1.17** | 格 2 | 875 / 0 | 235.3 / 237.6 / **149.5 KB/s**（解块 38/1037） |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.46 对角首次 | 43.0 / 43.0 · 18.0 ms | **0.88** | 格 2 | 1255 / 3 | 81.5 / 85.3 / **95.5 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.45 首次 / 杀进程重开 | 60.0 / 60.0 · 6.3 ms | **0.00** | 全图 · 单码 | 0 / 0 | 会话 **0 B/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.44 首次开 APK | 25.9 / 25.9 · 19.3 ms | **0.27** | 全图 | 483 / 0 | 19.9 / 7.8 / **29.7 KB/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.43 首次开 APK | 60.0 / 60.0 · 10.1 ms | **1.22**（空 397；有效约 1.99） | 格 2 | 1338 / 8 | 238.1 / 240.0 / **234.6 KB/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.43 继续接收 | 59.9 / 59.9 · 10.8 ms | **2.00** | 格 2 | 1209 / 8 | 231.8 / 234.9 / **238.4 KB/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.43 杀进程重开 | 59.5 / 59.5 · 11.1 ms | **1.96** | 格 2 | 1049 / 0 | 235.5 / 231.6 / **236.2 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.43 清空重收 | 26.5 / 26.5 · 27.1 ms | **0.02** | 跟踪中 | 9 / 0 | 5.4 / 3.3 / **1.9 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.43 清空后再杀 | 58.3 / 58.3 · 20.3 ms | **0.26** | 全图 | 144 / 0 | 25.6 / 30.2 / **38.5 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.42 首次开 APK | 58.2 / 58.2 · 11.7 ms | **0.81** | 全图 | 1321 / 5 | 115.2 / 118.8 / **102.8 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.42 继续接收 | 50.0 / 50.0 · 16.5 ms | **0.98** | 格 2 | 1186 / 3 | 121.8 / 117.6 / **101.4 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.42 杀进程重开 | 40.3 / 40.3 · 16.1 ms | **1.02** | 格 2 | 326 / 0 | 121.9 / 108.3 / **110.8 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.42 清空重收 | 60.2 / 60.2 · 13.5 ms · 看门狗 1 | **1.33** | 格 2 | 1212 / 7 | 239.8 / 240.5 / **151.8 KB/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.41 强杀后重开 | 59.6 / 59.6 · 10.9 ms | **1.95** | 格 2 | 1212 / 6 | 239.8 / 238.8 / **238.8 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.41 首次开 APK | 59.8 / 59.8 · 7.1 ms | **0.00** | 全图 · 单码 | 0 / 0 | 会话 **0 B/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.41 立刻继续接收 | 45.1 / 45.1 · 18.9 ms | **0.03** | 全图 | 15 / 0 | 8.3 / 4.7 / **6.1 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.40 首次 | 55.0 / 55.0 · 13.2 ms | **0.63** | 全图 | 1237 / 2 | 23.1 / 42.6 / **85.9 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.40 继续接收 | 40.1 / 40.1 · 18.6 ms | **0.31** | 格 2 | 322 / 0 | 80.2 / 82.6 / **37.7 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.40 杀进程重开 | 60.1 / 60.1 · 7.4 ms | **0.00** | 全图 · 单码 | 0 / 0 | 会话 **0 B/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.40 清空重收 | 60.0 / 60.0 · 8.0 ms | **0.00** | 全图 · 单码 | 0 / 0 | 会话 **0 B/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.39 杀进程重开 | 59.9 / 59.9 · 5.5 ms | **0.00** | 全图 · 单码 | 0 / 0 | 会话 **0 B/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.38 首次开 APK | 60.1 / 60.1 · 11.7 ms | **1.46** | 格 2 | 1360 / 7 | 238.7 / 239.3 / **238.1 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.38 继续接收 | 45.3 / 45.3 · 17.7 ms | **0.05** | 全图 | 47 / 0 | 24.0 / 21.4 / **20.1 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.38 杀进程重开 | 59.2 / 59.2 · 11.6 ms | **1.92** | 格 2 | 808 / 0 | 236.2 / 236.0 / **233.5 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.38 清空重收 | 51.0 / 51.0 · 17.6 ms · 看门狗 1 | **0.95** | 全图 | 471 / 0 | 91.8 / 96.4 / **98.6 KB/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.24 首次 | 60.2 / 60.2 · 11.8 ms | **1.94** | 格 2 | 1375 / 121 | 238.0 / 239.8 / **240.0 KB/s** |
| **2068 B · 60 FPS · 双码同刷** | 窗口 · 0.8.26 第 1 次 | 59.9 / **1.0** · 12.0 ms | **1.73** | 格 2 | 1319 / 4 | 241.8 / 238.8 / **233.9 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.26 第 3 次 | 59.0 / 45.0 · 9.9 ms | **1.85** · 看门狗 3 | 格 2 | 1212 / 9 | 238.3 / 238.5 / **226.2 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.26 第 2/4/5 次清空 | 60 · 8–9 ms | **0.00** · 看门狗 2→5 | 全图 | 900→0 | 会话 **45.4 / 24.4 / 0** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.25 | 60.2 / 60.2 · 10.2 ms | **1.87** · 看门狗 1 | 格 2 | 1173 / 172 | 239.3 / 240.2 / **238.6 KB/s** |
| 2068 B · 60 FPS · 双码同刷 | 窗口 · 0.8.25 再扫 | 57.7–60.2 · 11.7–13.0 ms | **0.81–1.00** | 收完全图 | — | 会话 **98.0 / 120.2 KB/s** |
| **1952 B · 60 FPS · 双码同刷** | 窗口 | 59.9 / 59.9 · 11.2 ms | 1.03（含瞄准；空结果 680，有效约 1.96） | 格 2 | 1507 / 23 | 226.1 / 226.4 / **219.9 KB/s** |
| 1732 B · 60 FPS · 双码同刷 | 窗口 | 59.5 / 59.5 · 10.3 ms | **1.88** | 格 2 | 1449 / 267 | 201.7 / 200.7 / **190.4 KB/s** |
| 1465 B · 30 FPS · 四码整屏同换 | 窗口 | 59.1 / 59.1 · 7.3 ms | **2.94** | 格 4 | 2230 / 2421 | 162.9 / 166.6 / **168.9 KB/s** |
| 1465 B · 60 FPS · 双码同刷 | 窗口 | 59.9 / 59.9 · 10.2 ms | **1.90** | 格 2 | 1687 / 191 | 161.9 / 166.5 / **168.6 KB/s** |
| 1465 B · 60 FPS · 四码交错 | 窗口 | 59.9 / 59.9 · 16.6 ms | 1.93 | 收完跟踪中 | 1846 / 441 | 166.8 / 164.5 / **154.4 KB/s** |

双码只扫到一枚时会话约为上限的一半（2068 约 **98–120**，1732 约 **84**）。**0.8.42 四步都能收完**，但首次/继续/杀进程会话卡在约 **100**（每帧 ~1，半速）；清空实时曾 **240**、会话 151.8（看门狗 1 次拖了前半段）。0.8.26 连扫：第 1、3 次满速，第 2、4、5 次清空后看门狗恢复次数累加并把相机打残。收完诊断里「分析 1.0 FPS」是停分析，不是掉速。**0.8.27：清空只 `resetSession`，不杀解码线程；解码超时不 `skipUntilRecover`、不重绑；心跳死了才 `unbindAll`。** 0.8.43 起看门狗不再 unbind。

### 四码旧对照（交错，已被 30 整屏同换替代）

| 发送 | 距离 | 采集 / 分析 | 每帧 | ROI | 唯一 / 重复 | 实时 / 平均 / 会话 |
|---|---|---|---|---|---|---|
| 30 FPS 交错 | 窗口常规 | 57.8 / 57.8 · 9.8 ms | 2.68 | 收完后全图 | 1188 / 784 | 163.5 / 166.1 / **152.8 KB/s** |
| 60 FPS 交错 | **拿远，四格都进框** | 58.8 / 58.8 · 11.2 ms | 1.92 | 格 3 | 1223 / 773 | 169.9 / 169.3 / **155.3 KB/s** |
| 60 FPS 交错 | 偏近 | 59.9 / 59.9 · 11.4 ms | 1.88 | 格 3 | 1234 / 1187 | 127.9 / 126.0 / 125.6 KB/s |

- 60 FPS 拿近掉到 125.6，是取景框装不下 2×2。
- 「唯一载荷」对应会话 KB/s；「光学」含重复和帧头。
- 0.8.8 峰值约 193 KB/s 高于当前 60 Hz V27 上限，不能当目标。
- 动手前红米 A/B：双码 2068·60 **首次 / 继续 / 强杀**不能低于 **234.6 / 238.4 / 236.2**。清空重收不应掉到 26 FPS / 0.02 命中。1952·60 不能低于 **219.9**；1732·60 不能低于 **190.4**。

### 怎么读诊断

- 网页「每帧」= 每次 WASM 打中的码数，不是相机帧数。
- 界面「平均」是近 3 秒滚动；会话平均含瞄准段。
- 理论光学载荷 = `(每码字节 − 20) × 码数 × FPS / 1024`。双码 2068 B · 60 FPS ≈ **240 KB/s**；1952·60 ≈ **226**；1732·60 ≈ **201**；四码 1465 B · 30 FPS ≈ **169 KB/s**。LT 约 1.15× 后文件通量再打折。

## 5. 发送端实现

源码：`sender/app.js`、`sender/styles.css`、`sender/template.html`。产物：`sender/dist/airferry-lite-sender.html`。改源码后必须 `node sender/build.mjs`。

1. `packFile`：≥768 B、MIME 不是已压缩格式、gzip 再省 ≥64 B 才压。界面「传输」格单独显示，不要塞进状态栏。
2. `LTEncoder` 按 `每帧数据 − 20` 切块。四码 `QUAD_MAX_FRAME_BYTES = 1465`（V27）。双码 `DUAL_FRAME_BYTES = 2068`（V33）。打开双码预填 **2068 B · 60 FPS**。每帧下拉：四码 1003 / 1273 / 1465，单码 1465 / 2331 / 2953，双码 1003 / 1273 / 1465 / 1732 / 1952 / 2068。帧率下拉：单码 20 / 24 / 30；四码另加 60 / 90 / 120（高刷）；双码 20 / 24 / 30 / 60。**不要 45 FPS**。`qr.make(4)` 必须钉死版本号（1465→27、1273→25、1732→30、1952→32、2068→33、2953→40），不要 `qrcode(0)` 从 1 扫到 N。双码 **`layoutCodes = 2`（magic 0x1c / systematic 0x1d）**，只占 2×2 **上排**（`DUAL_SLOTS = [0, 1]`）。下排保持白底。下排深色块 0.8.50 已否（继续 0 命中、杀掉半速）。不要下排复制 QR、不要对角。并排 2×1 / 按 1003 B 对齐已撤回。**不要把双码设成打开页面的默认布局**（默认仍是单码）。旧 APK 0.8.49 及更早不认 0x1c。
3. `requestAnimationFrame` 按测得刷新率对齐整数 vsync。卡顿超过三个间隔就丢积压节拍。采样必须包含 240 Hz（约 4 ms），不要 `dt > 8 ms`。QR 图案在 **4 个 Worker** 里 `make(4)`，主线程只打包喷泉帧和 blit。Worker 失败则回退主线程。不要 `setTimeout`。
4. 60 Hz 上单码超过 30 FPS 拉回 30。四码 60 会提示改 30。双码 60 Hz 预填 60 FPS。
5. **整数倍模块：** `integerModuleScale` 取能放进 viewer 的最大整数设备像素/模块。CSS 不要 `96vmin` / `max-width:100%` 再拉糊。viewer 尺寸变化要 relayout。
6. **四码：** 30 FPS **整屏同换 4 格**（间隔 `vsyncsPerQr`）。APK 0.8.17 窗口收完：每帧 **2.94**，格 4，会话 **168.9 KB/s**。**60 FPS 仍交错换对角**（窗口 154.4，解码 16.6 ms，看门狗曾恢复 1 次），不要四格同刷。
7. **双码：** **60 FPS 必须两格同时更新**。发送画在 2×2 **上排**，下排留白。不要对角。不要 60 FPS 交错只换一格。不要并排 2×1 / 按 1003 B 把格子放大（已撤回）。不要下排再放一枚可解码 QR，不要下排深色块（0.8.50 已否）。2068·60 对照仍以 0.8.43 首次 **234.6** / 继续 **238.4** / 强杀 **236.2** 为准。

画布：单码静区 2，四码/双码静区 4；窗口 `100dvh` + `overflow:hidden`。整数放大后四周留白正常。全屏只是模块更大。入口页接收 URL 小码静区 4，不要圆角裁定位点。

| 场景 | 参数 |
|---|---|
| 单码 | 2953 B · 30 FPS（60 Hz 预填；也可 2331 / 1465） |
| 四码 | 1465 B · 30 FPS（拿远四格都进框时 60 FPS 也可） |
| 双码 | **2068 B · 60 FPS**（60 Hz 预填；1952 B 也可） |
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

## 7. Android APK 实现（0.8.54）

源码：`android-receiver/app/src/main/java/com/airferrylite/receiver/`。构建：`android-receiver/build-local.ps1` 或 GitHub Actions `Build Android receiver`。Java 17，SDK 35。`versionName 0.8.54` / `versionCode 69`。不要改解码选项（`tryHarder` / rotate / invert / downscale / `isPure`），除非明确要求动分析管线。

APK 比网页快，是因为同一帧 Y 平面上原生 zxing-cpp 能扫多个码，CameraX 丢旧帧，没有 `createImageBitmap` 整帧读回。网页不要搬 APK 的 midX/midY 重排。

- 分析流：**1920×1440** · `YUV_420_888` · `KEEP_ONLY_LATEST`。标题行 30/60/120 只改 AE 档。高速录像管道不能扫码。
- `NativeQrDecoder`：先拷 Y 平面再 `readYBuffer`，**rotation 0**。不要 `ImageProxy.read()`（会旋转）。`tryHarder` / rotate / invert / downscale 全关。先 `LOCAL_AVERAGE`，空再 `GLOBAL_HISTOGRAM`。`LumaScaler` 热路径不用。
- 一帧 ≥2 个传输码锁四码路径。未锁双码时只做全图 max4，1 命中最多再并行左右半幅；**不要**因 1 枚 `0x1c` 跑串行八路兄妹补扫（0.8.53：16.4 ms / 38 KB/s）。空帧不要串行四格（0.8.52：20.6 ms）。同一帧两枚同时命中才锁双码。空扫清格后解锁回到未确认 max4。单枚四码帧头不锁补扫、不确认单码。确认单码后才 `maxSymbols = 1`。已锁双码且格子还不到 2 才允许 `acquireDualSibling`。
- 四码：已有格子则 4 路并行；锁满且本帧 ≥3 命中则返回，不再串行补扫。≥3 命中才 `tilesFromHits`。已锁 ≥3 格时 1–2 命中只 `followContainedHits`。格 2 **尚未**连续 6 帧 2 命中且不是双码帧头时仍四格补扫（0.8.36 一锁 格 2 就 return → 四码约 84）。一旦本会话出现过 3 命中，格 2 补扫一直开、收束作废。已锁 2 格且两枚都打中时不要整幅 max4（0.8.19）。
- **双码：** ≥2 真命中才 `tilesFromHits`，**已锁 格 2 后只要本帧仍有 2 命中就重排**。1 命中 `followContainedHits`。双码路径下格子 <2 才整幅 max4，再左右两裁。漏一枚只 inflate 漏格 + 左右两裁。已锁 ≥2 格即使本帧只中 1 枚也不要整幅 max4（0.8.35：28 FPS / 67.7）。空扫：无锁 2 次清格和 ROI；已锁 ≥2 格要 6 次。清格时解锁 `dualHint` / `dualLayout` / `multiLayout`，回到未确认 max4。
- 长时间开着会卡：解码超过 400 ms 只换 zxing 对象，不要停分析。看门狗心跳死了或解码超时**只 `replaceDecoders`，不要 `unbindAll`**。**进应用不开相机**。这台小米**每个进程只能成功 bind 一次**。收完 `unbindAll`。「继续接收」按下后再等 2 秒冷启动；新进程先预览 1.2 秒再挂分析。不要 `onStop` unbind。不要 `shutdownAsync`。扫描中清空 `resetSession`。不要空扫自动冷启动。不要首帧预热。不要独立 Lifecycle。诊断始终完整文本，高度 48dp。
- 收完点「保存文件」，不要自动写盘。诊断 ROI 显示 `格 N`。进度只在内存。
- **交给蓝：** 只发 GitHub Actions 链接，并写「拉到最底下 Artifacts，点 airferry-lite-android-debug」。需要登录。不要本地 apk 路径。

## 8. 架构

```text
sender/                         浏览器发送：测刷新率、lookahead、画 QR
  dist/airferry-lite-sender.html  提交用的单文件产物
index.html + app.js + sw.js     GitHub Pages 网页接收端
web-receiver/                   根目录镜像，必须 byte-identical
android-receiver/               Kotlin + CameraX + zxing-cpp（0.8.54）
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
- 不要收完 `unbindAll` 再在同一进程 bind（0.8.38：20.1）。不要立刻 `exit(0)` 再 bind（0.8.41 继续接收：6.1）。不要 `onStop` unbind 再 `onStart` bind（0.8.40：首次 85.9）。不要让收完后的会话一直占着相机直到杀进程（0.8.39：重开 0 命中）。继续接收点下去仍要再等 **2 秒** 再冷启动；不要因为看结果已经超过 2 秒就立刻 `killProcess`（0.8.49/0.8.50：继续 0 命中）。扫描中清空必须 `resetSession` 清格子和 ROI。不要 `shutdownAsync`。
- 不要一锁 格 2 就跳过四格补扫（0.8.36：四码约 84）。不要凭单枚 **四码** `layoutCodes=4` 锁多码。不要凭单枚 `layoutCodes=2` 锁双码并跳过补扫（0.8.50）。不要在见过一枚双码之后对空帧串行补扫（0.8.52：空白后首次 5 KB/s）。不要未锁时因 1 枚 `0x1c` 串行追兄妹（0.8.53：空白后首次 38 KB/s）。不要空扫 3 秒就 `killProcess`。不要下排复制 QR / 第三枚标记码 / 深色块（0.8.50 已否）。
- 不要看门狗 `unbindAll`（0.8.42 清空会话 151）。超时只换 zxing。
- 不要 `shutdownAsync` / 首帧 unbind / 独立 Lifecycle 去“修杀后台”。resume 重建 zxing 已否。清空不要 `unbindAll`。
- 不要在已锁 2 格且两枚都打中时整幅 `maxSymbols=4`（0.8.19：1732 每帧 0.01）。不要 60 Hz 双码 60 FPS 交错一格。
- 不要 60 Hz 上四码 60 FPS **又拿太近**（1465 偏近会话 125.6；拿远四格都进框是 155.3）。
- 不要网页要 120 FPS 或横屏 1920×1440。不要 SW `navigate` / `reload`。不要 60 Hz 上 120 FPS 发送。
- 不要把 APK 的本地路径（`android-receiver/dist/...`）发给蓝。只发 GitHub Actions run 链接。
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

来源：2026-08-21 Cursor 画布 `apk-sender-speed-levers`（未进 git）。已落地：整数放大、交错换对角、1–2 命中跟格、锁满后跳过补扫、Worker 生成、双码 **2068·60**（首次 240.0）、**1952·60**（219.9）、**1732·60**（190.4）、四码 **1465·30 整屏同换**（168.9）。下面不要当回归清单自动执行。

不要做（实测否定）：四码分析改 30；60 Hz 四码 60 FPS **拿太近**（125.6）；**60 Hz 四码四格同刷**；**60 Hz 双码 60 FPS 交错一格**（约 84 KB/s）；**已锁 2 格时每帧整幅 maxSymbols=4**（0.8.19：1732 每帧 0.01）。

仍不必做：

- **四码 60 整屏同换**：60 FPS 交错已经 16.6 ms 解码、会话 154。
- **`isPure=true` / 锁 AE·AWB**：静区不够会 0 命中；红米 CameraX 重绑过脆。
- **Brotli**：不抬会话 KB/s；APK 仍只认 gzip。
- **RaptorQ**：光学已近 V33 上限，换 FEC 不涨会话 KB/s。

| 优先级 | 侧 | 改动 | 注意 |
|---|---|---|---|
| P2 | 发送端 | gzip+Brotli 选更小 | 离线（`scripts/compare-brotli.mjs`，quality 6）：README 比 gzip 再小 14%、JS 5%、重复文本 56%；随机字节 gzip 都跳过。APK 仍只认 gzip。未进协议 |
| P2 | APK | 锁格后只锁 AE/AWB | 必须能丢锁 |
| P2 | APK | 格子贴紧后 `isPure=true` | 静区不够会 0 命中 |
| P2 | 发送端 | QR 生成进 Worker | **已落地。** 4 个 Worker + 主线程回退。缓存 256 |
| P2 | 发送端 | 双码 1732·60 | **已落地。** 每帧 1.88，实时 201.7，会话 **190.4 KB/s**（V30 上限约 201） |
| P2 | 发送端 | 双码 1952·60 | **已落地。** 0.8.24 窗口收完：实时 226.1，会话 **219.9 KB/s**。空结果 680 把「每帧」拉到 1.03，有效约 1.96。看门狗 0 |
| P2 | 发送端 | 双码 2068·60 | **已落地（首次）。** 240.0 / 0.8.26 第 1 次 233.9。0.8.26 连扫五次清空把相机打残（看门狗 0→5）。0.8.27 清空不再动相机 |
| P2 | 发送端 | 四码 30 整屏同换 | **已落地。** 每帧 2.94，格 4，会话 **168.9 KB/s**。60 FPS 仍交错（154.4） |
| P2 | 发送端 | 双码 1465·60 | **已落地。** 每帧 1.90，会话 **168.6 KB/s**。半速约 84 是只扫到一格；锁格后不收缩、1 命中不收 ROI。不要整幅 maxSymbols=4，不要重绑相机 |
| P3 | 协议 | LT → RaptorQ（MIT/Apache） | 不要 AGPL Decimen；现在不是瓶颈 |

## 13. 许可证

MIT。第三方见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。只使用 Decimen **v0.3.0 MIT**。后来的 AGPL Decimen（RaptorQ / 官方四码）不能直接搬。
