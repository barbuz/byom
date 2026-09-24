import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/svelte";
import { flushPromises, getCtxCalls } from "../../../tests/setup.js";
import UserPositionMarker from "../UserPositionMarker.svelte";
import {
  WATCHDOG_INTERVAL_MS,
  STALE_AFTER_MS,
  FIRST_FIX_TIMEOUT_MS,
  REARM_COOLDOWN_MS,
  MIN_HIDDEN_MS,
  GEOLOCATION_OPTIONS,
} from "../../lib/gps.js";
import assert from "node:assert/strict";

const SIM = {
  // 100 metres per pixel, and the test's image is 800x600 so the divisor is
  // 800: 100 * 800 = 80000 metres per fraction unit.
  m: [80000, 0, 0, 0, 80000, 0, 0, 0, 1],
  type: 'similarity',
  lon0: 10,
  lat0: 20,
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
    assert.deepEqual(options, GEOLOCATION_OPTIONS);
  });

  it("keeps the watchdog timing constants mutually consistent", () => {
    // A provider may take up to `timeout` ms to answer, and may hand back a
    // cached fix up to `maximumAge` ms old. Both must resolve before the
    // watchdog calls the watch stale, otherwise a slow-but-alive provider is
    // torn down and re-armed in a loop.
    assert.ok(GEOLOCATION_OPTIONS.timeout < STALE_AFTER_MS);
    assert.ok(GEOLOCATION_OPTIONS.maximumAge < STALE_AFTER_MS);
    // A fix delivered a tick after it arrives must still be fresh.
    assert.ok(WATCHDOG_INTERVAL_MS < STALE_AFTER_MS);
    assert.ok(WATCHDOG_INTERVAL_MS < FIRST_FIX_TIMEOUT_MS);
    // The cooldown must not exceed the staleness window, or a genuinely stale
    // watch would keep being reported stale without ever being rebuilt.
    assert.ok(REARM_COOLDOWN_MS < STALE_AFTER_MS);
    assert.ok(MIN_HIDDEN_MS > 0);
  });

  it("updates userPosition and calls scheduleRender when the watch fires", async () => {
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    emitPosition({ latitude:   12.3, longitude:   45.6, accuracy:   7.8 });
    await flushPromises();
    const position = component.userPosition;
    assert.equal(position.latitude, 12.3);
    assert.equal(position.longitude, 45.6);
    assert.equal(position.accuracy, 7.8);
    const calls = scheduleRender.mock.calls;
    assert.equal(calls.length, 1);
  });

  it("clears the watch on destroy", async () => {
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    const before = watchCount();
    assert.equal(before, 1);
    result.unmount();
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
    const position = component.userPosition;
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
      { props: { scheduleRender, geoTransform: SIM } },
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
function watchIds() {
  const watchers = globalThis.__geolocationTestUtil.getWatchers();
  const list = [...watchers.keys()];
  return list;
}

// Fake only the watchdog's clock and interval; setTimeout stays real so
// flushPromises and Svelte's own scheduling keep working.
function useWatchdogTimers() {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
}

describe("UserPositionMarker watchdog", () => {
  beforeEach(() => {
    globalThis.__canvasTestUtil.reset();
    const calls = getCtxCalls();
    calls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-arms the watch and flags staleness when no fix ever arrives", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    const before = watchIds();
    assert.equal(before.length, 1);
    assert.equal(component.positionStale, false);

    // Past FIRST_FIX_TIMEOUT_MS, and far enough to reach the next watchdog
    // tick, so the watchdog observes the expired first-fix budget.
    vi.advanceTimersByTime(FIRST_FIX_TIMEOUT_MS + WATCHDOG_INTERVAL_MS);
    await flushPromises();

    const after = watchIds();
    assert.equal(after.length, 1);
    assert.notEqual(after[0], before[0]);
    assert.equal(component.positionStale, true);
  });

  it("does not re-arm while fresh fixes keep arriving", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    render(UserPositionMarker, { props: { scheduleRender } });
    const before = watchIds();

    // One watchdog tick between fixes: shorter than STALE_AFTER_MS, so each
    // fix arrives while the previous one is still fresh.
    for (let i = 0; i < 6; i++) {
      emitPosition({ latitude: 12.3, longitude: 45.6, accuracy: 8 });
      vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
      await flushPromises();
    }

    const after = watchIds();
    assert.deepEqual(after, before);
  });

  it("re-arms when an existing fix goes stale", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;
    emitPosition({ latitude: 12.3, longitude: 45.6, accuracy: 8 });
    await flushPromises();
    const before = watchIds();

    // Still within STALE_AFTER_MS of the fix, so no re-arm yet.
    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
    await flushPromises();
    assert.deepEqual(watchIds(), before);
    assert.equal(component.positionStale, false);

    // Cross STALE_AFTER_MS: the fix is now stale and the watch is rebuilt.
    vi.advanceTimersByTime(STALE_AFTER_MS);
    await flushPromises();
    const after = watchIds();
    assert.notEqual(after[0], before[0]);
    assert.equal(component.positionStale, true);
  });

  it("clears the stale flag once a fresh fix arrives after re-arming", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    const component = result.component;

    vi.advanceTimersByTime(FIRST_FIX_TIMEOUT_MS + WATCHDOG_INTERVAL_MS);
    await flushPromises();
    assert.equal(component.positionStale, true);

    emitPosition({ latitude: 1, longitude: 2, accuracy: 5 });
    await flushPromises();
    assert.equal(component.positionStale, false);
  });

  function setVisibility(value) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("re-arms on becoming visible again", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    render(UserPositionMarker, { props: { scheduleRender } });
    const before = watchIds();
    const renderCallsBefore = scheduleRender.mock.calls.length;

    setVisibility("hidden");
    // Stand in for time spent in another app, the user's current workaround.
    // Just past MIN_HIDDEN_MS, but short enough that the watchdog's first-fix
    // budget has not expired, so the re-arm can only come from the resume.
    vi.advanceTimersByTime(MIN_HIDDEN_MS + 1);
    setVisibility("visible");
    await flushPromises();

    const after = watchIds();
    assert.notEqual(after[0], before[0]);
    assert.ok(scheduleRender.mock.calls.length > renderCallsBefore);
    delete document.visibilityState;
  });

  it("ignores visibility changes while the page is hidden", async () => {
    const scheduleRender = vi.fn();
    render(UserPositionMarker, { props: { scheduleRender } });
    const before = watchIds();

    setVisibility("hidden");
    await flushPromises();

    assert.deepEqual(watchIds(), before);
    delete document.visibilityState;
  });

  it("re-arms on pageshow", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    render(UserPositionMarker, { props: { scheduleRender } });
    const before = watchIds();

    window.dispatchEvent(new Event("pageshow"));
    await flushPromises();

    const after = watchIds();
    assert.notEqual(after[0], before[0]);
  });

  it("does not re-arm for an incidental visibility blip", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    render(UserPositionMarker, { props: { scheduleRender } });

    setVisibility("hidden");
    setVisibility("visible");
    await flushPromises();
    const afterFirst = watchIds();

    // A second blip straight away must not tear the fresh watch down again.
    setVisibility("hidden");
    setVisibility("visible");
    await flushPromises();
    assert.deepEqual(watchIds(), afterFirst);
    delete document.visibilityState;
  });

  it("stops the watchdog and listeners on destroy", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    const result = render(UserPositionMarker, { props: { scheduleRender } });
    assert.equal(watchCount(), 1);

    result.unmount();
    assert.equal(watchCount(), 0);

    vi.advanceTimersByTime(60000);
    await flushPromises();
    assert.equal(watchCount(), 0);

    window.dispatchEvent(new Event("pageshow"));
    await flushPromises();
    assert.equal(watchCount(), 0);
  });

  it("draws a hollow dashed marker when the fix is stale", async () => {
    useWatchdogTimers();
    const scheduleRender = vi.fn();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const result = render(UserPositionMarker, {
      props: { scheduleRender, geoTransform: SIM },
    });
    const component = result.component;
    emitPosition({ latitude: 20, longitude: 10, accuracy: 5000 });
    await flushPromises();

    vi.advanceTimersByTime(STALE_AFTER_MS + WATCHDOG_INTERVAL_MS);
    await flushPromises();
    assert.equal(component.positionStale, true);

    ctx.ctxCalls.length = 0;
    component.drawUserPosition(ctx);
    const filtered = ctx.ctxCalls.filter(function (c) {
      return c[0] !== "getContext";
    });
    const arcs = filtered.filter(function (c) {
      return c[0] === "arc";
    });
    const dashes = filtered.filter(function (c) {
      return c[0] === "setLineDash";
    });
    assert.equal(arcs.length, 1);
    assert.equal(dashes.length, 2);
    assert.equal(filtered.filter(function (c) {
      return c[0] === "restore";
    }).length, 1);
  });
});
