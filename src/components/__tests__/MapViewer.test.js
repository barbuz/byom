import { describe, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { flushPromises, FakeImage } from "../../../tests/setup.js";
import MapViewer from "../../MapViewer.svelte";
import {
  getMap,
  getReferencePoints,
  addReferencePoint,
  updateReferencePoint,
  deleteReferencePoint,
} from "../../lib/db.js";
import assert from "node:assert/strict";

const maplibreState = vi.hoisted(() => ({ maps: [], markers: [] }));

vi.mock("../../lib/db.js", () => ({
  getMap: vi.fn(),
  getReferencePoints: vi.fn(),
  addReferencePoint: vi.fn(),
  updateReferencePoint: vi.fn(),
  deleteReferencePoint: vi.fn(),
}));

const mockMapClasses = () => ({
  Map: class {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      maplibreState.maps.push(this);
    }
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    }
    setCenter() { return this; }
    setZoom() { return this; }
  },
  Marker: class {
    constructor() {
      maplibreState.markers.push(this);
    }
    setLngLat(lngLat) {
      this.lngLat = lngLat;
      return this;
    }
    addTo() { return this; }
  },
});

vi.mock("maplibre-gl", () => {
  const classes = mockMapClasses();
  return {
    ...classes,
    default: classes,
  };
});

class MapImage extends FakeImage {
  constructor() {
    super();
    this.width = 800;
    this.height = 600;
  }
}

const REF_POINTS = [
  { id: 1, mapId: 1, imageX:  100, imageY:  100, lon: -74.0, lat:  40.0, accuracy: null },
   { id:  2, mapId:  1, imageX:  700, imageY:  500, lon: -73.0, lat:  41.0, accuracy: null },
 ];

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function firstWatchId() {
  const watchers = globalThis.__geolocationTestUtil.getWatchers();
  const entries = watchers.entries();
  const list = [...entries];
  const first = list[0];
  const id = first[0];
  return id;
}

async function mountViewer() {
  const result = render(MapViewer, { props: { mapId: "1" } });
  await flushPromises();
  return result.component;
}

function clickCanvasAt(x, y) {
  const canvas = document.querySelector("canvas");
  fireEvent.click(canvas, { clientX: x, clientY: y });
}

async function openUseGps() {
  clickCanvasAt(512, 384);
  await sleep(120);
  fireEvent.click(await screen.findByRole("button", { name: /Use GPS/ }));
}

beforeEach(() => {
  getMap.mockReset();
  getReferencePoints.mockReset();
  addReferencePoint.mockReset();
  updateReferencePoint.mockReset();
  deleteReferencePoint.mockReset();
  getMap.mockResolvedValue({ id: 1, imageBlob: { blob: true } });
  getReferencePoints.mockResolvedValue([]);
  vi.stubGlobal("Image", MapImage);
});

describe("MapViewer image loading", () => {
  it("sets the image source to the map blob URL, not null", async () => {
    const instances = [];
    class TrackingImage extends FakeImage {
      constructor() {
        super();
        this.width = 800;
        this.height = 600;
        instances.push(this);
      }
    }
    vi.stubGlobal("Image", TrackingImage);

    await mountViewer();
    await flushPromises();

    assert.equal(instances.length, 1);
    assert.match(String(instances[0].src), /^blob:/);
  });

  it("does not draw a broken image and reports the failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    class BrokenImage extends FakeImage {
      set src(value) {
        this.srcValue = value;
        queueMicrotask(() => {
          this.complete = true;
          if (this.onerror) this.onerror();
        });
      }
      get src() { return this.srcValue; }
    }
    vi.stubGlobal("Image", BrokenImage);

    const result = render(MapViewer, { props: { mapId: "1" } });
    await flushPromises();

    // Interacting schedules a render, which must not reach drawImage on the
    // broken image.
    clickCanvasAt(512, 384);
    await sleep(50);
    const ctxCalls = globalThis.__canvasTestUtil.getCtxCalls();
    assert.equal(ctxCalls.filter(([m]) => m === "drawImage").length, 0);
    assert.ok(errorSpy.mock.calls.some(([msg]) => /Failed to load map image/.test(msg)));

    result.unmount();
    errorSpy.mockRestore();
  });
});

describe("MapViewer pointer input", () => {
  function canvas() {
    return document.querySelector("canvas");
  }

  function touchStart(x, y) {
    fireEvent.touchStart(canvas(), { touches: [{ clientX: x, clientY: y }] });
  }

  function touchMove(x, y) {
    fireEvent.touchMove(canvas(), { touches: [{ clientX: x, clientY: y }] });
  }

  function touchEnd(x, y) {
    fireEvent.touchEnd(canvas(), { changedTouches: [{ clientX: x, clientY: y }] });
  }

  it("starts a new point when the map is tapped", async () => {
    await mountViewer();

    // Browsers emit a compatibility click after a tap on a touch device.
    touchStart(512, 384);
    touchEnd(512, 384);
    clickCanvasAt(512, 384);

    await screen.findByText(/Add Reference Point/);
  });

  it("pans on drag without starting a new point", async () => {
    await mountViewer();
    await sleep(50);

    // Each render emits the view translate first, then the image-centering
    // translate, so the view offset is the second-to-last translate call.
    const viewOffset = () => {
      const calls = globalThis.__canvasTestUtil
        .getCtxCalls()
        .filter(([method]) => method === "translate");
      return calls[calls.length - 2][1];
    };
    const before = viewOffset();

    // A drag pans and produces no click, so no point is added.
    touchStart(512, 384);
    touchMove(600, 450);
    touchMove(700, 500);
    touchEnd(700, 500);
    await sleep(60);

    assert.equal(screen.queryByText(/Add Reference Point/), null);

    // The view followed the finger by the full drag delta.
    const after = viewOffset();
    assert.equal(after[0] - before[0], 700 - 512);
    assert.equal(after[1] - before[1], 500 - 384);
  });

  it("ignores the trailing click after a mouse drag", async () => {
    await mountViewer();
    const canvas = document.querySelector("canvas");

    fireEvent.mouseDown(canvas, { clientX: 512, clientY: 384 });
    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 450 });
    fireEvent.mouseUp(canvas, { clientX: 600, clientY: 450 });
    // Browsers still emit a click after a mouse drag.
    fireEvent.click(canvas, { clientX: 600, clientY: 450 });
    await sleep(30);

    assert.equal(screen.queryByText(/Add Reference Point/), null);
  });

  function twoFingerTouches(x1, y1, x2, y2) {
    return [
      { clientX: x1, clientY: y1 },
      { clientX: x2, clientY: y2 },
    ];
  }

  it("pans with the two-finger center while pinching", async () => {
    await mountViewer();
    await sleep(50);

    const viewOffset = () => {
      const calls = globalThis.__canvasTestUtil
        .getCtxCalls()
        .filter(([method]) => method === "translate");
      return calls[calls.length - 2][1];
    };
    const before = viewOffset();

    // After fitImageToCanvas the canvas (1024x768) centers the 800x600 image
    // at (512, 384); the gesture starts there with the view translate sitting
    // exactly on the pinch center. Fingers start symmetric about that point
    // 100px apart, then spread to 200px apart while moving down-right by
    // (+50, +30).
    fireEvent.touchStart(
      canvas(),
      { touches: twoFingerTouches(462, 384, 562, 384) },
    );
    fireEvent.touchMove(
      canvas(),
      { touches: twoFingerTouches(462, 414, 662, 414) },
    );
    await sleep(60);

    const after = viewOffset();
    // The view follows the fingers' center: zooming alone would keep the map
    // put, so the delta is the pan. The pre-fix code moved it to (-50, -30).
    assert.ok(after[0] - before[0] > 0, `x moved ${after[0] - before[0]}`);
    assert.ok(after[1] - before[1] > 0, `y moved ${after[1] - before[1]}`);
    assert.equal(after[0] - before[0], 50);
    assert.equal(after[1] - before[1], 30);
  });
});

describe("MapViewer GPS flows", () => {
  it("selects coordinates on the OSM map using the maplibre mock", async () => {
    maplibreState.maps.length = 0;
    maplibreState.markers.length = 0;

    await mountViewer();
    clickCanvasAt(512, 384);
    await sleep(120);
    fireEvent.click(await screen.findByRole("button", { name: /Select on Map/ }));
    await sleep(180);

    await screen.findByText("Click on the map to select coordinates");
    assert.equal(maplibreState.maps.length, 1);

    const map = maplibreState.maps[0];
    map.handlers.click({ lngLat: { lng: -74.006, lat: 40.7128 } });
    await flushPromises();

    await screen.findByText(/Selected: 40.712800, -74.006000/);
    assert.equal(maplibreState.markers.length, 1);

    map.handlers.click({ lngLat: { lng: -73.99, lat: 40.71 } });
    await flushPromises();
    await screen.findByText(/Selected: 40.710000, -73.990000/);
    assert.equal(maplibreState.markers.length, 1);
   });

  it("centers the OSM map on reference points when selecting on map", async () => {
    maplibreState.maps.length = 0;
    maplibreState.markers.length = 0;
    getReferencePoints.mockResolvedValue(REF_POINTS);

    await mountViewer();
    clickCanvasAt(512, 384);
    await sleep(120);
    fireEvent.click(await screen.findByRole("button", { name: /Select on Map/ }));
    await sleep(180);

    const map = maplibreState.maps[0];
    assert.ok(map.options.center.length === 2);
    assert.ok(Math.abs(map.options.center[0] + 73.5) < 0.001);
    assert.ok(Math.abs(map.options.center[1] - 40.5) < 0.001);
   assert.equal(map.options.zoom, 10);
   });

  it("uses GPS: records options, success enables Save with the selection", async () => {
    const gpsOptions = [];
    const geo = navigator.geolocation;
    const original = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = function (...args) {
      gpsOptions.push(args[2]);
      return original(...args);
    };

    await mountViewer();
    await openUseGps();

    assert.equal(gpsOptions.length, 1);
    assert.deepEqual(gpsOptions[0], {
      enableHighAccuracy: true,
      timeout:  10000,
      maximumAge:  0,
    });

    const saveButton = screen.getByText("Save Point");
    assert.equal(saveButton.disabled, true);

    globalThis.__geolocationTestUtil.emitCurrentPosition({
      latitude:  40.7128,
      longitude: -74.0060,
      accuracy:  10,
    });
    await flushPromises();

    assert.equal(saveButton.disabled, false);
    await screen.findByText(/GPS location acquired/);
    await screen.findByText(/40.712800/);
  });

  it("shows a GPS error and retries via Try Again", async () => {
    await mountViewer();
    await openUseGps();

    globalThis.__geolocationTestUtil.emitCurrentError("denied");
    await flushPromises();
    await screen.findByText("GPS error: denied");

    const tryAgain = screen.getByText("Try Again");
    fireEvent.click(tryAgain);
    globalThis.__geolocationTestUtil.emitCurrentPosition({
      latitude:  40.0,
      longitude: -74.0,
      accuracy:  null,
    });
    await flushPromises();
    await screen.findByText(/GPS location acquired/);
  });

  it("accepts valid manual coordinates and enables Save", async () => {
    await mountViewer();
    clickCanvasAt(512, 384);
    await sleep(120);
    fireEvent.click(await screen.findByRole("button", { name: /Manual Entry/ }));
    await flushPromises();

    const latInput = await screen.findByPlaceholderText("e.g., 40.7128");
    const lonInput = await screen.findByPlaceholderText("e.g., -74.0060");
    fireEvent.input(latInput, { target: { value: "40.7128" } });
    fireEvent.input(lonInput, { target: { value: "-74.0060" } });
    fireEvent.click(screen.getByText("Use These Coordinates"));

    const saveButton = await screen.findByText("Save Point");
    await flushPromises();
    assert.equal(saveButton.disabled, false);
  });

  it("rejects non-numeric manual coordinates", async () => {
    await mountViewer();
    clickCanvasAt(512, 384);
    await sleep(120);
    fireEvent.click(await screen.findByRole("button", { name: /Manual Entry/ }));
    await flushPromises();

    const latInput = await screen.findByPlaceholderText("e.g., 40.7128");
    fireEvent.input(latInput, { target: { value: "abc" } });
    fireEvent.click(screen.getByText("Use These Coordinates"));

    assert.equal(window.alert.mock.calls[0][0], "Please enter valid numbers");
  });

  it("rejects out-of-range latitude", async () => {
    await mountViewer();
    clickCanvasAt(512, 384);
    await sleep(120);
    fireEvent.click(await screen.findByRole("button", { name: /Manual Entry/ }));
    await flushPromises();

    const latInput = await screen.findByPlaceholderText("e.g., 40.7128");
    const lonInput = await screen.findByPlaceholderText("e.g., -74.0060");
    fireEvent.input(latInput, { target: { value: "91" } });
    fireEvent.input(lonInput, { target: { value: "-74.0060" } });
    fireEvent.click(screen.getByText("Use These Coordinates"));

    assert.equal(window.alert.mock.calls[0][0], "Latitude must be between -90 and 90");
  });

  it("debug modal shows a no-GPS message without position", async () => {
    await mountViewer();
    fireEvent.click(screen.getByText(/Debug/));
    await screen.findByText("No GPS data available");
  });

  it("debug modal shows position data and computed image coordinates", async () => {
    getReferencePoints.mockResolvedValue(REF_POINTS);
    await mountViewer();

    const id = firstWatchId();
    globalThis.__geolocationTestUtil.emitWatchPosition(id, {
      latitude:  40.5,
      longitude: -73.5,
      accuracy:  20,
    });
    await flushPromises();

    fireEvent.click(screen.getByText(/Debug/));
    await screen.findByText(/40.500000/);
    await screen.findByText(/-73.500000/);
    await screen.findByText(/20m/);

    const { geoToImage, calculateTransform } = await import("../../lib/transforms.js");
    const transform = calculateTransform(REF_POINTS);
    const computed = geoToImage(-73.5, 40.5, transform);
    await screen.findByText(
      new RegExp(`${computed.imageX.toFixed(1)}, ${computed.imageY.toFixed(1)}`)
    );
  });

  it("saves the reference point with pending image coords and selected GPS coords", async () => {
    await mountViewer();
    await openUseGps();

    globalThis.__geolocationTestUtil.emitCurrentPosition({
      latitude:  40.7128,
      longitude: -74.0060,
      accuracy:  10,
    });
    await flushPromises();

    const saveButton = await screen.findByText("Save Point");
    await flushPromises();
    assert.equal(saveButton.disabled, false);
    fireEvent.click(saveButton);
    await flushPromises();

    assert.equal(addReferencePoint.mock.calls.length, 1);
    const args = addReferencePoint.mock.calls[0][0];
    assert.equal(args.mapId, 1);
    assert.equal(args.imageX, 400);
    assert.equal(args.imageY, 300);
    assert.equal(args.lon, -74.0060);
    assert.equal(args.lat, 40.7128);
    assert.equal(args.accuracy, 10);
    assert.ok(!screen.queryByText("Use GPS"));
  });
});

describe("MapViewer center on user", () => {
  function centerButton() {
    return screen.getByRole("button", { name: /Center on me/ });
  }

  it("renders as an icon-only crosshair control outside the centred button bar", async () => {
    await mountViewer();

    const button = centerButton();
    // Icon-only: the SVG is hidden from assistive tech and the accessible
    // name comes from aria-label, so there is no visible text at all.
    assert.equal(button.textContent.trim(), "");
    assert.equal(button.getAttribute("aria-label"), "Center on me");
    assert.equal(button.classList.contains("center-user-btn"), true);
    assert.equal(button.classList.contains("control-btn"), false);

    // A crosshair, not a target/emoji: circle plus four arms.
    const svg = button.querySelector("svg.center-user-icon");
    assert.ok(svg, "crosshair svg should be present");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.equal(svg.getAttribute("stroke"), "currentColor");
    assert.equal(svg.querySelector("circle").getAttribute("r"), "7");
    assert.equal(svg.querySelectorAll("line").length, 4);

    // Pinned bottom-right, not inside the flex control bar.
    const controls = document.querySelector(".controls");
    assert.equal(controls.contains(button), false);
  });

  function viewOffset() {
    const calls = globalThis.__canvasTestUtil
      .getCtxCalls()
      .filter(([method]) => method === "translate");
    return calls[calls.length - 2][1];
  }

  it("disables the button until a GPS position and a geo transform are available", async () => {
    await mountViewer();
    assert.equal(centerButton().disabled, true);

    const id = firstWatchId();
    globalThis.__geolocationTestUtil.emitWatchPosition(id, {
      latitude:  40.5,
      longitude: -73.5,
      accuracy:  10,
    });
    await flushPromises();
    // Reference points are empty, so GPS cannot be mapped onto the image.
    assert.equal(centerButton().disabled, true);
  });

  it("centers the view on the user's computed image location", async () => {
    getReferencePoints.mockResolvedValue(REF_POINTS);
    await mountViewer();
    await sleep(50);

    const id = firstWatchId();
    globalThis.__geolocationTestUtil.emitWatchPosition(id, {
      latitude:  40.5,
      longitude: -73.5,
      accuracy:  10,
    });
    await flushPromises();

    const button = centerButton();
    assert.equal(button.disabled, false);
    fireEvent.click(button);
    await sleep(30);

    const { geoToImage, calculateTransform } = await import("../../lib/transforms.js");
    const geoTransform = calculateTransform(REF_POINTS);
    const image = geoToImage(-73.5, 40.5, geoTransform);

    const canvasWidth = window.innerWidth;
    const canvasHeight = window.innerHeight;
    const scale = Math.min(canvasWidth / 800, canvasHeight / 600) * 0.9;
    const expectedX = canvasWidth / 2 - (image.imageX - 400) * scale;
    const expectedY = canvasHeight / 2 - (image.imageY - 300) * scale;

    const offset = viewOffset();
    assert.ok(Math.abs(offset[0] - expectedX) < 1e-6, `x ${offset[0]} vs ${expectedX}`);
    assert.ok(Math.abs(offset[1] - expectedY) < 1e-6, `y ${offset[1]} vs ${expectedY}`);
  });
});

describe("MapViewer degenerate georeference", () => {
  // Two points with identical GPS coordinates but different image coordinates
  // have no valid similarity transform. That must not be treated as a map
  // load failure, or the map is permanently unopenable and the offending
  // points can never be fixed or deleted.
  const DUPLICATE_GPS_POINTS = [
    { id: 1, mapId: 1, imageX: 100, imageY: 100, lon: -74.0, lat: 40.0, accuracy: null },
    { id: 2, mapId: 1, imageX: 700, imageY: 500, lon: -74.0, lat: 40.0, accuracy: null },
  ];

  it("still opens the map and shows the georeference error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getReferencePoints.mockResolvedValue(DUPLICATE_GPS_POINTS);

    await mountViewer();
    await sleep(30);

    // The map itself loaded: no bail-out alert, no navigation away, canvas live.
    assert.equal(window.alert.mock.calls.length, 0);
    assert.ok(document.querySelector("canvas"));

    await screen.findByText(/Georeference unavailable/);
    await screen.findByText(/Reference points must be distinct/);

    errorSpy.mockRestore();
  });

  it("lets the user recover by editing a point to a distinct location", async () => {
    // Model the persistence round-trip: the edit lands in the "database", so
    // the reload that follows the save sees the corrected point set.
    const stored = DUPLICATE_GPS_POINTS.map((point) => ({ ...point }));
    getReferencePoints.mockImplementation(async () => stored.map((point) => ({ ...point })));
    updateReferencePoint.mockImplementation(async (id, changes) => {
      const target = stored.find((point) => point.id === id);
      Object.assign(target, changes);
    });

    await mountViewer();
    await sleep(30);

    // Reveal and open the first point for editing.
    fireEvent.click(screen.getByText(/Points \(2\)/));
    await flushPromises();

    const canvasWidth = window.innerWidth;
    const canvasHeight = window.innerHeight;
    const scale = Math.min(canvasWidth / 800, canvasHeight / 600) * 0.9;
    clickCanvasAt(
      canvasWidth / 2 + (100 - 400) * scale,
      canvasHeight / 2 + (100 - 300) * scale,
    );
    await screen.findByText(/Edit Point #1/);

    // Give it its own GPS coordinate; the set becomes valid again.
    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "41.0" } });
    fireEvent.click(screen.getByText("Save"));
    await flushPromises();

    assert.equal(updateReferencePoint.mock.calls.length, 1);
    assert.equal(window.alert.mock.calls.length, 0);
  });

  it("refuses to add a point that would make the georeference invalid", async () => {
    getReferencePoints.mockResolvedValue([REF_POINTS[0]]);
    await mountViewer();

    // Second point at a different image location, but the same GPS coords.
    clickCanvasAt(512, 384);
    await sleep(120);
    fireEvent.click(await screen.findByRole("button", { name: /Manual Entry/ }));
    await fireEvent.input(screen.getByLabelText(/Latitude/), { target: { value: "40.0" } });
    await fireEvent.input(screen.getByLabelText(/Longitude/), { target: { value: "-74.0" } });
    fireEvent.click(screen.getByText("Use These Coordinates"));
    await flushPromises();
    fireEvent.click(screen.getByText("Save Point"));
    await flushPromises();

    assert.equal(addReferencePoint.mock.calls.length, 0);
    assert.equal(window.alert.mock.calls.length, 1);
    assert.match(window.alert.mock.calls[0][0], /Reference points must be distinct/);
  });
});

describe("MapViewer point editing", () => {
  // The component sizes the canvas to the viewport and fits the 800x600
  // image into it, so the first reference point is not at its raw pixel
  // position on screen. Replicate that fit to find where to click.
  async function openEditModal() {
    getReferencePoints.mockResolvedValue(REF_POINTS);
    await mountViewer();
    fireEvent.click(screen.getByText(/Points \(2\)/));
    await flushPromises();

    const canvasWidth = window.innerWidth;
    const canvasHeight = window.innerHeight;
    const scale = Math.min(canvasWidth / 800, canvasHeight / 600) * 0.9;
    const screenX = canvasWidth / 2 + (100 - 400) * scale;
    const screenY = canvasHeight / 2 + (100 - 300) * scale;
    clickCanvasAt(screenX, screenY);
    await flushPromises();
    await screen.findByText(/Edit Point #1/);
  }

  it("persists edited coordinates through the db layer", async () => {
    await openEditModal();

    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "41.5" } });
    await fireEvent.input(screen.getByLabelText("Longitude"), { target: { value: "-72.25" } });
    fireEvent.click(screen.getByText("Save"));
    await flushPromises();

    assert.equal(updateReferencePoint.mock.calls.length, 1);
    const [id, changes] = updateReferencePoint.mock.calls[0];
    assert.equal(id, 1);
    assert.equal(changes.lat, 41.5);
    assert.equal(changes.lon, -72.25);
    assert.equal(screen.queryByText(/Edit Point #1/), null);
  });

  it("refuses an emptied coordinate instead of persisting an unusable point", async () => {
    await openEditModal();

    // Clearing a number input binds null; saving that would make the map
    // unloadable once the transform fitters reject the point.
    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "" } });
    await fireEvent.input(screen.getByLabelText("Longitude"), { target: { value: "-72.25" } });
    fireEvent.click(screen.getByText("Save"));
    await flushPromises();

    assert.equal(updateReferencePoint.mock.calls.length, 0);
    assert.equal(window.alert.mock.calls.length, 1);
    assert.match(window.alert.mock.calls[0][0], /Latitude must be between/);
    // The modal stays open so the user can correct the field.
    assert.ok(screen.queryByText(/Edit Point #1/));
  });

  it("refuses out-of-range coordinates", async () => {
    await openEditModal();

    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "95" } });
    fireEvent.click(screen.getByText("Save"));
    await flushPromises();

    assert.equal(updateReferencePoint.mock.calls.length, 0);
    assert.equal(window.alert.mock.calls.length, 1);
  });
});
