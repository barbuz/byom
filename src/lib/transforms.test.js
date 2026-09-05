import { describe, it, expect } from 'vitest';
import {
  computeSimilarityTransform,
  computeAffineTransform,
  imageToGeo,
  geoToImage,
  calculateTransform,
  geoDistanceToImagePixels,
} from '../lib/transforms.js';

describe('computeSimilarityTransform', () => {
  it('computes scale, rotation and translation from two points', () => {
    const refs = [
      { imageX: 0, imageY: 0, lon: 10, lat:  20 },
      { imageX:  100, imageY:  0, lon:  12, lat:  20 },
    ];
    const t = computeSimilarityTransform(refs);
    const scale = t.scale;
    const rotation = t.rotation;
    const tx = t.tx;
    const ty = t.ty;
    expect(scale).toBeCloseTo(0.02,  5);
    expect(rotation).toBeCloseTo(0,  5);
    expect(tx).toBeCloseTo(10,  5);
    expect(ty).toBeCloseTo(20,  5);
  });

  it('round-trips image-to-geo then geo-to-image', () => {
    const refs = [
      { imageX:  0, imageY:  0, lon:  -73.99, lat:  40.71 },
      { imageX:  500, imageY:  0, lon:  -73.98, lat:  40.71 },
    ];
    const t = computeSimilarityTransform(refs);
    const geo = imageToGeo(250, 125, t, 'similarity');
    const img = geoToImage(geo.lon, geo.lat, t, 'similarity');
    const ix = img.imageX;
    const iy = img.imageY;
    expect(ix).toBeCloseTo(250,  5);
    expect(iy).toBeCloseTo(125,  5);
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
      { imageX:  0, imageY:  0, lon:  0, lat:  0 },
      { imageX:  1000, imageY:  0, lon:  0.01, lat:  0 },
    ];
    const t = computeSimilarityTransform(refs);
    const px = geoDistanceToImagePixels(0, 0,  100, t, 'similarity');
    expect(px).toBeGreaterThan(0);
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

describe('computeSimilarityTransform edge cases', () => {
  it('throws when fewer than 2 reference points', () => {
    const one = [
      { imageX: 0, imageY: 0, lon: 1, lat: 2 },
    ];
    expect(() => computeSimilarityTransform(one)).toThrow('Need at least 2 reference points');
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
