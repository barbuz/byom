// Portable map archive: a `.byom` file is a plain ZIP holding `map.json` (map
// metadata plus reference points) and the original image bytes, so a map can be
// shared with another user and imported into their own BYOM.
//
// The archive deliberately does not store the fitted georeference: it is a pure
// function of the reference points (see `createGeoreference`), so it is
// recomputed on import. That keeps the file small and means a change to the
// similarity/affine/MLS ladder never invalidates an existing export.
//
// The writer is store-only (no compression): the image is already compressed
// and the JSON is tiny, so deflating would cost CPU on a phone for no gain. The
// reader accepts both STORE and DEFLATE, so an archive hand-built with a desktop
// zip tool still imports.

import { wrapLongitude } from './transforms.js';

export const ARCHIVE_FORMAT = 'byom-map';
export const ARCHIVE_FORMAT_VERSION = 1;
export const BYOM_EXTENSION = '.byom';
export const ARCHIVE_MIME = 'application/zip';
export const MAP_ENTRY_NAME = 'map.json';

// A `.byom` is a real ZIP; every local file header starts with this signature.
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// Bounds that keep a hostile or corrupt file from exhausting memory.
const MAX_ENTRIES = 32;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_REFERENCE_POINTS = 10000;

// Thrown when a file is not a BYOM archive at all (a random ZIP, a wrong file
// type) as opposed to a BYOM archive that is damaged. `MapList` turns this into
// a specific "this isn't a BYOM file" message rather than a generic failure.
export class NotByomError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotByomError';
  }
}

const notByom = (message) => new NotByomError(message);

const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
};

// ---------------------------------------------------------------- CRC-32

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/**
 * Standard CRC-32 (IEEE 802.3), as used by ZIP entries.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit checksum
 */
export function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------ byte helpers

function concatChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytesToStream(bytes) {
  // jsdom has no `Blob.stream()`, so the stream is built explicitly.
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function streamToBytes(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  return concatChunks(chunks);
}

async function inflateRaw(bytes) {
  const stream = bytesToStream(bytes).pipeThrough(new DecompressionStream('deflate-raw'));
  return streamToBytes(stream);
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

// ------------------------------------------------------------ ZIP writing

/**
 * Build a store-only ZIP from `{ name, data }` entries.
 * @param {Array<{name: string, data: Uint8Array}>} entries
 * @returns {Uint8Array}
 */
export function zipStore(entries) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, ZIP_LOCAL_SIGNATURE, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, ZIP_METHOD_STORE, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, ZIP_CENTRAL_SIGNATURE, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, ZIP_METHOD_STORE, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    localChunks.push(local, data);
    centralChunks.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, ZIP_EOCD_SIGNATURE, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concatChunks([...localChunks, ...centralChunks, eocd]);
}

// ------------------------------------------------------------ ZIP reading

function findEndOfCentralDirectory(view, byteLength) {
  const maxComment = 0xffff;
  const earliest = Math.max(0, byteLength - 22 - maxComment);
  for (let i = byteLength - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIGNATURE) return i;
  }
  return -1;
}

function assertSafeEntryName(name) {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid BYOM archive: unsafe entry name "${name}"`);
  }
}

/**
 * Read a ZIP (STORE or DEFLATE entries) into a name -> bytes map.
 * The central directory is authoritative; each entry's CRC-32 and declared
 * size are verified so truncation and corruption are caught.
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes.byteLength);
  if (eocd < 0) throw notByom('Not a BYOM archive: not a ZIP file');

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > MAX_ENTRIES) {
    throw new Error(`Invalid BYOM archive: too many entries (${entryCount})`);
  }

  const decoder = new TextDecoder();
  const entries = new Map();
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('Invalid BYOM archive: corrupt central directory');
    }
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    assertSafeEntryName(name);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Invalid BYOM archive: uncompressed size is too large');
    }

    if (view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error('Invalid BYOM archive: corrupt local header');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === ZIP_METHOD_STORE) {
      data = compressed;
    } else if (method === ZIP_METHOD_DEFLATE) {
      data = await inflateRaw(compressed);
    } else {
      throw new Error(`Invalid BYOM archive: unsupported compression method ${method}`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error(`Invalid BYOM archive: "${name}" is truncated`);
    }
    if (crc32(data) !== expectedCrc) {
      throw new Error(`Invalid BYOM archive: "${name}" failed its checksum`);
    }

    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// ------------------------------------------------------------- validation

function positiveIntOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function validateReferencePoint(point, index) {
  const label = `Reference point ${index + 1}`;
  if (!point || typeof point !== 'object') {
    throw new Error(`Invalid BYOM archive: ${label} is not an object`);
  }
  const u = Number(point.u);
  const v = Number(point.v);
  const lon = Number(point.lon);
  const lat = Number(point.lat);
  if (![u, v, lon, lat].every(Number.isFinite)) {
    throw new Error(`Invalid BYOM archive: ${label} has non-finite coordinates`);
  }
  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid BYOM archive: ${label} has an out-of-range latitude`);
  }

  let accuracy = null;
  if (point.accuracy !== null && point.accuracy !== undefined && point.accuracy !== '') {
    const value = Number(point.accuracy);
    if (Number.isFinite(value)) accuracy = value;
  }

  return { u, v, lon: wrapLongitude(lon), lat, accuracy };
}

function validateDocument(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Not a BYOM archive: map.json is not an object');
  }
  if (doc.format !== ARCHIVE_FORMAT) {
    throw new Error('Not a BYOM archive: unexpected format');
  }
  const version = doc.formatVersion;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Invalid BYOM archive: missing or invalid formatVersion');
  }

  const warnings = [];
  if (version > ARCHIVE_FORMAT_VERSION) {
    warnings.push(
      `This map was saved by a newer version of BYOM (format ${version}); ` +
      'it was imported on a best-effort basis and some details may be missing.',
    );
  }

  const source = doc.map;
  if (!source || typeof source !== 'object') {
    throw new Error('Invalid BYOM archive: missing map metadata');
  }
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : 'Imported map';
  const imageFile = typeof source.imageFile === 'string' ? source.imageFile : '';
  if (!imageFile) {
    throw new Error('Invalid BYOM archive: missing image reference');
  }
  const imageMime = typeof source.imageMime === 'string' && source.imageMime
    ? source.imageMime
    : 'application/octet-stream';

  const rawPoints = Array.isArray(doc.referencePoints) ? doc.referencePoints : [];
  if (rawPoints.length > MAX_REFERENCE_POINTS) {
    throw new Error(`Invalid BYOM archive: too many reference points (${rawPoints.length})`);
  }

  return {
    warnings,
    map: {
      name,
      imageFile,
      imageMime,
      imageWidth: positiveIntOrNull(source.imageWidth),
      imageHeight: positiveIntOrNull(source.imageHeight),
      createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : null,
    },
    referencePoints: rawPoints.map(validateReferencePoint),
  };
}

// ------------------------------------------------------------ public API

function extensionForMime(mime) {
  return MIME_EXTENSIONS[mime] ?? '.img';
}

function appVersion() {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
}

/**
 * A filesystem-safe `.byom` filename derived from a map name.
 * @param {string} name
 * @returns {string}
 */
export function suggestedArchiveName(name) {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned || 'map'}${BYOM_EXTENSION}`;
}

/**
 * Whether a picked file looks like a `.byom` archive: either the extension, or
 * a ZIP MIME type confirmed by the ZIP magic bytes.
 * @param {File|Blob} file
 * @returns {Promise<boolean>}
 */
export async function isByomFile(file) {
  if (!file) return false;
  if ((file.name ?? '').toLowerCase().endsWith(BYOM_EXTENSION)) return true;
  if (file.type === ARCHIVE_MIME || file.type === 'application/x-zip-compressed') {
    if (typeof file.slice !== 'function') return true;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return ZIP_MAGIC.every((byte, index) => head[index] === byte);
  }
  return false;
}

/**
 * Serialise a map and its reference points into a `.byom` blob.
 * @param {Object} params
 * @param {Object} params.map - map record: { name, imageWidth, imageHeight, timestamp }
 * @param {Array<Object>} [params.referencePoints]
 * @param {Blob} params.imageBlob
 * @returns {Promise<Blob>}
 */
export async function buildMapArchive({ map, referencePoints = [], imageBlob }) {
  if (!imageBlob) throw new Error('Cannot export a map without its image');

  const imageMime = imageBlob.type || 'image/png';
  const imageFile = `image${extensionForMime(imageMime)}`;

  const document = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    app: { name: 'BYOM', version: appVersion() },
    exportedAt: new Date().toISOString(),
    map: {
      name: map?.name ?? 'Untitled map',
      imageWidth: map?.imageWidth ?? null,
      imageHeight: map?.imageHeight ?? null,
      imageFile,
      imageMime,
      createdAt: Number.isFinite(map?.timestamp) ? map.timestamp : null,
    },
    referencePoints: referencePoints.map((point) => {
      const serialized = { u: point.u, v: point.v, lon: point.lon, lat: point.lat };
      if (point.accuracy !== null && point.accuracy !== undefined) {
        serialized.accuracy = point.accuracy;
      }
      return serialized;
    }),
  };

  const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  const jsonBytes = new TextEncoder().encode(JSON.stringify(document, null, 2));
  const zip = zipStore([
    { name: MAP_ENTRY_NAME, data: jsonBytes },
    { name: imageFile, data: imageBytes },
  ]);

  return new Blob([zip], { type: ARCHIVE_MIME });
}

/**
 * Parse a `.byom` blob back into a map record, its reference points and the
 * image blob. Throws a descriptive error for anything that is not a valid
 * archive; returns `warnings` for an archive written by a newer format version.
 * @param {Blob} blob
 * @returns {Promise<{map: Object, referencePoints: Array<Object>, imageBlob: Blob, warnings: Array<string>}>}
 */
export async function readMapArchive(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = await unzip(bytes);

  const documentBytes = entries.get(MAP_ENTRY_NAME);
  if (!documentBytes) {
    throw notByom(`Not a BYOM archive: missing ${MAP_ENTRY_NAME}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(documentBytes));
  } catch {
    throw new Error('Not a BYOM archive: map.json is not valid JSON');
  }

  const { map, referencePoints, warnings } = validateDocument(parsed);

  const imageBytes = entries.get(map.imageFile);
  if (!imageBytes) {
    throw new Error(`Invalid BYOM archive: missing its image (${map.imageFile})`);
  }

  return {
    map,
    referencePoints,
    imageBlob: new Blob([imageBytes], { type: map.imageMime }),
    warnings,
  };
}
