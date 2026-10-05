import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import App from "./App.svelte";

const dbMocks = vi.hoisted(() => ({
  initDB: vi.fn(async () => ({})),
  backfillImageDimensions: vi.fn(async () => {}),
  getAllMaps: vi.fn(async () => []),
  addMap: vi.fn(),
  deleteMap: vi.fn(),
  getMap: vi.fn(async () => ({ id: 1, name: "Test", imageBlob: { blob: true } })),
  getReferencePoints: vi.fn(async () => []),
  getAllReferencePoints: vi.fn(async () => []),
  addReferencePoint: vi.fn(),
  updateReferencePoint: vi.fn(),
  deleteReferencePoint: vi.fn(),
}));

vi.mock("./lib/db.js", () => dbMocks);

afterEach(() => {
  window.location.hash = "";
});

describe("App", () => {
  it("renders the map list by default", async () => {
    render(App);
    await screen.findByText(/bring your own map/i);
  });

  it("backfills image dimensions on startup", async () => {
    // The backfill must run from the app entry point, before any map is opened,
    // so the landing page can classify without decoding a blob per map.
    dbMocks.backfillImageDimensions.mockClear();
    render(App);
    await screen.findByText(/bring your own map/i);
    expect(dbMocks.backfillImageDimensions).toHaveBeenCalled();
  });

  it("routes to the viewer when the hash points to a map", async () => {
    window.location.hash = "#map/1";
    render(App);
    await screen.findByText(/← Back/);
    expect(dbMocks.getMap).toHaveBeenCalledWith(1);
  });
});

