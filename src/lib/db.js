// IndexedDB wrapper for BYOM
import { imageDivisor } from './transforms.js';

const DB_NAME = 'byom-db';
const DB_VERSION = 1;
const MAPS_STORE = 'maps';
const POINTS_STORE = 'referencePoints';

// A fractional coordinate is confined to [0, 1] by construction, so any
// coordinate strictly greater than 1 can only be a legacy pixel value. Strict
// `>` matters: a click on the far edge yields exactly 1.0, which is a legal
// fraction and must not be mistaken for a pixel.
const FRACTION_MAX = 1;
const LEGACY_X = 'imageX';
const LEGACY_Y = 'imageY';

let dbInstance = null;
let migrationPromise = null;

/**
 * Initialize and open the IndexedDB database
 */
export async function initDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Maps store: stores map images and metadata
      if (!db.objectStoreNames.contains(MAPS_STORE)) {
        const mapsStore = db.createObjectStore(MAPS_STORE, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        mapsStore.createIndex('timestamp', 'timestamp', { unique: false });
        mapsStore.createIndex('name', 'name', { unique: false });
      }

      // Reference points store: stores reference points linked to maps
      if (!db.objectStoreNames.contains(POINTS_STORE)) {
        const pointsStore = db.createObjectStore(POINTS_STORE, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        pointsStore.createIndex('mapId', 'mapId', { unique: false });
      }
    };
  });
}

/**
 * Add a new map to the database
 * @param {Object} mapData - { name, imageBlob, thumbnail }
 * @returns {Promise<number>} The ID of the newly created map
 */
export async function addMap(mapData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MAPS_STORE], 'readwrite');
    const store = transaction.objectStore(MAPS_STORE);
    
    const map = {
      name: mapData.name,
      imageBlob: mapData.imageBlob,
      thumbnail: mapData.thumbnail,
      timestamp: Date.now(),
    };

    const request = store.add(map);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all maps from the database
 * @returns {Promise<Array>} Array of map objects
 */
export async function getAllMaps() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MAPS_STORE], 'readonly');
    const store = transaction.objectStore(MAPS_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a single map by ID
 * @param {number} mapId 
 * @returns {Promise<Object>} Map object
 */
export async function getMap(mapId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MAPS_STORE], 'readonly');
    const store = transaction.objectStore(MAPS_STORE);
    const request = store.get(mapId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a map and all its reference points
 * @param {number} mapId 
 */
export async function deleteMap(mapId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MAPS_STORE, POINTS_STORE], 'readwrite');
    
    // Delete the map
    const mapsStore = transaction.objectStore(MAPS_STORE);
    mapsStore.delete(mapId);

    // Delete all reference points for this map
    const pointsStore = transaction.objectStore(POINTS_STORE);
    const index = pointsStore.index('mapId');
    const range = IDBKeyRange.only(mapId);
    const request = index.openCursor(range);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Add a reference point to a map
 * @param {Object} pointData - { mapId, u, v, lon, lat, accuracy }
 * @returns {Promise<number>} The ID of the newly created point
 */
export async function addReferencePoint(pointData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([POINTS_STORE], 'readwrite');
    const store = transaction.objectStore(POINTS_STORE);
    
    const point = {
      mapId: pointData.mapId,
      u: pointData.u,
      v: pointData.v,
      lon: pointData.lon,
      lat: pointData.lat,
      accuracy: pointData.accuracy || null,
      timestamp: Date.now(),
    };

    const request = store.add(point);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all reference points for a specific map
 * @param {number} mapId 
 * @returns {Promise<Array>} Array of reference point objects
 */
export async function getReferencePoints(mapId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([POINTS_STORE], 'readonly');
    const store = transaction.objectStore(POINTS_STORE);
    const index = store.index('mapId');
    const request = index.getAll(mapId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a reference point
 * @param {number} pointId 
 * @param {Object} updates - Partial point data to update
 */
export async function updateReferencePoint(pointId, updates) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([POINTS_STORE], 'readwrite');
    const store = transaction.objectStore(POINTS_STORE);
    
    const getRequest = store.get(pointId);
    getRequest.onsuccess = () => {
      const point = getRequest.result;
      if (!point) {
        reject(new Error('Point not found'));
        return;
      }

      const updatedPoint = { ...point, ...updates };
      const putRequest = store.put(updatedPoint);
      putRequest.onsuccess = () => resolve(updatedPoint);
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Delete a reference point
 * @param {number} pointId 
 */
export async function deleteReferencePoint(pointId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([POINTS_STORE], 'readwrite');
    const store = transaction.objectStore(POINTS_STORE);
    const request = store.delete(pointId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Whether a map's points were stored in the legacy pixel schema. The judgement
 * is per map, not per point: points within one map are all the same vintage,
 * and a per-point decision could tear a set in half.
 *
 * Legacy rows carried `imageX`/`imageY`, so their mere presence is conclusive.
 * Pixel values that somehow arrived under the new names are caught by the
 * range test: a fractional coordinate can never exceed 1 (`screenToImage`
 * rejects off-image clicks, a far-edge click yields exactly 1.0, and the
 * single divisor keeps the other axis below 1).
 * @param {Array} points
 * @returns {boolean}
 */
export function isLegacyPoints(points) {
  return points.some((point) =>
    Number.isFinite(point[LEGACY_X]) ||
    Number.isFinite(point[LEGACY_Y]) ||
    point.u > FRACTION_MAX ||
    point.v > FRACTION_MAX
  );
}

/**
 * The legacy pixel coordinates of a point, or null if it has none.
 * @param {Object} point
 * @returns {{x: number, y: number}|null}
 */
function legacyPixelCoords(point) {
  if (!Number.isFinite(point[LEGACY_X]) || !Number.isFinite(point[LEGACY_Y])) {
    return null;
  }
  return { x: point[LEGACY_X], y: point[LEGACY_Y] };
}

/**
 * Convert one map's points from pixels to fractions inside a single readwrite
 * transaction. The classification is re-done from the values read inside that
 * transaction, not from an earlier read, for two reasons:
 *
 * - A read in one transaction followed by per-point writes in another can be
 *   interrupted half-way, leaving a map with one point at 0.25 and the rest at
 *   pixel values. On the next boot the map still flags as legacy and the whole
 *   set is divided again, turning the converted point into 0.25 / D. One
 *   transaction makes the sweep idempotent and crash-safe.
 * - IndexedDB serializes overlapping readwrite transactions on the same store,
 *   so a second tab whose sweep begins after this one commits reads fractional
 *   values here and writes nothing, rather than dividing a second time.
 * @param {Object} db
 * @param {number} mapId
 * @param {number} divisor
 * @returns {Promise<void>}
 */
function convertMapPoints(db, mapId, divisor) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([POINTS_STORE], 'readwrite');
    const store = transaction.objectStore(POINTS_STORE);
    const index = store.index('mapId');
    const request = index.openCursor(IDBKeyRange.only(mapId));
    const records = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        records.push(cursor.value);
        cursor.continue();
        return;
      }
      if (!isLegacyPoints(records)) return;
      // Still inside the transaction, so these puts commit together with the
      // reads that justified them. `put` on the same key replaces the row, and
      // the legacy fields are dropped rather than left to re-flag the map.
      for (const record of records) {
        const pixels = legacyPixelCoords(record);
        const { [LEGACY_X]: _x, [LEGACY_Y]: _y, ...rest } = record;
        store.put({
          ...rest,
          u: pixels ? pixels.x / divisor : record.u / divisor,
          v: pixels ? pixels.y / divisor : record.v / divisor,
        });
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Decode an image blob to its natural dimensions. `createImageBitmap` reads
 * width/height without an object URL or a DOM `<img>`, and must be closed to
 * release the decoded bitmap.
 * @param {Blob} blob
 * @returns {Promise<{width: number, height: number}>}
 */
async function decodeImageSize(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * Convert any legacy pixel-based reference points to [0,1] fractions.
 *
 * A boot-time sweep, not a lazy conversion on map open: a lazy pass can never
 * promise it is finished, because a map the user never opens keeps its pixel
 * rows forever and deleting the code would silently break it. A sweep that
 * finds nothing left to convert is genuinely finished, and that is the gate
 * for eventually removing it.
 *
 * Nothing at all runs against an already-fractional database. A blob that
 * fails to decode is skipped rather than aborting the pass, so it re-flags on
 * the next boot and the removal gate stays honest.
 * @returns {Promise<void>}
 */
export async function migrateLegacyPoints() {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const db = await initDB();
    const maps = await getAllMaps();

    for (const map of maps) {
      const points = await getReferencePoints(map.id);
      if (!isLegacyPoints(points)) continue;

      let size;
      try {
        size = await decodeImageSize(map.imageBlob);
      } catch (error) {
        console.warn(`Skipping point migration for map ${map.id}: image failed to decode`, error);
        continue;
      }

      const divisor = imageDivisor(size.width, size.height);
      if (!(divisor > 0)) {
        console.warn(`Skipping point migration for map ${map.id}: image has no usable dimensions`);
        continue;
      }

      await convertMapPoints(db, map.id, divisor);
    }
  })().catch((error) => {
    // A failed sweep must not poison the app: the next boot retries.
    console.error('Reference point migration failed:', error);
  });

  return migrationPromise;
}
