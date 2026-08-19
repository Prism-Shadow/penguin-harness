/**
 * `penguin update`'s pure pieces, covering the facts that cannot be read off the implementation:
 * the install layouts other artifacts own (install.sh's tarball tree, the global npm/pnpm roots,
 * a source checkout), the download-source contract shared with the installers, the installer
 * argv/env that preserves the shape of the install being upgraded, and what planUpdate decides
 * before it touches anything.
 *
 * No real network and no filesystem mutation — every I/O helper takes its inputs as arguments.
 */
import { describe, expect, it } from "vitest";
import {
  buildInstallerInvocation,
  compareVersions,
  configuredInstallerCandidate,
  detectInstall,
  detectPackageManager,
  downloadInstaller,
  installerCandidates,
  normalizeVersion,
  normalizeHttpsBaseUrl,
  parseDownloadSource,
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
    it("tarball: <installDir>/lib/dist/index.js, the layout install.sh unpacks", () => {
      expect(detectInstall("/home/me/.penguin/lib/dist/index.js")).toEqual({
        kind: "tarball",
        installDir: "/home/me/.penguin",
      });
    });

    it("tarball: a non-default PENGUIN_INSTALL_DIR is read off the path, not the environment", () => {
      expect(detectInstall("/opt/tools/penguin/lib/dist/index.js")).toEqual({
        kind: "tarball",
        installDir: "/opt/tools/penguin",
      });
    });

    it("npm global: npm's own prefix layout", () => {
      expect(
        detectInstall("/usr/local/lib/node_modules/@prismshadow/penguin-cli/dist/index.js"),
      ).toEqual({ kind: "npm", globalRoot: "/usr/local/lib/node_modules" });
    });

    it("npm global: pnpm's global store, through the .pnpm virtual dir", () => {
      const p =
        "/home/me/.local/share/pnpm/global/5/node_modules/.pnpm/@prismshadow+penguin-cli@0.1.1/node_modules/@prismshadow/penguin-cli/dist/index.js";
      const info = detectInstall(p);
      expect(info.kind).toBe("npm");
      expect(info.globalRoot).toContain(".pnpm");
    });

    it("source checkout: the built dist inside the monorepo", () => {
      expect(detectInstall("/home/me/code/penguin-harness/packages/cli/dist/index.js")).toEqual({
        kind: "source",
      });
    });

    it("source checkout: tsx running src directly", () => {
      expect(detectInstall("/home/me/code/penguin-harness/packages/cli/src/index.ts")).toEqual({
        kind: "source",
      });
    });

    it("a checkout wins over the tarball shape, so a repo under a lib/ dir is never mistaken for an install", () => {
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
      expect(
        detectInstall("/opt/PenguinHarness/resources/app/dist/penguin.js", { electron: false })
          .kind,
      ).toBe("unknown");
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

describe("normalizeVersion / compareVersions", () => {
  it("accepts both v-prefixed and bare tags", () => {
    expect(normalizeVersion("v0.1.2")).toBe("0.1.2");
    expect(normalizeVersion("0.1.2")).toBe("0.1.2");
    expect(normalizeVersion("  V0.1.2 ")).toBe("0.1.2");
  });
  it("orders newer above older, including across component widths", () => {
    expect(compareVersions("0.1.2", "0.1.1")).toBe(1);
    expect(compareVersions("0.1.1", "0.1.2")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
  });
  it("a malformed tag can never look like an available upgrade", () => {
    expect(compareVersions("not-a-version", "0.1.1")).toBe(-1);
    expect(compareVersions("", "0.1.1")).toBe(-1);
  });
  it("reads each component as far as it is numeric, which is what the docblock promises", () => {
    // parseInt semantics, pinned so the comment and the behaviour cannot drift apart again:
    // leading digits win, and a component with none counts as 0.
    expect(compareVersions("0.1.2abc", "0.1.2")).toBe(0);
    expect(compareVersions("0.1.x", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.x", "0.1.1")).toBe(-1);
  });
  it("suffixes are invisible, so a pre-release compares equal to its release", () => {
    // Documented limitation rather than a bug: this project publishes plain vX.Y.Z tags only.
    expect(compareVersions("0.1.2-rc1", "0.1.2")).toBe(0);
    expect(compareVersions("0.1.2-rc1", "0.1.1")).toBe(1);
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

  it("accepts the same auto/oss/github environment contract as the installers", () => {
    expect(parseDownloadSource(undefined)).toBe("auto");
    expect(parseDownloadSource("auto")).toBe("auto");
    expect(parseDownloadSource("oss")).toBe("oss");
    expect(parseDownloadSource("github")).toBe("github");
    expect(parseDownloadSource("OSS")).toBeNull();
    expect(parseDownloadSource("mirror")).toBeNull();
  });

  it("accepts only absolute HTTPS mirror bases and removes trailing slashes", () => {
    expect(normalizeHttpsBaseUrl("https://mirror.example/releases/v0.2.1/")).toBe(
      "https://mirror.example/releases/v0.2.1",
    );
    expect(normalizeHttpsBaseUrl("http://mirror.example/releases/v0.2.1")).toBeNull();
    expect(normalizeHttpsBaseUrl("/releases/v0.2.1")).toBeNull();
    expect(normalizeHttpsBaseUrl(undefined)).toBeNull();
  });

  it("an explicit mirror is one strict installer candidate with its configured fallback", () => {
    expect(
      configuredInstallerCandidate(
        "https://mirror.example/releases/v0.2.1",
        "https://backup.example/releases/v0.2.1",
      ),
    ).toEqual({
      source: "configured",
      baseUrl: "https://mirror.example/releases/v0.2.1",
      url: "https://mirror.example/releases/v0.2.1/install.sh",
      fallbackBaseUrl: "https://backup.example/releases/v0.2.1",
    });
  });

  it("validates latest.json's schema, tag, and fixed OSS release base", () => {
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

  it("auto discovers latest through OSS without touching GitHub when metadata is valid", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(manifest), { status: 200 });
    };
    await expect(resolveRelease("auto", undefined, t, fetcher)).resolves.toMatchObject({
      tag: "v0.2.1",
      discoveredFrom: "oss",
    });
    expect(calls).toEqual([`${ossOrigin}/latest.json`]);
  });

  it("auto falls back to GitHub discovery when OSS metadata is unavailable", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url === `${ossOrigin}/latest.json`) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ tag_name: "v0.2.2" }), { status: 200 });
    };
    await expect(resolveRelease("auto", undefined, t, fetcher)).resolves.toEqual({
      version: "0.2.2",
      tag: "v0.2.2",
      discoveredFrom: "github",
    });
    expect(calls).toEqual([`${ossOrigin}/latest.json`, githubApi]);
  });

  it("forced oss is strict, while forced github skips OSS", async () => {
    const ossCalls: string[] = [];
    const unavailable = async (url: string) => {
      ossCalls.push(url);
      return new Response("unavailable", { status: 503 });
    };
    await expect(resolveRelease("oss", undefined, t, unavailable)).rejects.toThrow(
      t.update.ossUnavailable(),
    );
    expect(ossCalls).toEqual([`${ossOrigin}/latest.json`]);

    const githubCalls: string[] = [];
    const github = async (url: string) => {
      githubCalls.push(url);
      return new Response(JSON.stringify({ tag_name: "v0.2.2" }), { status: 200 });
    };
    await expect(resolveRelease("github", undefined, t, github)).resolves.toMatchObject({
      tag: "v0.2.2",
      discoveredFrom: "github",
    });
    expect(githubCalls).toEqual([githubApi]);
  });

  it("a requested release skips discovery and produces same-tag source candidates", async () => {
    let fetched = false;
    const shouldNotFetch = async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    };
    const release = await resolveRelease("auto", "0.2.0", t, shouldNotFetch);
    expect(fetched).toBe(false);
    expect(installerCandidates("auto", release)).toEqual([
      {
        source: "oss",
        baseUrl: `${ossOrigin}/releases/v0.2.0`,
        url: `${ossOrigin}/releases/v0.2.0/install.sh`,
      },
      {
        source: "github",
        baseUrl: "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0",
        url: "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0/install.sh",
      },
    ]);
  });

  it("auto stays on GitHub when OSS latest discovery failed", () => {
    const release = {
      version: "0.2.2",
      tag: "v0.2.2",
      discoveredFrom: "github" as const,
    };
    expect(installerCandidates("auto", release).map((candidate) => candidate.source)).toEqual([
      "github",
    ]);
    expect(installerCandidates("github", release).map((candidate) => candidate.source)).toEqual([
      "github",
    ]);
    expect(installerCandidates("oss", release).map((candidate) => candidate.source)).toEqual([
      "oss",
    ]);
  });

  it("installer transport failure falls back to the matching GitHub tag", async () => {
    const release = parseOssLatestManifest(manifest);
    expect(release).not.toBeNull();
    const candidates = installerCandidates("auto", release!);
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return url.includes("aliyuncs.com")
        ? new Response("unavailable", { status: 503 })
        : new Response("#!/bin/sh\n", { status: 200 });
    };
    const downloaded = await downloadInstaller(candidates, fetcher);
    expect(downloaded?.candidate.source).toBe("github");
    expect(downloaded?.script).toBe("#!/bin/sh\n");
    expect(calls).toEqual(candidates.map((candidate) => candidate.url));
  });
});

describe("buildInstallerInvocation (preserves the shape of the install being upgraded)", () => {
  const base = {
    scriptPath: "/tmp/penguin-install-1.sh",
    defaultInstallDir: "/home/me/.penguin",
  };

  it("default dir + bundled runtime: no flags, no env", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/home/me/.penguin",
        hasBundledNode: true,
      }),
    ).toEqual({ args: ["/tmp/penguin-install-1.sh"], env: {} });
  });

  it("no bundled node/ means the universal package: pass --universal so the runtime is not silently added", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/home/me/.penguin",
        hasBundledNode: false,
      }),
    ).toEqual({ args: ["/tmp/penguin-install-1.sh", "--universal"], env: {} });
  });

  it("a non-default install dir is passed through, or the upgrade would relocate the install", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/opt/penguin",
        hasBundledNode: true,
      }),
    ).toEqual({
      args: ["/tmp/penguin-install-1.sh"],
      env: { PENGUIN_INSTALL_DIR: "/opt/penguin" },
    });
  });

  it("a pinned version becomes PENGUIN_VERSION, always v-prefixed for the release tag", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/home/me/.penguin",
        hasBundledNode: true,
        version: "0.1.2",
      }).env,
    ).toEqual({ PENGUIN_VERSION: "v0.1.2" });
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/home/me/.penguin",
        hasBundledNode: true,
        version: "v0.1.2",
      }).env,
    ).toEqual({ PENGUIN_VERSION: "v0.1.2" });
  });

  it("all three at once: custom dir, universal package, pinned version", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/opt/penguin",
        hasBundledNode: false,
        version: "v0.2.0",
      }),
    ).toEqual({
      args: ["/tmp/penguin-install-1.sh", "--universal"],
      env: { PENGUIN_INSTALL_DIR: "/opt/penguin", PENGUIN_VERSION: "v0.2.0" },
    });
  });

  it("passes an explicit mirror and same-version fallback through to the child installer", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/home/me/.penguin",
        hasBundledNode: true,
        version: "0.2.0",
        downloadBaseUrl:
          "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0",
        downloadFallbackBaseUrl:
          "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0",
      }).env,
    ).toEqual({
      PENGUIN_VERSION: "v0.2.0",
      PENGUIN_DOWNLOAD_BASE_URL:
        "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0",
      PENGUIN_DOWNLOAD_FALLBACK_BASE_URL:
        "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0",
    });
  });

  it("explicitly clears inherited payload source locks for delegated auto selection", () => {
    expect(
      buildInstallerInvocation({
        ...base,
        installDir: "/home/me/.penguin",
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

  it("keeps explicit mirrors strict but delegates non-explicit payload source selection", () => {
    const candidate = {
      source: "oss" as const,
      baseUrl: "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0",
      url: "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0/install.sh",
      fallbackBaseUrl: "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0",
    };
    expect(payloadSourceEnv(candidate, true)).toEqual({
      downloadBaseUrl:
        "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.2.0",
      downloadFallbackBaseUrl:
        "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.2.0",
    });
    expect(payloadSourceEnv(candidate, false)).toEqual({
      downloadBaseUrl: "",
      downloadFallbackBaseUrl: "",
    });
  });

  it("localizes the source list and connector in installer download failures", () => {
    expect(getMessages("en").update.installerFetchFailed(["oss", "github"])).toBe(
      "Could not download the installer from the OSS mirror or GitHub. Check your network and retry.",
    );
    expect(getMessages("zh").update.installerFetchFailed(["oss"])).toBe(
      "无法从 OSS 镜像下载安装脚本。请检查网络后重试。",
    );
    expect(getMessages("zh").update.installerFetchFailed(["github"])).toBe(
      "无法从 GitHub 下载安装脚本。请检查网络后重试。",
    );
    expect(getMessages("zh").update.installerFetchFailed(["oss", "github"])).toBe(
      "无法从 OSS 镜像或 GitHub 下载安装脚本。请检查网络后重试。",
    );
    expect(getMessages("zh").update.installerFetchFailed(["configured"])).toBe(
      "无法从配置的镜像下载安装脚本。请检查网络后重试。",
    );
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
  const desktop = { kind: "desktop" } as const;
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
    expect(planUpdate({ ...base, target: "0.1.1", check: true, install: tarball })).toMatchObject({
      action: "report",
      comparison: 0,
    });
    expect(planUpdate({ ...base, check: true, install: { kind: "source" } }).action).toBe("report");
  });

  it("an install already on the target exits without touching anything", () => {
    expect(planUpdate({ ...base, target: "0.1.1", install: tarball })).toEqual({
      action: "up-to-date",
      current: "0.1.1",
    });
    // Decided before the layout matters: even an unknown install is simply up to date.
    expect(planUpdate({ ...base, target: "v0.1.1", install: { kind: "unknown" } }).action).toBe(
      "up-to-date",
    );
  });

  it("a source checkout is refused, because overwriting a working tree destroys work", () => {
    expect(planUpdate({ ...base, install: { kind: "source" } })).toEqual({
      action: "refuse",
      reason: "source",
    });
  });

  it("the desktop app is refused: it replaces its bundled CLI when the app updates", () => {
    expect(planUpdate({ ...base, install: desktop })).toEqual({
      action: "refuse",
      reason: "desktop",
    });
  });

  it("an unrecognised layout is refused and names the path it was running from", () => {
    expect(
      planUpdate({ ...base, modulePath: "/random/place/index.js", install: { kind: "unknown" } }),
    ).toEqual({
      action: "refuse",
      reason: "unknown-install",
      modulePath: "/random/place/index.js",
    });
  });

  it("a global install upgrades through its own manager", () => {
    expect(planUpdate({ ...base, install: npmGlobal })).toEqual({
      action: "npm",
      manager: "npm",
      command: "npm",
      args: ["install", "-g", "@prismshadow/penguin-cli@0.1.2"],
    });
  });

  it("a global install with an unidentifiable manager is refused rather than guessed", () => {
    expect(planUpdate({ ...base, install: { kind: "npm", globalRoot: "/weird/place" } })).toEqual({
      action: "refuse",
      reason: "unknown-manager",
      globalRoot: "/weird/place",
      target: "0.1.2",
    });
  });

  it("a tarball install re-runs the installer at the dir it was detected in", () => {
    expect(planUpdate({ ...base, install: tarball })).toEqual({
      action: "tarball",
      installDir: "/home/me/.penguin",
    });
    expect(
      planUpdate({ ...base, install: { kind: "tarball", installDir: "/opt/penguin" } }),
    ).toEqual({ action: "tarball", installDir: "/opt/penguin" });
    // No installDir on the info (shouldn't happen, but the fallback is the default install dir).
    expect(planUpdate({ ...base, install: { kind: "tarball" } })).toEqual({
      action: "tarball",
      installDir: "/home/me/.penguin",
    });
  });

  it("Windows is refused on the tarball path: the installer is a POSIX shell script", () => {
    expect(planUpdate({ ...base, platform: "win32", install: tarball })).toEqual({
      action: "refuse",
      reason: "windows-installer",
    });
  });

  it("Windows is refused on the npm path too, handing over the exact command to run", () => {
    // spawn() cannot run a .cmd shim without a shell, so this must not reach the spawn and
    // fail with a generic message.
    expect(planUpdate({ ...base, platform: "win32", install: npmGlobal })).toEqual({
      action: "refuse",
      reason: "windows-global",
      command: "npm install -g @prismshadow/penguin-cli@0.1.2",
    });
  });

  it("every refusal has a message in both languages", () => {
    const plans = [
      planUpdate({ ...base, install: { kind: "source" } }),
      planUpdate({ ...base, install: { kind: "unknown" } }),
      planUpdate({ ...base, install: { kind: "npm", globalRoot: "/weird/place" } }),
      planUpdate({ ...base, platform: "win32", install: tarball }),
      planUpdate({ ...base, platform: "win32", install: npmGlobal }),
    ];
    for (const lang of ["en", "zh"] as const) {
      const t = getMessages(lang);
      expect(plans.map((p) => p.action)).toEqual(Array(plans.length).fill("refuse"));
      expect(t.update.sourceCheckout()).toBeTruthy();
      expect(t.update.unknownInstall("/x")).toContain("/x");
      expect(t.update.npmUnknownManager("/weird/place", "0.1.2")).toContain("/weird/place");
      expect(t.update.windowsUnsupported()).toBeTruthy();
      // The Windows global-install message is only useful if it carries the command verbatim.
      expect(t.update.windowsGlobalInstall("pnpm add -g pkg@1")).toContain("pnpm add -g pkg@1");
    }
  });
});
