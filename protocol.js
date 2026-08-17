/* AirFerry Lite transfer protocol. MIT licensed project code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AirFerryLiteProtocol = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MAGIC = "AFL1";

  function crc32(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function hex32(value) {
    return (value >>> 0).toString(16).padStart(8, "0");
  }

  function base64UrlEncode(bytes) {
    let binary = "";
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const step = 0x8000;
    for (let offset = 0; offset < data.length; offset += step) {
      binary += String.fromCharCode(...data.subarray(offset, offset + step));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function utf8Encode(value) {
    return new TextEncoder().encode(value || "");
  }

  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function makeSessionId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return base64UrlEncode(bytes).slice(0, 11);
  }

  function makeHeader(meta) {
    return [
      MAGIC, "H", meta.session,
      base64UrlEncode(utf8Encode(meta.name || "download.bin")),
      base64UrlEncode(utf8Encode(meta.mime || "application/octet-stream")),
      String(meta.size), String(meta.chunkSize), String(meta.total), hex32(meta.fileCrc)
    ].join("|");
  }

  function makeData(session, index, total, bytes) {
    return [MAGIC, "D", session, String(index), String(total), hex32(crc32(bytes)), base64UrlEncode(bytes)].join("|");
  }

  function parseFrame(text) {
    if (typeof text !== "string") return null;
    const fields = text.split("|");
    if (fields[0] !== MAGIC) return null;
    if (fields[1] === "H" && fields.length === 9) {
      try {
        return {
          kind: "header", session: fields[2], name: utf8Decode(base64UrlDecode(fields[3])),
          mime: utf8Decode(base64UrlDecode(fields[4])) || "application/octet-stream",
          size: Number(fields[5]), chunkSize: Number(fields[6]), total: Number(fields[7]),
          fileCrc: Number.parseInt(fields[8], 16) >>> 0
        };
      } catch (_) { return null; }
    }
    if (fields[1] === "D" && fields.length === 7) {
      try {
        const bytes = base64UrlDecode(fields[6]);
        return {
          kind: "data", session: fields[2], index: Number(fields[3]), total: Number(fields[4]),
          chunkCrc: Number.parseInt(fields[5], 16) >>> 0, bytes
        };
      } catch (_) { return null; }
    }
    return null;
  }

  function makeTransfer(fileBytes, meta) {
    const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
    const chunkSize = meta.chunkSize || 700;
    const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
    const session = meta.session || makeSessionId();
    const descriptor = makeHeader({
      session, name: meta.name, mime: meta.mime, size: bytes.length,
      chunkSize, total, fileCrc: crc32(bytes)
    });
    const frames = [descriptor];
    for (let index = 0; index < total; index += 1) {
      const start = index * chunkSize;
      frames.push(makeData(session, index, total, bytes.subarray(start, Math.min(start + chunkSize, bytes.length))));
    }
    return { session, frames, total, chunkSize, fileCrc: crc32(bytes) };
  }

  return { MAGIC, crc32, hex32, base64UrlEncode, base64UrlDecode, utf8Encode, utf8Decode,
    makeSessionId, makeHeader, makeData, parseFrame, makeTransfer };
});
