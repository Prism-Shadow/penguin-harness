import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appIdentity, devDataRoot } from "../src/app-identity.js";

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
