import { describe, it, expect, vi } from 'vitest';
import {
  applyImageTransform,
  drawPendingPoint,
  drawReferencePoints,
  drawUserMarker,
} from './draw.js';
import { calculateTransform } from './transforms.js';

function fakeCtx() {
  return { calls: [], translate(...a) { this.calls.push(['translate', a]); }, rotate(...a) { this.calls.push(['rotate', a]); }, scale(...a) { this.calls.push(['scale', a]); }, transform(...a) { this.calls.push(['transform', a]); }, arc(...a) { this.calls.push(['arc', a]); }, fill() { this.calls.push(['fill']); }, stroke() { this.calls.push(['stroke']); }, beginPath() { this.calls.push(['beginPath']); }, setLineDash(...a) { this.calls.push(['setLineDash', a]); }, save() { this.calls.push(['save']); }, restore() { this.calls.push(['restore']); }, measureText(t) { this.calls.push(['measureText', t]); return { width: 30 }; }, fillRect(...a) { this.calls.push(['fillRect', a]); }, fillText(...a) { this.calls.push(['fillText', a]); }, set fillStyle(v) { this.fs = v; this.calls.push(['fillStyle', v]); }, get fillStyle() { return this.fs; }, set strokeStyle(v) { this.ss = v; this.calls.push(['strokeStyle', v]); }, get strokeStyle() { return this.ss; }, set lineWidth(v) { this.lw = v; }, get lineWidth() { return this.lw; }, set font(v) { this.fn = v; }, get font() { return this.fn; }, set textAlign(v) { this.ta = v; }, get textAlign() { return this.ta; }, set textBaseline(v) { this.tb = v; }, get textBaseline() { return this.tb; } };
}

describe('applyImageTransform', () => {
  it('applies translate-rotate-scale-translate transform stack', () => {
    const ctx = fakeCtx();
    applyImageTransform(ctx, { translateX:  10, translateY:  20, rotation:  0.5, scale:  2 },  100,  80);
    expect(ctx.calls).toEqual([
      ['translate', [10, 20]],
      ['rotate', [0.5]],
      ['scale', [2, 2]],
      ['translate', [-50, -40]],
    ]);
  });
});

describe('drawPendingPoint', () => {
  it('draws two concentric circles at the pending point', () => {
    const ctx = fakeCtx();
    drawPendingPoint(ctx, { u: 0.5, v: 0.6 }, { scale:  1, rotation:   0, translateX:  0, translateY:  0 },  100,  80);
    expect(ctx.calls.map(c => c[0]).filter(n => n === 'arc').length).toBe(2);
    expect(ctx.calls.filter(c => c[0] === 'arc')[0][1].slice(0,  2)).toEqual([50, 60]);
    expect(ctx.calls.filter(c => c[0] === 'arc')[1][1].slice(0,  2)).toEqual([50, 60]);
    expect(ctx.lw).toBe(2);
   });
});

describe('drawReferencePoints', () => {
  it('skips hidden points (showingPoints=false, no editing)', () => {
    const ctx = fakeCtx();
    drawReferencePoints(ctx, [{ id:  1, u: 0.1, v: 0.1 }], { scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80, {});
    expect(ctx.calls).toHaveLength(0);
   });

 it('draws a visible point with fill, stroke,and counter-rotated label', () => {
    const ctx = fakeCtx();
    drawReferencePoints(ctx, [{ id:  1, u: 0.1, v: 0.1 }], { scale:  2, rotation:  0, translateX:  0, translateY:  0 },  100,  80, { showingPoints:  true });
    expect(ctx.calls.map(c => c[0]).filter(n => n === 'arc').length).toBeGreaterThanOrEqual(1);
    const labels = ctx.calls.filter(c => c[0] === 'fillText');
    expect(labels).toHaveLength(1);
    expect(labels[0][1][0]).toBe('1');
    const scales = ctx.calls.filter(c => c[0] === 'scale');
    expect(scales[0][1][0]).toBeCloseTo(0.5);
   });

 it('uses editing color when editingPointId matches', () => {
    const ctx = fakeCtx();
    drawReferencePoints(ctx, [{ id:  1, u: 0.1, v: 0.1 }], { scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80, { showingPoints:  1, editingPointId:  1 });
    expect(ctx.fs).toBe('white');
   });

 it('draws an accuracy ring when the point has accuracy and a geo transform', () => {
    const ctx = fakeCtx();
    drawReferencePoints(
      ctx,
      [{ id:  1, u: 0.1, v: 0.1, lon:  1, lat:  2, accuracy:  100 }],
      { scale:  2, rotation:  0.5, translateX:  0, translateY:  0 },
      100,
      80,
      { showingPoints:  true, geoTransform: { m: [10000, 0, 0, 0, 10000, 0, 0, 0, 1], type: 'similarity', lon0: 1, lat0: 2 } }
    );
    const arcs = ctx.calls.filter(c => c[0] === 'arc');
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    expect(arcs[0][1][2]).toBeGreaterThan(0);
    expect(arcs[0][1][2]).toBeLessThan(arcs[1][1][2]);
   });

  it('draws the accuracy ring with translucent rgba colors', () => {
    const ctx = fakeCtx();
    drawReferencePoints(
      ctx,
      [{ id: 1, u: 0.1, v: 0.1, lon: 1, lat: 2, accuracy: 100 }],
      { scale: 2, rotation: 0.5, translateX: 0, translateY: 0 },
      100,
      80,
      { showingPoints: true, geoTransform: { m: [10000, 0, 0, 0, 10000, 0, 0, 0, 1], type: 'similarity', lon0: 1, lat0: 2 } }
    );
    const fs = ctx.calls.filter(c => c[0] === 'fillStyle');
    const ss = ctx.calls.filter(c => c[0] === 'strokeStyle');
    expect(fs[0][1]).toMatch(/^rgba\(33,\s*150,\s*243,\s*0\.1\)$/);
    expect(ss[0][1]).toMatch(/^rgba\(33,\s*150,\s*243,\s*0\.35\)$/);
  });
});

describe('drawUserMarker error path', () => {
  it('logs and swallows errors when the geo transform cannot be inverted', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = fakeCtx();
    drawUserMarker(
      ctx,
      { longitude:  0, latitude:  0, accuracy:  0 },
      { m: [1, 2, 3, 1, 2, 3, 0, 0, 1], type: 'affine', lon0: 0, lat0: 0 },
      { scale:  1, rotation:  0, translateX:  0, translateY:  0 },
      100,
      80
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(ctx.calls.filter(c => c[0] === 'arc')).toHaveLength(0);
    errorSpy.mockRestore();
   });
});

describe('drawUserMarker', () => {
  it('returns early without a position or geoTransform', () => {
    const ctx = fakeCtx();
    drawUserMarker(ctx, null, null,{ scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80);
    drawUserMarker(ctx, { longitude:  1, latitude:  2, accuracy:  5 },   null,{ scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80);
    expect(ctx.calls).toHaveLength(0);
   });

 it('draws position marker when geoTransform is provided', () => {
    const ctx = fakeCtx();
    const geoTransform = { m: [10000, 0, 0, 0, 10000, 0, 0, 0, 1], type: 'similarity', lon0: 0, lat0: 0 };
    drawUserMarker(ctx, { longitude:  0, latitude:  0, accuracy:  5 },  geoTransform,{ scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80);
    expect(ctx.calls.filter(c => c[0] === 'arc').length).toBeGreaterThanOrEqual(1);
    expect(ctx.calls.filter(c => c[0] === 'restore')).toHaveLength(1);
    const ss = ctx.calls.filter(c => c[0] === 'strokeStyle');
    const fs = ctx.calls.filter(c => c[0] === 'fillStyle');
    expect(ss[0][1]).toMatch(/^rgba\(175,\s*76,\s*80,\s*0\.4\)$/);
    expect(fs[0][1]).toMatch(/^rgba\(175,\s*76,\s*80,\s*0\.15\)$/);
   });

  it('places the marker north of a lower point, i.e. toward smaller image y', () => {
    // A north-up map: the top edge (v = 0) is north, the bottom (v = 1) south.
    // A GPS fix at higher latitude must land at a smaller pixel y than a lower
    // one. A y-flip in the transform or the drawing would invert this, so this
    // is the regression guard for the image y-down convention.
    const ctx = fakeCtx();
    const geoTransform = calculateTransform([
      { u: 0, v: 0, lon: 0, lat: 0.01 },
      { u: 1, v: 1, lon: 0.01, lat: 0 },
    ]);
    const view = { scale: 1, rotation: 0, translateX: 0, translateY: 0 };

    drawUserMarker(ctx, { longitude: 0.005, latitude: 0.0075, accuracy: null }, geoTransform, view, 100, 100);
    const northY = ctx.calls.filter(c => c[0] === 'arc')[0][1][1];
    ctx.calls.length = 0;
    drawUserMarker(ctx, { longitude: 0.005, latitude: 0.0025, accuracy: null }, geoTransform, view, 100, 100);
    const southY = ctx.calls.filter(c => c[0] === 'arc')[0][1][1];

    expect(northY).toBeCloseTo(25, 6);
    expect(southY).toBeCloseTo(75, 6);
    expect(northY).toBeLessThan(southY);
  });

  it('keeps the marker a constant screen size at any zoom', () => {
    const geoTransform = { m: [10000, 0, 0, 0, 10000, 0, 0, 0, 1], type: 'similarity', lon0: 0, lat0: 0 };
    const radiiAt = (scale) => {
      const ctx = fakeCtx();
      drawUserMarker(
        ctx,
        { longitude: 0, latitude: 0, accuracy: null },
        geoTransform,
        { scale, rotation: 0, translateX: 0, translateY: 0 },
        100,
        80
      );
      return ctx.calls.filter(c => c[0] === 'arc').map(c => c[1][2]);
    };

    // The outer dot and inner dot radii must not change with the map scale,
    // unlike the accuracy ring which is a real ground distance.
    expect(radiiAt(1)).toEqual([20, 6]);
    expect(radiiAt(4)).toEqual([20, 6]);
  });

  it('keeps the stale marker a constant screen size at any zoom', () => {
    const geoTransform = { m: [10000, 0, 0, 0, 10000, 0, 0, 0, 1], type: 'similarity', lon0: 0, lat0: 0 };
    const radiusAt = (scale) => {
      const ctx = fakeCtx();
      drawUserMarker(
        ctx,
        { longitude: 0, latitude: 0, accuracy: 50 },
        geoTransform,
        { scale, rotation: 0, translateX: 0, translateY: 0 },
        100,
        80,
        true
      );
      return ctx.calls.filter(c => c[0] === 'arc')[0][1][2];
    };

    expect(radiusAt(1)).toBe(20);
    expect(radiusAt(4)).toBe(20);
  });

  it('draws the marker at the correct screen point under rotation and zoom', () => {
    // Compose the recorded canvas transform stack and confirm the marker's
    // image point lands on the same screen point imageToScreen would give, and
    // that the marker is drawn at unit screen scale. The scale cancellation is
    // a post-multiplied matrix, so an error in its fixed point would shift the
    // marker off the user's location whenever the map is rotated or panned.
    const geoTransform = { m: [10000, 0, 0, 0, 10000, 0, 0, 0, 1], type: 'similarity', lon0: 0, lat0: 0 };
    const transform = { scale: 2.5, rotation: 0.7, translateX: 40, translateY: -15 };
    const imageWidth = 120;
    const imageHeight = 80;

    const ctx = fakeCtx();
    drawUserMarker(
      ctx,
      { longitude: 0, latitude: 0, accuracy: null },
      geoTransform,
      transform,
      imageWidth,
      imageHeight
    );

    // Marker image position: geo (0,0) maps to fraction (0,0) -> pixel (0,0).
    const markerX = 0;
    const markerY = 0;

    const mul = (A, B) => [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5],
    ];
    const asMatrix = ([name, args]) => {
      if (name === 'translate') return [1, 0, 0, 1, args[0], args[1]];
      if (name === 'scale') return [args[0], 0, 0, args[1], 0, 0];
      if (name === 'rotate') {
        const c = Math.cos(args[0]);
        const s = Math.sin(args[0]);
        return [c, s, -s, c, 0, 0];
      }
      if (name === 'transform') return [args[0], args[1], args[2], args[3], args[4], args[5]];
      return [1, 0, 0, 1, 0, 0];
    };

    const transformNames = ['translate', 'rotate', 'scale', 'transform'];
    let ctm = [1, 0, 0, 1, 0, 0];
    ctx.calls
      .filter(c => transformNames.includes(c[0]))
      .forEach(c => { ctm = mul(ctm, asMatrix(c)); });

    const screenX = ctm[0] * markerX + ctm[2] * markerY + ctm[4];
    const screenY = ctm[1] * markerX + ctm[3] * markerY + ctm[5];

    // Reference: imageToScreen applies the same stack as the app's renderer.
    const expectedX = (() => {
      const ox = markerX - imageWidth / 2;
      const oy = markerY - imageHeight / 2;
      const sx = ox * transform.scale;
      const sy = oy * transform.scale;
      const cr = Math.cos(transform.rotation);
      const sr = Math.sin(transform.rotation);
      return cr * sx - sr * sy + transform.translateX;
    })();
    const expectedY = (() => {
      const ox = markerX - imageWidth / 2;
      const oy = markerY - imageHeight / 2;
      const sx = ox * transform.scale;
      const sy = oy * transform.scale;
      const cr = Math.cos(transform.rotation);
      const sr = Math.sin(transform.rotation);
      return sr * sx + cr * sy + transform.translateY;
    })();

    expect(screenX).toBeCloseTo(expectedX, 9);
    expect(screenY).toBeCloseTo(expectedY, 9);
    // The dot is drawn at unit screen scale, so its radius is zoom-independent.
    expect(Math.hypot(ctm[0], ctm[1])).toBeCloseTo(1, 9);
  });
});
