import { describe, it, expect } from "vitest";

describe("test harness mocks", () => {
  it("records canvas 2d draw calls", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.fillRect(1, 2, 3, 4);
    ctx.arc(5, 6, 7, 0, 6.28);
    const calls = globalThis.__canvasTestUtil.getCtxCalls();
    const fill = calls.find(c => c[0] === "fillRect");
    expect(fill).toBeTruthy();
    expect(fill[1]).toEqual([1, 2, 3, 4]);
    expect(calls.some(c => c[0] === "arc")).toBe(true);
  });

  it("exposes geolocation emit helpers", () => {
    const util = globalThis.__geolocationTestUtil;
    expect(util).toHaveProperty("emitWatchPosition");
    expect(util).toHaveProperty("getWatchers");
  });
});

