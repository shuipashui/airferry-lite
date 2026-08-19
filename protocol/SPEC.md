# AirFerry Lite Protocol

AirFerry Lite uses a compact text protocol designed for QR video streams. Frames may arrive out of order and may be repeated.

## Encoding

Fields are UTF-8 text separated by `|`. Binary fields use URL-safe Base64 without padding. CRC values are eight lowercase hexadecimal digits.

## Frames

```text
AFL1|H|session|nameBase64|mimeBase64|size|chunkSize|total|fileCrc32
AFL1|H|session|nameBase64|mimeBase64|transferSize|chunkSize|total|transferCrc32|originalSize|originalCrc32|gzip
AFL1|D|session|index|total|chunkCrc32|payloadBase64
AFL1|P|session|groupStart|count|total|seed32|repairCrc32|payloadBase64
```

### Header ( `H` )

The header describes one transfer session. It is repeated throughout playback so a receiver can join mid-stream.

- `session`: random transfer identifier
- `size` / `transferSize`: transmitted payload size in bytes
- `chunkSize`: full data-fragment size
- `total`: `max(1, ceil(size / chunkSize))`
- `fileCrc32` / `transferCrc32`: CRC-32 of the complete transmitted payload
- The optional 12-field header is emitted only when gzip was selected. It records the original size and CRC so receivers verify both the compressed transport and the restored file. The 9-field header remains the raw-data compatibility format.

### Data ( `D` )

- `index` starts at zero.
- `chunkCrc32` covers the decoded payload bytes.
- Every non-final fragment must contain exactly `chunkSize` bytes.
- The final fragment contains the remaining bytes and may be empty for a zero-byte file.

### Linear repair ( `P` )

A repair frame covers `count` consecutive data fragments beginning at `groupStart`. Its payload is `chunkSize` bytes. The sender derives one non-zero GF(256) coefficient per covered fragment from the 32-bit `seed32`, then stores the coefficient-weighted sum of all fragments. Shorter final fragments are zero-padded.

Receivers keep distinct repair frames by seed. With one missing fragment, any valid repair frame can recover it. With multiple losses in one group, independent repair frames from later playback rounds are combined as a small GF(256) linear system. The sender emits a fresh seed for the same group on every playback round, so repair information is not repeated while the QR stream loops.

Current sender defaults:

- group size: 8 data fragments
- one repair frame per eligible group per playback round
- repair frame omitted for transfers smaller than four fragments

The outer frame remains text/Base64 for compatibility; old 8-field XOR `P` frames are still accepted as legacy repairs.

## Validation

The web receiver currently enforces:

- maximum file size: 64 MiB
- maximum fragment size: 4096 bytes
- maximum fragment count: 200000
- exact fragment length checks
- CRC-32 for every received data or repair frame
- final size and file CRC-32 verification
- original size and CRC-32 verification after gzip decompression

Frames from another session, malformed numeric fields, invalid group ranges and duplicate fragments are ignored.

## Compatibility

The outer magic remains `AFL1`. Receivers that only understand `H` and `D` should ignore unknown `P` frames and continue receiving repeated data frames. Senders keep the original `frames` collection (header plus data) and expose parity-aware `playbackFrames` separately.
## AFL2 高速协议

当前发送端、网页接收端和 Android APK 都使用 Decimen Optical Transfer v0.3.0 的 MIT 二进制协议：每帧为 20 字节小端头部加 `blockLen` 字节 XOR 喷泉块。首字节为 `0xD1`；次字节区分布局和是否系统帧（`0x0C` 单码修复、`0x0D` 四码修复、`0x0E` 单码系统、`0x0F` 四码系统）。其后字段依次为 sessionId、seq、k、blockLen、totalLen 和 payloadFNV。接收端可按任意顺序收帧，LT 解码器在约 `1.15 × k` 个有效帧后恢复容器。

发送端固定 QR ECC-L、掩码 4。单码最大帧 2953 字节（QR V40-L，其中 2933 字节为喷泉块）；四码每码上限 1003 字节（QR V22-L）。网页接收端使用 2 或 3 个 ZXing WASM Worker，忙时丢弃摄像帧、不排队。Android APK 用 zxing-cpp 读 CameraX Y 平面。网页和 APK 仍可接收上文 `AFL1` 文本流，但当前发送端不再发出 `AFL1`。
