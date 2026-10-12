/**
 * Reading what a machine's server says it runs (its GET /api/version), and whether that is what a
 * plan installs. The reports are the ones a machine answered on the test box: one running a
 * checkout's image, one running release 0.2.13 on a root that holds that image.
 *
 * - A source build beside the pushed harness on its disk is that build; a release answering
 *   beside one is not running it, whatever its disk says.
 * - A build is compared by its pushed platform, not by the release half of its version.
 * - What a machine runs is spelled as the plan for the same harness is: its platform, CLI and web
 *   bundles together, so a page and a log name one build by one version.
 * - A report that names no version reads as nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planOver, runningBuild, runsPlan } from "../src/machines/install-server.js";
import type { PushPlan } from "../src/machines/install-server.js";

const HARNESS = {
  source: null,
  pushedAt: "2026-10-12T09:33:03.909Z",
  bundles: {
    platform: "store/platform/9bb5205fcae4ec76.mjs",
    cli: "store/cli/e16e52dca673bfb0.mjs",
    web: "store/web/6b86f12df8238d3a.webz",
  },
  assets: "store/assets/3a2477fe44b9ba0e",
};
/** A machine running the image its disk holds. */
const IMAGE_RUNNING = {
  version: "0.2.13",
  describe: "v0.2.13",
  channel: "source",
  buildDate: null,
  commit: null,
  harness: HARNESS,
};
/** Release 0.2.13's own server on that root: it could not boot the newer platform. */
const RELEASE_RUNNING = {
  version: "0.2.13",
  describe: "v0.2.13",
  channel: "release",
  buildDate: "2026-09-16",
  commit: "691ae72f423581e2be145210a942715c79a667ba",
  harness: HARNESS,
};
/** The plan that installs HARNESS, made as a server whose store holds it makes one. */
const store = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-running-build-"));
fs.writeFileSync(
  path.join(store, "harness.json"),
  JSON.stringify({
    platform: { bundle: HARNESS.bundles.platform },
    cli: { bundle: HARNESS.bundles.cli },
    web: { manifest: HARNESS.bundles.web },
    assets: { dir: HARNESS.assets },
  }),
);
const IMAGE: PushPlan = planOver("0.2.13", store);
afterAll(() => fs.rmSync(store, { recursive: true, force: true }));

describe("runningBuild", () => {
  it("reads a machine running its pushed image as that image, spelled as its plan", () => {
    expect(runningBuild(IMAGE_RUNNING)).toEqual({
      release: "0.2.13",
      version: IMAGE.version,
      platform: "9bb5205fcae4",
      foreign: false,
    });
  });

  it("reads a release answering beside a pushed image as not running it", () => {
    expect(runningBuild(RELEASE_RUNNING)).toMatchObject({ release: "0.2.13", foreign: true });
  });

  it("reads a release with nothing pushed as that release", () => {
    expect(runningBuild({ ...RELEASE_RUNNING, harness: null })).toEqual({
      release: "0.2.13",
      version: "0.2.13",
      platform: null,
      foreign: false,
    });
  });

  it("reads an answer that names no version as nothing", () => {
    for (const report of [null, "0.2.13", {}, { version: 3 }, { version: "" }, { models: [] }]) {
      expect(runningBuild(report)).toBeNull();
    }
  });
});

describe("runsPlan", () => {
  it("is true for the image's own platform, whatever the release half of the version says", () => {
    // A packaged server stands on its release; the build pushed to it came from a checkout whose
    // VERSION may already be the next one.
    expect(runsPlan(runningBuild({ ...IMAGE_RUNNING, version: "0.2.14" })!, IMAGE)).toBe(true);
  });

  it("is false for another platform, and for a plain release where an image is expected", () => {
    const older = {
      ...IMAGE_RUNNING,
      harness: {
        ...HARNESS,
        bundles: { ...HARNESS.bundles, platform: "store/platform/0123456789abcdef.mjs" },
      },
    };
    expect(runsPlan(runningBuild(older)!, IMAGE)).toBe(false);
    expect(runsPlan(runningBuild({ ...RELEASE_RUNNING, harness: null })!, IMAGE)).toBe(false);
  });

  it("is true for a plain release where that release is what is installed", () => {
    const bare: PushPlan = {
      baseVersion: "0.2.13",
      harness: null,
      hmrDir: null,
      version: "0.2.13",
    };
    expect(runsPlan(runningBuild({ ...RELEASE_RUNNING, harness: null })!, bare)).toBe(true);
    expect(runsPlan(runningBuild(IMAGE_RUNNING)!, bare)).toBe(false);
  });
});
