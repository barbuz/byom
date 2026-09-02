import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi, beforeEach, afterEach } from "vitest";

// Recorded Canvas 2D context stub.
// jsdom has no real 2D context. Every draw call is recorded into
// ctxCalls as [method, args] entries so tests can assert on sequences.

class RecordedCanvasContext {
  constructor() {
    this.ctxCalls = [];
    this.fillStyle = "";
    this.strokeStyle = "";
    this.lineWidth = 0;
    this.globalAlpha = 1;
    this.font = "";
    this.textAlign = "";
    this.textBaseline = "";
    this.lineCap = "";
    this.lineJoin = "";
    this.miterLimit = 10;
  }

  call(method, args) {
    this.ctxCalls.push([method, [...args]]);
  }

  getContext() {
    return this;
  }

  measureText(text) {
    this.call("measureText", [text]);
    return { width: typeof text === "string" ? text.length * 8 : 0 };
  }

  toDataURL(type, quality) {
    this.call("toDataURL", [type, quality]);
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP8z8BQDwAEhQGAhajMIwAAAABJRU5ErkJggg==";
  }

  createImageData(w, h) {
    this.call("createImageData", [w, h]);
    return { width:w, height:h, data: new Uint8ClampedArray(w * h * 4) };
  }

  getImageData(x, y, w, h) {
    this.call("getImageData", [x, y, w, h]);
    return { width:w, height:h, data: new Uint8ClampedArray(w * h * 4) };
  }

  putImageData(imageData, dx, dy, dirtyX, dirtyY, dirtyW, dirtyH) {
    this.call("putImageData", [imageData, dx, dy, dirtyX, dirtyY, dirtyW, dirtyH]);
  }

  drawImage(...args) {
    this.call("drawImage", args);
  }

  fill() { this.call("fill", []); }
  stroke() { this.call("stroke", []); }
  beginPath() { this.call("beginPath", []); }
  closePath() { this.call("closePath", []); }
  save() { this.call("save", []); }
  restore() { this.call("restore", []); }
  clip() { this.call("clip", []); }

  moveTo(x, y) { this.call("moveTo", [x, y]); }
  lineTo(x, y) { this.call("lineTo", [x, y]); }
  arc(x, y, r, s, e, cc) { this.call("arc", [x, y, r, s, e, cc]); }
  arcTo(x1, y1, x2, y2, r) { this.call("arcTo", [x1, y1, x2, y2, r]); }
  rect(x, y, w, h) { this.call("rect", [x, y, w, h]); }
  fillRect(x, y, w, h) { this.call("fillRect", [x, y, w, h]); }
  strokeRect(x, y, w, h) { this.call("strokeRect", [x, y, w, h]); }
  clearRect(x, y, w, h) { this.call("clearRect", [x, y, w, h]); }

  scale(x, y) { this.call("scale", [x, y]); }
  rotate(a) { this.call("rotate", [a]); }
  translate(x, y) { this.call("translate", [x, y]); }
  transform(a, b, c, d, e, f) { this.call("transform", [a, b, c, d, e, f]); }
  setTransform(a, b, c, d, e, f) { this.call("setTransform", [a, b, c, d, e, f]); }
  resetTransform() { this.call("resetTransform", []); }

  fillText(t, x, y) { this.call("fillText", [t, x, y]); }
  strokeText(t, x, y) { this.call("strokeText", [t, x, y]); }
  setLineDash(s) { this.call("setLineDash", [s]); }
  getLineDash() { return []; }

  createLinearGradient() { this.call("createLinearGradient", []); return { addColorStop: () => {} }; }
  createRadialGradient() { this.call("createRadialGradient", []); return { addColorStop: () => {} }; }
  createPattern() { this.call("createPattern", []); return null; }

  getTransform() { return { a:  1, b:  0, c:  0,d:  1,e:  0,f:  0 }; }
  isPointInPath(x, y) { this.call("isPointInPath", [x, y]); return false; }
  drawFocusIfNeeded(el) { this.call("drawFocusIfNeeded", [el]); }
  ellipse(x, y, rx, ry, rot, s, e, cc) { this.call("ellipse", [x, y, rx, ry, rot, s, e, cc]); }
  bezierCurveTo(a, b, c, d, e, f) { this.call("bezierCurveTo", [a, b, c, d, e, f]); }
  quadraticCurveTo(a, b, c, d) { this.call("quadraticCurveTo", [a, b, c, d]); }
} 


let canvasContextStub = null;

export function installCanvasStub() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (type === "2d" || type === "2D") {
      if (!canvasContextStub) {
        canvasContextStub = new RecordedCanvasContext();
      }
      canvasContextStub.call("getContext", [type, ...args]);
      return canvasContextStub;
    }
    return originalGetContext.call(this, type, ...args);
  };

  return () => {
    if (canvasContextStub) {
      canvasContextStub.ctxCalls.length = 0;
    }
  };
} 

export function getCtxCalls() {
  return canvasContextStub ? canvasContextStub.ctxCalls : [];
} 

// Fake Image class. jsdom Image never fires load; this fake lets
// tests set dimensions and trigger onload manually (loads async).
class FakeImage {
  constructor() {
    this.width = 0;
    this.height =  0;
    this.onload = null;
    this.onerror = null;
    this.complete = false;
    this.srcValue = null;
    this.crossOriginValue = null;
    this.naturalWidthValue = 0;
    this.naturalHeightValue = 0;
  }

  set src(value) {
    this.srcValue = value;

    queueMicrotask(() => {
      this.complete = true;
      if (this.onload) this.onload();
    });
  }

  get src() { return this.srcValue; }

  set crossOrigin(value) { this.crossOriginValue = value; }
  get crossOrigin() { return this.crossOriginValue; }

  set naturalWidth(value) { this.naturalWidthValue = value; }
  get naturalWidth() { return this.naturalWidthValue || this.width; }

  set naturalHeight(value) { this.naturalHeightValue = value; }
  get naturalHeight() { return this.naturalHeightValue || this.height; }
} 


// Geolocation stub. Stores success/error callbacks so tests can fire
// position updates manually.
function installGeolocationStub() {
  const watchers = new Map();
  let watcherId = 0;
  const oneShotCallbacks = [];

  const geolocationStub = {
    watchPosition(success, error, options) {
      watcherId += 1;
      watchers.set(watcherId, { success, error, options });
      return watcherId;
    },
    clearWatch(id) { watchers.delete(id); },
    getCurrentPosition(success, error, options) {
      oneShotCallbacks.push({ success, error, options });
    },
  };

  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    enumerable: true,
    value: geolocationStub,
  });

  return {
    emitWatchPosition(id, coords) {
      const watcher = watchers.get(id);
      if (watcher) {
        watcher.success({ coords: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }, timestamp: Date.now() });
      }
    },
    emitWatchError(id, message) {
      const watcher = watchers.get(id);
      if (watcher && watcher.error) {
        watcher.error({ code: 1, message });
      }
    },
    emitCurrentPosition(coords) {
      const cb = oneShotCallbacks.shift();
      if (cb) {
        cb.success({ coords: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }, timestamp: Date.now() });
      }
    },
    emitCurrentError(message) {
      const cb = oneShotCallbacks.shift();
      if (cb && cb.error) {
        cb.error({ code: 1, message });
      }
    },
    getWatchers() { return watchers; }
  };
} 

export async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0));
} 

beforeEach(() => {
  const resetCanvas = installCanvasStub();

  // Reset DOM
  document.body.innerHTML = "";
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();

  const geo = installGeolocationStub();
  const geoUtils = {};
  Object.entries(geo).forEach(([key, value]) => {
    if (key.startsWith("emit") || key === "getWatchers") {
      geoUtils[key] = value;
    }
  });
  globalThis.__geolocationTestUtil = geoUtils;
  globalThis.__canvasTestUtil = { reset: resetCanvas, getCtxCalls };
});

afterEach(() => {
  if (window.confirm && window.confirm.mockRestore) {
    window.confirm.mockRestore();
  }
  if (window.alert && window.alert.mockRestore) {
    window.alert.mockRestore();
  }
  delete globalThis.__geolocationTestUtil;

  globalThis.__canvasTestUtil = null;
});

