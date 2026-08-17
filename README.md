# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖
- 网页接收端：GitHub Pages HTTPS 页面，支持 Android Chrome 等现代移动浏览器
- Android 接收端：原生 APK 源码（Android 10+）
- 传输协议：`AFL1` 描述帧、数据帧、XOR 修复帧、分片 CRC-32 和整文件 CRC-32
- 隐私：文件只在发送电脑和接收手机本地处理，不经过服务器

## 在线使用

- 手机网页接收端：https://shuipashui.github.io/airferry-lite/
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

网页接收端会优先使用浏览器原生二维码识别；不支持时自动切换到 `jsQR`，并在锁定二维码后缩小扫描区域以降低解码开销。

## 抗丢帧

发送端每组数据后插入一个 XOR 修复帧。网页接收端在一组中仅缺失一个数据片段时，可以立即恢复该片段，减少等待下一轮循环的次数。旧版接收端会忽略未知的修复帧，仍可依靠循环数据帧完成接收。

XOR 修复不是喷泉码：同一组同时缺失两个以上数据片段时仍需等待后续循环。协议细节见 [protocol/SPEC.md](protocol/SPEC.md)。

## 目录

`text
app.js                                      # GitHub Pages 网页接收端
protocol.js                                 # 网页接收端协议实现
sender/dist/airferry-lite-sender.html       # 可直接使用的单文件发送端
sender/                                     # 发送端源码和构建脚本
shared/protocol.js                          # 构建发送端使用的共享协议
tests/                                      # 协议、边界、二维码密度、恢复和接收端安全测试
protocol/SPEC.md                            # 线协议说明
`

## 本地构建与测试

需要 Node.js 18+：

`powershell
npm test
npm run build:sender
`

构建输出为 `sender/dist/airferry-lite-sender.html`。

## 网页接收限制

- 必须通过 HTTPS 或 localhost 才能访问摄像头。
- 单次文件上限目前为 64 MiB，接收状态保存在内存中。
- 刷新页面或清空进度后需要重新扫描。
- 光学速度受屏幕亮度、摩尔纹、摄像头对焦、手机性能和环境反光影响。
- 大文件或低性能设备建议使用稳定模式；Android 原生接收端更适合后续扩展大文件落盘。

## 和 AirFerry 的关系

本项目参考 AirFerry 的描述帧、连续 QR 视频流、接收端容错和 Android 接收思路，但没有复制其 Rust/RaptorQ 实现。当前采用更小、便于浏览器独立运行的循环分片与 XOR 修复方案。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
