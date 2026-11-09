import { describe, it, expect } from 'vitest';
import {
  buildGraticule,
  decimalPlacesFor,
  niceStepAtLeast,
  niceStepNear,
  pickGridStepForScale,
  visibleLines,
  DEFAULT_MAX_DIVISIONS,
  DEFAULT_SAMPLES,
  METERS_PER_DEG_LAT,
  MIN_SPACING_PX,
} from './grid.js';
import { metersPerDegreeLon } from './transforms.js';

/**
 * A linear (affine) georeference whose image fraction `(u, v)` maps to local
 * metres `(S*u, -S*v)`. It projects ground coordinates back the same way, so the
 * metric footprint is exactly `S` metres on each axis for a square image.
 */
function fakeGeoreference({ metres = 2000, lat0 = 40, lon0 = -74, bend = 0 } = {}) {
  const m = [metres, 0, 0, 0, metres, 0, 0, 0, 1];
  const mpdLon = metersPerDegreeLon(lat0);
  return {
    type: 'affine',
    lon0,
    lat0,
    m,
    extentTransform: { m },
    geoToUV(lon, lat) {
      const east = (lon - lon0) * mpdLon;
      const north = (lat - lat0) * METERS_PER_DEG_LAT;
      // An optional quadratic bend in `north` makes the projection non-linear,
      // which is what turns straight ground lines into curves.
      const bentNorth = north + bend * (east / metres) * (east / metres);
      return { u: east / metres, v: 0.5 - bentNorth / metres };
    },
    uvToGeo() {
      return { lon: lon0, lat: lat0 };
    },
    isFolded() {
      return false;
    },
  };
}

describe('niceStepAtLeast', () => {
  it('returns the smallest {1,2,5}x10^k value that is >= the input', () => {
    expect(niceStepAtLeast(0.0007)).toBe(0.001);
    expect(niceStepAtLeast(0.0016)).toBe(0.002);
    expect(niceStepAtLeast(0.37)).toBe(0.5);
    expect(niceStepAtLeast(3.3)).toBe(5);
    expect(niceStepAtLeast(55)).toBe(100);
  });

  it('returns an exact ladder value unchanged', () => {
    expect(niceStepAtLeast(0.05)).toBe(0.05);
    expect(niceStepAtLeast(2)).toBe(2);
  });

  it('guards non-finite and non-positive inputs', () => {
    expect(niceStepAtLeast(0)).toBeNull();
    expect(niceStepAtLeast(-3)).toBeNull();
    expect(niceStepAtLeast(NaN)).toBeNull();
    expect(niceStepAtLeast(Infinity)).toBeNull();
  });
});

describe('niceStepNear', () => {
  it('returns the nearest {1,2,5}x10^k value', () => {
    expect(niceStepNear(0.0007)).toBe(0.0005);
    expect(niceStepNear(3.3)).toBe(2);
    expect(niceStepNear(7)).toBe(5);
    expect(niceStepNear(0.37)).toBe(0.5);
  });

  it('guards non-finite and non-positive inputs', () => {
    expect(niceStepNear(0)).toBeNull();
    expect(niceStepNear(NaN)).toBeNull();
  });
});

describe('decimalPlacesFor', () => {
  it('reports the decimals needed to write a nice step exactly', () => {
    expect(decimalPlacesFor(2)).toBe(0);
    expect(decimalPlacesFor(0.2)).toBe(1);
    expect(decimalPlacesFor(0.05)).toBe(2);
    expect(decimalPlacesFor(0.01)).toBe(2);
    expect(decimalPlacesFor(0.005)).toBe(3);
  });

  it('returns 0 for non-finite/non-positive input', () => {
    expect(decimalPlacesFor(0)).toBe(0);
    expect(decimalPlacesFor(NaN)).toBe(0);
  });
});

describe('buildGraticule', () => {
  it('returns null without a usable georeference or dimensions', () => {
    const georef = fakeGeoreference();
    expect(buildGraticule(null, 800, 600)).toBeNull();
    expect(buildGraticule({}, 800, 600)).toBeNull();
    expect(buildGraticule(georef, 0, 600)).toBeNull();
    expect(buildGraticule(georef, 800, -1)).toBeNull();
    expect(buildGraticule(georef, NaN, 600)).toBeNull();
  });

  it('returns null for a degenerate footprint', () => {
    // A georeference whose extent matrix collapses the image to a point.
    const degenerate = {
      ...fakeGeoreference(),
      extentTransform: { m: [0, 0, 0, 0, 0, 0, 0, 0, 1] },
    };
    expect(buildGraticule(degenerate, 800, 600)).toBeNull();
  });

  it('bounds each axis to roughly maxDivisions lines', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const latLines = grid.lines.filter((line) => line.kind === 'lat');
    const lonLines = grid.lines.filter((line) => line.kind === 'lon');
    expect(latLines.length).toBeLessThanOrEqual(DEFAULT_MAX_DIVISIONS + 1);
    expect(lonLines.length).toBeLessThanOrEqual(DEFAULT_MAX_DIVISIONS + 1);
    expect(latLines.length).toBeGreaterThan(0);
    expect(lonLines.length).toBeGreaterThan(0);
  });

  it('honours a smaller maxDivisions', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600, { maxDivisions: 8 });
    const latLines = grid.lines.filter((line) => line.kind === 'lat');
    expect(latLines.length).toBeLessThanOrEqual(9);
    expect(grid.latStep).toBeGreaterThan(buildGraticule(fakeGeoreference(), 800, 600).latStep);
  });

  it('uses a nice base step and records ascending multiple levels', () => {
    const grid = buildGraticule(fakeGeoreference({ metres: 2000 }), 800, 600, { maxDivisions: 200 });
    expect(grid.latStep).toBe(0.0001);
    expect(grid.latLevels[0]).toBeCloseTo(grid.latStep, 12);
    for (let i = 1; i < grid.latLevels.length; i++) {
      expect(grid.latLevels[i]).toBeGreaterThan(grid.latLevels[i - 1]);
      const ratio = grid.latLevels[i] / grid.latStep;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-9);
    }
  });

  it('scales the longitude step by 1/cos(lat0)', () => {
    // At 60 degrees, one degree of longitude spans half the ground of a degree
    // of latitude, so the lon step must be twice the lat step.
    const grid = buildGraticule(fakeGeoreference({ metres: 2000, lat0: 60 }), 800, 600, { maxDivisions: 200 });
    expect(grid.lonStep / grid.latStep).toBeCloseTo(1 / Math.cos(60 * Math.PI / 180), 6);
  });

  it('keeps the lon step equal to the lat step at the equator', () => {
    const grid = buildGraticule(fakeGeoreference({ metres: 2000, lat0: 0 }), 800, 600, { maxDivisions: 200 });
    expect(grid.lonStep).toBeCloseTo(grid.latStep, 12);
  });

  it('samples each line and precomputes one fewer curve than samples', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600, { samples: 10 });
    expect(grid.lines.length).toBeGreaterThan(0);
    for (const line of grid.lines) {
      expect(line.curves).toHaveLength(9);
    }
    expect(buildGraticule(fakeGeoreference(), 800, 600).lines[0].curves).toHaveLength(DEFAULT_SAMPLES - 1);
  });

  it('tracks a curved warp closely at the default sample count', () => {
    // A quadratic bend turns ground lines into curves, standing in for the
    // sharp crease a folded MLS map produces. DEFAULT_SAMPLES must follow it
    // within a small fraction of a cell; 16 samples did not (0.018), 32 does
    // (0.009), so this pins the doubled default.
    const bent = (samples) => buildGraticule(fakeGeoreference({ bend: 2000 }), 800, 600, { samples });
    const fine = bent(400);
    const drawn = bent(DEFAULT_SAMPLES);
    const evalCurve = (line, t) => {
      const index = Math.min(line.curves.length - 1, Math.floor(t * line.curves.length));
      const localT = Math.min(1, t * line.curves.length - index);
      const seg = line.curves[index];
      const from = index === 0 ? line.start : line.curves[index - 1].to;
      const mt = 1 - localT;
      const w0 = mt * mt * mt;
      const w1 = 3 * mt * mt * localT;
      const w2 = 3 * mt * localT * localT;
      const w3 = localT * localT * localT;
      return {
        u: w0 * from.u + w1 * seg.c1.u + w2 * seg.c2.u + w3 * seg.to.u,
        v: w0 * from.v + w1 * seg.c1.v + w2 * seg.c2.v + w3 * seg.to.v,
      };
    };
    let worst = 0;
    for (let i = 0; i < fine.lines.length; i++) {
      for (let s = 0; s <= 200; s++) {
        const t = s / 200;
        const a = evalCurve(drawn.lines[i], t);
        const b = evalCurve(fine.lines[i], t);
        worst = Math.max(worst, Math.hypot(a.u - b.u, a.v - b.v));
      }
    }
    // Image fractions; a grid cell is 1/maxDivisions = 1/64 ~ 0.0156.
    expect(worst).toBeLessThan(0.012);
  });

  it('formats labels with the fewest decimals for the step', () => {
    const grid = buildGraticule(fakeGeoreference({ metres: 2000 }), 800, 600, { maxDivisions: 200 });
    const latLine = grid.lines.find((line) => line.kind === 'lat');
    // A 0.0001 step needs four decimals; the label is not a long float.
    expect(latLine.label).toMatch(/^-?\d+\.\d{4}$/);
    const latLineWithStep = grid.lines.find((line) => line.kind === 'lat' && line.level === grid.latStep);
    expect(latLineWithStep.label).toBe(Number(latLineWithStep.value).toFixed(4));
  });

  it('places higher latitudes nearer the top of the image', () => {
    // North-up map: latitude falls as image v (downward) grows, so a higher
    // latitude line must sit at a smaller v than a lower one. A y-flip in the
    // georeference or the grid would invert this.
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const latLines = grid.lines.filter((line) => line.kind === 'lat');
    const north = latLines.reduce((a, b) => (a.value > b.value ? a : b));
    const south = latLines.reduce((a, b) => (a.value < b.value ? a : b));
    expect(north.start.v).toBeLessThan(south.start.v);
  });

  it('leaves straight lines straight for a linear georeference', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const maxCross = (line) => {
      let previous = line.start;
      let worst = 0;
      for (const segment of line.curves) {
        const a = previous;
        const b = segment.to;
        for (const control of [segment.c1, segment.c2]) {
          const cross = (control.u - a.u) * (b.v - a.v) - (control.v - a.v) * (b.u - a.u);
          worst = Math.max(worst, Math.abs(cross));
        }
        previous = b;
      }
      return worst;
    };
    for (const line of grid.lines) {
      // Collinear control points: the cross product with the chord is ~0.
      expect(maxCross(line)).toBeLessThan(1e-9);
    }
  });

  it('bends the lines for a non-linear georeference', () => {
    const grid = buildGraticule(fakeGeoreference({ bend: 200 }), 800, 600);
    const maxCross = (line) => {
      let previous = line.start;
      let worst = 0;
      for (const segment of line.curves) {
        const a = previous;
        const b = segment.to;
        const cross = (segment.c1.u - a.u) * (b.v - a.v) - (segment.c1.v - a.v) * (b.u - a.u);
        worst = Math.max(worst, Math.abs(cross));
        previous = b;
      }
      return worst;
    };
    const curved = grid.lines.some((line) => maxCross(line) > 1e-6);
    expect(curved).toBe(true);
  });
});

describe('visibleLines', () => {
  it('returns only lines at the requested level and axis', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const level = grid.latLevels[grid.latLevels.length - 1];
    const lines = visibleLines(grid, level, 'lat');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.kind).toBe('lat');
      const ratio = line.value / level;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-6);
    }
  });

  it('treats a coarse level as an exact subset of the base grid', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const base = visibleLines(grid, grid.latStep, 'lat');
    const coarseLevel = grid.latLevels[grid.latLevels.length - 1];
    const coarse = visibleLines(grid, coarseLevel, 'lat');
    expect(coarse.length).toBeLessThan(base.length);
    for (const line of coarse) {
      expect(base.some((candidate) => candidate.value === line.value)).toBe(true);
    }
  });

  it('returns an empty list for a missing grid or step', () => {
    expect(visibleLines(null, 1, 'lat')).toEqual([]);
    expect(visibleLines({ lines: [] }, 0, 'lat')).toEqual([]);
  });
});

describe('pickGridStepForScale', () => {
  it('refines as the scale rises and coarsens as it drops', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const zoomedIn = pickGridStepForScale(grid, { scale: 8 }, 800);
    const mid = pickGridStepForScale(grid, { scale: 1 }, 800);
    const zoomedOut = pickGridStepForScale(grid, { scale: 0.1 }, 800);
    expect(zoomedIn.latStep).toBeLessThan(mid.latStep);
    expect(mid.latStep).toBeLessThan(zoomedOut.latStep);
    expect(zoomedIn.lonStep).toBeLessThanOrEqual(mid.lonStep);
  });

  it('keeps the shown spacing at or above MIN_SPACING_PX when possible', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    for (const scale of [0.2, 0.5, 1, 2, 4, 8]) {
      const { latStep } = pickGridStepForScale(grid, { scale }, 800);
      const spacing = latStep * (800 * scale) / grid.latSpanDeg;
      // Either the band is met, or we are already at the finest level.
      if (latStep > grid.latStep) {
        expect(spacing).toBeGreaterThanOrEqual(MIN_SPACING_PX);
      }
    }
  });

  it('falls back to the base steps for a missing grid', () => {
    expect(pickGridStepForScale(null, { scale: 1 }, 800)).toEqual({ latStep: 0, lonStep: 0 });
  });

  it('clamps to the coarsest available level when even that is too dense', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const { latStep } = pickGridStepForScale(grid, { scale: 1e-6 }, 800);
    expect(latStep).toBe(grid.latLevels[grid.latLevels.length - 1]);
  });

  it('tolerates a transform without a finite scale', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const picked = pickGridStepForScale(grid, {}, 800);
    expect(picked.latStep).toBeGreaterThan(0);
    expect(picked.lonStep).toBeGreaterThan(0);
  });

  it('falls back to the base steps when a grid has no levels or zero span', () => {
    const synthetic = {
      latStep: 0.1,
      lonStep: 0.2,
      latLevels: [],
      lonLevels: [],
      latSpanDeg: 0,
      lonSpanDeg: 0,
      imageWidth: 800,
      imageHeight: 600,
    };
    expect(pickGridStepForScale(synthetic, { scale: 1 }, 800)).toEqual({ latStep: 0.1, lonStep: 0.2 });
  });

  it('falls back to the grid image width when none is passed', () => {
    const grid = buildGraticule(fakeGeoreference(), 800, 600);
    const picked = pickGridStepForScale(grid, { scale: 1 }, 0);
    expect(picked.lonStep).toBeGreaterThan(0);
  });
});
