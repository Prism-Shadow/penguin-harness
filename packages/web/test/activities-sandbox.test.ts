import { describe, expect, it } from "vitest";
import {
  canBuild,
  playUrl,
  sandboxTone,
  type SandboxStatusLike,
} from "../src/features/activities/sandbox";

const status = (overrides: Partial<SandboxStatusLike> = {}): SandboxStatusLike => ({
  state: "ready",
  playable: true,
  buildable: false,
  ...overrides,
});

describe("how a preview state reads", () => {
  it("is success when it is ready and attention when it is stale", () => {
    // Stale is attention because something will happen when the author presses Build.
    expect(sandboxTone(status())).toBe("success");
    expect(sandboxTone(status({ state: "stale" }))).toBe("attention");
  });

  it("is muted for a ref that does not own the module", () => {
    // Not a fault: this ref simply does not own the module, and nothing here changes that.
    expect(sandboxTone(status({ state: "missing_shared_module" }))).toBe("muted");
  });

  it("is muted while there is nothing to show yet", () => {
    expect(sandboxTone(status({ state: "pending_spec" }))).toBe("muted");
    expect(sandboxTone(status({ state: "pending_scaffold" }))).toBe("muted");
  });
});

describe("whether Build does anything", () => {
  it("is offered even when the module is current", () => {
    // A rebuild is what an author asks for when they do not trust the last one.
    expect(canBuild(status())).toBe(true);
    expect(canBuild(status({ state: "stale" }))).toBe(true);
    expect(canBuild(status({ state: "pending_scaffold" }))).toBe(true);
  });

  it("is not offered with no specification or from a ref that does not own the module", () => {
    expect(canBuild(status({ state: "pending_spec" }))).toBe(false);
    expect(canBuild(status({ state: "missing_shared_module" }))).toBe(false);
  });
});

describe("the link that plays an activity", () => {
  it("names the activity, and carries only the overrides an author chose", () => {
    expect(playUrl("p 1", "act_1")).toBe("/api/projects/p%201/activities/act_1/sandbox/play");
    expect(playUrl("p", "a", { language: "es-MX", scene: "intro" })).toBe(
      "/api/projects/p/activities/a/sandbox/play?language=es-MX&scene=intro",
    );
  });
});
