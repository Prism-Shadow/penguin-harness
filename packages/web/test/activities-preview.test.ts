import { describe, expect, it } from "vitest";
import {
  activityInitials,
  filterActivities,
  fitScale,
  latestModuleRun,
  parseResolution,
  previewUrl,
  sceneIds,
} from "../src/features/activities/preview";

describe("activity preview helpers", () => {
  it("parses the declared module viewport with a sandbox fallback", () => {
    expect(parseResolution("640x480")).toEqual({ width: 640, height: 480 });
    expect(parseResolution(" 1280X720 ")).toEqual({ width: 1280, height: 720 });
    expect(parseResolution(undefined)).toEqual({ width: 1024, height: 768 });
    expect(parseResolution("wide")).toEqual({ width: 1024, height: 768 });
    expect(parseResolution("64x")).toEqual({ width: 1024, height: 768 });
  });

  it("fits the viewport into the box without ever upscaling", () => {
    expect(fitScale({ width: 640, height: 480 }, { width: 320, height: 480 })).toBe(0.5);
    expect(fitScale({ width: 640, height: 480 }, { width: 2000, height: 2000 })).toBe(1);
    expect(fitScale({ width: 640, height: 480 }, { width: 0, height: 480 })).toBe(1);
  });

  it("builds the preview URL with optional scene and language overrides", () => {
    expect(previewUrl("run-1")).toBe(
      "/api/sessions/run-1/files/preview-redirect?path=preview%2Findex.html",
    );
    expect(previewUrl("run 1", { scene: "scene-1" })).toBe(
      "/api/sessions/run%201/files/preview-redirect?path=preview%2Findex.html&scene=scene-1",
    );
    expect(previewUrl("run-1", { scene: "scene-1", language: "es-MX" })).toBe(
      "/api/sessions/run-1/files/preview-redirect?path=preview%2Findex.html&scene=scene-1&language=es-MX",
    );
  });

  it("derives two-letter marks from the title or the product code", () => {
    expect(activityInitials("Penguin Story", "PC")).toBe("PS");
    expect(activityInitials("Penguin", "PC")).toBe("PE");
    expect(activityInitials("  ", "penguin")).toBe("PE");
    expect(activityInitials("a b", "PC")).toBe("AB");
  });

  it("filters activities by title, product code or reference number", () => {
    const items = [
      { productCode: "LOOM", refNum: 12, title: "Sight words" },
      { productCode: "other", refNum: 3, title: "Penguin story" },
    ];
    expect(filterActivities(items, "")).toHaveLength(2);
    expect(filterActivities(items, "  ")).toHaveLength(2);
    expect(filterActivities(items, "penguin")).toEqual([items[1]]);
    expect(filterActivities(items, "LOOM")).toEqual([items[0]]);
    expect(filterActivities(items, "3")).toEqual([items[1]]);
    expect(filterActivities(items, "nothing")).toEqual([]);
  });

  it("lists scene ids from a saved specification", () => {
    expect(sceneIds({ scenes: [{ id: "cover" }, { id: "story" }] })).toEqual(["cover", "story"]);
    expect(sceneIds({ stages: [{ id: "intro" }] })).toEqual(["intro"]);
    expect(sceneIds({ scenes: [{}, { id: "" }, null] })).toEqual([]);
    expect(sceneIds(null)).toEqual([]);
    expect(sceneIds({ scenes: "nope" })).toEqual([]);
  });

  it("finds the newest previewable module run", () => {
    const runs = [
      { kind: "spec", status: "succeeded", sessionId: "s0" },
      { kind: "module", status: "succeeded", sessionId: "s1" },
      { kind: "module", status: "running", sessionId: "s2" },
    ];
    expect(latestModuleRun(runs)?.sessionId).toBe("s1");
    expect(
      latestModuleRun([{ kind: "module", status: "succeeded", sessionId: null }]),
    ).toBeUndefined();
    expect(latestModuleRun([])).toBeUndefined();
  });
});
