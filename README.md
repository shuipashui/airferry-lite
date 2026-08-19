# AirFerry Lite

AirFerry Lite 是一个无需服务器的离线光学文件传输项目：电脑浏览器将文件编码为连续二维码，手机网页或 Android 接收端通过摄像头恢复文件。

- 发送端：单文件 HTML，可直接双击打开，无运行时 CDN 依赖，并展示手机接收端网址二维码
- 网页接收端：GitHub Pages HTTPS 页面，支持 IndexedDB 断点恢复和 Android Chrome 等现代移动浏览器
- Android 接收端：原生 APK 源码（Android 10+），CameraX 采集、2-4 路并行 ZXing 解码、相机高帧率请求与二维码区域跟踪，支持 `AFL2` 二进制帧并保留旧 `AFL1` 接收回退
- 传输协议：`AFL1` 描述帧、数据帧、GF(256) 线性修复帧、择优 gzip、分片 CRC-32 和原文件 CRC-32
- 高速协议：`AFL2` 二进制帧、LT 喷泉码、V40-L QR、固定掩码 4，默认 30 FPS，支持单码/四码布局，并保留 45/60/90/120 FPS 选项
- 隐私：文件只在发送电脑和接收手机本地处理，不经过服务器

## 在线使用

- 手机网页接收端：https://shuipashui.github.io/airferry-lite/
- 发送端页面右侧会显示上述地址和二维码，手机扫码即可进入接收端；生成文件二维码流后该入口自动隐藏
- 单文件发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html

使用步骤：

1. 在电脑打开单文件发送端，选择文件。
2. 在电脑选择每帧数据量和播放帧率，点击“生成二维码流”和“开始播放”。发送端统一使用 `AFL2` 高速协议；距离较远或画面不够清晰时改用 1465 B / 24 FPS。
3. 手机打开网页接收端，允许摄像头权限并点击“开始扫描”。
4. 保持手机稳定对准二维码，接收完成后下载文件。

推荐参数：

- 推荐：2331 B / 30 FPS（适合 60 Hz 屏幕和手机摄像头，网页实测约 50 KB/s，实际速度取决于屏幕、相机和手机）
- 多码：2331 B / 30 FPS + 四码布局（发送端会自动把每码限制到约 1005 B，保证 2×2 画面仍有足够模块尺寸；每个显示周期携带 4 个不同 AFL2 喷泉帧，需要最新版网页或 APK）
- 高吞吐：2953 B / 30 FPS（更大、更密的二维码，适合画面清晰且距离较近的场景）
- 实验：2953 B / 45/60 FPS（45 FPS 参考 AirFerry 的稳定预设；60 FPS 仅适合高刷新率屏幕和确认发送设备、相机曝光都能稳定工作的场景）
- 高刷实验：90/120 FPS（只有高刷显示器和相机驱动同时支持时才有意义；普通 60 Hz 屏幕不会因此产生更多有效二维码）
- 低密度：1465 B / 24 FPS（距离较远、摩尔纹明显或对焦不稳定时使用）

网页接收端会在 Worker 中运行 Decimen v0.3 使用的 ZXing WASM 解码器：优先向浏览器请求最高 120 FPS（设备不支持时回退 60 FPS），通过 `requestVideoFrameCallback` 跟随摄像头真实取帧，只把画面中心的二维码扫描区域缩放到最多 800 像素后提交给空闲 Worker，支持时把位图裁剪和 RGBA 提取移出页面主线程；忙时丢弃过期帧，不排队堆积。多码 Worker 每帧最多返回 4 个 QR，2-3 个 Worker 与 LT 喷泉码共同吸收丢帧，界面区分显示相机采集、分析完成和有效二维码 FPS。

Android APK 0.7.0 采用同样的最新帧策略，通过 Camera2Interop 优先选择设备支持的固定 120/90/60 FPS，再回退到包含 60 FPS 的范围或设备可用范围；同时显示 Camera2 高速录像能力，但高速录像能力不等于 CameraX YUV 分析流能力。分析分辨率目标恢复为 1920×1440，2-4 个 ZXing 线程使用复用的 Y 平面缓冲区；单码走快速解码，旧版无布局标记的多码每 600 帧才兼容探测，新版四码帧使用 AFL2 标记并切换到四象限单码解码。APK 从 QR `BYTE_SEGMENTS`、`rawBytes` 和 ISO-8859-1 文本依次恢复二进制载荷，只有明确的 `AFL1|` 才进入旧兼容接收器，避免界面在“未识别文件”和“高速文件流”之间切换。新版发送端先发送 K 个系统源块，再发送 LT 喷泉修复帧；AFL2 协议处理移到独立线程，LT 接收在最多 768 块时增加低频二进制满秩补全。APK 会显示采集 FPS、分析 FPS、有效二维码 FPS、累计丢帧和实际分析分辨率，并提供可复制的诊断信息，包括设备型号、Camera2 FPS 能力、分析耗时、解码线程忙数、空结果、解码异常、新建缓冲区、ROI 跟踪/未命中、协议错误、最近有效帧延迟、接收字节和喷泉码解块进度。网页端也提供“复制诊断”，记录实际分辨率/FPS、Worker 就绪数、平均解码耗时、忙时丢弃、重启、错误、ROI 未识别、AFL2 唯一/重复/无效帧、协议序列跳跃、最近帧延迟、会话标识和有效载荷字节数。两端在本地完成 LT 解码、gzip 解压和 SHA-256 校验。

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

发送端二维码播放使用 `requestAnimationFrame` 和显示器真实时间戳节流。浏览器卡顿超过三个播放间隔时会丢弃积压节拍，避免恢复后瞬间跳过多帧；24/30/45/60/90/120 FPS 选项保持不变。AirFerry 没有专门的 50 FPS 预设，其界面常用 45 FPS；本项目同样保留 45 FPS 作为普通屏幕的中间档。

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

本项目保留 AirFerry 的 `AFL1` 接收代码用于读取旧发送端，但当前发送端不再暴露兼容模式，网页和 APK 统一使用 `AFL2`。`AFL2` 参考 `bashalarmistalt/decimen-optical-transfer` v0.3.0 的 MIT 实现，引入二进制 LT 喷泉码、固定掩码、发送端 lookahead 和并行解码。Decimen 当前 AGPL 版本的四二维码/RaptorQ 实现没有复制进 MIT 项目；后续若引入必须单独处理许可证、二进制协议和 Android 解码实现。

## 许可证

项目使用 MIT License。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
