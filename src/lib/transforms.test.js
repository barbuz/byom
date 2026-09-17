import { describe, it, expect } from 'vitest';
import {
  computeSimilarityTransform,
  computeAffineTransform,
  imageToGeo,
  geoToImage,
  calculateTransform,
  geoDistanceToImagePixels,
  metersPerDegreeLon,
  lonLatToLocalMeters,
  localMetersToLonLat,
} from '../lib/transforms.js';

const METERS_PER_DEG_LAT = 111320;

describe('computeSimilarityTransform', () => {
  it('fits scale, rotation and translation in a local metric plane', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 10, lat: 20 },
      { imageX: 100, imageY: 0, lon: 12, lat: 20 },
    ];
    const t = computeSimilarityTransform(refs);

    // Two degrees of longitude at 20° latitude, over 100 image pixels.
    expect(t.scale).toBeCloseTo(2 * metersPerDegreeLon(20) / 100, 5);
    expect(t.rotation).toBeCloseTo(0, 10);
    expect(t.lon0).toBeCloseTo(11, 10);
    expect(t.lat0).toBeCloseTo(20, 10);

    // Reference points map exactly onto their image coordinates.
    const a = geoToImage(refs[0].lon, refs[0].lat, t, 'similarity');
    const b = geoToImage(refs[1].lon, refs[1].lat, t, 'similarity');
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

    expect(t.scale).toBeCloseTo(metersPerPixel, 9);
    expect(t.rotation).toBeCloseTo(mapRotation, 9);

    for (const [x, y] of [[0, 0], [500, -400], [-900, 700], [123, -456]]) {
      const geo = pxToLonLat(x, y);
      const img = geoToImage(geo.lon, geo.lat, t, 'similarity');
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
      const geo = imageToGeo(x, y, t, 'similarity');
      const img = geoToImage(geo.lon, geo.lat, t, 'similarity');
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
      const img = geoToImage(p.lon, p.lat, t, 'similarity');
      expect(img.imageX).toBeCloseTo(p.imageX, 6);
      expect(img.imageY).toBeCloseTo(p.imageY, 6);
      const geo = imageToGeo(p.imageX, p.imageY, t, 'similarity');
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
});

describe('metric helpers', () => {
  it('metersPerDegreeLon shrinks with latitude', () => {
    expect(metersPerDegreeLon(0)).toBeCloseTo(METERS_PER_DEG_LAT, 6);
    expect(metersPerDegreeLon(60)).toBeCloseTo(METERS_PER_DEG_LAT / 2, 3);
    expect(metersPerDegreeLon(-60)).toBeCloseTo(METERS_PER_DEG_LAT / 2, 3);
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
});

describe('computeAffineTransform + imageToGeo', () => {
  it('maps three non-collinear points exactly', () => {
    const refs = [
      { imageX:  0, imageY:  0, lon:  1, lat:  2 },
      { imageX:  100, imageY:  0, lon:  3, lat:  2 },
      { imageX:  0, imageY:  100, lon:  1, lat:  4 },
    ];
    const t = computeAffineTransform(refs);
    for (const p of refs) {
      const geo = imageToGeo(p.imageX, p.imageY, t, 'affine');
      const gl = geo.lon;
      const ga = geo.lat;
      expect(gl).toBeCloseTo(p.lon, 6);
      expect(ga).toBeCloseTo(p.lat,  6);
    }
  });
});

describe('geoDistanceToImagePixels', () => {
  it('returns a positive scale-dependent distance', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 0, lat: 0 },
      { imageX: 1000, imageY: 0, lon: 0.01, lat: 0 },
    ];
    const t = computeSimilarityTransform(refs);
    const px = geoDistanceToImagePixels(0, 0, 100, t, 'similarity');
    expect(px).toBeGreaterThan(0);
  });

  it('converts metres to pixels via the transform scale', () => {
    // North-up map at the equator, 100 px per 0.01° of longitude (~1113 m).
    const refs = [
      { imageX: 0, imageY: 0, lon: 0, lat: 0 },
      { imageX: 1000, imageY: 0, lon: 0.01, lat: 0 },
    ];
    const t = computeSimilarityTransform(refs);
    const metersPerPixel = t.scale;
    const px = geoDistanceToImagePixels(0.004, 0.003, 500, t, 'similarity');
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
      expect(geoDistanceToImagePixels(lon, lat, 500, t, 'similarity')).toBeCloseTo(expectedPixels, 6);
    }

    // The metric-plane offset stays isotropic: a north-only offset measures
    // the same pixel distance as an east-only offset of the same length.
    const north = geoDistanceToImagePixels(originLon, originLat, 500, t, 'similarity');
    expect(north).toBeCloseTo(expectedPixels, 6);
  });

  it('handles the affine path with both axes', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 8, lat: 45 },
      { imageX: 1000, imageY: 0, lon: 8.01, lat: 45 },
      { imageX: 0, imageY: 1000, lon: 8, lat: 45.01 },
    ];
    const t = computeAffineTransform(refs);
    const px = geoDistanceToImagePixels(8, 45, 0, t, 'affine');
    expect(px).toBeCloseTo(0, 9);
    expect(geoDistanceToImagePixels(8.005, 45.005, 500, t, 'affine')).toBeGreaterThan(0);
  });
});

describe('calculateTransform', () => {
  it('returns null with too few points', () => {
    expect(calculateTransform([])).toBeNull();
    const one = [{ imageX:  0, imageY:  0, lon:  1, lat:  2 }];
    expect(calculateTransform(one)).toBeNull();
  });

  it('chooses similarity for two points and affine for three', () => {
    const two = [
      { imageX:  0, imageY:  0, lon:  1, lat:  2 },
      { imageX:  100, imageY:  0, lon:  3, lat:  2 },
    ];
    const calc2 = calculateTransform(two);
    expect(calc2.type).toBe('similarity');

    const three = [
      ...two,
      { imageX:  0, imageY:  100, lon:  1, lat:  4 },
    ];
    const calc3 = calculateTransform(three);
    expect(calc3.type).toBe('affine');
  });
});

describe('computeAffineTransform collinearity', () => {
  it('throws for collinear image points', () => {
    const collinear = [
      { imageX:  0, imageY:  0, lon:  1, lat:  2 },
      { imageX:  10, imageY:  10, lon:  3, lat:  4 },
      { imageX:  20, imageY:  20, lon:  5, lat:  6 },
    ];
    expect(() => computeAffineTransform(collinear)).toThrow('Points are collinear, cannot compute affine transform');
  });

  it('throws for collinear geo points', () => {
    const collinearGeo = [
      { imageX:  0, imageY:  0, lon:  1, lat:  2 },
      { imageX:  100, imageY:  0, lon:  3, lat:  4 },
      { imageX:  200, imageY:  0, lon:  5, lat:  6 },
    ];
    expect(() => computeAffineTransform(collinearGeo)).toThrow('Points are collinear, cannot compute affine transform');
  });

  it('throws when fewer than 3 reference points', () => {
    const two = [
      { imageX:  0, imageY:  0, lon:  1, lat:  2 },
      { imageX:  100, imageY:  0, lon:  3, lat:  2 },
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
      const geo = imageToGeo(p.imageX, p.imageY, t, 'affine');
      const back = geoToImage(geo.lon, geo.lat, t, 'affine');
      expect(back.imageX).toBeCloseTo(p.imageX, 6);
      expect(back.imageY).toBeCloseTo(p.imageY, 6);
    }
  });
});

describe('imageToGeo and geoToImage error cases', () => {
  it('throws on unknown transform type', () => {
    const t = { a: 1 };
    expect(() => imageToGeo(0, 0, t, 'bogus')).toThrow('Unknown transform type');
    expect(() => geoToImage(0, 0, t, 'bogus')).toThrow('Unknown transform type');
  });

  it('throws when a transform is singular', () => {
    const t = { a: 1, b:  2, c:  3, d:  1, e:  2, f:  3, type: 'affine' };
    expect(() => geoToImage(0, 0, t, 'affine')).toThrow('Transform is singular');
  });
});
