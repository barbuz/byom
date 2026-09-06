import { describe, it, expect, vi } from 'vitest';
import {
  applyImageTransform,
  drawPendingPoint,
  drawReferencePoints,
  drawUserMarker,
} from './draw.js';

function fakeCtx() {
  return { calls: [], translate(...a) { this.calls.push(['translate', a]); }, rotate(...a) { this.calls.push(['rotate', a]); }, scale(...a) { this.calls.push(['scale', a]); }, arc(...a) { this.calls.push(['arc', a]); }, fill() { this.calls.push(['fill']); }, stroke() { this.calls.push(['stroke']); }, beginPath() { this.calls.push(['beginPath']); }, save() { this.calls.push(['save']); }, restore() { this.calls.push(['restore']); }, measureText(t) { this.calls.push(['measureText', t]); return { width: 30 }; }, fillRect(...a) { this.calls.push(['fillRect', a]); }, fillText(...a) { this.calls.push(['fillText', a]); }, set fillStyle(v) { this.fs = v; this.calls.push(['fillStyle', v]); }, get fillStyle() { return this.fs; }, set strokeStyle(v) { this.ss = v; this.calls.push(['strokeStyle', v]); }, get strokeStyle() { return this.ss; }, set lineWidth(v) { this.lw = v; }, get lineWidth() { return this.lw; }, set font(v) { this.fn = v; }, get font() { return this.fn; }, set textAlign(v) { this.ta = v; }, get textAlign() { return this.ta; }, set textBaseline(v) { this.tb = v; }, get textBaseline() { return this.tb; }, };
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
    drawPendingPoint(ctx, { imageX:  50, imageY:  60 }, { scale:  1, rotation:   0, translateX:  0, translateY:  0 },  100,  80);
    expect(ctx.calls.map(c => c[0]).filter(n => n === 'arc').length).toBe(2);
    expect(ctx.calls.filter(c => c[0] === 'arc')[0][1].slice(0,  2)).toEqual([50, 60]);
    expect(ctx.calls.filter(c => c[0] === 'arc')[1][1].slice(0,  2)).toEqual([50, 60]);
    expect(ctx.lw).toBe(2);
   });
});

describe('drawReferencePoints', () => {
  it('skips hidden points (showingPoints=false, no editing)', () => {
    const ctx = fakeCtx();
    drawReferencePoints(ctx, [{ id:  1, imageX:  10, imageY:  10 }], { scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80, {});
    expect(ctx.calls).toHaveLength(0);
   });

 it('draws a visible point with fill, stroke,and counter-rotated label', () => {
    const ctx = fakeCtx();
    drawReferencePoints(ctx, [{ id:  1, imageX:  10, imageY:  10 }], { scale:  2, rotation:  0, translateX:  0, translateY:  0 },  100,  80, { showingPoints:  true });
    expect(ctx.calls.map(c => c[0]).filter(n => n === 'arc').length).toBeGreaterThanOrEqual(1);
    const labels = ctx.calls.filter(c => c[0] === 'fillText');
    expect(labels).toHaveLength(1);
    expect(labels[0][1][0]).toBe('1');
    const scales = ctx.calls.filter(c => c[0] === 'scale');
    expect(scales[0][1][0]).toBeCloseTo(0.5);
   });

 it('uses editing color when editingPointId matches', () => {
    const ctx = fakeCtx();
    drawReferencePoints(ctx, [{ id:  1, imageX:  10, imageY:  10 }], { scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80, { showingPoints:  1, editingPointId:  1 });
    expect(ctx.fs).toBe('white');
   });

 it('draws an accuracy ring when the point has accuracy and a geo transform', () => {
    const ctx = fakeCtx();
    drawReferencePoints(
      ctx,
      [{ id:  1, imageX:  10, imageY:  10, lon:  1, lat:  2, accuracy:  100 }],
      { scale:  2, rotation:  0.5, translateX:  0, translateY:  0 },
      100,
      80,
      { showingPoints:  true, geoTransform: { scale:  1, rotation:  0, tx:  0, ty:  0 }, geoTransformType: 'similarity' }
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
      [{ id: 1, imageX: 10, imageY: 10, lon: 1, lat: 2, accuracy: 100 }],
      { scale: 2, rotation: 0.5, translateX: 0, translateY: 0 },
      100,
      80,
      { showingPoints: true, geoTransform: { scale: 1, rotation: 0, tx: 0, ty: 0 }, geoTransformType: 'similarity' }
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
      { a:  1, b:  2, c:  3, d:  1, e:  2, f:  3 },
      'affine',
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
    drawUserMarker(ctx, null, null, 'similarity',{ scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80);
    drawUserMarker(ctx, { longitude:  1, latitude:  2, accuracy:  5 },   null, 'similarity',{ scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80);
    expect(ctx.calls).toHaveLength(0);
   });

 it('draws position marker when geoTransform is provided', () => {
    const ctx = fakeCtx();
    const geoTransform = { scale:  1, rotation:  0, tx:  0, ty:  0 };
    drawUserMarker(ctx, { longitude:  0, latitude:  0, accuracy:  5 },  geoTransform, 'similarity',{ scale:  1, rotation:  0, translateX:  0, translateY:  0 },  100,  80);
    expect(ctx.calls.filter(c => c[0] === 'arc').length).toBeGreaterThanOrEqual(1);
    expect(ctx.calls.filter(c => c[0] === 'restore')).toHaveLength(1);
    const ss = ctx.calls.filter(c => c[0] === 'strokeStyle');
    const fs = ctx.calls.filter(c => c[0] === 'fillStyle');
    expect(ss[0][1]).toMatch(/^rgba\(175,\s*76,\s*80,\s*0\.4\)$/);
    expect(fs[0][1]).toMatch(/^rgba\(175,\s*76,\s*80,\s*0\.15\)$/);
   });
});
