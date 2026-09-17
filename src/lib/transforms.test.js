import { describe, it, expect } from 'vitest';
import {
  computeSimilarityTransform,
  computeAffineTransform,
  computeHomographyTransform,
  imageToGeo,
  geoToImage,
  calculateTransform,
  geoDistanceToImagePixels,
  metersPerDegreeLon,
  lonLatToLocalMeters,
  localMetersToLonLat,
  wrapLongitude,
  planeOrigin,
} from '../lib/transforms.js';

const METERS_PER_DEG_LAT = 111320;

// Every model exposes the same shape: a row-major 3x3 matrix plus the metric
// plane's origin and a type label.
function expectMatrixShape(transform) {
  expect(transform.m).toHaveLength(9);
  expect(transform.m.every(Number.isFinite)).toBe(true);
  expect(transform.m[8]).toBeCloseTo(1, 12);
  expect(typeof transform.lon0).toBe('number');
  expect(typeof transform.lat0).toBe('number');
}

describe('computeSimilarityTransform', () => {
  it('fits scale, rotation and translation in a local metric plane', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 10, lat: 20 },
      { imageX: 100, imageY: 0, lon: 12, lat: 20 },
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

    // Uniform scale is metres per pixel; the linear part is that scale rotated
    // by zero, since the two points run due east in both spaces.
    const scale = 2 * metersPerDegreeLon(20) / 100;
    expect(t.m[0]).toBeCloseTo(scale, 6);
    expect(t.m[1]).toBeCloseTo(0, 6);
    expect(t.m[3]).toBeCloseTo(0, 6);
    expect(t.m[4]).toBeCloseTo(scale, 6);

    // Reference points map exactly onto their image coordinates.
    const a = geoToImage(refs[0].lon, refs[0].lat, t);
    const b = geoToImage(refs[1].lon, refs[1].lat, t);
    expect(a.imageX).toBeCloseTo(0, 6);
    expect(a.imageY).toBeCloseTo(0, 6);
    expect(b.imageX).toBeCloseTo(100, 6);
    expect(b.imageY).toBeCloseTo(0, 6);
  });

  it('is exact for a correctly projected planar map at 45° latitude with rotation', () => {
    // Map projection: pixel -> ground metres (rotated) -> degrees, about a
    // fixed origin. Latitude 45° makes lon/lat anisotropy 1.41x, which degree
    // space cannot represent but a metric-plane similarity can.
    const originLon = 8;
    const originLat = 45;
    const mPerDegLon = metersPerDegreeLon(originLat);
    const metersPerPixel = 8;
    const mapRotation = 25 * Math.PI / 180;

    const pxToLonLat = (x, y) => ({
      lon: originLon + metersPerPixel * (Math.cos(mapRotation) * x - Math.sin(mapRotation) * y) / mPerDegLon,
      lat: originLat + metersPerPixel * (Math.sin(mapRotation) * x + Math.cos(mapRotation) * y) / METERS_PER_DEG_LAT,
    });

    // Reference points symmetric about the map origin, so the centroid the
    // transform uses as its projection origin coincides with it.
    const refs = [
      { imageX: -300, imageY: -200, ...pxToLonLat(-300, -200) },
      { imageX: 300, imageY: 200, ...pxToLonLat(300, 200) },
    ];
    const t = computeSimilarityTransform(refs);

    // The linear block is metres-per-pixel times the map rotation.
    expect(t.m[0]).toBeCloseTo(metersPerPixel * Math.cos(mapRotation), 6);
    expect(t.m[1]).toBeCloseTo(-metersPerPixel * Math.sin(mapRotation), 6);
    expect(t.m[3]).toBeCloseTo(metersPerPixel * Math.sin(mapRotation), 6);
    expect(t.m[4]).toBeCloseTo(metersPerPixel * Math.cos(mapRotation), 6);

    for (const [x, y] of [[0, 0], [500, -400], [-900, 700], [123, -456]]) {
      const geo = pxToLonLat(x, y);
      const img = geoToImage(geo.lon, geo.lat, t);
      expect(img.imageX).toBeCloseTo(x, 6);
      expect(img.imageY).toBeCloseTo(y, 6);
    }
  });

  it('round-trips image-to-geo then geo-to-image for arbitrary points', () => {
    const refs = [
      { imageX: -120, imageY: 80, lon: 139.69, lat: 35.68 },
      { imageX: 640, imageY: 410, lon: 139.78, lat: 35.75 },
    ];
    const t = computeSimilarityTransform(refs);
    for (const [x, y] of [[250, 125], [-50, 900], [1000, -300]]) {
      const geo = imageToGeo(x, y, t);
      const img = geoToImage(geo.lon, geo.lat, t);
      expect(img.imageX).toBeCloseTo(x, 6);
      expect(img.imageY).toBeCloseTo(y, 6);
    }
  });

  it('maps the two reference points exactly', () => {
    const refs = [
      { imageX: 10, imageY: 20, lon: -73.99, lat: 40.71 },
      { imageX: 530, imageY: -90, lon: -73.95, lat: 40.75 },
    ];
    const t = computeSimilarityTransform(refs);
    for (const p of refs) {
      const img = geoToImage(p.lon, p.lat, t);
      expect(img.imageX).toBeCloseTo(p.imageX, 6);
      expect(img.imageY).toBeCloseTo(p.imageY, 6);
      const geo = imageToGeo(p.imageX, p.imageY, t);
      expect(geo.lon).toBeCloseTo(p.lon, 9);
      expect(geo.lat).toBeCloseTo(p.lat, 9);
    }
  });

  it('throws when fewer than 2 reference points', () => {
    const one = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
    ];
    expect(() => computeSimilarityTransform(one)).toThrow('Need at least 2 reference points');
  });

  it('throws when the two reference points coincide', () => {
    const refs = [
      { imageX: 5, imageY: 5, lon: 1, lat: 2 },
      { imageX: 5, imageY: 5, lon: 1, lat: 2 },
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

describe('computeAffineTransform + imageToGeo', () => {
  it('maps three non-collinear points exactly', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
      { imageX: 0, imageY: 100, lon: 1, lat: 4 },
    ];
    const t = computeAffineTransform(refs);
    expect(t.type).toBe('affine');
    expectMatrixShape(t);
    // An affine has no projective terms.
    expect(t.m[6]).toBe(0);
    expect(t.m[7]).toBe(0);
    for (const p of refs) {
      const geo = imageToGeo(p.imageX, p.imageY, t);
      expect(geo.lon).toBeCloseTo(p.lon, 6);
      expect(geo.lat).toBeCloseTo(p.lat, 6);
    }
  });

  it('is fitted in a metric plane, so it stays exact at high latitude', () => {
    // A north-up planar map at 60° latitude: the east and north metres-per-pixel
    // differ in degree space by cos(60°), which an affine fitted in degrees
    // could not represent.
    const lon0 = 8;
    const lat0 = 60;
    const refs = [
      { imageX: 0, imageY: 0 },
      { imageX: 1000, imageY: 0 },
      { imageX: 0, imageY: 1000 },
    ].map((p) => ({
      ...p,
      lon: lon0 + (p.imageX * 1) / metersPerDegreeLon(lat0),
      lat: lat0 + (p.imageY * 1) / METERS_PER_DEG_LAT,
    }));
    const t = computeAffineTransform(refs);
    for (const p of refs) {
      const img = geoToImage(p.lon, p.lat, t);
      expect(img.imageX).toBeCloseTo(p.imageX, 6);
      expect(img.imageY).toBeCloseTo(p.imageY, 6);
    }
  });
});

describe('computeHomographyTransform', () => {
  // A projective map: the ground plane is viewed at an angle, so ground
  // position varies as a rational function of the pixel coordinates.
  const homographyRefs = [
    { imageX: 0, imageY: 0, lon: 8.00, lat: 45.00 },
    { imageX: 1000, imageY: 0, lon: 8.02, lat: 45.00 },
    { imageX: 1000, imageY: 800, lon: 8.03, lat: 45.01 },
    { imageX: 0, imageY: 1000, lon: 8.00, lat: 45.02 },
  ];

  it('maps four reference points exactly', () => {
    const t = computeHomographyTransform(homographyRefs);
    expect(t.type).toBe('homography');
    expectMatrixShape(t);
    for (const p of homographyRefs) {
      const geo = imageToGeo(p.imageX, p.imageY, t);
      expect(geo.lon).toBeCloseTo(p.lon, 6);
      expect(geo.lat).toBeCloseTo(p.lat, 6);
    }
  });

  it('round-trips a projective transform', () => {
    const t = computeHomographyTransform(homographyRefs);
    for (const [x, y] of [[250, 125], [999, 401], [10, 990]]) {
      const geo = imageToGeo(x, y, t);
      const img = geoToImage(geo.lon, geo.lat, t);
      expect(img.imageX).toBeCloseTo(x, 6);
      expect(img.imageY).toBeCloseTo(y, 6);
    }
  });

  it('fits a true projective mapping exactly, where an affine cannot', () => {
    // Ground truth: pixel -> metric plane via a genuine perspective divide.
    const lon0 = 8;
    const lat0 = 45;
    const truth = (x, y) => {
      const w = 1 + 2e-4 * x + 1e-4 * y;
      return {
        east: (10 * x + 2 * y) / w,
        north: (1 * x + 10 * y) / w,
      };
    };
    const toLonLat = ({ east, north }) => localMetersToLonLat(east, north, lon0, lat0);
    const corners = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
    const refs = corners.map(([x, y]) => ({ imageX: x, imageY: y, ...toLonLat(truth(x, y)) }));

    const homography = computeHomographyTransform(refs);
    for (const [x, y] of [[500, 500], [123, 987], [800, 50]]) {
      const geo = imageToGeo(x, y, homography);
      const expected = toLonLat(truth(x, y));
      expect(geo.lon).toBeCloseTo(expected.lon, 9);
      expect(geo.lat).toBeCloseTo(expected.lat, 9);
    }
  });

  it('reduces to the affine solution when the map is not perspective-distorted', () => {
    // For a planar, unrotated map the projective terms vanish, so the
    // homography agrees with the affine fit of the same four corners.
    const refs = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
      { imageX: 100, imageY: 100, lon: 3, lat: 4 },
      { imageX: 0, imageY: 100, lon: 1, lat: 4 },
    ];
    const homography = computeHomographyTransform(refs);
    const affine = computeAffineTransform(refs);
    expect(homography.m[6]).toBeCloseTo(0, 9);
    expect(homography.m[7]).toBeCloseTo(0, 9);
    for (const p of refs) {
      const viaHomography = imageToGeo(p.imageX, p.imageY, homography);
      const viaAffine = imageToGeo(p.imageX, p.imageY, affine);
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
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 10, imageY: 10, lon: 3, lat: 4 },
      { imageX: 20, imageY: 20, lon: 5, lat: 6 },
      { imageX: 30, imageY: 30, lon: 7, lat: 8 },
    ];
    expect(() => computeHomographyTransform(collinear))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });

  it('throws for a degenerate rectangle where two corners coincide', () => {
    const doubled = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
      { imageX: 0, imageY: 100, lon: 1, lat: 4 },
    ];
    expect(() => computeHomographyTransform(doubled))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });

  it('throws when a single point is repeated and normalization cannot scale', () => {
    // All four points coincide, so the mean distance normalization would
    // divide by zero; the guard falls back to a unit scale and the singular
    // system is then rejected as usual.
    const coincident = [
      { imageX: 7, imageY: 9, lon: 1, lat: 2 },
      { imageX: 7, imageY: 9, lon: 1, lat: 2 },
      { imageX: 7, imageY: 9, lon: 1, lat: 2 },
      { imageX: 7, imageY: 9, lon: 1, lat: 2 },
    ];
    expect(() => computeHomographyTransform(coincident))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });

  it('throws when the fit overflows to a non-finite matrix', () => {
    // Enormous but finite inputs can overflow the fit into a matrix with
    // non-finite coefficients; such a transform must be rejected rather than
    // silently poisoning every subsequent projection.
    const overflowing = [
      { imageX: 0, imageY: 0, lon: 0, lat: 0 },
      { imageX: 1e308, imageY: 0, lon: 1, lat: 0 },
      { imageX: 1e308, imageY: 1e308, lon: 1, lat: 1 },
      { imageX: 0, imageY: 1e308, lon: 0, lat: 1 },
    ];
    expect(() => computeHomographyTransform(overflowing))
      .toThrow('Points are degenerate, cannot compute homography transform');
  });
});

describe('homography conditioning', () => {
  // Ground truth is a genuine perspective divide on the metric plane, so a
  // correct fit reproduces it exactly and a badly conditioned one drifts.
  const perspectiveRefs = (pixelSpan) => {
    const lon0 = 8;
    const lat0 = 45;
    const truth = (x, y) => {
      const w = 1 + 2e-4 * (x / pixelSpan) + 1e-4 * (y / pixelSpan);
      return { east: (10 * x + 2 * y) / w, north: (1 * x + 10 * y) / w };
    };
    const refs = [[0, 0], [pixelSpan, 0], [pixelSpan, pixelSpan], [0, pixelSpan]]
      .map(([x, y]) => ({ imageX: x, imageY: y, ...localMetersToLonLat(truth(x, y).east, truth(x, y).north, lon0, lat0) }));
    return { refs, truth, lon0, lat0 };
  };

  // The raw DLT design matrix grows worse conditioned with map size; Hartley
  // normalization holds it at a constant ~2.6. These checks assert the
  // observable consequence: the fit stays exact at 12,000 px, where a raw
  // solve of a large map loses precision.
  it.each([1000, 4000, 12000])('fits a %d px perspective map to float64 precision', (pixelSpan) => {
    const { refs, truth, lon0, lat0 } = perspectiveRefs(pixelSpan);
    const t = computeHomographyTransform(refs);
    expectMatrixShape(t);

    for (const [x, y] of [[pixelSpan / 2, pixelSpan / 2], [123, pixelSpan - 129], [0.9 * pixelSpan, 50]]) {
      const geo = imageToGeo(x, y, t);
      const expected = localMetersToLonLat(truth(x, y).east, truth(x, y).north, lon0, lat0);
      expect(geo.lon).toBeCloseTo(expected.lon, 9);
      expect(geo.lat).toBeCloseTo(expected.lat, 9);
    }
  });

  it('keeps the coefficients finite and the projective terms physical at 12,000 px', () => {
    const { refs } = perspectiveRefs(12000);
    const t = computeHomographyTransform(refs);
    // Projective terms scale as 1/span, so they are small but non-zero.
    expect(t.m[6]).not.toBe(0);
    expect(t.m[7]).not.toBe(0);
    expect(Math.abs(t.m[6])).toBeLessThan(1e-6);
    expect(Math.abs(t.m[7])).toBeLessThan(1e-6);
    expect(t.m[8]).toBeCloseTo(1, 12);
  });

  it('agrees with the affine fit on a large, unrotated, non-perspective map', () => {
    // The denormalized matrix must reduce to affine when there is no
    // perspective, at the scale where conditioning used to hurt most.
    const lon0 = 8;
    const lat0 = 45;
    const refs = [[0, 0], [12000, 0], [12000, 12000], [0, 12000]].map(([x, y]) => ({
      imageX: x,
      imageY: y,
      ...localMetersToLonLat(3 * x, 4 * y, lon0, lat0),
    }));
    const homography = computeHomographyTransform(refs);
    const affine = computeAffineTransform(refs);
    expect(homography.m[6]).toBeCloseTo(0, 9);
    expect(homography.m[7]).toBeCloseTo(0, 9);
    for (const [x, y] of [[6000, 6000], [100, 11900]]) {
      const a = imageToGeo(x, y, affine);
      const h = imageToGeo(x, y, homography);
      expect(h.lon).toBeCloseTo(a.lon, 9);
      expect(h.lat).toBeCloseTo(a.lat, 9);
    }
  });
});

describe('antimeridian-crossing maps', () => {
  // A 1000x800 px map spanning 0.4 degrees of longitude at 60N, centred on the
  // date line, so its corners sit at 179.8 and -179.8 and its middle is on it.
  const lat0 = 60;
  const centreLon = 179.8;
  const pxPerDegree = 1000 / 0.4;
  const toLonLat = (x, y) => ({
    lon: wrapLongitude(centreLon + x / pxPerDegree),
    lat: lat0 + y / pxPerDegree,
  });
  const corners = [[0, 0], [1000, 0], [1000, 800], [0, 800]].map(([x, y]) => ({
    imageX: x,
    imageY: y,
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
      { imageX: 0, imageY: 0, lon: 179.9, lat: 60 },
      { imageX: 1000, imageY: 0, lon: -179.9, lat: 60 },
    ];
    const t = computeSimilarityTransform(refs);
    expect(t.lon0).toBe(-180);
    expectMatrixShape(t);

    // Metres per pixel is 0.2 deg of longitude at 60N over 1000 px.
    const scale = 0.2 * metersPerDegreeLon(60) / 1000;
    expect(t.m[0]).toBeCloseTo(scale, 6);

    // No 10,000 km blow-up: the fit is exact at both reference points.
    for (const p of refs) {
      const img = geoToImage(p.lon, p.lat, t);
      expect(img.imageX).toBeCloseTo(p.imageX, 6);
      expect(img.imageY).toBeCloseTo(p.imageY, 6);
    }
    const mid = imageToGeo(500, 0, t);
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
        const geo = imageToGeo(p.imageX, p.imageY, t);
        expect(geo.lon).toBeCloseTo(p.lon, 9);
        expect(geo.lat).toBeCloseTo(p.lat, 9);
      }
      // Interior points land where the underlying pixel-to-degree map says,
      // with 180 wrapped back to -180.
      const interior = imageToGeo(500, 400, t);
      expect(interior.lon).toBeCloseTo(-180, 9);
      expect(interior.lat).toBeCloseTo(60.16, 9);
    }
  });

  it('geoDistanceToImagePixels stays finite for a point on the line', () => {
    const t = computeSimilarityTransform(corners.slice(0, 2));
    const px = geoDistanceToImagePixels(-179.95, 60, 500, t);
    expect(Number.isFinite(px)).toBe(true);
    expect(px).toBeGreaterThan(0);
  });
});

describe('reference point validation', () => {
  const valid = [
    { imageX: 0, imageY: 0, lon: 1, lat: 2 },
    { imageX: 100, imageY: 0, lon: 3, lat: 2 },
    { imageX: 0, imageY: 100, lon: 1, lat: 4 },
    { imageX: 100, imageY: 100, lon: 3, lat: 4 },
  ];

  const fitters = [
    ['similarity', (refs) => computeSimilarityTransform(refs.slice(0, 2))],
    ['affine', (refs) => computeAffineTransform(refs.slice(0, 3))],
    ['homography', (refs) => computeHomographyTransform(refs)],
  ];

  it.each(fitters)('%s rejects a null coordinate', (_name, fit) => {
    // A null coordinate coerces (`null - lon0` is a number), so without a
    // guard the fit succeeds with a plausible but wrong transform.
    for (const field of ['lon', 'lat', 'imageX', 'imageY']) {
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
    const refs = [...valid, { imageX: 0, imageY: 0, lon: null, lat: null }];
    expect(() => computeHomographyTransform(refs)).not.toThrow();
  });
});

describe('geoDistanceToImagePixels', () => {
  it('returns a positive scale-dependent distance', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 0, lat: 0 },
      { imageX: 1000, imageY: 0, lon: 0.01, lat: 0 },
    ];
    const t = computeSimilarityTransform(refs);
    const px = geoDistanceToImagePixels(0, 0, 100, t);
    expect(px).toBeGreaterThan(0);
  });

  it('converts metres to pixels via the transform scale', () => {
    // North-up map at the equator, 100 px per 0.01° of longitude (~1113 m).
    const refs = [
      { imageX: 0, imageY: 0, lon: 0, lat: 0 },
      { imageX: 1000, imageY: 0, lon: 0.01, lat: 0 },
    ];
    const t = computeSimilarityTransform(refs);
    const metersPerPixel = Math.hypot(t.m[0], t.m[3]);
    const px = geoDistanceToImagePixels(0.004, 0.003, 500, t);
    expect(px).toBeCloseTo(500 / metersPerPixel, 6);
  });

  it('accounts for both axes so the ring is circular under map rotation', () => {
    // Same planar map as the similarity test: 45° latitude, 25° map rotation.
    // A latitude-only offset would be squashed by the lon/lat anisotropy.
    const originLon = 8;
    const originLat = 45;
    const mPerDegLon = metersPerDegreeLon(originLat);
    const metersPerPixel = 8;
    const mapRotation = 25 * Math.PI / 180;
    const refs = [
      { imageX: -300, imageY: -200 },
      { imageX: 300, imageY: 200 },
    ].map(p => ({
      ...p,
      lon: originLon + metersPerPixel * (Math.cos(mapRotation) * p.imageX - Math.sin(mapRotation) * p.imageY) / mPerDegLon,
      lat: originLat + metersPerPixel * (Math.sin(mapRotation) * p.imageX + Math.cos(mapRotation) * p.imageY) / METERS_PER_DEG_LAT,
    }));
    const t = computeSimilarityTransform(refs);

    const expectedPixels = 500 / metersPerPixel;
    for (const [lon, lat] of [[originLon, originLat], [originLon + 0.01, originLat - 0.008], [originLon - 0.02, originLat + 0.005]]) {
      expect(geoDistanceToImagePixels(lon, lat, 500, t)).toBeCloseTo(expectedPixels, 6);
    }

    // The metric-plane offset stays isotropic: a north-only offset measures
    // the same pixel distance as an east-only offset of the same length.
    const north = geoDistanceToImagePixels(originLon, originLat, 500, t);
    expect(north).toBeCloseTo(expectedPixels, 6);
  });

  it('handles the affine path with both axes', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 8, lat: 45 },
      { imageX: 1000, imageY: 0, lon: 8.01, lat: 45 },
      { imageX: 0, imageY: 1000, lon: 8, lat: 45.01 },
    ];
    const t = computeAffineTransform(refs);
    const px = geoDistanceToImagePixels(8, 45, 0, t);
    expect(px).toBeCloseTo(0, 9);
    expect(geoDistanceToImagePixels(8.005, 45.005, 500, t)).toBeGreaterThan(0);
  });

  it('works for a homography transform', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 8.00, lat: 45.00 },
      { imageX: 1000, imageY: 0, lon: 8.02, lat: 45.00 },
      { imageX: 1000, imageY: 800, lon: 8.03, lat: 45.01 },
      { imageX: 0, imageY: 1000, lon: 8.00, lat: 45.02 },
    ];
    const t = computeHomographyTransform(refs);
    const px = geoDistanceToImagePixels(8.01, 45.005, 500, t);
    expect(px).toBeGreaterThan(0);
    expect(Number.isFinite(px)).toBe(true);
  });
});

describe('calculateTransform', () => {
  it('returns null with too few points', () => {
    expect(calculateTransform([])).toBeNull();
    expect(calculateTransform(null)).toBeNull();
    const one = [{ imageX: 0, imageY: 0, lon: 1, lat: 2 }];
    expect(calculateTransform(one)).toBeNull();
  });

  it('chooses similarity for two, affine for three, homography for four', () => {
    const two = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
    ];
    const three = [
      ...two,
      { imageX: 0, imageY: 100, lon: 1, lat: 4 },
    ];
    const four = [
      ...three,
      { imageX: 100, imageY: 100, lon: 3, lat: 4 },
    ];

    expect(calculateTransform(two).type).toBe('similarity');
    expect(calculateTransform(three).type).toBe('affine');
    expect(calculateTransform(four).type).toBe('homography');
  });

  it('returns a transform object directly, with no wrapper', () => {
    const two = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
    ];
    const result = calculateTransform(two);
    expect(result.m).toHaveLength(9);
    expect(result).not.toHaveProperty('transform');
  });
});

describe('computeAffineTransform collinearity', () => {
  it('throws for collinear image points', () => {
    const collinear = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 10, imageY: 10, lon: 3, lat: 4 },
      { imageX: 20, imageY: 20, lon: 5, lat: 6 },
    ];
    expect(() => computeAffineTransform(collinear)).toThrow('Points are collinear, cannot compute affine transform');
  });

  it('throws for collinear geo points', () => {
    const collinearGeo = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 4 },
      { imageX: 200, imageY: 0, lon: 5, lat: 6 },
    ];
    expect(() => computeAffineTransform(collinearGeo)).toThrow('Points are collinear, cannot compute affine transform');
  });

  it('throws when fewer than 3 reference points', () => {
    const two = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 0, lon: 3, lat: 2 },
    ];
    expect(() => computeAffineTransform(two)).toThrow('Need at least 3 reference points for affine transform');
  });
});

describe('computeAffineTransform round-trip', () => {
  it('imageToGeo then geoToImage returns the original point', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
      { imageX: 100, imageY: 50, lon: 3, lat: 4 },
      { imageX: -30, imageY: 80, lon: -2, lat: 9 },
    ];
    const t = computeAffineTransform(refs);
    for (const p of refs) {
      const geo = imageToGeo(p.imageX, p.imageY, t);
      const back = geoToImage(geo.lon, geo.lat, t);
      expect(back.imageX).toBeCloseTo(p.imageX, 6);
      expect(back.imageY).toBeCloseTo(p.imageY, 6);
    }
  });
});

describe('imageToGeo and geoToImage error cases', () => {
  it('throws when inverting a singular transform', () => {
    // Rows 1 and 2 are identical, so the matrix has zero determinant.
    const singular = { m: [1, 2, 3, 1, 2, 3, 0, 0, 1], type: 'affine', lon0: 0, lat0: 0 };
    expect(() => geoToImage(0, 0, singular)).toThrow('Transform is singular');
  });

  it('throws when a point maps to infinity', () => {
    // The image-space line 2x + y = 0 is the horizon, where w = 0.
    const projective = {
      m: [1, 0, 0, 0, 1, 0, 2, 1, 0],
      type: 'homography',
      lon0: 0,
      lat0: 0,
    };
    expect(() => imageToGeo(1, -2, projective)).toThrow('Transform is singular');
    // Its inverse is singular too, since this matrix is not invertible.
    expect(() => geoToImage(-2, 1, projective)).toThrow('Transform is singular');
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
    const finite = imageToGeo(0, 0, projective);
    expect(Number.isFinite(finite.lon)).toBe(true);
    expect(Number.isFinite(finite.lat)).toBe(true);

    const onHorizon = localMetersToLonLat(1, 0, projective.lon0, projective.lat0);
    expect(() => geoToImage(onHorizon.lon, onHorizon.lat, projective))
      .toThrow('Transform is singular');

    // A neighbouring point still resolves, confirming only the horizon fails.
    const nearHorizon = localMetersToLonLat(1, 0.001, projective.lon0, projective.lat0);
    const img = geoToImage(nearHorizon.lon, nearHorizon.lat, projective);
    expect(Number.isFinite(img.imageX)).toBe(true);
    expect(Number.isFinite(img.imageY)).toBe(true);
  });
});
