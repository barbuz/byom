import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let db;
let conn;

beforeEach(async () => {
  vi.resetModules();
  indexedDB.deleteDatabase("byom-db");
  db = await import("./db.js");
  conn = await db.initDB();
});

afterEach(() => {
  conn.close();
});


describe("IndexedDB wrapper", () => {
  it("adds and retrieves a map", async () => {
    const id = await db.addMap({ name: "Downtown", imageBlob: { data: [1,2] }, thumbnail: null });
    expect(id).toBeGreaterThan(0);
    const map = await db.getMap(id);
    const name = map.name;
    expect(name).toBe("Downtown");
    const blob = map.imageBlob;
    expect(blob).toEqual({ data: [1, 2] });
  });

  it("lists all maps", async () => {
    await db.addMap({ name: "A", imageBlob: new Blob(["a"]), thumbnail: null });
    await db.addMap({ name: "B", imageBlob: new Blob(["b"]), thumbnail: null });
    const maps = await db.getAllMaps();
    expect(maps).toHaveLength(2);
    const names = maps.map(m => m.name).sort();
    expect(names).toEqual(["A", "B"]);
  });

  it("deletes a map", async () => {
    const id = await db.addMap({ name: "Temp", imageBlob: new Blob(["t"]), thumbnail: null });
    await db.deleteMap(id);
    const gone = await db.getMap(id);
    expect(gone).toBeUndefined();
  });

  it("adds and lists reference points per map", async () => {
    const mapId = await db.addMap({ name: "Map", imageBlob: new Blob(["m"]), thumbnail: null });
    const p1 = await db.addReferencePoint({ mapId, imageX:  10, imageY:  20, lon:  -73.99, lat:  40.71 });
    const p2 = await db.addReferencePoint({ mapId, imageX:  30, imageY:  40, lon:  -73.98, lat:  40.72 });
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);
    const points = await db.getReferencePoints(mapId);
    expect(points).toHaveLength(2);
    const lon0 = points[0].lon;
    expect(lon0).toBeCloseTo(-73.99,  5);
  });

  it("updatesand deletes a reference point", async () => {
    const mapId = await db.addMap({ name: "Map", imageBlob: new Blob(["m"]), thumbnail: null });
    const pid = await db.addReferencePoint({ mapId, imageX:  10, imageY:  20, lon:  1, lat:  2 });
    const updated = await db.updateReferencePoint(pid, { lon:  3, lat:  4 });
    const ulon = updated.lon;
    const ulat = updated.lat;
    expect(ulon).toBe(3);
    expect(ulat).toBe(4);
    await db.deleteReferencePoint(pid);
    const points = await db.getReferencePoints(mapId);
    expect(points).toHaveLength(0);
  });
});

