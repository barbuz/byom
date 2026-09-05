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
  getMap.mockResolvedValue({ id: 1, imageBlob: { blob: true } });
  getReferencePoints.mockResolvedValue([]);
  vi.stubGlobal("Image", MapImage);
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
    const computed = geoToImage(-73.5, 40.5, transform.transform, transform.type);
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
