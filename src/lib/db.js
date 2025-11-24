// IndexedDB wrapper for BYOM
const DB_NAME = 'byom-db';
const DB_VERSION = 1;
const MAPS_STORE = 'maps';
const POINTS_STORE = 'referencePoints';

let dbInstance = null;

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
 * @param {Object} pointData - { mapId, imageX, imageY, lon, lat }
 * @returns {Promise<number>} The ID of the newly created point
 */
export async function addReferencePoint(pointData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([POINTS_STORE], 'readwrite');
    const store = transaction.objectStore(POINTS_STORE);
    
    const point = {
      mapId: pointData.mapId,
      imageX: pointData.imageX,
      imageY: pointData.imageY,
      lon: pointData.lon,
      lat: pointData.lat,
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
