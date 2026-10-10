/**
 * GET /api/rsi: the self-evolution catalogue the draft screen counts. Both lists are derived —
 * the toolkits from the library's `rsi` category, the reproductions from core's built-in
 * Benchmarks — so what is checked is that the route answers exactly those two sources, to any
 * logged-in user and to nobody else.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_BENCHMARKS, loadPluginGroups } from "@prismshadow/penguin-core";
import type { RsiCatalogResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("GET /api/rsi", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it("requires a login", async () => {
    expect((await t.app.request("/api/rsi")).status).toBe(401);
  });

  it("lists the rsi toolkits and the built-in Benchmarks to a user of no Project", async () => {
    // Deployment-global like the plugin library: no Project membership is asked for.
    const reader = apiClient(t.app, (await provisionUser(t.app, "reader_r")).cookie);
    const res = await reader.get("/api/rsi");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RsiCatalogResponse;

    const rsi = loadPluginGroups().find((g) => g.id === "rsi")?.plugins ?? [];
    // Non-vacuous: the library files its toolkits under the category.
    expect(rsi.length).toBeGreaterThan(0);
    expect(body.toolkits.map((toolkit) => toolkit.plugin)).toEqual(rsi.map((p) => p.name).sort());
    for (const toolkit of body.toolkits) expect(toolkit.skills.length).toBeGreaterThan(0);

    expect(body.benchmarks).toEqual(BUILTIN_BENCHMARKS.map((b) => ({ id: b.id, title: b.title })));
  });
});
