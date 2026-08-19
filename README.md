# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖，并展示手机接收端网址二维码
- 网页接收端：GitHub Pages HTTPS 页面，支持 IndexedDB 断点恢复和 Android Chrome 等现代移动浏览器
- Android 接收端：原生 APK（Android 10+，当前 0.8.2），CameraX 采集、zxing-cpp 原生解码、最新帧策略
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
4. 保持手机稳定对准全屏二维码，接收完成后保存或下载文件。

推荐参数：

- 单码推荐：2331 B / 30 FPS（适合 60 Hz 屏幕；二维码约 QR V34）
- 四码推荐：全屏 + 60 FPS（每码上限 1003 B / QR V22；选更大的“每帧数据”不会增加四码载荷）
- 单码高吞吐：2953 B / 30 FPS（QR V40，只适合单码、近距离、画面清晰）
- 稳妥：1465 B / 24 或 30 FPS（距离较远、摩尔纹明显或对焦不稳时使用）
- 不建议：45 FPS 在 60 Hz 屏幕上会对齐成更快的刷新节拍，V40 几乎扫不到；90/120 FPS 只在高刷屏上有意义

发送端按显示器刷新对齐播放：60 Hz 上 30 FPS 每码显示 2 帧，60 FPS 每刷新一帧。四码在 30 FPS 容易重复扫到同一屏，实测吞吐接近 60 FPS 的三分之二。理论速度是 `每码字节 × 码数 × FPS`，喷泉码大约再加 15% 帧。

网页接收端在 Worker 中运行 Decimen v0.3 的 ZXing WASM：优先请求最高 120 FPS（不支持则 60 FPS），用 `requestVideoFrameCallback` 跟随真实取帧。单码把中心区域缩到最多 960 像素、`maxSymbols=1`；四码最多 1280 像素、`maxSymbols=4`。忙时丢弃过期帧。界面区分采集、分析和有效二维码 FPS，并提供可复制诊断。

Android APK 0.8.2 用 CameraX 分析流（目标 1920×1440）和 `zxing-cpp` 2.3.0 读 Y 平面，关闭旋转/反色/再缩放。单码一次最多 1 个符号；四码先扫四个重叠象限，不够 4 个再整图补扫。采集走最新帧，解码约数毫秒到十余毫秒时可跟上 60 FPS 分析。APK 只把明确的 `AFL1|` 交给旧接收器，其余二进制帧走 `AFL2`。发送端先发 K 个系统源块，再发 LT 修复帧。两端都提供可复制诊断（机型、相机能力、解码耗时、空结果、ROI、唯一/重复帧、解块进度），不含账号或上传路径。本地完成 LT 解码、gzip 解压和 SHA-256 校验。

生成二维码流前，发送端会尝试浏览器原生 gzip。仅当文件不小于 1 KiB 且压缩后至少缩小约 5% 时才发送压缩载荷，否则保持原始数据。接收端同时校验传输载荷和解压后的原文件。

网页接收进度会按会话写入 IndexedDB。刷新或意外关闭后再次打开，可恢复最近一次未完成传输；完成下载或点击“清空进度”后删除对应断点。

## 抗丢帧

发送端每组数据后插入一个 GF(256) 线性修复帧。每轮循环都会为同一分组生成新的种子和系数，接收端可累计多个独立修复方程。旧版接收端会忽略未知字段，仍可依靠循环数据帧完成接收。协议细节见 [protocol/SPEC.md](protocol/SPEC.md)。

## 目录

```text
app.js                                      # GitHub Pages 网页接收端
sw.js                                       # 网页接收端缓存
android-receiver/                           # Android APK 源码
sender/dist/airferry-lite-sender.html       # 可直接使用的单文件发送端
sender/                                     # 发送端源码和构建脚本
shared/                                     # AFL1 / AFL2 共享协议
web-receiver/                               # 网页接收端镜像
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

APK 输出为 `android-receiver/app/build/outputs/apk/debug/app-debug.apk`。如果迁移项目目录，需要重新生成 `android-receiver/local.properties`，或把脚本中的 SDK 路径改为当前仓库下的 `.tools/android-sdk`。

## 网页接收限制

- 必须通过 HTTPS 或 localhost 才能访问摄像头。
- 单次原文件和传输载荷上限目前均为 64 MiB。
- 刷新页面会恢复最近一次未完成进度；主动清空进度后需重新扫描。
- gzip 传输要求接收浏览器支持 `DecompressionStream`；当前 Android Chrome 和原生 Android 接收端均支持该路径。
- 光学速度受屏幕亮度、摩尔纹、摄像头对焦、手机性能和环境反光影响。
- 四码请让发送端全屏；大文件或低性能设备可改单码 30 FPS。Android 原生接收端更适合后续扩展大文件落盘。

## 和 AirFerry / Decimen 的关系

本项目保留 AirFerry 的 `AFL1` 接收代码用于读取旧发送端，但当前发送端不再暴露兼容模式，网页和 APK 统一使用 `AFL2`。`AFL2` 参考 `bashalarmistalt/decimen-optical-transfer` v0.3.0 的 MIT 实现，引入二进制 LT 喷泉码、固定掩码、发送端 lookahead 和并行解码。Decimen 当前 AGPL 版本的四二维码/RaptorQ 实现没有复制进 MIT 项目；后续若引入必须单独处理许可证、二进制协议和 Android 解码实现。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
