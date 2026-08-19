# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖，并展示手机接收端网址二维码
- 网页接收端：GitHub Pages HTTPS 页面，支持 Android Chrome 等现代移动浏览器；旧 AFL1 流可 IndexedDB 断点
- Android 接收端：原生 APK（Android 10+，当前 0.8.12），CameraX 采集、zxing-cpp 原生解码、最新帧策略
- 传输协议：`AFL1` 描述帧、数据帧、GF(256) 线性修复帧、择优 gzip、分片 CRC-32 和原文件 CRC-32
- 高速协议：`AFL2` 二进制帧、LT 喷泉码、固定掩码 4，单码默认 30 FPS，四码默认 60 FPS
- 隐私：文件只在发送电脑和接收手机本地处理，不经过服务器

## 在线使用

- 手机网页接收端：https://shuipashui.github.io/airferry-lite/
- 发送端页面右侧会显示上述地址和二维码，手机扫码即可进入接收端；生成文件二维码流后该入口自动隐藏
- 单文件发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html

使用步骤：

1. 在电脑打开单文件发送端，选择文件。
2. 选择布局和帧率，点击“生成二维码流”。四码请再点“全屏”后开始播放。
3. 手机打开网页接收端或安装 APK，允许摄像头权限并开始扫描。
4. 保持手机稳定对准二维码（四码请让发送端全屏），接收完成后保存或下载文件。

推荐参数：

- 单码推荐：2331 B / 30 FPS（适合 60 Hz 屏幕；二维码约 QR V34）
- 四码推荐：全屏 + 60 FPS（每码上限 1003 B / QR V22；选更大的“每帧数据”不会增加四码载荷）
- 单码高吞吐：2953 B / 30 FPS（QR V40，只适合单码、近距离、画面清晰）
- 稳妥：1465 B / 24 或 30 FPS（距离较远、摩尔纹明显或对焦不稳时使用）
- 不建议：单码不要选 60/120 FPS（相机会拍到换码拖影，通常比 30 FPS 更慢）；90/120 FPS 只对四码且高刷屏有意义，且分析流仍约 60 FPS

发送端按实测刷新率对齐播放（含 240 Hz）：60 Hz 上 30 FPS 每码显示 2 帧，60 FPS 每刷新一帧；240 Hz 上 30/60 FPS 分别每 8/4 次 vsync 换一屏。旧发送端会丢掉短于 8 ms 的 vsync，把 240 Hz 当成 60 Hz，选 30 FPS 实际约 120 屏/秒。四码若停在 30 FPS，60 FPS 相机会对同一屏扫两遍，吞吐上不去。理论速度是 `每码字节 × 码数 × FPS`，喷泉码大约再加 15% 帧。界面「平均」是近 3 秒滚动，诊断里另有整段会话平均。

网页接收端在 Worker 中运行 Decimen v0.3 的 ZXing WASM（2 或 3 个 Worker）。单码先扫整幅画面最多 1440 像素，锁定后裁紧码再缩到 720–960，避免中心正方形把竖幅上下裁掉。四码按 2×2 格子轮转，每格有命中后改紧裁，不再按距离把两格并成一块。同一时刻只从摄像头抽一张图。不要把单码切成四块再缩到 720，V34 会不够模块。WASM/Worker 走 Service Worker 缓存优先，避免 `no-store` 卡住解码器。诊断第一行带网页版本号。若标题不是 v28，强制刷新。旧 `AFL1` 文本流会回退到 jsQR。

Android APK 0.8.12 用 CameraX 分析流（目标 1920×1440）和 `zxing-cpp` 2.3.0 读 Y 平面，关闭旋转/反色/再缩放。单码一次最多 1 个符号；四码并行扫上一帧四个码的位置，不足 4 个时在分析线程上顺序补重叠象限和直方图，避免多线程抢同一 Y 平面。少于 3 个码时 ROI 回到中心整幅，避免锁在一行上。采集走最新帧。APK 只把明确的 `AFL1|` 交给旧接收器，其余二进制帧走 `AFL2`。发送端按实测刷新率对齐 vsync（含 240 Hz）。完成后文件写到系统下载目录下的 `AirFerry Lite` 文件夹。两端都提供可复制诊断（机型、相机能力、解码耗时、每帧码数、空结果、ROI、唯一/重复帧、解块进度）。本地完成 LT 解码、gzip 解压和 SHA-256 校验。

当前发送端走 AFL2：文件至少 768 字节、MIME 不像已经压缩过、且 gzip 后再小 64 字节以上时才压缩，否则保持原始数据。接收端同时校验传输载荷和解压后的原文件。

IndexedDB 断点只用于旧的 AFL1 文本流。当前 AFL2 传输保存在内存里，刷新网页或关掉 APK 后需要重新扫描。

## 丢帧与修复

当前发送端使用 LT 喷泉码：接收端按任意顺序收帧，大约 `1.15 × k` 个有效块即可恢复。旧 AFL1 发送端仍会在每组数据后插入 GF(256) 线性修复帧，网页和 APK 都还能收。协议细节见 [protocol/SPEC.md](protocol/SPEC.md)。

## 目录

```text
index.html                                  # GitHub Pages 网页接收端入口
app.js / protocol.js / highspeed-protocol.js
sw.js                                       # 网页接收端缓存
android-receiver/                           # Android APK 源码
sender/dist/airferry-lite-sender.html       # 可直接使用的单文件发送端
sender/                                     # 发送端源码和构建脚本
shared/                                     # AFL1 / AFL2 共享协议
web-receiver/                               # 网页接收端镜像
third_party/decimen-v0.3/                   # AFL2 所参考的 MIT 源码
tests/                                      # 协议、密度、恢复和接收端安全测试
protocol/SPEC.md                            # 线协议说明
```

## 本地构建与测试

需要 Node.js 18+：

```powershell
npm test
npm run build:sender
npm run build
```

`npm run build` 会生成高速协议 bundle、同步 `web-receiver/` 镜像，再生成 `sender/dist/airferry-lite-sender.html`。

发送端二维码播放使用 `requestAnimationFrame`，并按测得的刷新率对齐到整数个 vsync。浏览器卡顿超过三个播放间隔时会丢弃积压节拍，避免恢复后瞬间跳过多帧。

### Android APK

仓库包含 Gradle Wrapper。本机构建需要 Java 17、Android SDK Platform 35 和项目 `.tools/` 中的本地工具链（该目录已忽略，不上传仓库）：

```powershell
cd android-receiver
.\build-local.ps1 assembleDebug
```

APK 输出为 `android-receiver/app/build/outputs/apk/debug/app-debug.apk`。没有本地 SDK 时，可从 GitHub Actions 工作流 `Build Android receiver` 下载 `airferry-lite-android-debug` 产物。如果迁移项目目录，需要重新生成 `android-receiver/local.properties`，或把脚本中的 SDK 路径改为当前仓库下的 `.tools/android-sdk`。

## 网页接收限制

- 必须通过 HTTPS 或 localhost 才能访问摄像头。
- 单次原文件和传输载荷上限目前均为 64 MiB。
- 刷新页面不会保留当前 AFL2 进度；旧 AFL1 会话仍可从 IndexedDB 恢复，主动清空进度后需重新扫描。
- gzip 传输要求接收浏览器支持 `DecompressionStream`；当前 Android Chrome 和原生 Android 接收端均支持该路径。
- 光学速度受屏幕亮度、摩尔纹、摄像头对焦、手机性能和环境反光影响。
- 四码请让发送端全屏；大文件或低性能设备可改单码 30 FPS。Android 原生接收端更适合后续扩展大文件落盘。

## 和 AirFerry / Decimen 的关系

本项目保留 AirFerry 的 `AFL1` 接收代码用于读取旧发送端，但当前发送端不再暴露兼容模式，网页和 APK 统一发送/接收 `AFL2`。`AFL2` 参考 `bashalarmistalt/decimen-optical-transfer` v0.3.0 的 MIT 实现，引入二进制 LT 喷泉码、固定掩码和发送端 lookahead。网页用多个 ZXing WASM Worker 解码，Android 用 zxing-cpp。Decimen 当前 AGPL 版本的四二维码/RaptorQ 实现没有复制进 MIT 项目；后续若引入必须单独处理许可证、二进制协议和 Android 解码实现。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
