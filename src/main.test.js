import { describe, it, expect, vi, afterEach } from "vitest";

// Bootstrap regression test. main.js is the one entry point unit tests never
// exercised: components are mounted via @testing-library/svelte, so a broken
// mount call in main.js left every test green while the real app threw
// effect_orphan and rendered a blank page.
const dbMocks = vi.hoisted(() => ({
  initDB: vi.fn(async () => ({})),
  migrateLegacyPoints: vi.fn(async () => {}),
  getAllMaps: vi.fn(async () => []),
  addMap: vi.fn(),
  deleteMap: vi.fn(),
}));

vi.mock("./lib/db.js", () => dbMocks);

afterEach(() => {
  vi.resetModules();
  window.location.hash = "";
});

describe("main bootstrap", () => {
  it("mounts the app into #app", async () => {
    const target = document.createElement("div");
    target.id = "app";
    document.body.appendChild(target);

    await import("./main.js");

    expect(target.textContent).toContain("Bring Your Own Map");
  });
});
