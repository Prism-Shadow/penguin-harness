/**
 * `penguin update`'s pure pieces, kept to the cases that can fail without anyone having changed
 * their mind: the validators that reject hostile input, and the precedence and branch invariants
 * whose breakage is silent.
 *
 * A fixture that restates a layout, a flag or a URL the implementation already spells out is
 * deliberately absent: the other end of those contracts is an installer script and a release
 * workflow, which no assertion here is anchored to, so such a copy only ever fails in the same
 * commit that deliberately changed it.
 *
 * No real network and no filesystem mutation — every I/O helper takes its inputs as arguments.
 */
import { describe, expect, it } from "vitest";
import {
  buildInstallerInvocation,
  compareVersions,
  detectInstall,
  detectPackageManager,
  normalizeHttpsBaseUrl,
  normalizeVersion,
  parseOssLatestManifest,
  payloadSourceEnv,
  planUpdate,
  resolveRelease,
} from "../src/commands/update.js";
import { getMessages } from "../src/i18n.js";

// POSIX-only: the fixtures are POSIX install layouts and detectInstall normalizes through
// path.* (backslashes on Windows) — where in-place `penguin update` is refused anyway
// (the documented Windows upgrade path is re-running install.ps1).
describe.skipIf(process.platform === "win32")(
  "detectInstall (how this CLI was installed, from its own real path)",
  () => {
    it("recognises each layout it can upgrade", () => {
      expect(detectInstall("/home/me/.penguin/lib/dist/index.js")).toEqual({
        kind: "tarball",
        installDir: "/home/me/.penguin",
      });
      expect(
        detectInstall("/usr/local/lib/node_modules/@prismshadow/penguin-cli/dist/index.js"),
      ).toEqual({ kind: "npm", globalRoot: "/usr/local/lib/node_modules" });
      expect(detectInstall("/home/me/code/penguin-harness/packages/cli/dist/index.js")).toEqual({
        kind: "source",
      });
    });

    it("a checkout wins over the tarball shape, so a repo under a lib/ dir is never mistaken for an install", () => {
      // The consequence of losing this ordering is an upgrade that overwrites a working tree.
      expect(detectInstall("/srv/lib/penguin-harness/packages/cli/dist/index.js")).toEqual({
        kind: "source",
      });
    });

    it("anything else is unknown rather than guessed", () => {
      expect(detectInstall("/random/place/index.js").kind).toBe("unknown");
      expect(detectInstall("/home/me/.penguin/bin/penguin").kind).toBe("unknown");
    });

    it("an Electron runtime is the desktop app, whatever the path looks like", () => {
      // The desktop app bundles the CLI to a path no layout matches, and runs it on the
      // app's Electron runtime as Node.
      expect(
        detectInstall("/opt/PenguinHarness/resources/app/dist/penguin.js", { electron: true }),
      ).toEqual({ kind: "desktop" });
      expect(
        detectInstall("/usr/local/lib/node_modules/@prismshadow/penguin-cli/dist/index.js", {
          electron: true,
        }),
      ).toEqual({ kind: "desktop" });
    });
  },
);

describe("detectPackageManager (which manager owns a global node_modules root)", () => {
  it("a pnpm root is not read as npm, though it matches the npm shape too", () => {
    // Every global root contains `node_modules`, which is one of npm's own markers, so the
    // order of the checks decides. Guessing npm here installs over a pnpm tree and leaves
    // two copies and a broken shim.
    expect(detectPackageManager("/home/me/.local/share/pnpm/global/5/node_modules")).toBe("pnpm");
    expect(
      detectPackageManager("/home/me/.local/share/pnpm/global/5/node_modules/.pnpm/x/node_modules"),
    ).toBe("pnpm");
    expect(detectPackageManager("/usr/local/lib/node_modules")).toBe("npm");
  });

  it("returns null when unrecognizable, so the caller prints a command instead of guessing", () => {
    expect(detectPackageManager("/weird/place")).toBeNull();
    expect(detectPackageManager("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by component value, not by string, across component widths", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("v0.1.1", "0.1.1")).toBe(0);
  });

  it("a malformed tag can never look like an available upgrade", () => {
    expect(compareVersions("not-a-version", "0.1.1")).toBe(-1);
    expect(compareVersions("", "0.1.1")).toBe(-1);
  });

  it("reads each component as far as it is numeric, and ignores suffixes", () => {
    // Documented limitations rather than bugs, pinned so the docblock and the behaviour
    // cannot drift apart again: parseInt semantics, and plain vX.Y.Z tags only.
    expect(normalizeVersion("  V0.1.2 ")).toBe("0.1.2");
    expect(compareVersions("0.1.2abc", "0.1.2")).toBe(0);
    expect(compareVersions("0.1.x", "0.1.1")).toBe(-1);
    expect(compareVersions("0.1.2-rc1", "0.1.2")).toBe(0);
  });
});

describe("release source selection", () => {
  const ossOrigin = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com";
  const githubApi = "https://api.github.com/repos/Prism-Shadow/penguin-harness/releases/latest";
  const manifest = {
    schemaVersion: 1,
    tag: "v0.2.1",
    version: "0.2.1",
    releaseBaseUrl: `${ossOrigin}/releases/v0.2.1`,
  };
  const t = getMessages("en");

  it("rejects a latest.json that is the wrong schema, escapes its tag, or points off the mirror", () => {
    expect(parseOssLatestManifest(manifest)).toEqual({
      version: "0.2.1",
      tag: "v0.2.1",
      discoveredFrom: "oss",
    });
    expect(parseOssLatestManifest({ ...manifest, schemaVersion: 2 })).toBeNull();
    expect(parseOssLatestManifest({ ...manifest, tag: "../bad" })).toBeNull();
    expect(
      parseOssLatestManifest({ ...manifest, releaseBaseUrl: "https://example.com/v0.2.1" }),
    ).toBeNull();
  });

  it("accepts only absolute HTTPS mirror bases and removes trailing slashes", () => {
    expect(normalizeHttpsBaseUrl("https://mirror.example/releases/v0.2.1/")).toBe(
      "https://mirror.example/releases/v0.2.1",
    );
    expect(normalizeHttpsBaseUrl("http://mirror.example/releases/v0.2.1")).toBeNull();
    expect(normalizeHttpsBaseUrl("/releases/v0.2.1")).toBeNull();
    expect(normalizeHttpsBaseUrl(undefined)).toBeNull();
  });

  it("auto asks OSS first and only reaches GitHub when that fails", async () => {
    const ossOnly: string[] = [];
    await expect(
      resolveRelease("auto", undefined, t, async (url: string) => {
        ossOnly.push(url);
        return new Response(JSON.stringify(manifest), { status: 200 });
      }),
    ).resolves.toMatchObject({ tag: "v0.2.1", discoveredFrom: "oss" });
    expect(ossOnly).toEqual([`${ossOrigin}/latest.json`]);

    const fallback: string[] = [];
    await expect(
      resolveRelease("auto", undefined, t, async (url: string) => {
        fallback.push(url);
        if (url === `${ossOrigin}/latest.json`) return new Response("unavailable", { status: 503 });
        return new Response(JSON.stringify({ tag_name: "v0.2.2" }), { status: 200 });
      }),
    ).resolves.toEqual({ version: "0.2.2", tag: "v0.2.2", discoveredFrom: "github" });
    expect(fallback).toEqual([`${ossOrigin}/latest.json`, githubApi]);
  });

  it("forced oss is strict, while forced github skips OSS", async () => {
    const ossCalls: string[] = [];
    await expect(
      resolveRelease("oss", undefined, t, async (url: string) => {
        ossCalls.push(url);
        return new Response("unavailable", { status: 503 });
      }),
    ).rejects.toThrow(t.update.ossUnavailable());
    expect(ossCalls).toEqual([`${ossOrigin}/latest.json`]);

    const githubCalls: string[] = [];
    await expect(
      resolveRelease("github", undefined, t, async (url: string) => {
        githubCalls.push(url);
        return new Response(JSON.stringify({ tag_name: "v0.2.2" }), { status: 200 });
      }),
    ).resolves.toMatchObject({ tag: "v0.2.2", discoveredFrom: "github" });
    expect(githubCalls).toEqual([githubApi]);
  });
});

describe("buildInstallerInvocation (preserves the shape of the install being upgraded)", () => {
  const base = {
    scriptPath: "/tmp/penguin-install-1.sh",
    defaultInstallDir: "/home/me/.penguin",
  };

  it("carries over what the installer would otherwise change about the install", () => {
    // Each branch is silent when it breaks: a missing --universal adds a runtime the install
    // deliberately does without, and a dropped PENGUIN_INSTALL_DIR relocates the install.
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: base.defaultInstallDir,
        hasBundledNode: true,
      }),
    ).toEqual({ args: [base.scriptPath], env: {} });
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: base.defaultInstallDir,
        hasBundledNode: false,
      }).args,
    ).toEqual([base.scriptPath, "--universal"]);
    expect(
      buildInstallerInvocation({ ...base, installDir: "/opt/penguin", hasBundledNode: true }).env,
    ).toEqual({ PENGUIN_INSTALL_DIR: "/opt/penguin" });
  });

  it("an explicit mirror stays strict, and anything else delegates the choice to the installer", () => {
    const candidate = {
      source: "oss" as const,
      baseUrl: `https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0`,
      url: `https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0/install.sh`,
      fallbackBaseUrl: "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0",
    };
    expect(payloadSourceEnv(candidate, true)).toEqual({
      downloadBaseUrl: candidate.baseUrl,
      downloadFallbackBaseUrl: candidate.fallbackBaseUrl,
    });
    expect(payloadSourceEnv(candidate, false)).toEqual({
      downloadBaseUrl: "",
      downloadFallbackBaseUrl: "",
    });
    // Empty strings are written out rather than omitted, so an inherited lock is cleared
    // instead of leaking into the child installer.
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: base.defaultInstallDir,
        hasBundledNode: true,
        version: "0.2.0",
        downloadBaseUrl: "",
        downloadFallbackBaseUrl: "",
      }).env,
    ).toEqual({
      PENGUIN_VERSION: "v0.2.0",
      PENGUIN_DOWNLOAD_BASE_URL: "",
      PENGUIN_DOWNLOAD_FALLBACK_BASE_URL: "",
    });
  });
});

describe("planUpdate (what the command decides before it touches anything)", () => {
  const base = {
    current: "0.1.1",
    target: "0.1.2",
    modulePath: "/home/me/.penguin/lib/dist/index.js",
    platform: "linux",
    defaultInstallDir: "/home/me/.penguin",
  };
  const tarball = { kind: "tarball", installDir: "/home/me/.penguin" } as const;
  const npmGlobal = { kind: "npm", globalRoot: "/usr/local/lib/node_modules" } as const;

  it("--check only ever reports: upgrade, downgrade, up to date, even from a source checkout", () => {
    // Reporting changes nothing, so neither the comparison nor the install layout may gate it.
    expect(planUpdate({ ...base, check: true, install: tarball })).toEqual({
      action: "report",
      current: "0.1.1",
      target: "0.1.2",
      comparison: 1,
    });
    expect(planUpdate({ ...base, target: "0.1.0", check: true, install: tarball })).toMatchObject({
      action: "report",
      comparison: -1,
    });
    expect(planUpdate({ ...base, check: true, install: { kind: "source" } }).action).toBe("report");
  });

  it("an install already on the target exits before the layout matters", () => {
    expect(planUpdate({ ...base, target: "v0.1.1", install: { kind: "unknown" } }).action).toBe(
      "up-to-date",
    );
  });

  it("upgrades the two layouts it owns, at the place they were detected", () => {
    expect(planUpdate({ ...base, install: npmGlobal })).toMatchObject({
      action: "npm",
      manager: "npm",
    });
    expect(
      planUpdate({ ...base, install: { kind: "tarball", installDir: "/opt/penguin" } }),
    ).toEqual({ action: "tarball", installDir: "/opt/penguin" });
  });

  it("refuses every layout it must not overwrite", () => {
    // A source checkout holds uncommitted work; the desktop app replaces its own CLI; an
    // unrecognised path names itself rather than being upgraded on a guess.
    expect(planUpdate({ ...base, install: { kind: "source" } })).toEqual({
      action: "refuse",
      reason: "source",
    });
    expect(planUpdate({ ...base, install: { kind: "desktop" } })).toEqual({
      action: "refuse",
      reason: "desktop",
    });
    expect(
      planUpdate({ ...base, modulePath: "/random/place/index.js", install: { kind: "unknown" } }),
    ).toEqual({
      action: "refuse",
      reason: "unknown-install",
      modulePath: "/random/place/index.js",
    });
  });

  it("a global install with an unidentifiable manager is refused rather than guessed", () => {
    // Installing with the wrong manager leaves two copies and a broken shim.
    expect(planUpdate({ ...base, install: { kind: "npm", globalRoot: "/weird/place" } })).toEqual({
      action: "refuse",
      reason: "unknown-manager",
      globalRoot: "/weird/place",
      target: "0.1.2",
    });
  });

  it("Windows is refused on both upgrade paths, handing over the command on the npm one", () => {
    // The installer is a POSIX shell script, and spawn() cannot run a .cmd shim without a
    // shell — neither must reach the spawn and fail with a generic message.
    expect(planUpdate({ ...base, platform: "win32", install: tarball })).toEqual({
      action: "refuse",
      reason: "windows-installer",
    });
    expect(planUpdate({ ...base, platform: "win32", install: npmGlobal })).toEqual({
      action: "refuse",
      reason: "windows-global",
      command: "npm install -g @prismshadow/penguin-cli@0.1.2",
    });
  });

  it("every refusal has a message in both languages", () => {
    // A new refusal reason with a missing translation is an accident, not a decision.
    const plans = [
      planUpdate({ ...base, install: { kind: "source" } }),
      planUpdate({ ...base, install: { kind: "desktop" } }),
      planUpdate({ ...base, install: { kind: "unknown" } }),
      planUpdate({ ...base, install: { kind: "npm", globalRoot: "/weird/place" } }),
      planUpdate({ ...base, platform: "win32", install: tarball }),
      planUpdate({ ...base, platform: "win32", install: npmGlobal }),
    ];
    expect(plans.map((p) => p.action)).toEqual(Array(plans.length).fill("refuse"));
    const reasons = new Set(plans.map((p) => (p.action === "refuse" ? p.reason : "")));
    expect(reasons.size).toBe(plans.length);
    for (const lang of ["en", "zh"] as const) {
      const t = getMessages(lang);
      for (const plan of plans) {
        if (plan.action !== "refuse") continue;
        const message = {
          source: t.update.sourceCheckout(),
          desktop: t.update.desktopApp(),
          "unknown-install": t.update.unknownInstall("/x"),
          "unknown-manager": t.update.npmUnknownManager("/x", "0.1.2"),
          "windows-global": t.update.windowsGlobalInstall("cmd"),
          "windows-installer": t.update.windowsUnsupported(),
        }[plan.reason];
        expect(message.length).toBeGreaterThan(0);
      }
    }
  });
});
