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

beforeEach(resetDB);

afterEach(() => {
  conn.close();
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
    const p1 = await db.addReferencePoint({ mapId, imageX: 10, imageY:  20, lon: -73.99, lat: 40.71 });
    const p2 = await db.addReferencePoint({ mapId, imageX:  30, imageY:  40, lon: -73.98, lat:  40.72 });
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);

    const points = await db.getReferencePoints(mapId);
    expect(points).toHaveLength(2);
    const first = points[0];
    expect(first.mapId).toBe(mapId);
    expect(first.imageX).toBe(10);
    expect(first.lon).toBeCloseTo(-73.99,  5);
    expect(first.accuracy).toBeNull();
  });

  it('filters reference points by mapId using the index', async () => {
    const mapA = await db.addMap({ name: 'A', imageBlob: 'blob', thumbnail: null });
    const mapB = await db.addMap({ name: 'B', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId: mapA, imageX: 1, imageY:  1, lon: 1, lat:  1 });
    await db.addReferencePoint({ mapId: mapB, imageX:  2, imageY:  2, lon:  2, lat:  2 });

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
    const pid = await db.addReferencePoint({ mapId, imageX:  10, imageY:  20, lon: 1, lat:  2, accuracy:  5 });

    const updated = await db.updateReferencePoint(pid, { lon:  3, lat:  4 });
    expect(updated.lon).toBe(3);
    expect(updated.lat).toBe(4);
    expect(updated.mapId).toBe(mapId);
    expect(updated.imageX).toBe(10);
    expect(updated.imageY).toBe(20);
    expect(updated.accuracy).toBe(5);
    expect(typeof updated.timestamp).toBe('number');

    const reloaded = (await db.getReferencePoints(mapId))[0];
    expect(reloaded.lon).toBe(3);
    expect(reloaded.lat).toBe(4);
    expect(reloaded.imageX).toBe(10);
  });

  it('rejects updating a nonexistent reference point', async () => {
    await expect(
      db.updateReferencePoint(9999, { lon:  3, lat:  4 }),
    ).rejects.toThrow('Point not found');
  });

  it('deletes a reference point', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    const pid = await db.addReferencePoint({ mapId, imageX:  10, imageY:  20, lon: 1, lat:  2 });
    await db.deleteReferencePoint(pid);
    const points = await db.getReferencePoints(mapId);
    expect(points).toHaveLength(0);
  });
});

describe('IndexedDB wrapper — cascade delete', () => {
  it('removes a mapand all its reference points', async () => {
    const mapId = await db.addMap({ name: 'Map', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId, imageX:  10, imageY:  20, lon: 1, lat:  2 });
    await db.addReferencePoint({ mapId, imageX:  30, imageY:  40, lon:  3, lat:  4 });
    await db.addReferencePoint({ mapId, imageX:  50, imageY:  60, lon:  5, lat:  6 });

    await db.deleteMap(mapId);

    const gone = await db.getMap(mapId);
    expect(gone).toBeUndefined();
    const orphanPoints = await db.getReferencePoints(mapId);
    expect(orphanPoints).toEqual([]);
  });

  it('cascade delete does not affect other maps', async () => {
    const mapA = await db.addMap({ name: 'A', imageBlob: 'blob', thumbnail: null });
    const mapB = await db.addMap({ name: 'B', imageBlob: 'blob', thumbnail: null });
    await db.addReferencePoint({ mapId: mapA, imageX:  1, imageY:  1, lon:  1, lat:  1 });
    await db.addReferencePoint({ mapId: mapB, imageX:  2, imageY:  2, lon:  2, lat:  2 });

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