# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖，并展示手机接收端网址二维码
- 网页接收端：GitHub Pages HTTPS 页面，支持 IndexedDB 断点恢复和 Android Chrome 等现代移动浏览器
- Android 接收端：原生 APK 源码（Android 10+）
- 传输协议：`AFL1` 描述帧、数据帧、GF(256) 线性修复帧、择优 gzip、分片 CRC-32 和原文件 CRC-32
- 隐私：文件只在发送电脑和接收手机本地处理，不经过服务器

## 在线使用

- 手机网页接收端：https://shuipashui.github.io/airferry-lite/
- 发送端页面右侧会显示上述地址和二维码，手机扫码即可进入接收端；生成文件二维码流后该入口自动隐藏
- 单文件发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html

使用步骤：

1. 在电脑打开单文件发送端，选择文件。
2. 推荐先使用“均衡”模式，点击“生成二维码流”和“开始播放”。
3. 手机打开网页接收端，允许摄像头权限并点击“开始扫描”。
4. 保持手机稳定对准二维码，接收完成后下载文件。

推荐参数：

- 稳定：400 B / 6 FPS
- 均衡：700 B / 8 FPS
- 快速：900 B / 12 FPS（二维码密度基准通过，适合光线和对焦稳定的设备）

网页接收端会优先使用浏览器原生二维码识别；不支持时自动在 Web Worker 中运行 `jsQR`，并在锁定二维码后缩小扫描区域以降低主线程开销。Worker 不可用时自动回退主线程解码。接收界面同时显示实时接收速度（B/s、KB/s 或 MB/s），采用短窗口平滑统计有效片段和修复片段的写入速率。

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
```

构建输出为 `sender/dist/airferry-lite-sender.html`。

## 网页接收限制

- 必须通过 HTTPS 或 localhost 才能访问摄像头。
- 单次原文件和传输载荷上限目前均为 64 MiB。
- 刷新页面会恢复最近一次未完成进度；主动清空进度后需重新扫描。
- gzip 传输要求接收浏览器支持 `DecompressionStream`；当前 Android Chrome 和原生 Android 接收端均支持该路径。
- 光学速度受屏幕亮度、摩尔纹、摄像头对焦、手机性能和环境反光影响。
- 大文件或低性能设备建议使用稳定模式；Android 原生接收端更适合后续扩展大文件落盘。

## 和 AirFerry 的关系

本项目参考 AirFerry 的描述帧、连续 QR 视频流、接收端容错和 Android 接收思路，但没有复制其 Rust/RaptorQ 实现。当前采用更小、便于浏览器独立运行的循环分片与 GF(256) 线性修复方案。真正的 RaptorQ、二进制帧和同屏多二维码属于下一代不兼容协议，需配套可信的 RaptorQ WASM/Android 实现后再引入。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
