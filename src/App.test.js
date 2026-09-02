import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import App from "./App.svelte";

describe("App", () => {
  it("renders the map list by default", async () => {
    render(App);
    await screen.findByText(/bring your own map/i);
  });
});

