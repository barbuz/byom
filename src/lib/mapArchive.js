// Portable map archive: a `.byom` file is a plain ZIP holding `map.json` (map
// metadata plus reference points) and the original image bytes, so a map can be
// shared with another user and imported into their own BYOM.
//
// The archive deliberately does not store the fitted georeference: it is a pure
// function of the reference points (see `createGeoreference`), so it is
// recomputed on import. That keeps the file small and means a change to the
// similarity/affine/MLS ladder never invalidates an existing export.
//
// The ZIP container itself is fflate's (no hand-rolled byte parsing). We write
// store-only (the image is already compressed and the JSON is tiny, so
// deflating would cost CPU on a phone for no gain) but read STORE and DEFLATE
// alike, so an archive hand-built with a desktop zip tool still imports.
//
// fflate verifies neither an entry's CRC-32 nor its name, and inflates before
// checking anything, so `unzip` keeps that policy: it reads the declared CRCs,
// sizes and methods from the central directory and rejects an oversized or
// unsupported archive *before* inflating, then verifies each entry's name,
// size and CRC-32 afterwards.

import { unzipSync, zipSync } from 'fflate';
import { wrapLongitude } from './transforms.js';

export const ARCHIVE_FORMAT = 'byom-map';
export const ARCHIVE_FORMAT_VERSION = 1;
export const BYOM_EXTENSION = '.byom';
export const ARCHIVE_MIME = 'application/zip';
export const MAP_ENTRY_NAME = 'map.json';

// A `.byom` is a real ZIP; every local file header starts with this signature.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

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

// ------------------------------------------------------- ZIP container

// The container is fflate's; the policy around it is ours. fflate verifies
// neither an entry's CRC-32 nor its name, and it will inflate a bomb, so the
// checks below are not redundant.

function assertSafeEntryName(name) {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid BYOM archive: unsafe entry name "${name}"`);
  }
}

/**
 * The metadata each entry declares, read from the central directory. fflate
 * does not expose any of it, and it inflates before checking anything, so the
 * declared sizes and methods are read here to reject a decompression bomb
 * *before* handing the bytes to fflate.
 * @param {Uint8Array} bytes
 * @returns {Map<string, {crc: number, size: number}>}
 */
function declaredEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxComment = 0xffff;
  const earliest = Math.max(0, bytes.byteLength - 22 - maxComment);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) throw notByom('Not a BYOM archive: not a ZIP file');

  const entryCount = view.getUint16(eocd + 10, true);
  if (entryCount > MAX_ENTRIES) {
    throw new Error(`Invalid BYOM archive: too many entries (${entryCount})`);
  }

  const decoder = new TextDecoder();
  const entries = new Map();
  let totalDeclared = 0;
  let cursor = view.getUint32(eocd + 16, true);
  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('Invalid BYOM archive: corrupt central directory');
    }
    const method = view.getUint16(cursor + 10, true);
    if (method !== ZIP_METHOD_STORE && method !== ZIP_METHOD_DEFLATE) {
      throw new Error(`Invalid BYOM archive: unsupported compression method ${method}`);
    }
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error('Invalid BYOM archive: corrupt local header');
    }

    totalDeclared += size;
    if (totalDeclared > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Invalid BYOM archive: uncompressed size is too large');
    }
    entries.set(name, { crc, size });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Read a ZIP (STORE or DEFLATE entries) into a name -> bytes map. fflate does
 * the inflating; this verifies each entry's name, declared size and CRC-32, so
 * truncation and corruption are still caught.
 * @param {Uint8Array} bytes
 * @returns {Map<string, Uint8Array>}
 */
export function unzip(bytes) {
  const declared = declaredEntries(bytes);

  let raw;
  try {
    raw = unzipSync(bytes);
  } catch {
    throw new Error('Invalid BYOM archive: could not decompress its contents');
  }

  const entries = new Map();
  for (const [name, data] of Object.entries(raw)) {
    assertSafeEntryName(name);

    // fflate enumerates entries from the central directory, so every name it
    // returns was recorded above.
    const entry = declared.get(name);
    if (data.length !== entry.size) {
      throw new Error(`Invalid BYOM archive: "${name}" is truncated`);
    }
    if (crc32(data) !== entry.crc) {
      throw new Error(`Invalid BYOM archive: "${name}" failed its checksum`);
    }

    entries.set(name, data);
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
  const zip = zipSync(
    { [MAP_ENTRY_NAME]: jsonBytes, [imageFile]: imageBytes },
    { level: 0 },
  );

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
  const entries = unzip(bytes);

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
