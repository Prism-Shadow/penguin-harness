/**
 * ProjectConfigService read-cache semantics: repeat reads are served from the
 * mtime-keyed parsed-table cache (one initial readFile), the service's own writes
 * invalidate synchronously, an external edit is caught by the stat, a fresh mtime is
 * never cached as clean (same-second-granularity guard), and the typed loadConfig
 * view mirrors core's loadProjectConfig (missing file → the preset default config).
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProjectConfig,
  projectConfigPath,
  renderProjectConfigToml,
} from "@prismshadow/penguin-core";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import { makeTempRoot } from "./helpers.js";

const P = "project-cfg";
const PRICED = {
  provider: "custom",
  model_id: "m1",
  pricing: { unit: "usd_per_mtok", cache_read: 1, cache_write: 2, output: 3 },
};

/** Ages the config's mtime past the gate's FRESH_MS window (fixed instants keep backdates idempotent). */
async function backdate(file: string, instant: string): Promise<void> {
  const at = new Date(instant);
  await fs.utimes(file, at, at);
}

describe("project-config read cache", () => {
  let root: string;
  let svc: ProjectConfigService;
  let file: string;

  beforeEach(async () => {
    root = await makeTempRoot();
    svc = new ProjectConfigService(root);
    file = projectConfigPath(root, P);
    await svc.writeRaw(P, { name: "cached", models: [PRICED] });
    await backdate(file, "2026-01-01T00:00:00Z");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("repeat reads cost one readFile: pricing, name and the typed loadConfig view share the cached parse", async () => {
    const reads = vi.spyOn(fs, "readFile");
    expect(await svc.getPricing(P, "custom", "m1")).toEqual({
      cacheRead: 1,
      cacheWrite: 2,
      output: 3,
    });
    expect(await svc.getPricing(P, "custom", "m1")).toEqual({
      cacheRead: 1,
      cacheWrite: 2,
      output: 3,
    });
    expect(await svc.getName(P)).toBe("cached");
    expect((await svc.loadConfig(P)).models.map((m) => m.model_id)).toEqual(["m1"]);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("a service write invalidates synchronously; once quiet, the next read re-parses exactly once", async () => {
    await svc.getName(P); // Warm the cache at the stable mtime.
    await svc.setName(P, "renamed");
    await backdate(file, "2026-01-01T00:01:00Z");
    const reads = vi.spyOn(fs, "readFile");
    expect(await svc.getName(P)).toBe("renamed");
    expect(await svc.getPricing(P, "custom", "m1")).toEqual({
      cacheRead: 1,
      cacheWrite: 2,
      output: 3,
    });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("an external edit (bypassing the service) is caught by the stat: new mtime → re-read", async () => {
    expect(await svc.getName(P)).toBe("cached"); // Warm at the old mtime.
    await fs.writeFile(
      file,
      renderProjectConfigToml({ name: "edited", models: [{ provider: "custom", model_id: "m2" }] }),
      "utf8",
    );
    await backdate(file, "2026-01-01T00:02:00Z"); // Stable, but a different mtime than cached.
    expect(await svc.getName(P)).toBe("edited");
    expect((await svc.loadConfig(P)).models.map((m) => m.model_id)).toEqual(["m2"]);
    expect(await svc.getPricing(P, "custom", "m1")).toBeUndefined();
  });

  it("a fresh mtime is never cached as clean: reads keep hitting disk until the file has been quiet", async () => {
    await svc.setName(P, "fresh"); // mtime = now, inside the FRESH_MS window.
    const reads = vi.spyOn(fs, "readFile");
    await svc.getName(P);
    await svc.getName(P);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("missing file: readRaw → {} and loadConfig → the preset default config (core loadProjectConfig parity)", async () => {
    await svc.getName(P); // Warm, then delete out from under the cache.
    await fs.rm(file);
    expect(await svc.readRaw(P)).toEqual({});
    expect(await svc.loadConfig(P)).toEqual(defaultProjectConfig());
  });
});
