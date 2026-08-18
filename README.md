# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖，并展示手机接收端网址二维码
- 网页接收端：GitHub Pages HTTPS 页面，支持 IndexedDB 断点恢复和 Android Chrome 等现代移动浏览器
- Android 接收端：原生 APK 源码（Android 10+），支持兼容 `AFL1` 和网页高速 `AFL2` 二进制帧
- 传输协议：`AFL1` 描述帧、数据帧、GF(256) 线性修复帧、择优 gzip、分片 CRC-32 和原文件 CRC-32
- 网页高速协议：`AFL2` 二进制帧、LT 喷泉码、V40-L QR、固定掩码 4、60 FPS、3 个 ZXing WASM 解码 Worker
- 隐私：文件只在发送电脑和接收手机本地处理，不经过服务器

## 在线使用

- 手机网页接收端：https://shuipashui.github.io/airferry-lite/
- 发送端页面右侧会显示上述地址和二维码，手机扫码即可进入接收端；生成文件二维码流后该入口自动隐藏
- 单文件发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html

使用步骤：

1. 在电脑打开单文件发送端，选择文件。
2. 在电脑选择传输档位，点击“生成二维码流”和“开始播放”。最新网页接收端与 Android APK 都支持“网页高速（推荐）”；距离较远或屏幕较小时改用兼容稳定档。
3. 手机打开网页接收端，允许摄像头权限并点击“开始扫描”。
4. 保持手机稳定对准二维码，接收完成后下载文件。

推荐参数：

- 网页高速推荐：2331 B / 30 FPS（适合 60 Hz 屏幕和手机摄像头，实际约 40-60 KB/s 取决于屏幕、相机和手机）
- 网页高速高吞吐：2953 B / 30 FPS（更大二维码，适合画面清晰且距离较近的场景）
- 网页高速实验：2953 B / 60 FPS（保留给 120 Hz 屏幕或确认手机摄像头实际 60 FPS 的设备）
- 网页高速兼容：1465 B / 24 FPS（距离较远或普通显示器）
- APK / 网页兼容稳定：400 B / 6 FPS
- APK 兼容均衡：700 B / 8 FPS
- APK 兼容快速：900 B / 12 FPS

网页高速模式会在 Worker 中运行 Decimen v0.3 使用的 ZXing WASM 解码器：每个摄像头帧只提交给空闲 Worker，忙时丢弃过期帧，不排队堆积；3 个 Worker 与 LT 喷泉码共同吸收丢帧。它返回原始二进制帧，因此没有 Base64 膨胀。Android APK 会从 ZXing 的 QR `BYTE_SEGMENTS` 读取同一份二进制帧并在本地 LT 解码、gzip 解压和 SHA-256 校验。旧模式仍会优先使用浏览器原生二维码识别，不支持时回退 `jsQR`。接收界面同时显示实时接收速度。

生成二维码流前，发送端会尝试使用浏览器原生 gzip。仅当文件不小于 1 KiB 且压缩后至少缩小约 5% 时才发送压缩载荷，否则保持原始数据，避免压缩格式和额外字段反而降低速度。接收端同时校验传输载荷和解压后的原文件。

网页接收进度会按会话持续写入 IndexedDB。刷新或意外关闭页面后再次打开，可恢复最近一次未完成传输的有效片段和修复帧；完成下载或点击“清空进度”后会删除对应断点。

## 抗丢帧

发送端每组数据后插入一个 GF(256) 线性修复帧。每轮循环都会为同一分组生成新的种子和系数，接收端可累计多个独立修复方程，在同组同时丢失多个片段时逐步恢复。旧版接收端会忽略未知字段，仍可依靠循环数据帧完成接收。协议细节见 [protocol/SPEC.md](protocol/SPEC.md)。

## 目录

```text
app.js                                      # GitHub Pages 网页接收端
protocol.js                                 # 网页接收端协议实现
sender/dist/airferry-lite-sender.html       # 可直接使用的单文件发送端
sender/                                     # 发送端源码和构建脚本
shared/protocol.js                          # 构建发送端使用的共享协议
tests/                                      # 协议、边界、二维码密度、恢复和接收端安全测试
protocol/SPEC.md                            # 线协议说明
```

## 本地构建与测试

需要 Node.js 18+：

```powershell
npm test
npm run build:sender
npm run build
```

`npm run build` 会先生成高速协议 bundle、同步 `web-receiver/` 镜像，再生成 `sender/dist/airferry-lite-sender.html`。构建输出为 `sender/dist/airferry-lite-sender.html`。

### Android APK

仓库包含 Gradle Wrapper；本机可用的最小 Android 工具链位于项目 `.tools/`（该目录已忽略，不上传仓库）：Java 17、Gradle 8.9、Android SDK Platform 35、Build Tools 34/35 和 Platform Tools。C 盘主目录中直接运行：

```powershell
cd C:\codex_project\airferry-lite\android-receiver
.\build-local.ps1 assembleDebug
```

APK 输出为 `android-receiver/app/build/outputs/apk/debug/app-debug.apk`。如果迁移项目目录，需要重新生成 `android-receiver/local.properties`，或把脚本中的 SDK 路径改为新的 `.tools/android-sdk`。

## 网页接收限制

- 必须通过 HTTPS 或 localhost 才能访问摄像头。
- 单次原文件和传输载荷上限目前均为 64 MiB。
- 刷新页面会恢复最近一次未完成进度；主动清空进度后需重新扫描。
- gzip 传输要求接收浏览器支持 `DecompressionStream`；当前 Android Chrome 和原生 Android 接收端均支持该路径。
- 光学速度受屏幕亮度、摩尔纹、摄像头对焦、手机性能和环境反光影响。
- 大文件或低性能设备建议使用稳定模式；Android 原生接收端更适合后续扩展大文件落盘。

## 和 AirFerry / Decimen 的关系

本项目保留 AirFerry 的 Android 兼容协议，同时参考 `bashalarmistalt/decimen-optical-transfer` v0.3.0 的 MIT 实现引入网页专用 `AFL2` 二进制 LT 喷泉码、固定掩码、发送端 lookahead 和并行 WASM 解码。Decimen 当前 AGPL 版本的四二维码/RaptorQ 实现没有复制进 MIT 项目；后续若引入必须单独处理许可证、二进制协议和 Android 解码实现。当前目标是先达到其 v0.3 单二维码约 128 KB/s 的量级，不能把本机生成基准当成手机实测速度。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
