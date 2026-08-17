# AirFerry Lite Protocol

AirFerry Lite uses a compact text protocol designed for QR video streams. Frames may arrive out of order and may be repeated.

## Encoding

Fields are UTF-8 text separated by `|`. Binary fields use URL-safe Base64 without padding. CRC values are eight lowercase hexadecimal digits.

## Frames

`text
AFL1|H|session|nameBase64|mimeBase64|size|chunkSize|total|fileCrc32
AFL1|D|session|index|total|chunkCrc32|payloadBase64
AFL1|P|session|groupStart|count|total|parityCrc32|payloadBase64
`

### Header ( `H` )

The header describes one transfer session. It is repeated throughout playback so a receiver can join mid-stream.

- `session`: random transfer identifier
- `size`: original file size in bytes
- `chunkSize`: full data-fragment size
- `total`: `max(1, ceil(size / chunkSize))`
- `fileCrc32`: CRC-32 of the complete original file

### Data ( `D` )

- `index` starts at zero.
- `chunkCrc32` covers the decoded payload bytes.
- Every non-final fragment must contain exactly `chunkSize` bytes.
- The final fragment contains the remaining bytes and may be empty for a zero-byte file.

### XOR repair ( `P` )

A repair frame covers `count` consecutive data fragments beginning at `groupStart`. Its payload is `chunkSize` bytes. Each byte is the XOR of the corresponding byte in all covered fragments; shorter final fragments are treated as zero-padded.

If exactly one covered data fragment is missing, the receiver reconstructs it by XORing the repair payload with all other fragments in that group, then truncates the result to the expected fragment length.

Current sender defaults:

- group size: 8 data fragments
- repair frame omitted for transfers smaller than four fragments
- one repair frame per eligible group

A repair frame cannot recover two or more simultaneous losses in the same group. Receivers therefore continue accepting repeated data and repair frames across playback rounds.

## Validation

The web receiver currently enforces:

- maximum file size: 64 MiB
- maximum fragment size: 4096 bytes
- maximum fragment count: 200000
- exact fragment length checks
- CRC-32 for every received data or repair frame
- final size and file CRC-32 verification

Frames from another session, malformed numeric fields, invalid group ranges and duplicate fragments are ignored.

## Compatibility

The outer magic remains `AFL1`. Receivers that only understand `H` and `D` should ignore unknown `P` frames and continue receiving repeated data frames. Senders keep the original `frames` collection (header plus data) and expose parity-aware `playbackFrames` separately.
