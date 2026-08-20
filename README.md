# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖，并展示手机接收端网址二维码
- 网页接收端：GitHub Pages HTTPS 页面（当前 **v61**）。单码把 ROI 裁切放到 Worker；四码格 4 后会跟手抖。细节见 [HANDOVER.md](HANDOVER.md)
- Android 接收端：原生 APK（Android 10+，**冻结在 0.8.12**），CameraX 采集、zxing-cpp 原生解码、最新帧策略
- 传输协议：`AFL1` 描述帧、数据帧、GF(256) 线性修复帧、择优 gzip、分片 CRC-32 和原文件 CRC-32
- 高速协议：`AFL2` 二进制帧、LT 喷泉码、固定掩码 4
- 隐私：文件只在发送电脑和接收手机本地处理，不经过服务器

工程细节、硬约束和已验证结论见 [HANDOVER.md](HANDOVER.md)。

## 在线使用

- 手机网页接收端：https://shuipashui.github.io/airferry-lite/
- 发送端页面右侧会显示上述地址和二维码，手机扫码即可进入接收端；生成文件二维码流后该入口自动隐藏
- 单文件发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html

使用步骤：

1. 在电脑打开单文件发送端，选择文件。
2. 选择布局和帧率，点击“生成二维码流”。四码请再点“全屏”后开始播放。
3. 手机打开网页接收端或安装 APK，允许摄像头权限并开始扫描。
4. 保持手机稳定对准二维码（四码请让发送端全屏），接收完成后保存或下载文件。

诊断第一行必须是 `网页：v61`。Chrome 若一直停在旧版，是旧 Service Worker 不刷新；新 SW 激活时会强制打开页面。仍不对就清掉该站数据。

## 推荐参数

针对 **60 Hz 电脑屏 + 约 60 FPS 手机相机**（当前主力测试机：红米 / Xiaomi M098FE · Android 16 · Chrome）：

| 场景 | 参数 | 说明 |
|---|---|---|
| 单码推荐 | **2331 B · 30 FPS** | QR 约 V34。网页 v61 把锁码后的 ROI 裁切移进 Worker，待 Pages 确认采集是否不再掉到约 12 FPS |
| 四码推荐 | **全屏 · 2331 B · 30 FPS** | 发送端会把四码每码限制到 1273 B（QR V22–V25）。v53 格 4 实时约 50–56 KB/s；v61 会跟手抖，待 Pages 确认每帧命中 |
| 单码高吞吐 | 2953 B · 30 FPS | QR V40，只适合单码、近距离、画面清晰 |
| 更远 / 摩尔纹 | 1465 B 或四码 1003 B · 24/30 FPS | 对焦不稳时更稳 |
| 不要用 | 单码 60/120 FPS | 相机会拍到换码拖影，通常比 30 FPS 更慢 |
| 不要用 | 60 Hz 屏上四码 60 FPS | 容易拖影，实测往往不如 30 FPS |

发送端按实测刷新率对齐播放（含 240 Hz）：60 Hz 上 30 FPS 每码显示 2 帧，60 FPS 每刷新一帧；240 Hz 上 30/60 FPS 分别每 8/4 次 vsync 换一屏。旧发送端会丢掉短于 8 ms 的 vsync，把 240 Hz 当成 60 Hz，选 30 FPS 实际约 120 屏/秒。

理论速度是 `每码字节 × 码数 × FPS`，喷泉码大约再加 15% 帧。四码 30 FPS、每码 1253 B 时屏幕上限大约 `1253 × 4 × 30 ≈ 147 KB/s`；网页当前四码还远低于这个上限，卡在每帧只打中大约 1 个码。界面「平均」是近 3 秒滚动，诊断里另有整段会话平均。

## 接收端现状

网页接收端在 Worker 中运行 Decimen v0.3 的 ZXing WASM（通常 4 个 Worker）。**v61** 单码在主线程只做整幅 1440 快照，ROI 裁切在 Worker 里完成；四码由 Chrome `BarcodeDetector` 找框，格 4 后 ≥3 命中重排 2×2、1–2 命中只更新包含该码的窗口。WASM/Worker 走 Service Worker 缓存优先。旧 `AFL1` 文本流会回退到 jsQR。

Android APK **0.8.12 冻结，未经要求不要改**。峰值是 0.8.8：60 Hz 四码约 **193 KB/s**。0.8.12 用 CameraX 分析流（目标 1920×1440）和 `zxing-cpp` 2.3.0 读 Y 平面。单码一次最多 1 个符号；四码并行扫上一帧四个码的位置。采集走最新帧。完成后文件写到系统下载目录下的 `AirFerry Lite` 文件夹。

当前发送端走 AFL2：文件至少 768 字节、MIME 不像已经压缩过、且 gzip 后再小 64 字节以上时才压缩，否则保持原始数据。接收端同时校验传输载荷和解压后的原文件。

IndexedDB 断点只用于旧的 AFL1 文本流。当前 AFL2 传输保存在内存里，刷新网页或关掉 APK 后需要重新扫描。

## 丢帧与修复

当前发送端使用 LT 喷泉码：接收端按任意顺序收帧，大约 `1.15 × k` 个有效块即可恢复。旧 AFL1 发送端仍会在每组数据后插入 GF(256) 线性修复帧，网页和 APK 都还能收。协议细节见 [protocol/SPEC.md](protocol/SPEC.md)。

## 目录

```text
index.html                                  # GitHub Pages 网页接收端入口
app.js / protocol.js / highspeed-protocol.js
sw.js                                       # 网页接收端缓存（airferry-lite-v61）
android-receiver/                           # Android APK 源码（0.8.12）
sender/dist/airferry-lite-sender.html       # 可直接使用的单文件发送端
sender/                                     # 发送端源码和构建脚本
shared/                                     # AFL1 / AFL2 共享协议
web-receiver/                               # 网页接收端镜像，必须与根目录接收端文件一致
third_party/decimen-v0.3/                   # AFL2 所参考的 MIT 源码
tests/                                      # 协议、密度、恢复和接收端安全测试
protocol/SPEC.md                            # 线协议说明
HANDOVER.md                                 # 工程交接
```

## 本地构建与测试

需要 Node.js 18+（本仓库本地工具链在已忽略的 `.tools/node`）：

```powershell
npm test
npm run build:sender
npm run build
```

`npm run build` 会生成高速协议 bundle、同步 `web-receiver/` 镜像，再生成 `sender/dist/airferry-lite-sender.html`。改根目录接收端后必须跑 `node sync-receiver.mjs`，否则 CI 会失败。

发送端二维码播放使用 `requestAnimationFrame`，并按测得的刷新率对齐到整数个 vsync。浏览器卡顿超过三个播放间隔时会丢弃积压节拍，避免恢复后瞬间跳过多帧。

### Android APK

仓库包含 Gradle Wrapper。本机构建需要 Java 17、Android SDK Platform 35 和项目 `.tools/` 中的本地工具链（该目录已忽略，不上传仓库）：

```powershell
cd android-receiver
.\build-local.ps1 assembleDebug
```

APK 输出为 `android-receiver/app/build/outputs/apk/debug/app-debug.apk`。没有本地 SDK 时，可从 GitHub Actions 工作流 `Build Android receiver` 下载 `airferry-lite-android-debug` 产物。如果迁移项目目录，需要重新生成 `android-receiver/local.properties`，或把脚本中的 SDK 路径改为当前仓库下的 `.tools/android-sdk`。

## 网页接收限制

- 必须通过 HTTPS 或 localhost 才能访问摄像头。用户只在 GitHub Pages 上测网页端。
- 单次原文件和传输载荷上限目前均为 64 MiB。
- 刷新页面不会保留当前 AFL2 进度；旧 AFL1 会话仍可从 IndexedDB 恢复，主动清空进度后需重新扫描。
- gzip 传输要求接收浏览器支持 `DecompressionStream`；当前 Android Chrome 和原生 Android 接收端均支持该路径。
- 光学速度受屏幕亮度、摩尔纹、摄像头对焦、手机性能和环境反光影响。
- 四码请让发送端全屏。Android 原生接收端更适合后续扩展大文件落盘。
- 这台红米的 120/240/480 FPS 只出现在高速录像能力里，CameraX / getUserMedia 分析流最高仍是 60，网页不要对 Android 请求 120 FPS。

## 和 AirFerry / Decimen 的关系

本项目保留 AirFerry 的 `AFL1` 接收代码用于读取旧发送端，但当前发送端不再暴露兼容模式，网页和 APK 统一发送/接收 `AFL2`。`AFL2` 参考 `bashalarmistalt/decimen-optical-transfer` v0.3.0 的 MIT 实现，引入二进制 LT 喷泉码、固定掩码和发送端 lookahead。网页用多个 ZXing WASM Worker 解码，Android 用 zxing-cpp。Decimen 当前 AGPL 版本的四二维码/RaptorQ 实现没有复制进 MIT 项目；后续若引入必须单独处理许可证、二进制协议和 Android 解码实现。

原版 [AirFerry](https://github.com/UR-SillyB/AirFerry) 只作思路参考，不要把其扫描策略直接搬进网页端。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
