import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_DIRECTION,
  DEFAULT_SORT,
  SORT_OPTIONS,
  buildMapSummaries,
  classifyMaps,
  geoPointInImage,
  imageCornersToGeoBounds,
  imageCornersToMetricBounds,
  lastModified,
  mapCenter,
  mapCenterDistanceMeters,
  mapGroundAreaSquareMeters,
  precomputeInverse,
  sortSummaries,
  userInMetricBounds,
} from './mapMatch.js';
import { calculateTransform, lonLatToLocalMeters } from './transforms.js';

// A north-up map: image fraction (u, v) -> ground, with v growing south.
// On an 800x600 image D = 800, so the image rectangle is [0,1] x [0,0.75].
//   A (0, 0)    -> (8.00, 47.00)
//   B (1, 0)    -> (8.01, 47.00)
//   C (0, 0.75) -> (8.00, 46.99)
const W = 800;
const H = 600;
const POINTS = [
  { u: 0, v: 0, lon: 8.0, lat: 47.0 },
  { u: 1, v: 0, lon: 8.01, lat: 47.0 },
  { u: 0, v: 0.75, lon: 8.0, lat: 46.99 },
];

function makeMap(overrides = {}) {
  return {
    id: 1,
    name: 'Downtown',
    thumbnail: 'data:image/jpeg;base64,AAA',
    timestamp: 1700000000000,
    imageWidth: W,
    imageHeight: H,
    imageBlob: { big: true },
    ...overrides,
  };
}

function pointsByMap(entries) {
  return new Map(entries);
}

describe('mapMatch footprint bounds', () => {
  it('projects the four image corners to the expected metric AABB', () => {
    const transform = calculateTransform(POINTS);
    const bounds = imageCornersToMetricBounds(transform, W, H);

    // The fit is exact through the three reference points, so the image corners
    // land on the known ground positions. Bounds are expressed about the
    // transform's plane origin (the point centroid), not the corner itself.
    const cornerLonLats = [
      { lon: 8.0, lat: 47.0 },
      { lon: 8.01, lat: 47.0 },
      { lon: 8.01, lat: 46.99 },
      { lon: 8.0, lat: 46.99 },
    ];
    const local = cornerLonLats.map(({ lon, lat }) =>
      lonLatToLocalMeters(lon, lat, transform.lon0, transform.lat0));
    expect(bounds.minEast).toBeCloseTo(Math.min(...local.map((p) => p.east)), 6);
    expect(bounds.maxEast).toBeCloseTo(Math.max(...local.map((p) => p.east)), 6);
    expect(bounds.minNorth).toBeCloseTo(Math.min(...local.map((p) => p.north)), 6);
    expect(bounds.maxNorth).toBeCloseTo(Math.max(...local.map((p) => p.north)), 6);
  });

  it('projects the four image corners to the expected geo AABB', () => {
    const transform = calculateTransform(POINTS);
    const bounds = imageCornersToGeoBounds(transform, W, H);
    expect(bounds.minLon).toBeCloseTo(8.0, 9);
    expect(bounds.maxLon).toBeCloseTo(8.01, 9);
    expect(bounds.minLat).toBeCloseTo(46.99, 9);
    expect(bounds.maxLat).toBeCloseTo(47.0, 9);
  });

  it('returns null bounds without a transform or dimensions', () => {
    expect(imageCornersToMetricBounds(null, W, H)).toBeNull();
    expect(imageCornersToGeoBounds(null, W, H)).toBeNull();
    expect(imageCornersToMetricBounds({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, 0, H)).toBeNull();
    expect(imageCornersToGeoBounds({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, W, 0)).toBeNull();
  });
});

describe('mapMatch containment', () => {
  const transform = calculateTransform(POINTS);
  const inverse = precomputeInverse(transform);

  it('accepts an interior point and rejects a point outside the footprint', () => {
    // u = 0.5, v = 0.375 is the image centre.
    expect(geoPointInImage(8.005, 46.995, transform, inverse, W, H)).toBe(true);
    expect(geoPointInImage(8.02, 46.995, transform, inverse, W, H)).toBe(false);
  });

  it('uses the exact [0, W/D] x [0, H/D] rectangle, not [0,1]^2', () => {
    // v = 0.9 exceeds the short axis (H/D = 0.75) but lies within [0,1]. A
    // [0,1]^2 test would wrongly accept it; the exact test must reject it.
    const beyondShortAxis = { lon: 8.005, lat: 46.99 - 0.15 * (0.01 / 0.75) };
    expect(geoPointInImage(beyondShortAxis.lon, beyondShortAxis.lat, transform, inverse, W, H)).toBe(false);
  });

  it('rejects without a transform, inverse or dimensions', () => {
    expect(geoPointInImage(8.005, 46.995, null, inverse, W, H)).toBe(false);
    expect(geoPointInImage(8.005, 46.995, transform, null, W, H)).toBe(false);
    expect(geoPointInImage(8.005, 46.995, transform, inverse, 0, H)).toBe(false);
  });

  it('Tier-1 metric bounds accept the interior and reject a far point', () => {
    const bounds = imageCornersToMetricBounds(transform, W, H);
    expect(userInMetricBounds(8.005, 46.995, transform.lon0, transform.lat0, bounds)).toBe(true);
    expect(userInMetricBounds(9.5, 48.5, transform.lon0, transform.lat0, bounds)).toBe(false);
    expect(userInMetricBounds(8.005, 46.995, transform.lon0, transform.lat0, null)).toBe(false);
  });
});

describe('mapMatch sorting helpers', () => {
  it('computes the centre of a box and the distance to it', () => {
    const box = { minLon: 8.0, maxLon: 8.02, minLat: 46.98, maxLat: 47.0 };
    expect(mapCenter(box).lon).toBeCloseTo(8.01, 9);
    expect(mapCenter(box).lat).toBeCloseTo(46.99, 9);
    expect(mapCenter(null)).toBeNull();

    // At the centre the distance is ~0; it grows as the point moves away.
    expect(mapCenterDistanceMeters(box, 8.01, 46.99)).toBeCloseTo(0, 6);
    const near = mapCenterDistanceMeters(box, 8.02, 46.99);
    const far = mapCenterDistanceMeters(box, 8.10, 46.99);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(mapCenterDistanceMeters(null, 0, 0)).toBe(Infinity);
  });

  it('reports a nonzero distance for a point outside a rotated footprint', () => {
    // Regression: the old box-clamped distance returned 0 for any point inside
    // the geo AABB, so a map whose rotated footprint excluded the user could
    // sit in "Other maps" while still badging "On this map".
    const box = { minLon: 8.0, maxLon: 8.02, minLat: 46.98, maxLat: 47.0 };
    const corner = { lon: 8.02, lat: 47.0 };
    expect(mapCenterDistanceMeters(box, corner.lon, corner.lat)).toBeGreaterThan(0);
  });

  it('computes a positive ground area and Infinity without bounds', () => {
    const box = { minLon: 8.0, maxLon: 8.01, minLat: 46.99, maxLat: 47.0 };
    expect(mapGroundAreaSquareMeters(box)).toBeGreaterThan(0);
    expect(mapGroundAreaSquareMeters(null)).toBe(Infinity);
  });

  it('takes the newest of the map and point timestamps', () => {
    const map = { timestamp: 100 };
    expect(lastModified(map, [])).toBe(100);
    expect(lastModified(map, [{ timestamp: 50 }, { timestamp: 250 }])).toBe(250);
    expect(lastModified({}, [{ timestamp: 7 }])).toBe(7);
  });

  it('sorts by size, last-modified, name and distance with a direction', () => {
    const a = { name: 'B', sizeMeters: 20, lastModified: 1, boundsGeo: { minLon: 0, maxLon: 0, minLat: 0, maxLat: 0 } };
    const b = { name: 'A', sizeMeters: 10, lastModified: 2, boundsGeo: { minLon: 1, maxLon: 1, minLat: 1, maxLat: 1 } };

    // size defaults ascending: the smaller map first.
    const bySize = [a, b];
    sortSummaries(bySize, 'size');
    expect(bySize[0]).toBe(b);

    // lastModified defaults descending: the newer map first.
    const byModified = [a, b];
    sortSummaries(byModified, 'lastModified');
    expect(byModified[0]).toBe(b);

    // name defaults ascending: A before B.
    const byName = [a, b];
    sortSummaries(byName, 'name');
    expect(byName[0]).toBe(b);

    // distance needs a fix; at (1, 1) b's box centre is closer.
    const byDistance = [a, b];
    sortSummaries(byDistance, 'distance', { hasFix: true, userPosition: { longitude: 1, latitude: 1 } });
    expect(byDistance[0]).toBe(b);

    // A 'desc' direction flips any of the above.
    const bySizeDesc = [a, b];
    sortSummaries(bySizeDesc, 'size', { direction: 'desc' });
    expect(bySizeDesc[0]).toBe(a);
    const byNameDesc = [a, b];
    sortSummaries(byNameDesc, 'name', { direction: 'desc' });
    expect(byNameDesc[0]).toBe(a);

    // Without a fix, distance is meaningless and falls back to newest-first.
    const noFix = [a, b];
    sortSummaries(noFix, 'distance', { hasFix: false });
    expect(noFix[0]).toBe(b);
  });

  it('leaves a section unchanged for an unknown sort key', () => {
    const a = { name: 'A', sizeMeters: 1, lastModified: 1, boundsGeo: null };
    const b = { name: 'B', sizeMeters: 2, lastModified: 2, boundsGeo: null };
    const section = [a, b];
    sortSummaries(section, 'nonsense');
    expect(section).toEqual([a, b]);
  });
});

describe('mapMatch summaries', () => {
  it('fits once, caches the inverse and bounds, and strips the blob', () => {
    const summaries = buildMapSummaries([makeMap()], pointsByMap([[1, POINTS]]));
    const summary = summaries[0];
    expect(summary.pointCount).toBe(3);
    expect(summary.transform).not.toBeNull();
    expect(summary.inverse).not.toBeNull();
    expect(summary.boundsMetric).not.toBeNull();
    expect(summary.boundsGeo).not.toBeNull();
    expect(summary.sizeMeters).toBeGreaterThan(0);
    expect(summary.imageBlob).toBeUndefined();
  });

  it('produces the same summary shape for 2 points and many points', () => {
    const two = buildMapSummaries([makeMap()], pointsByMap([[1, POINTS.slice(0, 2)]]))[0];
    const many = buildMapSummaries([makeMap()], pointsByMap([[1, POINTS]]))[0];
    expect(Object.keys(two).sort()).toEqual(Object.keys(many).sort());
    expect(two.pointCount).toBe(2);
    expect(many.pointCount).toBe(3);
  });

  it('treats a degenerate fit as unclassifiable but still georeferenced', () => {
    // Two points sharing a GPS position cannot be fitted.
    const degenerate = [
      { u: 0, v: 0, lon: 8.0, lat: 47.0 },
      { u: 1, v: 1, lon: 8.0, lat: 47.0 },
    ];
    const summary = buildMapSummaries([makeMap()], pointsByMap([[1, degenerate]]))[0];
    expect(summary.pointCount).toBe(2);
    expect(summary.transform).toBeNull();
    expect(summary.inverse).toBeNull();
  });

  it('has no transform or bounds without dimensions', () => {
    const summary = buildMapSummaries(
      [makeMap({ imageWidth: null, imageHeight: null })],
      pointsByMap([[1, POINTS]]),
    )[0];
    expect(summary.transform).not.toBeNull();
    expect(summary.boundsMetric).toBeNull();
    expect(summary.boundsGeo).toBeNull();
  });
});

describe('mapMatch classification', () => {
  function summariesFor(maps, points) {
    return buildMapSummaries(maps, points);
  }

  it('places maps with fewer than two points in incomplete', () => {
    const summaries = summariesFor([makeMap()], pointsByMap([[1, []]]));
    const { near, incomplete, other } = classifyMaps(summaries, null);
    expect(incomplete).toHaveLength(1);
    expect(near).toHaveLength(0);
    expect(other).toHaveLength(0);
  });

  it('with no fix, every georeferenced map is in other', () => {
    const summaries = summariesFor([makeMap()], pointsByMap([[1, POINTS]]));
    const { near, incomplete, other } = classifyMaps(summaries, null);
    expect(near).toHaveLength(0);
    expect(incomplete).toHaveLength(0);
    expect(other).toHaveLength(1);
  });

  it('puts a containing map in near and a distant one in other', () => {
    const here = makeMap({ id: 1, name: 'Here' });
    const there = makeMap({ id: 2, name: 'There' });
    const summaries = summariesFor(
      [here, there],
      pointsByMap([[1, POINTS], [2, POINTS]]),
    );
    const { near, other } = classifyMaps(summaries, { latitude: 46.995, longitude: 8.005 });
    expect(near.map((s) => s.name)).toEqual(['Here', 'There']);
    // Both share the same footprint, so both contain the point.
    expect(other).toHaveLength(0);
  });

  it('orders near by area ascending', () => {
    const small = makeMap({ id: 1, name: 'Small' });
    const large = makeMap({ id: 2, name: 'Large' });
    // A larger map: same u span, a wider longitude span.
    const largePoints = [
      { u: 0, v: 0, lon: 8.0, lat: 47.0 },
      { u: 1, v: 0, lon: 8.05, lat: 47.0 },
      { u: 0, v: 0.75, lon: 8.0, lat: 46.99 },
    ];
    const summaries = summariesFor(
      [large, small],
      pointsByMap([[2, largePoints], [1, POINTS]]),
    );
    const { near } = classifyMaps(summaries, { latitude: 46.995, longitude: 8.005 });
    expect(near.map((s) => s.name)).toEqual(['Small', 'Large']);
  });

  it('ignores a fix with non-finite coordinates', () => {
    const summaries = summariesFor([makeMap()], pointsByMap([[1, POINTS]]));
    const { near, other } = classifyMaps(summaries, { latitude: NaN, longitude: 8.005 });
    expect(near).toHaveLength(0);
    expect(other).toHaveLength(1);
  });

  it('does not refit or reinvert when classifying repeatedly', () => {
    const summaries = summariesFor([makeMap()], pointsByMap([[1, POINTS]]));
    const spy = vi.spyOn(console, 'error');
    const before = JSON.stringify(summaries[0].inverse);
    classifyMaps(summaries, { latitude: 46.995, longitude: 8.005 });
    classifyMaps(summaries, { latitude: 46.995, longitude: 8.005 });
    expect(JSON.stringify(summaries[0].inverse)).toBe(before);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('mapMatch sort options', () => {
  it('offers every sort key in every section', () => {
    const values = SORT_OPTIONS.map((option) => option.value);
    expect(values).toEqual(['distance', 'size', 'lastModified', 'name']);
  });

  it('documents a default key and direction per section', () => {
    expect(DEFAULT_SORT).toEqual({ near: 'size', incomplete: 'lastModified', other: 'distance' });
    expect(DEFAULT_DIRECTION.lastModified).toBe('desc');
    expect(DEFAULT_DIRECTION.distance).toBe('asc');
    expect(DEFAULT_DIRECTION.size).toBe('asc');
    expect(DEFAULT_DIRECTION.name).toBe('asc');
  });
});
