# AirFerry Lite

一个受 AirFerry 启发的精简离线光学传输项目：

- 发送端：单文件 HTML，无服务器、无运行时 CDN 依赖
- 接收端：手机网页接收端
- 接收端：Android 原生 APK 源码（Android 10+、ARM64）
- 传输：屏幕连续二维码视频流，文件分片、循环播放、片段 CRC-32、文件 CRC-32
- 协议：`AFL1`，见 [`protocol/SPEC.md`](protocol/SPEC.md)

## 目录

```text
sender/dist/airferry-lite-sender.html  # 可直接双击打开的单文件发送端
web-receiver/                          # 手机 HTTPS 网页接收端
android-receiver/                      # Android 原生接收端工程
shared/protocol.js                     # Web 端共享协议实现
protocol/SPEC.md                       # 帧格式
```

## 快速使用

1. 用浏览器打开 [`sender/dist/airferry-lite-sender.html`](sender/dist/airferry-lite-sender.html)。
2. 选择文件，点击“生成二维码流”，再点击“开始播放”。
3. 手机打开 `web-receiver/` 部署后的 HTTPS 地址，或安装 Android APK。
4. 让手机摄像头稳定对准电脑二维码，保持发送端循环播放到接收完成。

网页接收端必须在 HTTPS 或 localhost 下访问摄像头。Android 接收端使用 ZXing 连续扫码，并将文件保存到 `Download/AirFerry Lite`。

## 构建单文件发送端

需要 Node.js 18+：

```powershell
cd sender
node build.mjs
```

输出仍然是一个独立的 `sender/dist/airferry-lite-sender.html`，不需要本地 HTTP 服务器。

## 构建 Android APK

本机需要 JDK 17、Android SDK 35 和 Gradle 8.9。也可以直接使用仓库内的 GitHub Actions 工作流：

```text
.github/workflows/android-apk.yml
```

它会产出 `app-debug.apk` 构建产物。Android 接收端使用 `com.journeyapps:zxing-android-embedded` 做连续二维码识别，最低 Android 10。

## 和 AirFerry 的关系

本项目参考了 AirFerry 的总体思路：描述帧、数据分片、连续 QR 视频流、接收端容错和原生 Android 接收端。为了让项目保持易读、可独立构建，本版本没有复制 AirFerry 的 Rust/RaptorQ 实现，而是使用一个更小的循环帧协议。后续可以在不改变 `AFL1` 外层帧格式的情况下替换为喷泉码。

## 限制

- 这是一个可运行的精简基线，不是 AirFerry 的同等吞吐量实现。
- 默认每片 700 字节，适合普通手机摄像头；可在发送端选择更小或更大的片段。
- 网页端解码速度受浏览器限制，Android 原生端更适合较大文件。
- 当前接收进度主要保存在内存中，刷新页面后需要重新扫描。

## 许可证

本项目使用 MIT License。第三方依赖说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
