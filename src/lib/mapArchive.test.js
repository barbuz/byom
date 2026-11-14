import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  MAP_ENTRY_NAME,
  NotByomError,
  buildMapArchive,
  crc32,
  isByomFile,
  readMapArchive,
  suggestedArchiveName,
  unzip,
} from './mapArchive.js';

const encoder = new TextEncoder();

/** Build a store-only ZIP, the way `buildMapArchive` writes one. */
function zipStore(entries) {
  const files = {};
  for (const entry of entries) files[entry.name] = entry.data;
  return zipSync(files, { level: 0 });
}

function concat(chunks) {
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

async function deflateRaw(bytes) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new CompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(chunks);
}

/** Build a ZIP by hand with an explicit method, to exercise foreign archives. */
async function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const method = entry.method ?? 0;
    const data = entry.data;
    const stored = method === 8 ? await deflateRaw(data) : data;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    local.push(lh, stored);
    central.push(ch);
    offset += lh.length + stored.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concat([...local, ...central, eocd]);
}

/** Byte offset of the central directory, from the trailing EOCD record. */
function centralDirectoryOffset(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  return view.getUint32(zip.byteLength - 22 + 16, true);
}

/** Central-directory metadata (method + sizes) for each entry, by name. */
function centralEntries(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const count = view.getUint16(zip.byteLength - 22 + 10, true);
  const entries = {};
  let cursor = centralDirectoryOffset(zip);
  for (let i = 0; i < count; i += 1) {
    const nameLength = view.getUint16(cursor + 28, true);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    entries[name] = {
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
    };
    cursor += 46 + nameLength
      + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return entries;
}

describe('crc32', () => {
  it('matches the standard CRC-32 check value', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipStore / unzip', () => {
  it('round-trips stored entries', async () => {
    const zip = zipStore([
      { name: 'a.txt', data: encoder.encode('hello') },
      { name: 'b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const entries = unzip(zip);
    expect(new TextDecoder().decode(entries.get('a.txt'))).toBe('hello');
    expect(Array.from(entries.get('b.bin'))).toEqual([0, 1, 2, 255]);
  });

  it('reads a deflate-compressed archive, as a desktop zip tool would write', async () => {
    const payload = encoder.encode('deflate me '.repeat(100));
    const zip = await buildZip([{ name: MAP_ENTRY_NAME, data: payload, method: 8 }]);
    const entries = unzip(zip);
    // A DecompressionStream output is a cross-realm Uint8Array, so compare
    // contents rather than instances.
    expect(Array.from(entries.get(MAP_ENTRY_NAME))).toEqual(Array.from(payload));
  });

  it('rejects a non-ZIP blob', async () => {
    expect(() => unzip(encoder.encode('not a zip'))).toThrow(/not a ZIP/i);
  });

  it('rejects an entry whose checksum does not match', async () => {
    const zip = zipStore([{ name: 'a.txt', data: encoder.encode('hello') }]);
    zip[centralDirectoryOffset(zip) - 1] ^= 0xff; // corrupt the stored data
    expect(() => unzip(zip)).toThrow(/checksum/i);
  });

  it('rejects an entry whose declared size does not match its data', async () => {
    const zip = zipStore([{ name: 'a.txt', data: encoder.encode('hello') }]);
    const central = centralDirectoryOffset(zip);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint32(central + 24, 6, true); // claim one byte more than stored
    expect(() => unzip(zip)).toThrow(/truncated/i);
  });

  it('rejects an unsupported compression method', async () => {
    const zip = zipStore([{ name: 'a.txt', data: encoder.encode('hello') }]);
    const central = centralDirectoryOffset(zip);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint16(central + 10, 99, true);
    expect(() => unzip(zip)).toThrow(/compression method/i);
  });

  it('rejects an unsafe entry name', async () => {
    const zip = zipStore([{ name: '../evil.txt', data: encoder.encode('x') }]);
    expect(() => unzip(zip)).toThrow(/unsafe entry name/i);
  });

  it('rejects an archive with too many entries', async () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({
      name: `f${i}.txt`,
      data: encoder.encode('x'),
    }));
    const zip = zipStore(entries);
    expect(() => unzip(zip)).toThrow(/too many entries/i);
  });
});

const SAMPLE_MAP = {
  name: 'Old town plan',
  imageWidth: 800,
  imageHeight: 600,
  timestamp: 1700000000000,
};

const SAMPLE_POINTS = [
  { u: 0.125, v: 0.25, lon: 8.0, lat: 47.0, accuracy: 5 },
  { u: 0.5, v: 0.5, lon: 8.01, lat: 46.99, accuracy: null },
];

function sampleImage() {
  return new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], { type: 'image/png' });
}

describe('buildMapArchive / readMapArchive', () => {
  it('round-trips map metadata, reference points and image bytes', async () => {
    const imageBlob = sampleImage();
    const archive = await buildMapArchive({
      map: SAMPLE_MAP,
      referencePoints: SAMPLE_POINTS,
      imageBlob,
    });
    expect(archive.type).toBe('application/zip');

    const result = await readMapArchive(archive);
    expect(result.map.name).toBe('Old town plan');
    expect(result.map.imageWidth).toBe(800);
    expect(result.map.imageHeight).toBe(600);
    expect(result.map.createdAt).toBe(1700000000000);
    expect(result.referencePoints).toHaveLength(2);
    expect(result.referencePoints[0]).toEqual({
      u: 0.125, v: 0.25, lon: 8.0, lat: 47.0, accuracy: 5,
    });
    expect(result.referencePoints[1].accuracy).toBeNull();
    expect(result.warnings).toEqual([]);

    const bytes = new Uint8Array(await result.imageBlob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71, 1, 2, 3, 4]);
    expect(result.imageBlob.type).toBe('image/png');
  });

  it('stores the image untouched and names it after its MIME type', async () => {
    const archive = await buildMapArchive({
      map: SAMPLE_MAP,
      referencePoints: [],
      imageBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    });
    const entries = unzip(new Uint8Array(await archive.arrayBuffer()));
    expect(entries.has('image.jpg')).toBe(true);
    const doc = JSON.parse(new TextDecoder().decode(entries.get(MAP_ENTRY_NAME)));
    expect(doc.format).toBe(ARCHIVE_FORMAT);
    expect(doc.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(doc.map.imageFile).toBe('image.jpg');
  });

  it('deflates map.json but stores the image', async () => {
    const points = Array.from({ length: 200 }, (_, i) => ({
      u: i / 200, v: (i % 13) / 13, lon: 8 + i / 1e4, lat: 47 - i / 1e4,
    }));
    const archive = await buildMapArchive({
      map: SAMPLE_MAP,
      referencePoints: points,
      imageBlob: sampleImage(),
    });
    const entries = centralEntries(new Uint8Array(await archive.arrayBuffer()));

    expect(entries[MAP_ENTRY_NAME].method).toBe(8);
    expect(entries[MAP_ENTRY_NAME].compressedSize)
      .toBeLessThan(entries[MAP_ENTRY_NAME].size);
    expect(entries['image.png'].method).toBe(0);
    expect(entries['image.png'].compressedSize).toBe(entries['image.png'].size);
  });

  it('omits the accuracy field when a point has none', async () => {
    const archive = await buildMapArchive({
      map: SAMPLE_MAP,
      referencePoints: [{ u: 0, v: 0, lon: 1, lat: 2, accuracy: null }],
      imageBlob: sampleImage(),
    });
    const entries = unzip(new Uint8Array(await archive.arrayBuffer()));
    const doc = JSON.parse(new TextDecoder().decode(entries.get(MAP_ENTRY_NAME)));
    expect(doc.referencePoints[0]).toEqual({ u: 0, v: 0, lon: 1, lat: 2 });
  });

  it('rejects exporting without an image', async () => {
    await expect(buildMapArchive({ map: SAMPLE_MAP, referencePoints: [] })).rejects.toThrow(/image/i);
  });

  it('imports a newer format version on a best-effort basis with a warning', async () => {
    const doc = {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION + 5,
      futureField: true,
      map: { name: 'From the future', imageFile: 'image.png', imageMime: 'image/png', imageWidth: 10, imageHeight: 10 },
      referencePoints: [{ u: 0.1, v: 0.1, lon: 1, lat: 2 }],
    };
    const zip = zipStore([
      { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify(doc)) },
      { name: 'image.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    const result = await readMapArchive(new Blob([zip], { type: 'application/zip' }));
    expect(result.map.name).toBe('From the future');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/newer version/i);
  });

  it('rejects an archive with no map.json', async () => {
    const zip = zipStore([{ name: 'image.png', data: new Uint8Array([1]) }]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/missing map.json/i);
  });

  it('throws a NotByomError for an archive that is not a BYOM file', async () => {
    // A valid ZIP that is simply not a BYOM archive (no map.json inside).
    const zip = zipStore([{ name: 'holiday.txt', data: encoder.encode('hi') }]);
    const error = await readMapArchive(new Blob([zip])).catch((e) => e);
    expect(error).toBeInstanceOf(NotByomError);
    expect(error.name).toBe('NotByomError');
  });

  it('does not flag a damaged BYOM archive as NotByomError', async () => {
    // map.json exists but is corrupt: a broken BYOM file, not a different file
    // type, so the caller keeps the generic failure path.
    const zip = zipStore([{ name: MAP_ENTRY_NAME, data: encoder.encode('{ not json') }]);
    const error = await readMapArchive(new Blob([zip])).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NotByomError);
  });

  it('rejects an archive whose map.json is not JSON', async () => {
    const zip = zipStore([{ name: MAP_ENTRY_NAME, data: encoder.encode('{nope') }]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/not valid JSON/i);
  });

  it('rejects an archive with the wrong format marker', async () => {
    const zip = zipStore([
      { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify({ format: 'something-else', formatVersion: 1 })) },
    ]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/unexpected format/i);
  });

  it('rejects an archive with a missing formatVersion', async () => {
    const zip = zipStore([
      { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify({ format: ARCHIVE_FORMAT })) },
    ]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/formatVersion/i);
  });

  it('rejects an archive whose image entry is missing', async () => {
    const doc = {
      format: ARCHIVE_FORMAT,
      formatVersion: 1,
      map: { name: 'X', imageFile: 'image.png', imageMime: 'image/png' },
      referencePoints: [],
    };
    const zip = zipStore([{ name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify(doc)) }]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/missing its image/i);
  });

  it('rejects a reference point with non-finite coordinates', async () => {
    const doc = {
      format: ARCHIVE_FORMAT,
      formatVersion: 1,
      map: { name: 'X', imageFile: 'image.png', imageMime: 'image/png' },
      referencePoints: [{ u: 'oops', v: 0, lon: 1, lat: 2 }],
    };
    const zip = zipStore([
      { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify(doc)) },
      { name: 'image.png', data: new Uint8Array([1]) },
    ]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/non-finite/i);
  });

  it('rejects a reference point with an out-of-range latitude', async () => {
    const doc = {
      format: ARCHIVE_FORMAT,
      formatVersion: 1,
      map: { name: 'X', imageFile: 'image.png', imageMime: 'image/png' },
      referencePoints: [{ u: 0, v: 0, lon: 1, lat: 123 }],
    };
    const zip = zipStore([
      { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify(doc)) },
      { name: 'image.png', data: new Uint8Array([1]) },
    ]);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/latitude/i);
  });

  it('wraps an out-of-range longitude into [-180, 180)', async () => {
    const doc = {
      format: ARCHIVE_FORMAT,
      formatVersion: 1,
      map: { name: 'X', imageFile: 'image.png', imageMime: 'image/png' },
      referencePoints: [{ u: 0, v: 0, lon: 190, lat: 2 }],
    };
    const zip = zipStore([
      { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify(doc)) },
      { name: 'image.png', data: new Uint8Array([1]) },
    ]);
    const result = await readMapArchive(new Blob([zip]));
    expect(result.referencePoints[0].lon).toBeCloseTo(-170, 6);
  });
});

/** A minimal archive with a JSON document body, for malformed-input tests. */
function archiveFromDoc(doc, entries = []) {
  return zipStore([
    { name: MAP_ENTRY_NAME, data: encoder.encode(JSON.stringify(doc)) },
    ...entries,
  ]);
}

describe('readMapArchive — malformed documents', () => {
  const baseDoc = {
    format: ARCHIVE_FORMAT,
    formatVersion: 1,
    map: { name: 'X', imageFile: 'image.png', imageMime: 'image/png' },
    referencePoints: [],
  };

  it('defaults a blank map name and image MIME type', async () => {
    const zip = archiveFromDoc(
      { ...baseDoc, map: { name: '  ', imageFile: 'image.png' } },
      [{ name: 'image.png', data: new Uint8Array([1]) }],
    );
    const result = await readMapArchive(new Blob([zip]));
    expect(result.map.name).toBe('Imported map');
    expect(result.imageBlob.type).toBe('application/octet-stream');
  });

  it('rejects a document that is not an object', async () => {
    const zip = archiveFromDoc('just a string');
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/not an object/i);
  });

  it('rejects a document with no map metadata', async () => {
    const { map, ...withoutMap } = baseDoc;
    const zip = archiveFromDoc(withoutMap);
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/missing map metadata/i);
  });

  it('rejects a document with no image reference', async () => {
    const zip = archiveFromDoc({ ...baseDoc, map: { name: 'X' } });
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/missing image reference/i);
  });

  it('rejects a reference point that is not an object', async () => {
    const zip = archiveFromDoc({ ...baseDoc, referencePoints: [42] });
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/not an object/i);
  });

  it('rejects an archive with too many reference points', async () => {
    const many = Array.from({ length: 10001 }, () => ({ u: 0, v: 0, lon: 1, lat: 2 }));
    const zip = archiveFromDoc({ ...baseDoc, referencePoints: many });
    await expect(readMapArchive(new Blob([zip]))).rejects.toThrow(/too many reference points/i);
  });
});

describe('unzip — structural corruption', () => {
  function validZip() {
    return zipStore([{ name: 'a.txt', data: encoder.encode('hello') }]);
  }

  it('rejects a corrupt central directory signature', async () => {
    const zip = validZip();
    const central = centralDirectoryOffset(zip);
    zip[central] ^= 0xff;
    expect(() => unzip(zip)).toThrow(/corrupt central directory/i);
  });

  it('rejects a corrupt local header signature', async () => {
    const zip = validZip();
    zip[0] ^= 0xff;
    expect(() => unzip(zip)).toThrow(/corrupt local header/i);
  });

  it('rejects an entry that claims an implausibly large size', () => {
    const zip = validZip();
    const central = centralDirectoryOffset(zip);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint32(central + 24, 0xffffffff, true);
    expect(() => unzip(zip)).toThrow(/too large/i);
  });

  it('rejects a deflate stream that cannot be decompressed', async () => {
    // A well-formed central directory whose deflate payload is damaged beyond
    // recovery, so the failure happens inside the inflater rather than in the
    // header parsing.
    const zip = await buildZip([{ name: 'a.txt', data: encoder.encode('hello'.repeat(50)), method: 8 }]);
    const payloadStart = 30 + encoder.encode('a.txt').length;
    zip[payloadStart] ^= 0xff;
    expect(() => unzip(zip)).toThrow(/could not decompress/i);
  });
});

describe('suggestedArchiveName', () => {
  it('slugifies a map name and adds the extension', () => {
    expect(suggestedArchiveName('Old town plan')).toBe('Old town plan.byom');
    expect(suggestedArchiveName('a/b:c*d?e')).toBe('a b c d e.byom');
    expect(suggestedArchiveName('  ')).toBe('map.byom');
    expect(suggestedArchiveName(undefined)).toBe('map.byom');
  });
});

describe('isByomFile', () => {
  it('accepts a .byom extension', async () => {
    expect(await isByomFile({ name: 'map.byom', type: '' })).toBe(true);
  });

  it('accepts a zip MIME type only when the magic bytes agree', async () => {
    const zip = zipStore([{ name: 'a', data: new Uint8Array([1]) }]);
    const file = new Blob([zip], { type: 'application/zip' });
    file.name = 'map.zip';
    expect(await isByomFile(file)).toBe(true);

    const notZip = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/zip' });
    notZip.name = 'map.zip';
    expect(await isByomFile(notZip)).toBe(false);
  });

  it('rejects an ordinary image', async () => {
    expect(await isByomFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
  });
});
