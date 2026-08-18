# Third-party notices

## qrcode-generator

Used by the standalone sender to render QR matrices. MIT licensed, Copyright (c) Kazuhiko Arase. The vendored file is `sender/vendor/qrcode.js`.

## jsQR

Used by the mobile web receiver to decode camera frames. The original license is included at `web-receiver/vendor/jsQR-LICENSE.txt`; the vendored file is `web-receiver/vendor/jsQR.js`.

## zxing-android-embedded

The Android receiver declares `com.journeyapps:zxing-android-embedded:4.3.0`, which brings the ZXing Android barcode scanner. Its transitive license notices are distributed by the upstream project and Maven artifacts.

## Decimen Optical Transfer v0.3.0

The AFL2 binary frame container, LT fountain implementation, and bundled ZXing decode worker are derived from Decimen Optical Transfer v0.3.0 by Evan Crawley (Bash Alarmist). Version 0.3.0 is MIT licensed. Source and the complete license text are retained under `third_party/decimen-v0.3/`.

Project: https://github.com/bashalarmistalt/decimen-optical-transfer/tree/v0.3.0

Only the MIT-licensed v0.3.0 implementation is used. Code from later AGPL-3.0 releases is not included.

## zxing-wasm / zxing-cpp

The high-speed receiver includes the `zxing-wasm` 2.x QR decoder bundle used by Decimen v0.3.0. `zxing-wasm` is MIT licensed and bundles ZXing-C++, which is Apache-2.0 licensed.
