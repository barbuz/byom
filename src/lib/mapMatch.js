/**
 * Landing-page map classification: which maps contain the user's current
 * location, and how to order each section.
 *
 * All heavy per-map work (fitting the georeference, inverting its matrix,
 * computing footprint bounds) happens once in `buildMapSummaries`, so the
 * per-fix path only ever applies a precomputed 3x3 matrix. The two-tier test is:
 *
 * 1. A cheap axis-aligned bounding box of the four projected image corners,
 *    expressed in the map's local metric plane. Working in metres (not lon/lat)
 *    makes it linear and immune to antimeridian wrapping.
 * 2. For Tier-1 survivors, the exact test: map the user back through the
 *    precomputed inverse and check the result lies in `[0, W/D] x [0, H/D]`.
 *    The exact rectangle is not `[0,1]^2` for a non-square image, because the
 *    single divisor is `D = max(W, H)`.
 *
 * The image-to-ground matrix is the canonical y-up frame (`x = u`, `y = -v`);
 * `uvToGeo`/`geoToUV` handle the flip at the boundary.
 */

import {
  calculateTransform,
  imageDivisor,
  invertMatrix,
  lonLatToLocalMeters,
  metersPerDegreeLon,
  uvToGeo,
  wrapLongitude,
} from './transforms.js';

const METERS_PER_DEG_LAT = 111320;

/**
 * Apply a homogeneous matrix to a point, returning null on a point at infinity.
 * @param {Array<number>} m
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}|null}
 */
function applyMatrix(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  const mappedX = (m[0] * x + m[1] * y + m[2]) / w;
  const mappedY = (m[3] * x + m[4] * y + m[5]) / w;
  if (!Number.isFinite(mappedX) || !Number.isFinite(mappedY)) return null;
  return { x: mappedX, y: mappedY };
}

/**
 * The four image corners as stored y-down fractions, ordered around the
 * rectangle. `D = max(W, H)`, so one axis spans `[0,1]` and the other is shorter.
 * @param {number} W
 * @param {number} H
 * @returns {Array<{u: number, v: number}>}
 */
function imageCornerFractions(W, H) {
  const D = imageDivisor(W, H);
  return [
    { u: 0, v: 0 },
    { u: W / D, v: 0 },
    { u: W / D, v: H / D },
    { u: 0, v: H / D },
  ];
}

/**
 * Axis-aligned bounds of a map's footprint in its local metric plane. The
 * projected image is convex (a similarity/affine parallelogram or a projective
 * quadrilateral), so the four projected corners bound the whole footprint.
 * @param {Object|null} transform - Transform object {m, type, lon0, lat0}
 * @param {number} W
 * @param {number} H
 * @returns {{minEast: number, maxEast: number, minNorth: number, maxNorth: number}|null}
 */
export function imageCornersToMetricBounds(transform, W, H) {
  if (!transform || !transform.m || !(W > 0) || !(H > 0)) return null;

  const corners = imageCornerFractions(W, H).map(({ u, v }) =>
    applyMatrix(transform.m, u, -v)
  );
  if (corners.some((corner) => !corner)) return null;

  const easts = corners.map((corner) => corner.x);
  const norths = corners.map((corner) => corner.y);
  return {
    minEast: Math.min(...easts),
    maxEast: Math.max(...easts),
    minNorth: Math.min(...norths),
    maxNorth: Math.max(...norths),
  };
}

/**
 * The four projected image corners as lon/lat, for display and as a coarse
 * fallback. The min/max below assumes the map does not straddle the
 * antimeridian; callers that only need containment should use the metric bounds
 * and `geoPointInImage` instead, which are wrap-safe.
 * @param {Object|null} transform
 * @param {number} W
 * @param {number} H
 * @returns {{minLon: number, maxLon: number, minLat: number, maxLat: number}|null}
 */
export function imageCornersToGeoBounds(transform, W, H) {
  if (!transform || !transform.m || !(W > 0) || !(H > 0)) return null;

  const corners = imageCornerFractions(W, H).map(({ u, v }) =>
    uvToGeo(u, v, transform)
  );
  const lons = corners.map((corner) => corner.lon);
  const lats = corners.map((corner) => corner.lat);
  return {
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

/**
 * Invert a fitted transform once so the per-fix path never inverts again.
 * @param {Object|null} transform
 * @returns {Array<number>|null}
 */
export function precomputeInverse(transform) {
  if (!transform || !transform.m) return null;
  return invertMatrix(transform.m);
}

/**
 * Tier-1 test: is the user inside the map's metric AABB? Cheap and wrap-free.
 * @param {number} lon
 * @param {number} lat
 * @param {number} lon0
 * @param {number} lat0
 * @param {{minEast: number, maxEast: number, minNorth: number, maxNorth: number}|null} boundsMetric
 * @returns {boolean}
 */
export function userInMetricBounds(lon, lat, lon0, lat0, boundsMetric) {
  if (!boundsMetric) return false;
  const { east, north } = lonLatToLocalMeters(lon, lat, lon0, lat0);
  return (
    east >= boundsMetric.minEast && east <= boundsMetric.maxEast &&
    north >= boundsMetric.minNorth && north <= boundsMetric.maxNorth
  );
}

/**
 * Exact containment test: map the user through the precomputed inverse and
 * check the image fraction lies in `[0, W/D] x [0, H/D]`. No inversion here.
 * @param {number} lon
 * @param {number} lat
 * @param {Object} transform
 * @param {Array<number>|null} inverse
 * @param {number} W
 * @param {number} H
 * @returns {boolean}
 */
export function geoPointInImage(lon, lat, transform, inverse, W, H) {
  if (!transform || !inverse || !(W > 0) || !(H > 0)) return false;

  const { east, north } = lonLatToLocalMeters(lon, lat, transform.lon0, transform.lat0);
  const image = applyMatrix(inverse, east, north);
  if (!image) return false;

  const D = imageDivisor(W, H);
  const u = image.x;
  const v = -image.y;
  return u >= 0 && u <= W / D && v >= 0 && v <= H / D;
}

/**
 * Geographic centre of a map's lon/lat footprint bounds.
 * @param {{minLon: number, maxLon: number, minLat: number, maxLat: number}|null} boundsGeo
 * @returns {{lon: number, lat: number}|null}
 */
export function mapCenter(boundsGeo) {
  if (!boundsGeo) return null;
  return {
    lon: (boundsGeo.minLon + boundsGeo.maxLon) / 2,
    lat: (boundsGeo.minLat + boundsGeo.maxLat) / 2,
  };
}

/**
 * Approximate ground distance in metres from a point to a map's centre, using
 * an equirectangular projection about the centre's latitude.
 *
 * This is the one distance measure the landing page both shows and sorts by, so
 * a card's badge and its sort position always agree. It is deliberately not the
 * distance to the footprint's bounding box: a box's edges extend past the actual
 * (usually rotated) footprint, so clamping to the box reports 0 m for points
 * that are outside the map — which previously produced a card in "Other maps"
 * still badged "On this map". Containment is a separate, exact test
 * (`classifyMaps`).
 * @param {{minLon: number, maxLon: number, minLat: number, maxLat: number}|null} boundsGeo
 * @param {number} lon
 * @param {number} lat
 * @returns {number}
 */
export function mapCenterDistanceMeters(boundsGeo, lon, lat) {
  const center = mapCenter(boundsGeo);
  if (!center) return Infinity;
  return Math.hypot(
    wrapLongitude(lon - center.lon) * metersPerDegreeLon(center.lat),
    (lat - center.lat) * METERS_PER_DEG_LAT,
  );
}

/**
 * Approximate ground area of a map's bounding box in square metres, for the
 * section-1 "smallest map first" ordering.
 * @param {{minLon: number, maxLon: number, minLat: number, maxLat: number}|null} boundsGeo
 * @returns {number}
 */
export function mapGroundAreaSquareMeters(boundsGeo) {
  if (!boundsGeo) return Infinity;
  const midLat = (boundsGeo.minLat + boundsGeo.maxLat) / 2;
  const width = (boundsGeo.maxLon - boundsGeo.minLon) * metersPerDegreeLon(midLat);
  const height = (boundsGeo.maxLat - boundsGeo.minLat) * METERS_PER_DEG_LAT;
  return Math.abs(width * height);
}

/**
 * Approximate ground distance in metres between two fixes, using an
 * equirectangular projection about their mid-latitude. Used to skip
 * reclassification when the user has barely moved.
 * @param {{latitude: number, longitude: number}|null} a
 * @param {{latitude: number, longitude: number}|null} b
 * @returns {number}
 */
export function positionDistanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const midLat = (a.latitude + b.latitude) / 2;
  return Math.hypot(
    wrapLongitude(a.longitude - b.longitude) * metersPerDegreeLon(midLat),
    (a.latitude - b.latitude) * METERS_PER_DEG_LAT,
  );
}

/**
 * Last-modified time: the newest of the map's own timestamp and its points'.
 * @param {Object} map
 * @param {Array} points
 * @returns {number}
 */
export function lastModified(map, points) {
  let latest = Number.isFinite(map?.timestamp) ? map.timestamp : 0;
  for (const point of points ?? []) {
    if (Number.isFinite(point?.timestamp) && point.timestamp > latest) {
      latest = point.timestamp;
    }
  }
  return latest;
}

/**
 * Turn raw DB rows into per-map summaries, doing all heavy work once: fit the
 * transform, precompute its inverse and footprint bounds, and record the
 * point count, size and last-modified time. The image blob is not retained.
 * @param {Array} maps
 * @param {Map<number, Array>} pointsByMap
 * @returns {Array<Object>}
 */
export function buildMapSummaries(maps, pointsByMap) {
  return maps.map((map) => {
    const points = pointsByMap?.get(map.id) ?? [];
    const pointCount = points.length;
    const W = map.imageWidth;
    const H = map.imageHeight;
    const hasDimensions = W > 0 && H > 0;

    let transform = null;
    if (pointCount >= 2) {
      try {
        transform = calculateTransform(points);
      } catch {
        transform = null;
      }
    }

    let inverse = null;
    let boundsMetric = null;
    let boundsGeo = null;
    if (transform && hasDimensions) {
      inverse = precomputeInverse(transform);
      boundsMetric = imageCornersToMetricBounds(transform, W, H);
      boundsGeo = imageCornersToGeoBounds(transform, W, H);
    }

    return {
      id: map.id,
      name: map.name,
      thumbnail: map.thumbnail,
      timestamp: map.timestamp,
      imageWidth: W ?? null,
      imageHeight: H ?? null,
      pointCount,
      transform,
      inverse,
      boundsMetric,
      boundsGeo,
      sizeMeters: mapGroundAreaSquareMeters(boundsGeo),
      lastModified: lastModified(map, points),
    };
  });
}

/**
 * Whether a summary can place the user on the map: it has a valid fit, cached
 * inverse, footprint bounds, and image dimensions.
 * @param {Object} summary
 * @returns {boolean}
 */
function isClassifiable(summary) {
  return Boolean(
    summary.transform && summary.inverse && summary.boundsMetric && summary.boundsGeo,
  );
}

/**
 * Split summaries into the three landing-page sections. Cheap per fix: no fit
 * or inversion happens here.
 *
 * - `incomplete`: fewer than two reference points, so no georeference.
 * - `near`: georeferenced, Tier-1 bounds pass, and the exact test is true.
 * - `other`: everything else georeferenced (including, with no fix, all of them).
 * @param {Array<Object>} summaries
 * @param {{latitude: number, longitude: number}|null} userPosition
 * @returns {{near: Array, incomplete: Array, other: Array}}
 */
export function classifyMaps(summaries, userPosition) {
  const near = [];
  const incomplete = [];
  const other = [];

  const hasFix = Boolean(
    userPosition &&
    Number.isFinite(userPosition.latitude) &&
    Number.isFinite(userPosition.longitude),
  );

  for (const summary of summaries) {
    if (summary.pointCount < 2) {
      incomplete.push(summary);
      continue;
    }

    if (
      hasFix &&
      isClassifiable(summary) &&
      userInMetricBounds(
        userPosition.longitude, userPosition.latitude,
        summary.transform.lon0, summary.transform.lat0,
        summary.boundsMetric,
      ) &&
      geoPointInImage(
        userPosition.longitude, userPosition.latitude,
        summary.transform, summary.inverse,
        summary.imageWidth, summary.imageHeight,
      )
    ) {
      near.push(summary);
    } else {
      other.push(summary);
    }
  }

  sortSummaries(near, DEFAULT_SORT.near, { hasFix, userPosition });
  sortSummaries(incomplete, DEFAULT_SORT.incomplete, { hasFix, userPosition });
  sortSummaries(other, hasFix ? DEFAULT_SORT.other : 'lastModified', { hasFix, userPosition });

  return { near, incomplete, other };
}

/**
 * Every sort key the landing page offers, in display order. All sections offer
 * the same set, so a map can be ordered by size, distance, recency or name
 * wherever it appears.
 */
export const SORT_OPTIONS = [
  { value: 'distance', label: 'Distance' },
  { value: 'size', label: 'Map size' },
  { value: 'lastModified', label: 'Last modified' },
  { value: 'name', label: 'Name' },
];

/** The sort key each section defaults to. */
export const DEFAULT_SORT = {
  near: 'size',
  incomplete: 'lastModified',
  other: 'distance',
};

/** Default direction per key: distance and size read best ascending. */
export const DEFAULT_DIRECTION = {
  distance: 'asc',
  size: 'asc',
  lastModified: 'desc',
  name: 'asc',
};

const byNameAsc = (a, b) => a.name.localeCompare(b.name);
const bySizeAsc = (a, b) => a.sizeMeters - b.sizeMeters;
const byLastModifiedAsc = (a, b) => a.lastModified - b.lastModified;

/**
 * Sort one section in place by the chosen key and direction. All comparators
 * order ascending by their natural value, so the direction sign is the single
 * place that flips an order. `distance` needs a fix; without one it is
 * meaningless, so it falls back to newest-first. Unknown keys are a no-op.
 * @param {Array<Object>} section
 * @param {string} key
 * @param {{hasFix?: boolean, userPosition?: Object, direction?: 'asc'|'desc'}} [context]
 */
export function sortSummaries(
  section,
  key,
  { hasFix = false, userPosition = null, direction } = {},
) {
  let comparator = null;
  let dir = direction ?? DEFAULT_DIRECTION[key] ?? 'asc';

  if (key === 'size') {
    comparator = bySizeAsc;
  } else if (key === 'lastModified') {
    comparator = byLastModifiedAsc;
  } else if (key === 'name') {
    comparator = byNameAsc;
  } else if (key === 'distance' && hasFix && userPosition) {
    const lon = userPosition.longitude;
    const lat = userPosition.latitude;
    comparator = (a, b) =>
      mapCenterDistanceMeters(a.boundsGeo, lon, lat) -
      mapCenterDistanceMeters(b.boundsGeo, lon, lat);
  } else if (key === 'distance') {
    comparator = byLastModifiedAsc;
    if (direction === undefined) dir = 'desc';
  }

  if (!comparator) return;
  const sign = dir === 'desc' ? -1 : 1;
  section.sort((a, b) => sign * comparator(a, b));
}
