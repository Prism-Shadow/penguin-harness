/**
 * A library plugin carries its quick start in plugin.json, listed on GET /api/plugins. The page
 * only pre-fills a draft from it, so what is checked here is that the demo reaches it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginLibraryResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("quick start", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(() => t.cleanup());

  it("lists a library plugin's demo with the library", async () => {
    const body = (await (await api.get("/api/plugins")).json()) as PluginLibraryResponse;
    const goal = body.groups.flatMap((g) => g.plugins).find((p) => p.name === "goal");
    expect(goal?.quickStart).toMatchObject({ goal: true });
    expect(goal?.quickStart?.prompt.length).toBeGreaterThan(0);
  });
});
