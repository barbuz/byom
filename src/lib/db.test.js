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

describe('IndexedDB wrapper — bulk reference points', () => {
  it('returns every reference point across all maps', async () => {
    const mapA = await db.addMap({ name: 'A', imageBlob: 'a', thumbnail: null });
    const mapB = await db.addMap({ name: 'B', imageBlob: 'b', thumbnail: null });
    await db.addReferencePoint({ mapId: mapA, u: 0.1, v: 0.1, lon: 1, lat: 1 });
    await db.addReferencePoint({ mapId: mapB, u: 0.2, v: 0.2, lon: 2, lat: 2 });

    const all = await db.getAllReferencePoints();
    expect(all).toHaveLength(2);
    expect(all.map((point) => point.mapId).sort()).toEqual([mapA, mapB]);
  });

  it('returns an empty list when there are no points', async () => {
    expect(await db.getAllReferencePoints()).toEqual([]);
  });
});

describe('IndexedDB wrapper — image dimension backfill', () => {
  function stubDecode(width, height) {
    return vi.fn(async () => ({ width, height, close: vi.fn() }));
  }

  it('persists image dimensions supplied to addMap', async () => {
    const id = await db.addMap({
      name: 'Sized',
      imageBlob: 'blob',
      thumbnail: null,
      imageWidth: 800,
      imageHeight: 600,
    });
    const map = await db.getMap(id);
    expect(map.imageWidth).toBe(800);
    expect(map.imageHeight).toBe(600);
  });

  it('records null dimensions for a map added without them', async () => {
    const id = await db.addMap({ name: 'Unsized', imageBlob: 'blob', thumbnail: null });
    const map = await db.getMap(id);
    expect(map.imageWidth).toBeNull();
    expect(map.imageHeight).toBeNull();
  });

  it('fills missing dimensions and is idempotent', async () => {
    const id = await db.addMap({ name: 'A', imageBlob: 'a', thumbnail: null });
    const decode = stubDecode(800, 600);
    vi.stubGlobal('createImageBitmap', decode);

    await db.backfillImageDimensions();

    const map = await db.getMap(id);
    expect(map.imageWidth).toBe(800);
    expect(map.imageHeight).toBe(600);
    expect(decode).toHaveBeenCalledTimes(1);

    // A second run finds nothing to fill, so it decodes nothing.
    await db.backfillImageDimensions();
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('does not decode a map that already carries dimensions', async () => {
    await db.addMap({
      name: 'Sized',
      imageBlob: 'a',
      thumbnail: null,
      imageWidth: 10,
      imageHeight: 10,
    });
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);

    await db.backfillImageDimensions();
    expect(decode).not.toHaveBeenCalled();
  });

  it('skips a blob that fails to decode and retries it next boot', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const goodId = await db.addMap({ name: 'Good', imageBlob: 'good', thumbnail: null });
    const brokenId = await db.addMap({ name: 'Broken', imageBlob: 'broken', thumbnail: null });

    vi.stubGlobal('createImageBitmap', vi.fn(async (blob) => {
      if (blob === 'broken') throw new Error('bad image');
      return { width: 400, height: 300, close: vi.fn() };
    }));

    await db.backfillImageDimensions();

    expect((await db.getMap(goodId)).imageWidth).toBe(400);
    // The broken map is left un-backfilled so the next boot retries it.
    expect((await db.getMap(brokenId)).imageWidth).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    // Next boot: a fresh module run sees the blob now decodes and fills it in.
    conn.close();
    vi.resetModules();
    db = await import('./db.js');
    conn = await db.initDB();
    vi.stubGlobal('createImageBitmap', stubDecode(400, 300));

    await db.backfillImageDimensions();
    expect((await db.getMap(brokenId)).imageWidth).toBe(400);
    warnSpy.mockRestore();
  });

  it('swallows a backfill failure so a broken pass never poisons startup', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.addMap({ name: 'A', imageBlob: 'a', thumbnail: null });
    vi.stubGlobal('createImageBitmap', stubDecode(10, 10));

    // Force the write transaction open to throw.
    const originalTransaction = conn.transaction.bind(conn);
    conn.transaction = () => {
      throw new Error('database is closing');
    };

    await expect(db.backfillImageDimensions()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    conn.transaction = originalTransaction;
    errorSpy.mockRestore();
  });

  it('does not bump DB_VERSION for the backfill', () => {
    // Dimensions are an additive field, not a structural change, so there is
    // nothing for onupgradeneeded to do.
    expect(conn.version).toBe(1);
  });
});
