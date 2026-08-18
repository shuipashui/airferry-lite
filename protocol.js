/* AirFerry Lite transfer protocol. MIT licensed project code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AirFerryLiteProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this), function () {
  const MAGIC = "AFL1";
  const DEFAULT_PARITY_GROUP_SIZE = 8;
  const GF_MUL = new Uint8Array(256 * 256);
  const GF_INV = new Uint8Array(256);
  for (let a = 0; a < 256; a += 1) for (let b = 0; b < 256; b += 1) {
    let aa = a, bb = b, value = 0;
    while (bb) { if (bb & 1) value ^= aa; aa <<= 1; if (aa & 0x100) aa ^= 0x11d; bb >>>= 1; }
    GF_MUL[(a << 8) | b] = value;
  }
  for (let value = 1; value < 256; value += 1) for (let candidate = 1; candidate < 256; candidate += 1) {
    if (GF_MUL[(value << 8) | candidate] === 1) { GF_INV[value] = candidate; break; }
  }

  function crc32(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function hex32(value) {
    return (value >>> 0).toString(16).padStart(8, "0");
  }

  function repairSeedFor(session, groupStart, round = 0) {
    let hash = 2166136261 >>> 0;
    const text = session + "|" + groupStart + "|" + round;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
    return (hash || 1) >>> 0;
  }

  function repairCoefficients(seed, count) {
    let state = (seed >>> 0) || 1;
    const coefficients = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      state ^= state << 13; state >>>= 0; state ^= state >>> 17; state >>>= 0; state ^= state << 5; state >>>= 0;
      coefficients[i] = (state & 255) || 1;
    }
    return coefficients;
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
    const fields = [
      MAGIC, "H", meta.session,
      base64UrlEncode(utf8Encode(meta.name || "download.bin")),
      base64UrlEncode(utf8Encode(meta.mime || "application/octet-stream")),
      String(meta.size), String(meta.chunkSize), String(meta.total), hex32(meta.fileCrc)
    ];
    if (meta.encoding && meta.encoding !== "raw") {
      fields.push(String(meta.originalSize), hex32(meta.originalFileCrc), meta.encoding);
    }
    return fields.join("|");
  }

  function makeData(session, index, total, bytes) {
    return [MAGIC, "D", session, String(index), String(total), hex32(crc32(bytes)), base64UrlEncode(bytes)].join("|");
  }

  function makeParity(session, groupStart, count, total, seed, bytes) {
    if (bytes === undefined) { bytes = seed; seed = 0; }
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    return seed ? [MAGIC, "P", session, String(groupStart), String(count), String(total), hex32(seed), hex32(crc32(bytes)), base64UrlEncode(bytes)].join("|") : [MAGIC, "P", session, String(groupStart), String(count), String(total), hex32(crc32(bytes)), base64UrlEncode(bytes)].join("|");
  }

  function makeRepairFrame(transfer, groupStart, round = 0) {
    const count = Math.min(transfer.parityGroupSize, transfer.total - groupStart);
    const seed = repairSeedFor(transfer.session, groupStart, round);
    const coefficients = repairCoefficients(seed, count);
    const repair = new Uint8Array(transfer.chunkSize);
    for (let offset = 0; offset < count; offset += 1) {
      const chunk = transfer.chunks[groupStart + offset];
      const coefficient = coefficients[offset];
      for (let index = 0; index < chunk.length; index += 1) repair[index] ^= GF_MUL[(coefficient << 8) | chunk[index]];
    }
    return makeParity(transfer.session, groupStart, count, transfer.total, seed, repair);
  }

  function parseFrame(text) {
    if (typeof text !== "string") return null;
    const fields = text.split("|");
    if (fields[0] !== MAGIC) return null;
    if (fields[1] === "H" && (fields.length === 9 || fields.length === 12)) {
      try {
        const compressed = fields.length === 12;
        return {
          kind: "header", session: fields[2], name: utf8Decode(base64UrlDecode(fields[3])),
          mime: utf8Decode(base64UrlDecode(fields[4])) || "application/octet-stream",
          size: Number(fields[5]), chunkSize: Number(fields[6]), total: Number(fields[7]),
          fileCrc: Number.parseInt(fields[8], 16) >>> 0,
          originalSize: compressed ? Number(fields[9]) : Number(fields[5]),
          originalFileCrc: compressed ? Number.parseInt(fields[10], 16) >>> 0 : Number.parseInt(fields[8], 16) >>> 0,
          encoding: compressed ? fields[11] : "raw"
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
    if (fields[1] === "P" && (fields.length === 8 || fields.length === 9)) {
      try {
        const legacy = fields.length === 8;
        const seed = legacy ? 0 : Number.parseInt(fields[6], 16) >>> 0;
        const crcField = legacy ? fields[6] : fields[7];
        const payloadField = legacy ? fields[7] : fields[8];
        const bytes = base64UrlDecode(payloadField);
        return { kind: "parity", session: fields[2], groupStart: Number(fields[3]), count: Number(fields[4]), total: Number(fields[5]), seed, coefficients: legacy ? null : repairCoefficients(seed, Number(fields[4])), parityCrc: Number.parseInt(crcField, 16) >>> 0, bytes };
      } catch (_) { return null; }
    }
    return null;
  }

  function makeTransfer(fileBytes, meta) {
    const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
    const chunkSize = meta.chunkSize || 700;
    const parityGroupSize = Math.max(2, Math.min(32, meta.parityGroupSize || DEFAULT_PARITY_GROUP_SIZE));
    const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
    const session = meta.session || makeSessionId();
    const descriptor = makeHeader({
      session, name: meta.name, mime: meta.mime, size: bytes.length,
      chunkSize, total, fileCrc: crc32(bytes), encoding: meta.encoding || "raw",
      originalSize: meta.originalSize ?? bytes.length,
      originalFileCrc: meta.originalFileCrc ?? crc32(bytes)
    });
    const frames = [descriptor];
    const dataFrames = [];
    const chunks = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * chunkSize;
      const chunk = bytes.slice(start, Math.min(start + chunkSize, bytes.length));
      chunks.push(chunk);
      const frame = makeData(session, index, total, chunk);
      frames.push(frame);
      dataFrames.push(frame);
    }

    const repairFrames = [];
    const playbackFrames = [];
    for (let groupStart = 0; groupStart < total; groupStart += parityGroupSize) {
      const count = Math.min(parityGroupSize, total - groupStart);
      for (let offset = 0; offset < count; offset += 1) playbackFrames.push(dataFrames[groupStart + offset]);
      if (total >= 4 && count >= 2) {
        const repair = makeRepairFrame({ session, total, chunkSize, parityGroupSize, chunks }, groupStart, 0);
        repairFrames.push(repair);
        playbackFrames.push(repair);
      }
    }

    return {
      session, frames, dataFrames, repairFrames, playbackFrames, chunks, total, chunkSize,
      parityGroupSize, fileCrc: crc32(bytes), encoding: meta.encoding || "raw",
      originalSize: meta.originalSize ?? bytes.length,
      originalFileCrc: meta.originalFileCrc ?? crc32(bytes)
    };
  }

  async function preparePayload(input, minSavings = 0.05) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const raw = { bytes, encoding: "raw", originalSize: bytes.length, originalFileCrc: crc32(bytes), savedBytes: 0 };
    if (bytes.length < 1024 || typeof CompressionStream === "undefined") return raw;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      if (compressed.length + 32 >= bytes.length * (1 - minSavings)) return raw;
      return { bytes: compressed, encoding: "gzip", originalSize: bytes.length, originalFileCrc: raw.originalFileCrc, savedBytes: bytes.length - compressed.length };
    } catch (_) { return raw; }
  }

  async function restorePayload(input, meta) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!meta?.encoding || meta.encoding === "raw") return bytes;
    if (meta.encoding !== "gzip" || typeof DecompressionStream === "undefined") throw new Error("Unsupported compression: " + meta.encoding);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return {
    MAGIC, DEFAULT_PARITY_GROUP_SIZE, crc32, hex32, base64UrlEncode, base64UrlDecode,
    utf8Encode, utf8Decode, makeSessionId, makeHeader, makeData, makeParity, makeRepairFrame, repairSeedFor, repairCoefficients, gfMul: (a, b) => GF_MUL[(a << 8) | b], gfInv: value => GF_INV[value], parseFrame, makeTransfer, preparePayload, restorePayload
  };
});
