import { describe, it, expect } from 'vitest';
import {
  screenToImage,
  imageToScreen,
  getPointAtScreen,
  pinchZoomTransform,
} from './viewport.js';

describe('screenToImage', () => {
  it('returns null when image dimensions are missing', () => {
    expect(screenToImage(10, 20, { scale: 1, rotation: 0, translateX: 0, translateY: 0 }, 0, 0)).toBeNull();
  });

  it('converts screen coordinates to image coordinates', () => {
    const result = screenToImage(110, 70, { scale:  2, rotation:  0, translateX:  10, translateY:  20 },  100,  80);
    expect(result).toEqual({ x:  100, y:  65 });
  });

  it('returns null for coordinates outside the image', () => {
    const transform = { scale:  1, rotation:  0, translateX:  0, translateY:  0 };
    expect(screenToImage(1000, 1000, transform,  100,  100)).toBeNull();
  });
});

describe('imageToScreen', () => {
  it('round-trips with screenToImage', () => {
    const transform = { scale:  2, rotation:  0.5, translateX:  30, translateY:  40 };
    const screen = imageToScreen(80, 60, transform,  200, 160);
    expect(screenToImage(screen.x, screen.y, transform,  200,  160)).toEqual({ x: 80, y:  60 });
  });

  it('applies rotation and translation', () => {
    const screen = imageToScreen(50,  30, { scale:  1, rotation:  0, translateX:  5, translateY:  7 }, 100, 80);
    expect(screen).toEqual({ x:  5, y:  -3 });
  });
});

describe('getPointAtScreen', () => {
  it('returns -1 when points are hidden', () => {
    expect(getPointAtScreen(0,  0, [{ imageX:  0, imageY:  0 }], { scale:  1, rotation:  0, translateX:  0, translateY:  0 }, 100,  100)).toBe(-1);
  });

 it('finds the point near the click', () => {
    const points = [
      { id:  1, imageX:  50, imageY:  50 },
      { id:  2, imageX:  150, imageY:  50 },
    ];
    const index = getPointAtScreen(52,  2, points, { scale:  1, rotation:  0, translateX:  0, translateY:  0 }, 200,  100);
    expect(index).toBe(1);
  });

 it('returns -1 when no point is near', () => {
    const points = [{ id:  1, imageX:  500, imageY:  500 }];
    expect(getPointAtScreen(100,  200, points, { scale:  1, rotation:  0, translateX:  0, translateY:  0 },  1000,   1000)).toBe(-1);
  });

 it('accounts for rotation when hitting a point', () => {
    const transform = { scale:  2, rotation: Math.PI, translateX:  200, translateY:  150 };
    const points = [{ id:  1, imageX:  50, imageY:  50 }];
    expect(getPointAtScreen(200,  150, points, transform,  100,  100)).toBe(0);
  });
});

describe('pinchZoomTransform', () => {
  it('keeps the pinch center fixed when zooming', () => {
    const center = { x:  100, y:  80 };
    const transform = { scale:  1, rotation:  0, translateX:  30, translateY:  20 };
    const zoomed = pinchZoomTransform(center, transform,  2);
    expect(zoomed).toMatchObject({ scale:  2 });
    expect(zoomed.translateX).toBeCloseTo(-40,  5);
    expect(zoomed.translateY).toBeCloseTo(-40,  5);
  });

 it('adjusts translation to keep the center fixed', () => {
    const center = { x:  100, y:  100 };
    const transform = { scale:  1, rotation:  0, translateX:  0, translateY:  0 };
    const zoomed = pinchZoomTransform(center, transform,  2);
    expect(zoomed.translateX).toBeCloseTo(-100,  5);
    expect(zoomed.translateY).toBeCloseTo(-100,  5);
  });
});