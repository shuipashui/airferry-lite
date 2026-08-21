# AirFerry Lite

电脑浏览器把文件编成连续二维码，手机摄像头扫回来，不经过服务器。

- 发送端：单文件 HTML，可直接打开，并显示手机接收页地址和二维码
- 网页接收端：https://shuipashui.github.io/airferry-lite/
- Android 接收端：原生应用，Android 10+
- 当前传输为 AFL2（二进制帧 + 喷泉码）；旧 AFL1 发送端仍可接收
- 文件只在发送电脑和接收手机本地处理

## 使用

- 发送端：https://shuipashui.github.io/airferry-lite/sender/dist/airferry-lite-sender.html
- 网页接收端也可从发送页右侧的地址 / 二维码进入；开始播放文件码流后该入口会隐藏

1. 在电脑打开发送端，选择文件。
2. 选择布局和帧率，点击「生成二维码流」。四码可窗口播放；全屏模块更大、更稳。
3. 手机打开网页接收端或安装 APK，允许摄像头并开始扫描。APK 可在标题行切换相机 30/60/120（默认 60；达不到会回落）。
4. 对准二维码保持稳定。网页收完后下载文件；APK 收完后点「保存文件」，不会自动写入。点进度条可展开完整诊断，相机画面大小不变。

网页接收端需要 HTTPS 才能打开摄像头。Chrome 若一直停在旧版，可清掉该站数据后再打开。

## 推荐参数

面向常见 60 Hz 电脑屏。发送端会按实测刷新率对齐播放。

| 场景 | 参数 |
|---|---|
| 单码 | **2953 B · 30 FPS**（打开发送端即预填；也可改 2331 / 1465 B） |
| 四码 | **1465 B · 30 FPS**（每码上限 1465 B；也可改 1273 / 1003 B。全屏模块更大） |
| 较远或摩尔纹明显 | 单码 1465 B，或四码 1003 B · 24/30 FPS |
| 不要用 | 单码 60/120 FPS；60 Hz 屏上的四码 60 FPS（拖影，实测更慢）；45 FPS（60 Hz 上等于 30） |

## 限制

- 单次文件上限 64 MiB。
- 刷新网页或关掉应用会丢失当前 AFL2 进度，需要重新扫描。
- 速度受屏幕亮度、摩尔纹、对焦、手机性能和反光影响。
- 四码全屏更稳；APK 在窗口模式下也可以收。
- gzip 传输需要接收端支持 `DecompressionStream`；当前 Android Chrome 和 Android 应用均支持。

## 目录

```text
index.html / app.js / sw.js                 网页接收端（GitHub Pages 根目录）
sender/dist/airferry-lite-sender.html       单文件发送端
sender/                                     发送端源码
android-receiver/                           Android 应用
shared/                                     AFL1 / AFL2 协议
protocol/SPEC.md                            线协议说明
tests/                                      测试
```

## 本地构建

需要 Node.js 18+。

```powershell
npm test
npm run build:sender
npm run build
```

`npm run build` 会生成协议 bundle、同步网页接收端镜像，再生成单文件发送端。

Android 调试包需要 Java 17 和 Android SDK Platform 35：

```powershell
cd android-receiver
.\build-local.ps1 assembleDebug
```

APK 输出为 `android-receiver/app/build/outputs/apk/debug/app-debug.apk`。也可从 GitHub Actions 工作流 `Build Android receiver` 下载 `airferry-lite-android-debug`。

## 和 AirFerry / Decimen 的关系

当前发送 AFL2，参考 [decimen-optical-transfer](https://github.com/bashalarmistalt/decimen-optical-transfer) v0.3.0（MIT）：二进制 LT 喷泉码、固定掩码、发送端 lookahead。网页用 ZXing WASM 解码，Android 用 zxing-cpp。Decimen 后续 AGPL 版本的四码 / RaptorQ 没有纳入本项目。旧 AFL1 接收代码仍保留，用于读取旧发送端。

## 许可证

MIT License。第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
