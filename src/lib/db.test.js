import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let db;
let conn;

async function resetDB() {
  vi.resetModules();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('byom-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  db = await import('./db.js');
  conn = await db.initDB();
}

// The sweep decodes each legacy map's blob to recover the divisor. Tests stub
// createImageBitmap rather than providing a real image decoder.
function stubImageSize(width, height) {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width,
    height,
    close: vi.fn(),
  })));
}

beforeEach(resetDB);

afterEach(() => {
  conn.close();
  vi.unstubAllGlobals();
});

function storeIndexNames(storeName) {
  return Array.from(conn.transaction(storeName).objectStore(storeName).indexNames);
}

function storeNames() {
  return Array.from(conn.objectStoreNames);
}

describe('IndexedDB wrapper — store creation', () => {
  it('creates both stores and their indexes on first open', () => {
    expect(storeNames()).toEqual(expect.arrayContaining(['maps', 'referencePoints']));
    expect(storeIndexNames('maps')).toEqual(expect.arrayContaining(['timestamp', 'name']));
    expect(storeIndexNames('referencePoints')).toEqual(expect.arrayContaining(['mapId']));
  });
});

describe('IndexedDB wrapper — map CRUD', () => {
  it('adds a map, assigns an auto-increment id and a timestamp', async () => {
    const id = await db.addMap({ name: 'Downtown', imageBlob: { data: [1, 2] }, thumbnail: null });
    expect(id).toBeGreaterThan(0);
    const map = await db.getMap(id);
    expect(map.name).toBe('Downtown');
    expect(map.imageBlob).toEqual({ data: [1, 2] });
    expect(map.timestamp).toBeGreaterThan(0);
    expect(map.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('lists all maps', async () => {
    await db.addMap({ name: 'A', imageBlob: 'blob-a', thumbnail: null });
    await db.addMap({ name: 'B', imageBlob: 'blob-b', thumbnail: null });
    const maps = await db.getAllMaps();
    expect(maps).toHaveLength(2);
    const names = maps.map(m => m.name).sort();
    expect(names).toEqual(['A', 'B']);
  });

  it('returns undefined for a missing map', async () => {
    const missing = await db.getMap(9999);
    expect(missing).toBeUndefined();
  });
});

describe('IndexedDB wrapper — reference point CRUD', () => {
  it('adds and retrieves reference points for a map', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    const p1 = await db.addReferencePoint({ mapId, u: 0.1, v: 0.2, lon: -73.99, lat: 40.71 });
    const p2 = await db.addReferencePoint({ mapId, u: 0.3, v: 0.4, lon: -73.98, lat:  40.72 });
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);

    const points = await db.getReferencePoints(mapId);
    expect(points).toHaveLength(2);
    const first = points[0];
    expect(first.mapId).toBe(mapId);
    expect(first.u).toBe(0.1);
    expect(first.lon).toBeCloseTo(-73.99,  5);
    expect(first.accuracy).toBeNull();
  });

  it('filters reference points by mapId using the index', async () => {
    const mapA = await db.addMap({ name: 'A', imageBlob: 'blob', thumbnail: null });
    const mapB = await db.addMap({ name: 'B', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId: mapA, u: 0.1, v: 0.1, lon: 1, lat:  1 });
    await db.addReferencePoint({ mapId: mapB, u: 0.2, v: 0.2, lon:  2, lat:  2 });

    const pointsForA = await db.getReferencePoints(mapA);
    const pointsForB = await db.getReferencePoints(mapB);
    expect(pointsForA).toHaveLength(1);
    expect(pointsForA[0].mapId).toBe(mapA);
    expect(pointsForB).toHaveLength(1);
    expect(pointsForB[0].mapId).toBe(mapB);
  });

  it('returns an empty list when a map has no reference points', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    const points = await db.getReferencePoints(mapId);
    expect(points).toEqual([]);
  });

  it('updates a reference point merging partial changes', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    const pid = await db.addReferencePoint({ mapId, u: 0.1, v: 0.2, lon: 1, lat:  2, accuracy:  5 });

    const updated = await db.updateReferencePoint(pid, { lon:  3, lat:  4 });
    expect(updated.lon).toBe(3);
    expect(updated.lat).toBe(4);
    expect(updated.mapId).toBe(mapId);
    expect(updated.u).toBe(0.1);
    expect(updated.v).toBe(0.2);
    expect(updated.accuracy).toBe(5);
    expect(typeof updated.timestamp).toBe('number');

    const reloaded = (await db.getReferencePoints(mapId))[0];
    expect(reloaded.lon).toBe(3);
    expect(reloaded.lat).toBe(4);
    expect(reloaded.u).toBe(0.1);
  });

  it('rejects updating a nonexistent reference point', async () => {
    await expect(
      db.updateReferencePoint(9999, { lon:  3, lat:  4 }),
    ).rejects.toThrow('Point not found');
  });

  it('deletes a reference point', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    const pid = await db.addReferencePoint({ mapId, u: 0.1, v: 0.2, lon: 1, lat:  2 });
    await db.deleteReferencePoint(pid);
    const points = await db.getReferencePoints(mapId);
    expect(points).toHaveLength(0);
  });
});

describe('IndexedDB wrapper — cascade delete', () => {
  it('removes a mapand all its reference points', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId, u: 0.1, v: 0.2, lon: 1, lat:  2 });
    await db.addReferencePoint({ mapId, u: 0.3, v: 0.4, lon:  3, lat:  4 });
    await db.addReferencePoint({ mapId, u: 0.5, v: 0.6, lon:  5, lat:  6 });

    await db.deleteMap(mapId);

    const gone = await db.getMap(mapId);
    expect(gone).toBeUndefined();
    const orphanPoints = await db.getReferencePoints(mapId);
    expect(orphanPoints).toEqual([]);
  });

  it('cascade delete does not affect other maps', async () => {
    const mapA = await db.addMap({ name: 'A', imageBlob: 'blob', thumbnail: null });
    const mapB = await db.addMap({ name: 'B', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId: mapA, u: 0.1, v: 0.1, lon:  1, lat:  1 });
    await db.addReferencePoint({ mapId: mapB, u: 0.2, v: 0.2, lon:  2, lat:  2 });

    await db.deleteMap(mapA);

    expect(await db.getMap(mapA)).toBeUndefined();
    expect(await db.getMap(mapB)).toBeTruthy();
    const a = await db.getReferencePoints(mapA);
    const b = await db.getReferencePoints(mapB);
    expect(a).toEqual([]);
    expect(b).toHaveLength(1);
    expect(b[0].mapId).toBe(mapB);
  });
});

describe('IndexedDB wrapper — legacy point migration', () => {
  // A 400x300 image, so D = max(400, 300) = 400. Legacy pixel coordinates
  // differ from the resulting fractions by exactly that divisor.
  const WIDTH = 400;
  const HEIGHT = 300;
  const DIVISOR = 400;

  // Legacy rows used imageX/imageY, so they are written straight into the
  // store rather than through addReferencePoint, which only speaks u/v.
  async function addLegacyMap(name, points, size = { width: WIDTH, height: HEIGHT }) {
    const mapId = await db.addMap({ name, imageBlob: { size: `${name}-blob` }, thumbnail: null });
    await new Promise((resolve, reject) => {
      const tx = conn.transaction(['referencePoints'], 'readwrite');
      const store = tx.objectStore('referencePoints');
      for (const point of points) store.add({ mapId, ...point });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    stubImageSize(size.width, size.height);
    return mapId;
  }

  it('isLegacyPoints flags legacy imageX/imageY rows and out-of-range values', () => {
    expect(db.isLegacyPoints([])).toBe(false);
    expect(db.isLegacyPoints([{ u: 0.5, v: 0.5 }])).toBe(false);
    // Exactly 1.0 is a legal fraction (a click on the far edge), not a pixel.
    expect(db.isLegacyPoints([{ u: 1.0, v: 1.0 }])).toBe(false);
    expect(db.isLegacyPoints([{ u: 0.5, v: 1.0 }])).toBe(false);

    // The real v1 shape: the pixel fields themselves are conclusive.
    expect(db.isLegacyPoints([{ imageX: 10, imageY: 20, u: 0.1, v: 0.2 }])).toBe(true);
    expect(db.isLegacyPoints([{ imageX: 0, imageY: 0 }])).toBe(true);
    // A pixel coordinate under the new names is caught by the range test.
    expect(db.isLegacyPoints([{ u: 1.0000001, v: 0.5 }])).toBe(true);
    expect(db.isLegacyPoints([{ u: 0.5, v: 200 }])).toBe(true);
    // The judgement is per map: one legacy row flags the whole set.
    expect(db.isLegacyPoints([{ u: 0.25, v: 0.25 }, { imageX: 100, imageY: 50 }])).toBe(true);
  });

  it('converts legacy pixel points to fractions with the single max divisor', async () => {
    const mapId = await addLegacyMap('Legacy', [
      { imageX: 100, imageY: 60, lon: -74.0, lat: 40.0 },
      { imageX: 300, imageY: 240, lon: -73.0, lat: 41.0 },
    ]);

    await db.migrateLegacyPoints();

    const points = await db.getReferencePoints(mapId);
    const byLon = [...points].sort((a, b) => a.lon - b.lon);
    expect(byLon[0].u).toBeCloseTo(100 / DIVISOR, 12);
    expect(byLon[0].v).toBeCloseTo(60 / DIVISOR, 12);
    expect(byLon[1].u).toBeCloseTo(300 / DIVISOR, 12);
    expect(byLon[1].v).toBeCloseTo(240 / DIVISOR, 12);
    // The other fields are preserved, and the legacy fields are gone so the
    // map cannot be re-flagged on the next boot.
    expect(byLon[0].lon).toBe(-74.0);
    expect(byLon[0].lat).toBe(40.0);
    expect(byLon[0].mapId).toBe(mapId);
    expect(byLon[0].imageX).toBeUndefined();
    expect(byLon[0].imageY).toBeUndefined();
  });

  it('resolves a v1 fixture to the same geo positions after the sweep', async () => {
    // Round-trip: fit a transform from the legacy pixel points, remember where
    // an arbitrary pixel resolves, then confirm the migrated fractions resolve
    // to the same place. The fit input space changes, so this is the check
    // that the migration preserves the georeference.
    const { calculateTransform, uvToGeo } = await import('./transforms.js');
    const pixelRefs = [
      { imageX: 0, imageY: 0, lon: 8.0, lat: 45.0 },
      { imageX: 1000, imageY: 0, lon: 8.02, lat: 45.0 },
      { imageX: 1000, imageY: 800, lon: 8.03, lat: 45.01 },
      { imageX: 0, imageY: 1000, lon: 8.0, lat: 45.02 },
    ];
    const before = calculateTransform(pixelRefs.map(({ imageX, imageY, ...rest }) => ({ u: imageX, v: imageY, ...rest })));
    const expected = uvToGeo(625, 375, before);

    const mapId = await addLegacyMap('V1', pixelRefs.map((p) => ({ ...p })), { width: 1000, height: 1000 });
    await db.migrateLegacyPoints();

    const migrated = await db.getReferencePoints(mapId);
    const after = calculateTransform(migrated);
    const actual = uvToGeo(625 / 1000, 375 / 1000, after);
    expect(actual.lon).toBeCloseTo(expected.lon, 9);
    expect(actual.lat).toBeCloseTo(expected.lat, 9);
  });

  it('is a no-op on an already-fractional database and is idempotent', async () => {
    const mapId = await addLegacyMap('Legacy', [
      { u: 100, v: 60, lon: -74.0, lat: 40.0 },
      { u: 300, v: 240, lon: -73.0, lat: 41.0 },
    ]);
    const fractionalMapId = await db.addMap({ name: 'Modern', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId: fractionalMapId, u: 0.25, v: 0.5, lon: 1, lat: 2 });

    await db.migrateLegacyPoints();
    const first = await db.getReferencePoints(mapId);
    const modern = await db.getReferencePoints(fractionalMapId);

    // A second sweep finds nothing left to convert: no double division.
    await db.migrateLegacyPoints();
    const second = await db.getReferencePoints(mapId);

    expect(second).toEqual(first);
    // The already-fractional map is untouched.
    expect(modern[0].u).toBe(0.25);
    expect(modern[0].v).toBe(0.5);
  });

  it('commits a map atomically so a retry can never divide it twice', async () => {
    const mapId = await addLegacyMap('Legacy', [
      { imageX: 100, imageY: 60, lon: -74.0, lat: 40.0 },
      { imageX: 300, imageY: 240, lon: -73.0, lat: 41.0 },
    ]);

    // Overlapping calls collapse onto the module-level guard, like two effects
    // re-running in one tab.
    await Promise.all([db.migrateLegacyPoints(), db.migrateLegacyPoints()]);

    const points = await db.getReferencePoints(mapId);
    const byLon = [...points].sort((a, b) => a.lon - b.lon);
    expect(byLon[0].u).toBeCloseTo(100 / DIVISOR, 12);
    expect(byLon[0].v).toBeCloseTo(60 / DIVISOR, 12);
    // After a committed sweep nothing is left flagged, so a later pass (another
    // tab, a crash retry) reads fractions and writes nothing. A half-written
    // map would still flag here and be divided a second time.
    expect(db.isLegacyPoints(points)).toBe(false);
  });

  it('skips a map whose blob fails to decode without aborting the sweep', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First map's blob decodes; second map's does not.
    const decodableId = await db.addMap({ name: 'Good', imageBlob: 'good', thumbnail: null });
    await db.addReferencePoint({ mapId: decodableId, u: 100, v: 60, lon: -74.0, lat: 40.0 });
    const brokenId = await db.addMap({ name: 'Broken', imageBlob: 'broken', thumbnail: null });
    await db.addReferencePoint({ mapId: brokenId, u: 200, v: 120, lon: -73.0, lat: 41.0 });

    vi.stubGlobal('createImageBitmap', vi.fn(async (blob) => {
      if (blob === 'broken') throw new Error('bad image');
      return { width: WIDTH, height: HEIGHT, close: vi.fn() };
    }));

    await db.migrateLegacyPoints();

    // The decodable map converted...
    const good = await db.getReferencePoints(decodableId);
    expect(good[0].u).toBeCloseTo(100 / DIVISOR, 12);
    // ...and the broken one was left as pixels so it re-flags next boot.
    const broken = await db.getReferencePoints(brokenId);
    expect(broken[0].u).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('leaves a map with no points alone without decoding its blob', async () => {
    await db.addMap({ name: 'Empty', imageBlob: 'empty', thumbnail: null });
    const bitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', bitmap);

    await db.migrateLegacyPoints();
    expect(bitmap).not.toHaveBeenCalled();
  });

  it('skips a map whose image reports no usable dimensions', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mapId = await addLegacyMap('Zero', [
      { imageX: 100, imageY: 60, lon: -74.0, lat: 40.0 },
    ], { width: 0, height: 0 });

    await db.migrateLegacyPoints();

    const points = await db.getReferencePoints(mapId);
    expect(points[0].imageX).toBe(100);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('swallows a sweeping failure so a broken pass never poisons app startup', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addLegacyMap('Legacy', [{ imageX: 100, imageY: 60, lon: -74.0, lat: 40.0 }]);

    // Force the conversion transaction open to throw.
    const originalTransaction = conn.transaction.bind(conn);
    conn.transaction = () => {
      throw new Error('database is closing');
    };

    await expect(db.migrateLegacyPoints()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    conn.transaction = originalTransaction;
    errorSpy.mockRestore();
  });

  it('does not bump DB_VERSION for the migration', () => {
    // The fractional schema is a meaning change to existing fields, not a
    // structural one, so there is nothing for onupgradeneeded to do.
    expect(conn.version).toBe(1);
  });
});
