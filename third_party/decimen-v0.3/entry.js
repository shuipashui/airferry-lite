import {
  HEADER_LEN,
  MAX_FILE_BYTES,
  fnv1a,
  packFile,
  unpackFile,
  verifyFile,
  packFrame,
  parseFrame,
  streamIdentity
} from "./protocol.ts";
import { LTEncoder, LTDecoder, frameIndices, solitonCdf } from "./fountain.ts";

globalThis.AirFerryHighSpeed = Object.freeze({
  HEADER_LEN,
  MAX_FILE_BYTES,
  fnv1a,
  packFile,
  unpackFile,
  verifyFile,
  packFrame,
  parseFrame,
  streamIdentity,
  LTEncoder,
  LTDecoder,
  frameIndices,
  solitonCdf
});
