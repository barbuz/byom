import { describe, it, expect } from 'vitest';
import {
  computeSimilarityTransform,
  computeAffineTransform,
  computeHomographyTransform,
  uvToGeo,
  geoToUV,
  calculateTransform,
  geoDistanceToUV,
  imageDivisor,
  metersPerDegreeLon,
  lonLatToLocalMeters,
  localMetersToLonLat,
  wrapLongitude,
  planeOrigin,
} from '../lib/transforms.js';

const METERS_PER_DEG_LAT = 111320;

// Every model exposes the same shape: a row-major 3x3 matrix plus the metric
// plane's origin and a type label. The image plane is fractional (u, v), so
// `m` maps [0,1] fractions to metres.
function expectMatrixShape(transform) {
  expect(transform.m).toHaveLength(9);
  expect(transform.m.every(Number.isFinite)).toBe(true);
  expect(transform.m[8]).toBeCloseTo(1, 12);
  expect(typeof transform.lon0).toBe('number');
  expect(typeof transform.lat0).toBe('number');
}

describe('imageDivisor', () => {
  it('is a single divisor, max(width, height), for both axes', () => {
    expect(imageDivisor(800, 600)).toBe(800);
    expect(imageDivisor(600, 800)).toBe(800);
    expect(imageDivisor(1000, 1000)).toBe(1000);
  });

  it('keeps both coordinates within [0,1] for any aspect ratio', () => {
    // A portrait image: its height exceeds its width, so dividing the
    // vertical coordinate by the width would push v above 1.
    const D = imageDivisor(400, 900);
    expect(400 / D).toBeLessThanOrEqual(1);
    expect(900 / D).toBeLessThanOrEqual(1);
    expect(900 / D).toBeCloseTo(1, 12);
  });
});

describe('computeSimilarityTransform', () => {
  it('fits scale, rotation and translation in a local metric plane', () => {
    // A 100x100 image, so D = 100 and the fractions are the pixels / 100. The
    // two points run due east along the image's top edge (constant v).
    const refs = [
      { u: 0, v: 0, lon: 10, lat: 20 },
      { u: 1, v: 0, lon: 12, lat: 20 },
    ];
    const t = computeSimilarityTransform(refs);

    expect(t.type).toBe('similarity');
    expectMatrixShape(t);
    // Origin is the midpoint of the reference points.
    expect(t.lon0).toBeCloseTo(11, 10);
    expect(t.lat0).toBeCloseTo(20, 10);

    // No projective terms in a similarity.
    expect(t.m[6]).toBe(0);
    expect(t.m[7]).toBe(0);

    // Uniform scale is metres per fraction unit. The linear block sends u to
    // +east and v to -north, because the image's y axis points down (canvas
    // convention) while metric north points up on a north-up map. The map is
    // therefore orientation-reversing, so the determinant is negative.
    const scale = 2 * metersPerDegreeLon(20) / 1;
    expect(t.m[0]).toBeCloseTo(scale, 6);
    expect(t.m[1]).toBeCloseTo(0, 6);
    expect(t.m[3]).toBeCloseTo(0, 6);
    expect(t.m[4]).toBeCloseTo(-scale, 6);
    expect(t.m[0] * t.m[4] - t.m[1] * t.m[3]).toBeLessThan(0);

    // Reference points map exactly onto their fractional image coordinates.
    const a = geoToUV(refs[0].lon, refs[0].lat, t);
    const b = geoToUV(refs[1].lon, refs[1].lat, t);
    expect(a.u).toBeCloseTo(0, 6);
    expect(a.v).toBeCloseTo(0, 6);
    expect(b.u).toBeCloseTo(1, 6);
    expect(b.v).toBeCloseTo(0, 6);
  });

  it('is exact for a correctly projected planar map at 45° latitude with rotation', () => {
    // Map projection: fraction -> ground metres -> degrees, about a fixed
    // origin. The ground truth is a rotated map seen with the image's y axis
    // pointing down, so it is s·R(θ)·diag(1, -1): a similarity composed with
    // the y-down reflection. Latitude 45° makes lon/lat anisotropy 1.41x,
    // which degree space cannot represent but a metric-plane fit can.
    const originLon = 8;
    const originLat = 45;
    const mPerDegLon = metersPerDegreeLon(originLat);
    const metersPerPixel = 8;
    const divisor = 1000;
    const metersPerFraction = metersPerPixel * divisor;
    const mapRotation = 25 * Math.PI / 180;
    const cos = Math.cos(mapRotation);
    const sin = Math.sin(mapRotation);

    const fracToLonLat = (u, v) => ({
      lon: originLon + metersPerFraction * (cos * u + sin * v) / mPerDegLon,
      lat: originLat + metersPerFraction * (sin * u - cos * v) / METERS_PER_DEG_LAT,
    });

    // Reference points symmetric about the map origin, so the centroid the
    // transform uses as its projection origin coincides with it.
    const refs = [
      { u: -300 / divisor, v: -200 / divisor, ...fracToLonLat(-300 / divisor, -200 / divisor) },
      { u: 300 / divisor, v: 200 / divisor, ...fracToLonLat(300 / divisor, 200 / divisor) },
    ];
    const t = computeSimilarityTransform(refs);

    // The linear block is metres-per-fraction-unit times the rotated y-flip.
    expect(t.m[0]).toBeCloseTo(metersPerFraction * cos, 6);
    expect(t.m[1]).toBeCloseTo(metersPerFraction * sin, 6);
    expect(t.m[3]).toBeCloseTo(metersPerFraction * sin, 6);
    expect(t.m[4]).toBeCloseTo(-metersPerFraction * cos, 6);

    for (const [x, y] of [[0, 0], [500, -400], [-900, 700], [123, -456]]) {
      const geo = fracToLonLat(x / divisor, y / divisor);
      const img = geoToUV(geo.lon, geo.lat, t);
      expect(img.u).toBeCloseTo(x / divisor, 6);
      expect(img.v).toBeCloseTo(y / divisor, 6);
    }
  });

  it('does not mirror ground positions about the reference line', () => {
    // The regression: a north-up map with two reference points on its top
    // edge. The image y axis points down (south), so a point below the
    // reference line is south of it. An orientation-preserving fit in (u, v)
    // instead puts it the same distance NORTH, mirroring the whole map.
    const originLon = 8;
    const originLat = 45;
    const mPerDegLon = metersPerDegreeLon(originLat);
    const divisor = 1000;
    // A 1 fraction unit per 8 m map, upright (no rotation).
    const metersPerFraction = 8 * divisor;
    const fracToLonLat = (u, v) => ({
      lon: originLon + metersPerFraction * u / mPerDegLon,
      lat: originLat - metersPerFraction * v / METERS_PER_DEG_LAT,
    });

    const refs = [
      { u: 0, v: 0, ...fracToLonLat(0, 0) },
      { u: 1, v: 0, ...fracToLonLat(1, 0) },
    ];
    const t = computeSimilarityTransform(refs);

    // Below the reference line (v > 0) must be south of it.
    const below = uvToGeo(0.5, 1, t);
    expect(below.lat).toBeLessThan(refs[0].lat);
    expect(below.lat).toBeCloseTo(fracToLonLat(0.5, 1).lat, 9);

    // And the fit is exact across the whole map, not just on the line.
    for (const [u, v] of [[0.25, 0.75], [1, 1], [0, 1], [0.9, 0.1]]) {
      const geo = uvToGeo(u, v, t);
      expect(geo.lon).toBeCloseTo(fracToLonLat(u, v).lon, 9);
      expect(geo.lat).toBeCloseTo(fracToLonLat(u, v).lat, 9);
    }
  });

  it('round-trips image-to-geo then geo-to-image for arbitrary points', () => {
    const refs = [
      { u: -0.12, v: 0.08, lon: 139.69, lat: 35.68 },
      { u: 0.64, v: 0.41, lon: 139.78, lat: 35.75 },
    ];
    const t = computeSimilarityTransform(refs);
    for (const [u, v] of [[0.25, 0.125], [-0.05, 0.9], [1.0, -0.3]]) {
      const geo = uvToGeo(u, v, t);
      const img = geoToUV(geo.lon, geo.lat, t);
      expect(img.u).toBeCloseTo(u, 6);
      expect(img.v).toBeCloseTo(v, 6);
    }
  });

  it('maps the two reference points exactly', () => {
    const refs = [
      { u: 0.01, v: 0.02, lon: -73.99, lat: 40.71 },
      { u: 0.53, v: -0.09, lon: -73.95, lat: 40.75 },
    ];
    const t = computeSimilarityTransform(refs);
    for (const p of refs) {
      const img = geoToUV(p.lon, p.lat, t);
      expect(img.u).toBeCloseTo(p.u, 6);
      expect(img.v).toBeCloseTo(p.v, 6);
      const geo = uvToGeo(p.u, p.v, t);
      expect(geo.lon).toBeCloseTo(p.lon, 9);
      expect(geo.lat).toBeCloseTo(p.lat, 9);
    }
  });

  it('is invariant under a proportional rescale of the image frame', () => {
    // The motivating scenario: the same physical map photograph saved at two
    // resolutions must georeference identically. A copy at half the resolution
    // halves every pixel and the divisor D = max(width, height), so the
    // fractions — what is actually stored — are unchanged.
    const pixels = [
      { x: 120, y: 240, lon: 10, lat: 20 },
      { x: 800, y: 640, lon: 12, lat: 21 },
    ];
    const toFrac = (p, d) => ({ u: p.x / d, v: p.y / d, lon: p.lon, lat: p.lat });
    const fullRes = pixels.map((p) => toFrac(p, 1000));
    const downscaled = pixels.map((p) => toFrac({ ...p, x: p.x / 2, y: p.y / 2 }, 500));

    for (let i = 0; i < pixels.length; i++) {
      expect(downscaled[i].u).toBeCloseTo(fullRes[i].u, 12);
      expect(downscaled[i].v).toBeCloseTo(fullRes[i].v, 12);
    }

    const atFull = uvToGeo(0.5, 0.45, computeSimilarityTransform(fullRes));
    const atDown = uvToGeo(0.5, 0.45, computeSimilarityTransform(downscaled));
    expect(atDown.lon).toBeCloseTo(atFull.lon, 12);
    expect(atDown.lat).toBeCloseTo(atFull.lat, 12);
  });

  it('throws when fewer than 2 reference points', () => {
    const one = [
      { u: 0, v: 0, lon: 1, lat: 2 },
    ];
    expect(() => computeSimilarityTransform(one)).toThrow('Need at least 2 reference points');
  });

  it('throws when the two reference points coincide', () => {
    const refs = [
      { u: 0.5, v: 0.5, lon: 1, lat: 2 },
      { u: 0.5, v: 0.5, lon: 1, lat: 2 },
    ];
    expect(() => computeSimilarityTransform(refs)).toThrow('Reference points must be distinct');
  });
});

describe('metric helpers', () => {
  it('metersPerDegreeLon shrinks with latitude', () => {
    expect(metersPerDegreeLon(0)).toBeCloseTo(METERS_PER_DEG_LAT, 6);
    expect(metersPerDegreeLon(60)).toBeCloseTo(METERS_PER_DEG_LAT / 2, 3);
    expect(metersPerDegreeLon(-60)).toBeCloseTo(METERS_PER_DEG_LAT / 2, 3);
  });

  it('wrapLongitude folds any longitude into [-180, 180)', () => {
    // In-range values must come back bit-identical: the fits depend on it.
    expect(wrapLongitude(0)).toBe(0);
    expect(wrapLongitude(12.3456789)).toBe(12.3456789);
    expect(wrapLongitude(-179.9)).toBe(-179.9);
    expect(wrapLongitude(179.9)).toBe(179.9);

    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(-180)).toBe(-180);
    expect(wrapLongitude(181)).toBeCloseTo(-179, 9);
    expect(wrapLongitude(-181)).toBeCloseTo(179, 9);
    expect(wrapLongitude(360)).toBe(0);
    expect(wrapLongitude(-360)).toBe(0);
    expect(wrapLongitude(200.5)).toBeCloseTo(-159.5, 9);
    expect(wrapLongitude(540)).toBe(-180);
  });

  it('planeOrigin averages plain midpoints away from the antimeridian', () => {
    expect(planeOrigin([{ lon: 10, lat: 20 }])).toEqual({ lon0: 10, lat0: 20 });
    const origin = planeOrigin([
      { lon: 10, lat: 20 },
      { lon: 12, lat: 30 },
      { lon: 14, lat: 40 },
    ]);
    expect(origin.lon0).toBeCloseTo(12, 12);
    expect(origin.lat0).toBeCloseTo(30, 12);
    // In-range longitudes are untouched, so no rounding is introduced.
    expect(origin.lon0).toBe(12);
  });

  it('planeOrigin keeps an antimeridian-crossing map on one side of the globe', () => {
    // The naive mean of these two longitudes is 0.025, forcing a ~20,000 km
    // linearisation for points ~40 km apart.
    const origin = planeOrigin([
      { lon: 179.9, lat: 60 },
      { lon: -179.9, lat: 60 },
    ]);
    expect(Math.abs(origin.lon0)).toBe(180);
    expect(origin.lat0).toBeCloseTo(60, 12);
  });

  it('planeOrigin throws for empty input rather than returning NaN', () => {
    expect(() => planeOrigin([])).toThrow('Cannot compute a plane origin from no points');
  });

  it('projects degrees to local east/north metres about an origin', () => {
    const local = lonLatToLocalMeters(1, 1, 0, 0);
    expect(local.east).toBeCloseTo(METERS_PER_DEG_LAT, 6);
    expect(local.north).toBeCloseTo(METERS_PER_DEG_LAT, 6);

    const at60 = lonLatToLocalMeters(1, 0, 0, 60);
    expect(at60.east).toBeCloseTo(METERS_PER_DEG_LAT * Math.cos(60 * Math.PI / 180), 6);
  });

  it('localMetersToLonLat is the inverse of lonLatToLocalMeters', () => {
    const { east, north } = lonLatToLocalMeters(12.34, -56.78, 12.0, -57.0);
    const back = localMetersToLonLat(east, north, 12.0, -57.0);
    expect(back.lon).toBeCloseTo(12.34, 12);
    expect(back.lat).toBeCloseTo(-56.78, 12);
  });

  it('projects short offsets across the antimeridian without leaving the plane', () => {
    // 179.9 and -179.9 are 0.2 degrees apart, not 359.8.
    const a = lonLatToLocalMeters(179.9, 60, -180, 60);
    const b = lonLatToLocalMeters(-179.9, 60, -180, 60);
    const span = Math.hypot(a.east - b.east, a.north - b.north);
    const expected = 0.2 * metersPerDegreeLon(60);
    expect(span).toBeCloseTo(expected, 6);
    expect(span).toBeLessThan(20000);

    // And the inverse still lands on a valid longitude.
    const back = localMetersToLonLat(a.east, a.north, -180, 60);
    expect(wrapLongitude(back.lon)).toBeCloseTo(179.9, 9);
  });
});

describe('computeAffineTransform + uvToGeo', () => {
  it('maps three non-collinear points exactly', () => {
    const refs = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0, lon: 3, lat: 2 },
      { u: 0, v: 0.5, lon: 1, lat: 4 },
    ];
    const t = computeAffineTransform(refs);
    expect(t.type).toBe('affine');
    expectMatrixShape(t);
    // An affine has no projective terms.
    expect(t.m[6]).toBe(0);
    expect(t.m[7]).toBe(0);
    for (const p of refs) {
      const geo = uvToGeo(p.u, p.v, t);
      expect(geo.lon).toBeCloseTo(p.lon, 6);
      expect(geo.lat).toBeCloseTo(p.lat, 6);
    }
  });

  it('is fitted in a metric plane, so it stays exact at high latitude', () => {
    // A north-up planar map at 60° latitude: the east and north metres-per-pixel
    // differ in degree space by cos(60°), which an affine fitted in degrees
    // could not represent. Coordinates are the pixels over a divisor of 1000.
    const lon0 = 8;
    const lat0 = 60;
    const divisor = 1000;
    const refs = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ].map((p) => ({
      u: p.x / divisor,
      v: p.y / divisor,
      lon: lon0 + (p.x * 1) / metersPerDegreeLon(lat0),
      lat: lat0 + (p.y * 1) / METERS_PER_DEG_LAT,
    }));
    const t = computeAffineTransform(refs);
    for (const p of refs) {
      const img = geoToUV(p.lon, p.lat, t);
      expect(img.u).toBeCloseTo(p.u, 6);
      expect(img.v).toBeCloseTo(p.v, 6);
    }
  });
});

describe('computeHomographyTransform', () => {
  // A projective map: the ground plane is viewed at an angle, so ground
  // position varies as a rational function of the pixel coordinates. The
  // stored (u, v) are the pixels over a divisor of 1000.
  const homographyRefs = [
    { u: 0, v: 0, lon: 8.00, lat: 45.00 },
    { u: 1, v: 0, lon: 8.02, lat: 45.00 },
    { u: 1, v: 0.8, lon: 8.03, lat: 45.01 },
    { u: 0, v: 1, lon: 8.00, lat: 45.02 },
  ];

  it('maps four reference points exactly', () => {
    const t = computeHomographyTransform(homographyRefs);
    expect(t.type).toBe('homography');
    expectMatrixShape(t);
    for (const p of homographyRefs) {
      const geo = uvToGeo(p.u, p.v, t);
      expect(geo.lon).toBeCloseTo(p.lon, 6);
      expect(geo.lat).toBeCloseTo(p.lat, 6);
    }
  });

  it('round-trips a projective transform', () => {
    const t = computeHomographyTransform(homographyRefs);
    for (const [u, v] of [[0.25, 0.125], [0.999, 0.401], [0.01, 0.99]]) {
      const geo = uvToGeo(u, v, t);
      const img = geoToUV(geo.lon, geo.lat, t);
      expect(img.u).toBeCloseTo(u, 6);
      expect(img.v).toBeCloseTo(v, 6);
    }
  });

  it('fits a true projective mapping exactly, where an affine cannot', () => {
    // Ground truth: pixel -> metric plane via a genuine perspective divide.
    // Stored coordinates are the pixels over a divisor of 1000.
    const lon0 = 8;
    const lat0 = 45;
    const divisor = 1000;
    const truth = (x, y) => {
      const w = 1 + 2e-4 * x + 1e-4 * y;
      return {
        east: (10 * x + 2 * y) / w,
        north: (1 * x + 10 * y) / w,
      };
    };
    const toLonLat = ({ east, north }) => localMetersToLonLat(east, north, lon0, lat0);
    const corners = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
    const refs = corners.map(([x, y]) => ({ u: x / divisor, v: y / divisor, ...toLonLat(truth(x, y)) }));

    const homography = computeHomographyTransform(refs);
    for (const [x, y] of [[500, 500], [123, 987], [800, 50]]) {
      const geo = uvToGeo(x / divisor, y / divisor, homography);
      const expected = toLonLat(truth(x, y));
      expect(geo.lon).toBeCloseTo(expected.lon, 9);
      expect(geo.lat).toBeCloseTo(expected.lat, 9);
    }
  });

  it('reduces to the affine solution when the map is not perspective-distorted', () => {
    // For a planar, unrotated map the projective terms vanish, so the
    // homography agrees with the affine fit of the same four corners.
    const refs = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0, lon: 3, lat: 2 },
      { u: 0.5, v: 0.5, lon: 3, lat: 4 },
      { u: 0, v: 0.5, lon: 1, lat: 4 },
    ];
    const homography = computeHomographyTransform(refs);
    const affine = computeAffineTransform(refs);
    expect(homography.m[6]).toBeCloseTo(0, 9);
    expect(homography.m[7]).toBeCloseTo(0, 9);
    for (const p of refs) {
      const viaHomography = uvToGeo(p.u, p.v, homography);
      const viaAffine = uvToGeo(p.u, p.v, affine);
      expect(viaHomography.lon).toBeCloseTo(viaAffine.lon, 9);
      expect(viaHomography.lat).toBeCloseTo(viaAffine.lat, 9);
    }
  });

  it('throws when fewer than 4 reference points', () => {
    const three = homographyRefs.slice(0, 3);
    expect(() => computeHomographyTransform(three))
      .toThrow('Need at least 4 reference points for homography transform');
  });

  it('throws for degenerate points', () => {
    // Three collinear image points make the DLT system singular.
    const collinear = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.1, v: 0.1, lon: 3, lat: 4 },
      { u: 0.2, v: 0.2, lon: 5, lat: 6 },
      { u: 0.3, v: 0.3, lon: 7, lat: 8 },
    ];
    expect(() => computeHomographyTransform(collinear))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });

  it('throws for a degenerate rectangle where two corners coincide', () => {
    const doubled = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 1, v: 0, lon: 3, lat: 2 },
      { u: 1, v: 0, lon: 3, lat: 2 },
      { u: 0, v: 1, lon: 1, lat: 4 },
    ];
    expect(() => computeHomographyTransform(doubled))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });

  it('throws when a single point is repeated and normalization cannot scale', () => {
    // All four points coincide, so the mean distance normalization would
    // divide by zero; the guard falls back to a unit scale and the singular
    // system is then rejected as usual.
    const coincident = [
      { u: 0.7, v: 0.9, lon: 1, lat: 2 },
      { u: 0.7, v: 0.9, lon: 1, lat: 2 },
      { u: 0.7, v: 0.9, lon: 1, lat: 2 },
      { u: 0.7, v: 0.9, lon: 1, lat: 2 },
    ];
    expect(() => computeHomographyTransform(coincident))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });

  it('throws when the fit overflows to a non-finite matrix', () => {
    // Enormous but finite inputs can overflow the fit into a matrix with
    // non-finite coefficients; such a transform must be rejected rather than
    // silently poisoning every subsequent projection.
    const overflowing = [
      { u: 0, v: 0, lon: 0, lat: 0 },
      { u: 1e308, v: 0, lon: 1, lat: 0 },
      { u: 1e308, v: 1e308, lon: 1, lat: 1 },
      { u: 0, v: 1e308, lon: 0, lat: 1 },
    ];
    expect(() => computeHomographyTransform(overflowing))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });
});

describe('homography conditioning', () => {
  // Ground truth is a genuine perspective divide on the metric plane, so a
  // correct fit reproduces it exactly and a badly conditioned one drifts.
  // Stored coordinates are the pixels over the span, so the fractional plane
  // is always unit-span regardless of how many pixels the image has.
  const perspectiveRefs = (pixelSpan) => {
    const lon0 = 8;
    const lat0 = 45;
    const truth = (x, y) => {
      const w = 1 + 2e-4 * (x / pixelSpan) + 1e-4 * (y / pixelSpan);
      return { east: (10 * x + 2 * y) / w, north: (1 * x + 10 * y) / w };
    };
    const refs = [[0, 0], [pixelSpan, 0], [pixelSpan, pixelSpan], [0, pixelSpan]]
      .map(([x, y]) => ({
        u: x / pixelSpan,
        v: y / pixelSpan,
        ...localMetersToLonLat(truth(x, y).east, truth(x, y).north, lon0, lat0),
      }));
    return { refs, truth, lon0, lat0, pixelSpan };
  };

  // The raw DLT design matrix grows worse conditioned with map size; Hartley
  // normalization holds it at a constant ~2.6. These checks assert the
  // observable consequence: the fit stays exact even for a large image, where
  // a raw solve would lose precision.
  it.each([1000, 4000, 12000])('fits a %d px image perspective map to float64 precision', (pixelSpan) => {
    const { refs, truth, lon0, lat0 } = perspectiveRefs(pixelSpan);
    const t = computeHomographyTransform(refs);
    expectMatrixShape(t);

    for (const [x, y] of [[pixelSpan / 2, pixelSpan / 2], [123, pixelSpan - 129], [0.9 * pixelSpan, 50]]) {
      const geo = uvToGeo(x / pixelSpan, y / pixelSpan, t);
      const expected = localMetersToLonLat(truth(x, y).east, truth(x, y).north, lon0, lat0);
      expect(geo.lon).toBeCloseTo(expected.lon, 9);
      expect(geo.lat).toBeCloseTo(expected.lat, 9);
    }
  });

  it('keeps the coefficients finite and the projective terms physical at 12,000 px', () => {
    const { refs } = perspectiveRefs(12000);
    const t = computeHomographyTransform(refs);
    // Projective terms are non-zero but bounded, because the fractional input
    // plane is unit-span whatever the pixel span was.
    expect(t.m[6]).not.toBe(0);
    expect(t.m[7]).not.toBe(0);
    expect(Math.abs(t.m[6])).toBeLessThan(1);
    expect(Math.abs(t.m[7])).toBeLessThan(1);
    expect(t.m[8]).toBeCloseTo(1, 12);
  });

  it('agrees with the affine fit on a large, unrotated, non-perspective map', () => {
    // The denormalized matrix must reduce to affine when there is no
    // perspective, at the scale where conditioning used to hurt most.
    const lon0 = 8;
    const lat0 = 45;
    const refs = [[0, 0], [12000, 0], [12000, 12000], [0, 12000]].map(([x, y]) => ({
      u: x / 12000,
      v: y / 12000,
      ...localMetersToLonLat(3 * x, 4 * y, lon0, lat0),
    }));
    const homography = computeHomographyTransform(refs);
    const affine = computeAffineTransform(refs);
    expect(homography.m[6]).toBeCloseTo(0, 9);
    expect(homography.m[7]).toBeCloseTo(0, 9);
    for (const [u, v] of [[0.5, 0.5], [0.01, 0.99]]) {
      const a = uvToGeo(u, v, affine);
      const h = uvToGeo(u, v, homography);
      expect(h.lon).toBeCloseTo(a.lon, 9);
      expect(h.lat).toBeCloseTo(a.lat, 9);
    }
  });
});

describe('antimeridian-crossing maps', () => {
  // A map spanning 0.4 degrees of longitude at 60N, centred on the date line,
  // so its corners sit at 179.8 and -179.8 and its middle is on it. Stored
  // coordinates are the pixels over a divisor of 1000.
  const lat0 = 60;
  const centreLon = 179.8;
  const pxPerDegree = 1000 / 0.4;
  const divisor = 1000;
  const toLonLat = (x, y) => ({
    lon: wrapLongitude(centreLon + x / pxPerDegree),
    lat: lat0 + y / pxPerDegree,
  });
  const corners = [[0, 0], [1000, 0], [1000, 800], [0, 800]].map(([x, y]) => ({
    u: x / divisor,
    v: y / divisor,
    ...toLonLat(x, y),
  }));

  it('spans the true 0.4 degrees rather than the long way round', () => {
    expect(corners[0].lon).toBeCloseTo(179.8, 9);
    expect(corners[1].lon).toBeCloseTo(-179.8, 9);
    expect(corners[2].lon).toBeCloseTo(-179.8, 9);
    expect(corners[3].lon).toBeCloseTo(179.8, 9);
    // Every corner is within 0.4 degrees of every other, not 359.6.
    for (const a of corners) {
      for (const b of corners) {
        expect(Math.abs(wrapLongitude(a.lon - b.lon))).toBeLessThanOrEqual(0.4 + 1e-9);
      }
    }
  });

  it('similarity spans the real ~20 km between points either side of the line', () => {
    const refs = [
      { u: 0, v: 0, lon: 179.9, lat: 60 },
      { u: 1, v: 0, lon: -179.9, lat: 60 },
    ];
    const t = computeSimilarityTransform(refs);
    expect(t.lon0).toBe(-180);
    expectMatrixShape(t);

    // Metres per fraction unit is 0.2 deg of longitude at 60N over 1 unit.
    const scale = 0.2 * metersPerDegreeLon(60) / 1;
    expect(t.m[0]).toBeCloseTo(scale, 6);

    // No 10,000 km blow-up: the fit is exact at both reference points.
    for (const p of refs) {
      const img = geoToUV(p.lon, p.lat, t);
      expect(img.u).toBeCloseTo(p.u, 6);
      expect(img.v).toBeCloseTo(p.v, 6);
    }
    const mid = uvToGeo(0.5, 0, t);
    expect(Math.abs(mid.lon)).toBe(180);
    expect(mid.lat).toBeCloseTo(60, 9);
  });

  it('affine and homography map the crossing corners exactly', () => {
    for (const t of [
      computeAffineTransform(corners),
      computeHomographyTransform(corners),
    ]) {
      expectMatrixShape(t);
      // The origin sits inside the map's 0.2-degree span, not on the far side
      // of the planet as a naive mean would put it.
      expect(Math.abs(t.lon0)).toBeGreaterThan(179.8);
      expect(Math.abs(t.lon0)).toBeLessThanOrEqual(180);
      for (const p of corners) {
        const geo = uvToGeo(p.u, p.v, t);
        expect(geo.lon).toBeCloseTo(p.lon, 9);
        expect(geo.lat).toBeCloseTo(p.lat, 9);
      }
      // Interior points land where the underlying pixel-to-degree map says,
      // with 180 wrapped back to -180.
      const interior = uvToGeo(0.5, 0.4, t);
      expect(interior.lon).toBeCloseTo(-180, 9);
      expect(interior.lat).toBeCloseTo(60.16, 9);
    }
  });

  it('geoDistanceToUV stays finite for a point on the line', () => {
    const t = computeSimilarityTransform(corners.slice(0, 2));
    const d = geoDistanceToUV(-179.95, 60, 500, t);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});

describe('reference point validation', () => {
  const valid = [
    { u: 0, v: 0, lon: 1, lat: 2 },
    { u: 0.5, v: 0, lon: 3, lat: 2 },
    { u: 0, v: 0.5, lon: 1, lat: 4 },
    { u: 0.5, v: 0.5, lon: 3, lat: 4 },
  ];

  const fitters = [
    ['similarity', (refs) => computeSimilarityTransform(refs.slice(0, 2))],
    ['affine', (refs) => computeAffineTransform(refs.slice(0, 3))],
    ['homography', (refs) => computeHomographyTransform(refs)],
  ];

  it.each(fitters)('%s rejects a null coordinate', (_name, fit) => {
    // A null coordinate coerces (`null - lon0` is a number), so without a
    // guard the fit succeeds with a plausible but wrong transform.
    for (const field of ['lon', 'lat', 'u', 'v']) {
      const refs = valid.map(p => ({ ...p }));
      refs[0][field] = null;
      expect(() => fit(refs)).toThrow('Reference points must have finite coordinates');
    }
  });

  it.each(fitters)('%s rejects an undefined coordinate', (_name, fit) => {
    const refs = valid.map(p => ({ ...p }));
    delete refs[1].lon;
    expect(() => fit(refs)).toThrow('Reference points must have finite coordinates');
  });

  it.each(fitters)('%s rejects a non-numeric coordinate', (_name, fit) => {
    for (const bad of [NaN, Infinity, -Infinity, '12']) {
      const refs = valid.map(p => ({ ...p }));
      refs[1].lat = bad;
      expect(() => fit(refs)).toThrow('Reference points must have finite coordinates');
    }
  });

  it('leaves the extra points beyond the fit untouched by validation', () => {
    // Only the points a model actually uses are validated, so a malformed 5th
    // point does not break the 4-point homography.
    const refs = [...valid, { u: 0, v: 0, lon: null, lat: null }];
    expect(() => computeHomographyTransform(refs)).not.toThrow();
  });
});

describe('geoDistanceToUV', () => {
  it('returns a positive scale-dependent distance', () => {
    const refs = [
      { u: 0, v: 0, lon: 0, lat: 0 },
      { u: 1, v: 0, lon: 0.01, lat: 0 },
    ];
    const t = computeSimilarityTransform(refs);
    const d = geoDistanceToUV(0, 0, 100, t);
    expect(d).toBeGreaterThan(0);
  });

  it('converts metres to fractional units via the transform scale', () => {
    // North-up map at the equator, 1 fraction unit per 0.01° of longitude
    // (~1113 m).
    const refs = [
      { u: 0, v: 0, lon: 0, lat: 0 },
      { u: 1, v: 0, lon: 0.01, lat: 0 },
    ];
    const t = computeSimilarityTransform(refs);
    const metersPerUnit = Math.hypot(t.m[0], t.m[3]);
    const d = geoDistanceToUV(0.004, 0.003, 500, t);
    expect(d).toBeCloseTo(500 / metersPerUnit, 6);
  });

  it('accounts for both axes so the ring is circular under map rotation', () => {
    // Same planar map as the similarity test: 45° latitude, 25° map rotation.
    // A latitude-only offset would be squashed by the lon/lat anisotropy.
    const originLon = 8;
    const originLat = 45;
    const mPerDegLon = metersPerDegreeLon(originLat);
    const metersPerPixel = 8;
    const divisor = 1000;
    const mapRotation = 25 * Math.PI / 180;
    const refs = [
      { x: -300, y: -200 },
      { x: 300, y: 200 },
    ].map(p => ({
      u: p.x / divisor,
      v: p.y / divisor,
      lon: originLon + metersPerPixel * (Math.cos(mapRotation) * p.x - Math.sin(mapRotation) * p.y) / mPerDegLon,
      lat: originLat + metersPerPixel * (Math.sin(mapRotation) * p.x + Math.cos(mapRotation) * p.y) / METERS_PER_DEG_LAT,
    }));
    const t = computeSimilarityTransform(refs);

    const expectedUnits = 500 / metersPerPixel / divisor;
    for (const [lon, lat] of [[originLon, originLat], [originLon + 0.01, originLat - 0.008], [originLon - 0.02, originLat + 0.005]]) {
      expect(geoDistanceToUV(lon, lat, 500, t)).toBeCloseTo(expectedUnits, 6);
    }

    // The metric-plane offset stays isotropic: a north-only offset measures
    // the same fractional distance as an east-only offset of the same length.
    const north = geoDistanceToUV(originLon, originLat, 500, t);
    expect(north).toBeCloseTo(expectedUnits, 6);
  });

  it('handles the affine path with both axes', () => {
    const refs = [
      { u: 0, v: 0, lon: 8, lat: 45 },
      { u: 1, v: 0, lon: 8.01, lat: 45 },
      { u: 0, v: 1, lon: 8, lat: 45.01 },
    ];
    const t = computeAffineTransform(refs);
    const d = geoDistanceToUV(8, 45, 0, t);
    expect(d).toBeCloseTo(0, 9);
    expect(geoDistanceToUV(8.005, 45.005, 500, t)).toBeGreaterThan(0);
  });

  it('works for a homography transform', () => {
    const refs = [
      { u: 0, v: 0, lon: 8.00, lat: 45.00 },
      { u: 1, v: 0, lon: 8.02, lat: 45.00 },
      { u: 1, v: 0.8, lon: 8.03, lat: 45.01 },
      { u: 0, v: 1, lon: 8.00, lat: 45.02 },
    ];
    const t = computeHomographyTransform(refs);
    const d = geoDistanceToUV(8.01, 45.005, 500, t);
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe('calculateTransform', () => {
  it('returns null with too few points', () => {
    expect(calculateTransform([])).toBeNull();
    expect(calculateTransform(null)).toBeNull();
    const one = [{ u: 0, v: 0, lon: 1, lat: 2 }];
    expect(calculateTransform(one)).toBeNull();
  });

  it('chooses similarity for two, affine for three, homography for four', () => {
    const two = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0, lon: 3, lat: 2 },
    ];
    const three = [
      ...two,
      { u: 0, v: 0.5, lon: 1, lat: 4 },
    ];
    const four = [
      ...three,
      { u: 0.5, v: 0.5, lon: 3, lat: 4 },
    ];

    expect(calculateTransform(two).type).toBe('similarity');
    expect(calculateTransform(three).type).toBe('affine');
    expect(calculateTransform(four).type).toBe('homography');
  });

  it('returns a transform object directly, with no wrapper', () => {
    const two = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0, lon: 3, lat: 2 },
    ];
    const result = calculateTransform(two);
    expect(result.m).toHaveLength(9);
    expect(result).not.toHaveProperty('transform');
  });
});

describe('computeAffineTransform collinearity', () => {
  it('throws for collinear image points', () => {
    const collinear = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.1, v: 0.1, lon: 3, lat: 4 },
      { u: 0.2, v: 0.2, lon: 5, lat: 6 },
    ];
    expect(() => computeAffineTransform(collinear)).toThrow('Points are collinear, cannot compute affine transform');
  });

  it('throws for collinear geo points', () => {
    const collinearGeo = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0, lon: 3, lat: 4 },
      { u: 1, v: 0, lon: 5, lat: 6 },
    ];
    expect(() => computeAffineTransform(collinearGeo)).toThrow('Points are collinear, cannot compute affine transform');
  });

  it('throws when fewer than 3 reference points', () => {
    const two = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0, lon: 3, lat: 2 },
    ];
    expect(() => computeAffineTransform(two)).toThrow('Need at least 3 reference points for affine transform');
  });
});

describe('computeAffineTransform round-trip', () => {
  it('uvToGeo then geoToUV returns the original point', () => {
    const refs = [
      { u: 0, v: 0, lon: 1, lat: 2 },
      { u: 0.5, v: 0.25, lon: 3, lat: 4 },
      { u: -0.15, v: 0.4, lon: -2, lat: 9 },
    ];
    const t = computeAffineTransform(refs);
    for (const p of refs) {
      const geo = uvToGeo(p.u, p.v, t);
      const back = geoToUV(geo.lon, geo.lat, t);
      expect(back.u).toBeCloseTo(p.u, 6);
      expect(back.v).toBeCloseTo(p.v, 6);
    }
  });
});

describe('uvToGeo and geoToUV error cases', () => {
  it('throws when inverting a singular transform', () => {
    // Rows 1 and 2 are identical, so the matrix has zero determinant.
    const singular = { m: [1, 2, 3, 1, 2, 3, 0, 0, 1], type: 'affine', lon0: 0, lat0: 0 };
    expect(() => geoToUV(0, 0, singular)).toThrow('Transform is singular');
  });

  it('throws when a point maps to infinity', () => {
    // The image-space line 2u + v = 0 is the horizon, where w = 0.
    const projective = {
      m: [1, 0, 0, 0, 1, 0, 2, 1, 0],
      type: 'homography',
      lon0: 0,
      lat0: 0,
    };
    expect(() => uvToGeo(1, -2, projective)).toThrow('Transform is singular');
    // Its inverse is singular too, since this matrix is not invertible.
    expect(() => geoToUV(-2, 1, projective)).toThrow('Transform is singular');
  });

  it('throws when the inverse maps a point to infinity', () => {
    // An invertible homography whose projective row is (1, 1, 1): every image
    // point maps to a finite position, but the metric-space horizon east +
    // north = -1 has no finite image.
    const projective = {
      m: [1, 0, 0, 0, 1, 0, 1, 1, 1],
      type: 'homography',
      lon0: 0,
      lat0: 0,
    };
    const finite = uvToGeo(0, 0, projective);
    expect(Number.isFinite(finite.lon)).toBe(true);
    expect(Number.isFinite(finite.lat)).toBe(true);

    const onHorizon = localMetersToLonLat(1, 0, projective.lon0, projective.lat0);
    expect(() => geoToUV(onHorizon.lon, onHorizon.lat, projective))
      .toThrow('Transform is singular');

    // A neighbouring point still resolves, confirming only the horizon fails.
    const nearHorizon = localMetersToLonLat(1, 0.001, projective.lon0, projective.lat0);
    const img = geoToUV(nearHorizon.lon, nearHorizon.lat, projective);
    expect(Number.isFinite(img.u)).toBe(true);
    expect(Number.isFinite(img.v)).toBe(true);
  });
});