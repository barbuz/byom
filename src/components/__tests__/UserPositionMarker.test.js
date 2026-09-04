import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/svelte";
import { flushPromises, getCtxCalls } from "../../../tests/setup.js";
import UserPositionMarker from "../UserPositionMarker.svelte";
import assert from "node:assert/strict";

const SIM = {
  scale: 0.1,
  rotation: 0,
  tx: 10,
  ty:  20,
};

function firstWatcher() {
  const watchers = globalThis.__geolocationTestUtil.getWatchers();
  const entries = watchers.entries();
  const list = [...entries];
  const first = list[0];
  return first;
}

function watchCount() {
  const watchers = globalThis.__geolocationTestUtil.getWatchers();
  const entries = watchers.entries();
  const list = [...entries];
  const count = list.length;
  return count;
}

function watchId() {
  const first = firstWatcher();
  const id = first[0];
  return id;
}

function emitPosition(position) {
  const id = watchId();
  globalThis.__geolocationTestUtil.emitWatchPosition(id, position);
}

describe("UserPositionMarker", () => {
  beforeEach(() => {
    globalThis.__canvasTestUtil.reset();
    const calls = getCtxCalls();
    calls.length = 0;
  });

  it("registers a geolocation watch with the expected options on mount", () => {
    const scheduleRender = vi.fn();
    render(UserPositionMarker, { props: { scheduleRender } });
    const count = watchCount();
    assert.equal(count, 1);
    const first = firstWatcher();
    const entry = first[1];
    const options = entry.options;
    const expectedOptions = {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    };
    assert.deepEqual(options, expectedOptions);
  });

  it("updates userPosition and calls scheduleRender when the watch fires", async () => {
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    emitPosition({ latitude:   12.3, longitude:   45.6, accuracy:   7.8 });
    await flushPromises();
    const state = component.$capture_state();
    const position = state.userPosition;
    assert.equal(position.latitude, 12.3);
    assert.equal(position.longitude, 45.6);
    assert.equal(position.accuracy, 7.8);
    const calls = scheduleRender.mock.calls;
    assert.equal(calls.length, 1);
  });

  it("clears the watch on destroy", () => {
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    const before = watchCount();
    assert.equal(before, 1);
    component.$destroy();
    const after = watchCount();
    assert.equal(after, 0);
  });

  it("warns and does not watch when geolocation is unsupported", () => {
    const scheduleRender = vi.fn();
    const warnSpy = vi.spyOn(console, "warn");
    warnSpy.mockImplementation(() => {});
    const geo = globalThis.__geolocationTestUtil;
    delete navigator.geolocation;
    render(UserPositionMarker, { props: { scheduleRender } });
    const messages = warnSpy.mock.calls;
    const found = messages.some(function (args) {
      return args[0] === "Geolocation not supported";
    });
    assert.equal(found, true);
    const watchers = geo.getWatchers();
    const entries = watchers.entries();
    const list = [...entries];
    assert.equal(list.length, 0);
    warnSpy.mockRestore();
    navigator.geolocation = geo;
  });

  it("logs watch errors without crashing", async () => {
    const scheduleRender = vi.fn();
    const errorSpy = vi.spyOn(console, "error");
    errorSpy.mockImplementation(() => {});
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    const id = watchId();
    globalThis.__geolocationTestUtil.emitWatchError(id, "denied");
    await flushPromises();
    const messages = errorSpy.mock.calls;
    const found = messages.some(function (args) {
      return args[0] === "GPS error:";
    });
    assert.equal(found, true);
    const calls = scheduleRender.mock.calls;
    assert.equal(calls.length, 0);
    errorSpy.mockRestore();
  });

  it("draws nothing when there is no position", () => {
    const result = render(UserPositionMarker);
    const component = result.component;
    const state = component.$capture_state();
    const position = state.userPosition;
    assert.equal(position, null);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const beforeCalls = getCtxCalls();
    const before = beforeCalls.length;
    component.drawUserPosition(ctx);
    const afterCalls = getCtxCalls();
    const after = afterCalls.length;
    assert.equal(after, before);
  });

  it("draws user positionand accuracy circle in the expected order", async () => {
    const scheduleRender = vi.fn();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const result = render(
      UserPositionMarker,
      {
        props: {
          scheduleRender,
          geoTransform: SIM,
          geoTransformType: "similarity",
          transform: { scale:  2, translateX:  5, translateY:  6, rotation:  0.3 },
          imageWidth:  800,
          imageHeight:  600,
        },
      },
    );
    const component = result.component;
    emitPosition({ latitude:  20, longitude:  10, accuracy: 1100 });
    await flushPromises();
    component.drawUserPosition(ctx);
    const calls = ctx.ctxCalls;
    const filtered = calls.filter(function (c) {
      return c[0] !== "getContext";
    });
    const methods = filtered.map(function (c) {
      return c[0];
    });
    const lastIndex = methods.length - 1;
    const last = methods[lastIndex];
    assert.equal(last, "restore");
    const arcs = filtered.filter(function (c) {
      return c[0] === "arc";
    });
    const arcsCount = arcs.length;
    assert.equal(arcsCount, 3);
    const accuracyRadius = arcs[0][1][2];
    const markerOuter = arcs[1][1][2];
    assert.ok(accuracyRadius > 0.05);
    assert.ok(accuracyRadius < markerOuter);
    assert.ok(markerOuter > arcs[2][1][2]);
    const renderCalls = scheduleRender.mock.calls;
    assert.equal(renderCalls.length, 1);
  });

  it("draws an inner dot when the marker is rendered", async () => {
    const scheduleRender = vi.fn();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const result = render(
      UserPositionMarker,
      { props: { scheduleRender, geoTransform: SIM, geoTransformType: "similarity" } },
    );
    const component = result.component;
    emitPosition({ latitude:  20, longitude:  10, accuracy: null });
    await flushPromises();
    component.drawUserPosition(ctx);
    const calls = ctx.ctxCalls;
    const filtered = calls.filter(function (c) {
      return c[0] !== "getContext";
    });
    const arcs = filtered.filter(function (c) {
      return c[0] === "arc";
    });
    const arcsCount = arcs.length;
    assert.equal(arcsCount, 2);
    const markerRadius = arcs[1][1][2];
    assert.ok(markerRadius >5);
    assert.ok(markerRadius <8);
  });
});