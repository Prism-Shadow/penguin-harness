/**
 * A tab that outlived a web push reloads onto the current build the first time one of its lazy
 * chunks is gone — once per build, never in a loop (lib/stale-build.ts). The 2026-10-05
 * regression: after the d531v20 → d531v21 push, xterm's chunk names changed, the server
 * answered the old ones with index.html, and every Claude Code terminal in a tab opened
 * before the push stayed on "connecting".
 */
import { describe, expect, it } from "vitest";
import { STALE_BUILD_RELOAD_KEY, reloadForStaleBuild } from "../src/lib/stale-build";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("reloadForStaleBuild", () => {
  it("reloads the first time a chunk of this build fails, and remembers the build", () => {
    const storage = memoryStorage();
    let reloads = 0;
    const reloaded = reloadForStaleBuild({
      build: "/assets/index-OLD.js",
      storage,
      reload: () => reloads++,
    });
    expect(reloaded).toBe(true);
    expect(reloads).toBe(1);
    expect(storage.map.get(STALE_BUILD_RELOAD_KEY)).toBe("/assets/index-OLD.js");
  });

  it("does not reload again for a build it already reloaded for (no loop)", () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: "/assets/index-NEW.js" });
    let reloads = 0;
    const reloaded = reloadForStaleBuild({
      build: "/assets/index-NEW.js",
      storage,
      reload: () => reloads++,
    });
    expect(reloaded).toBe(false);
    expect(reloads).toBe(0);
  });

  it("reloads again after a later push: a different build is a new chance", () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: "/assets/index-V20.js" });
    let reloads = 0;
    expect(
      reloadForStaleBuild({ build: "/assets/index-V21.js", storage, reload: () => reloads++ }),
    ).toBe(true);
    expect(reloads).toBe(1);
  });

  it("never reloads without storage to guard the loop", () => {
    let reloads = 0;
    expect(reloadForStaleBuild({ build: "b", storage: null, reload: () => reloads++ })).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(reloadForStaleBuild({ build: "b", storage: throwing, reload: () => reloads++ })).toBe(
      false,
    );
    expect(reloads).toBe(0);
  });
});
