import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appIdentity, desktopDataRoot, devDataRoot } from "../src/app-identity.js";

const builderConfig = fs.readFileSync(
  fileURLToPath(new URL("../electron-builder.yml", import.meta.url)),
  "utf8",
);

/** A top-level scalar from electron-builder.yml (line-based; the config keeps them plain). */
function builderValue(key: string): string {
  const m = new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "m").exec(builderConfig);
  if (!m) throw new Error(`electron-builder.yml has no top-level '${key}'`);
  return m[1]!;
}

describe("appIdentity", () => {
  it("release identity matches what electron-builder stamps on installed builds", () => {
    // The AppUserModelID must equal the appId electron-builder writes into the installed
    // shortcuts (Windows toast routing), and the name must equal productName. This test
    // is the sync the main.ts comment used to only ask for.
    expect(appIdentity(true)).toEqual({
      name: builderValue("productName"),
      appUserModelId: builderValue("appId"),
    });
  });

  it("dev identity is dev-suffixed so a dev run coexists with a release install", () => {
    const dev = appIdentity(false);
    // The name keys the userData directory (Chromium profile, port memory) and the
    // single-instance lock: sharing it would make a dev launch quit into the release
    // instance's window.
    expect(dev.name).not.toBe(appIdentity(true).name);
    expect(dev.appUserModelId).not.toBe(appIdentity(true).appUserModelId);
    expect(dev).toEqual({
      name: "PenguinHarness-Dev",
      appUserModelId: "com.prismshadow.penguinharness.dev",
    });
  });
});

describe("devDataRoot", () => {
  it("is ~/.penguin/dev-data, apart from the release/CLI ~/.penguin/data", () => {
    expect(devDataRoot("/home/dev")).toBe(path.join("/home/dev", ".penguin", "dev-data"));
    expect(devDataRoot("/home/dev")).not.toBe(path.join("/home/dev", ".penguin", "data"));
  });
});

/**
 * The precedence rule #292 turns on. These pin the RULE, not the constants: flipping the
 * packaged branch, dropping the PENGUIN_HOME precedence, or letting either form fall into
 * the other's root has to fail here.
 */
describe("desktopDataRoot", () => {
  const releaseRoot = path.join("/home/dev", ".penguin", "data");
  const devRoot = path.join("/home/dev", ".penguin", "dev-data");
  /** Stands in for core's resolveRoot, and records whether the rule consulted it. */
  function stubRelease(): (() => string) & { calls: number } {
    const fn = (): string => {
      fn.calls += 1;
      return releaseRoot;
    };
    fn.calls = 0;
    return fn;
  }

  it("an explicit PENGUIN_HOME wins in both forms", () => {
    for (const isPackaged of [true, false]) {
      const release = stubRelease();
      expect(
        desktopDataRoot({
          envHome: "/srv/elsewhere",
          isPackaged,
          homedir: "/home/dev",
          releaseRoot: release,
        }),
      ).toBe("/srv/elsewhere");
      // The explicit value short-circuits: core's resolver is never consulted.
      expect(release.calls).toBe(0);
    }
  });

  it("a packaged build with no PENGUIN_HOME shares the CLI's root via core's resolver", () => {
    const release = stubRelease();
    expect(
      desktopDataRoot({
        envHome: undefined,
        isPackaged: true,
        homedir: "/home/dev",
        releaseRoot: release,
      }),
    ).toBe(releaseRoot);
    // Delegated rather than re-derived, so ~/.penguin/data keeps one definition point.
    expect(release.calls).toBe(1);
  });

  it("an unpackaged run with no PENGUIN_HOME takes the dev root, never the release one", () => {
    const release = stubRelease();
    const root = desktopDataRoot({
      envHome: undefined,
      isPackaged: false,
      homedir: "/home/dev",
      releaseRoot: release,
    });
    expect(root).toBe(devRoot);
    // The #292 regression guard: a bare dev launch must not land on the release install's
    // data root, where it would attach to the running release server via its server.lock.
    expect(root).not.toBe(releaseRoot);
    expect(release.calls).toBe(0);
  });
});
