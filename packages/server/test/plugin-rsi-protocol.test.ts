/**
 * An RSI toolkit declares how it uses Benchmarks in its package.json (`penguin.rsi_protocol`),
 * listed on GET /api/plugins: the Optimize tab reads it to decide what to ask the toolkit for.
 *
 * - A toolkit that learns on a Train/Test pair lists `train-test`.
 * - A toolkit that declares nothing lists no protocol, which the tab reads as one Benchmark.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginLibraryResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("an RSI toolkit's protocol", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(() => t.cleanup());

  it("lists the protocol a toolkit declares, and none for one that declares nothing", async () => {
    const body = (await (await api.get("/api/plugins")).json()) as PluginLibraryResponse;
    const plugins = body.groups.flatMap((g) => g.plugins);
    const toolkit = (name: string) => plugins.find((p) => p.name === name);
    expect(toolkit("skillopt-rsi-toolkit")?.rsiProtocol).toBe("train-test");
    expect(toolkit("opro-rsi-toolkit")).toBeDefined();
    expect(toolkit("opro-rsi-toolkit")).not.toHaveProperty("rsiProtocol");
  });
});
