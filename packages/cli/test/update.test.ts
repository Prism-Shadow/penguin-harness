/**
 * `penguin update`'s pure pieces: install-kind detection over the three real layouts, package-
 * manager identification for global installs, version normalisation/comparison, the installer
 * argv/env built for each combination of install dir and bundled runtime, and the decision the
 * command makes before it touches anything (planUpdate) plus its confirmation gate.
 *
 * No network and no filesystem mutation — every function under test takes its inputs as arguments.
 */
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import {
  buildInstallerInvocation,
  compareVersions,
  confirmationMode,
  detectInstall,
  detectPackageManager,
  globalInstallCommand,
  installerUrl,
  normalizeVersion,
  planUpdate,
  registerUpdateCommand,
} from "../src/commands/update.js";
import { getMessages } from "../src/i18n.js";

describe("detectInstall (how this CLI was installed, from its own real path)", () => {
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
});

describe("detectPackageManager (which manager owns a global node_modules root)", () => {
  it("pnpm: the global store or the .pnpm virtual dir", () => {
    expect(detectPackageManager("/home/me/.local/share/pnpm/global/5/node_modules")).toBe("pnpm");
    expect(
      detectPackageManager("/home/me/.local/share/pnpm/global/5/node_modules/.pnpm/x/node_modules"),
    ).toBe("pnpm");
  });
  it("npm: the usual prefixes", () => {
    expect(detectPackageManager("/usr/local/lib/node_modules")).toBe("npm");
    expect(detectPackageManager("/home/me/.npm-global/lib/node_modules")).toBe("npm");
  });
  it("yarn and bun", () => {
    expect(detectPackageManager("/home/me/.config/yarn/global/node_modules")).toBe("yarn");
    expect(detectPackageManager("/home/me/.bun/install/global/node_modules")).toBe("bun");
  });
  it("returns null when unrecognizable, so the caller prints a command instead of guessing", () => {
    expect(detectPackageManager("/weird/place")).toBeNull();
    expect(detectPackageManager("")).toBeNull();
  });
});

describe("globalInstallCommand", () => {
  it("uses each manager's own global-install spelling", () => {
    expect(globalInstallCommand("pnpm", "0.1.2")).toEqual({
      command: "pnpm",
      args: ["add", "-g", "@prismshadow/penguin-cli@0.1.2"],
    });
    expect(globalInstallCommand("npm", "0.1.2")).toEqual({
      command: "npm",
      args: ["install", "-g", "@prismshadow/penguin-cli@0.1.2"],
    });
    expect(globalInstallCommand("yarn", "0.1.2")).toEqual({
      command: "yarn",
      args: ["global", "add", "@prismshadow/penguin-cli@0.1.2"],
    });
    expect(globalInstallCommand("bun", "0.1.2")).toEqual({
      command: "bun",
      args: ["add", "-g", "@prismshadow/penguin-cli@0.1.2"],
    });
  });
});

describe("normalizeVersion / compareVersions", () => {
  it("accepts both v-prefixed and bare tags", () => {
    expect(normalizeVersion("v0.1.2")).toBe("0.1.2");
    expect(normalizeVersion("0.1.2")).toBe("0.1.2");
    expect(normalizeVersion("  V0.1.2 ")).toBe("0.1.2");
  });
  it("equal versions compare equal regardless of the v prefix", () => {
    expect(compareVersions("v0.1.1", "0.1.1")).toBe(0);
  });
  it("orders newer above older, including across component widths", () => {
    expect(compareVersions("0.1.2", "0.1.1")).toBe(1);
    expect(compareVersions("0.1.1", "0.1.2")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
  });
  it("treats a missing component as 0", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.1", "1.0.9")).toBe(1);
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

describe("installerUrl", () => {
  it("resolves the latest release when no version is pinned", () => {
    expect(installerUrl()).toBe(
      "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh",
    );
  });
  it("pins a tag, normalising the v prefix", () => {
    const expected =
      "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.1.2/install.sh";
    expect(installerUrl("0.1.2")).toBe(expected);
    expect(installerUrl("v0.1.2")).toBe(expected);
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

  it("--check reports the comparison and never upgrades, even when one is available", () => {
    expect(planUpdate({ ...base, check: true, install: tarball })).toEqual({
      action: "report",
      current: "0.1.1",
      target: "0.1.2",
      comparison: 1,
    });
  });

  it("--check reports a downgrade and an up-to-date install without upgrading either", () => {
    expect(planUpdate({ ...base, target: "0.1.0", check: true, install: tarball })).toMatchObject({
      action: "report",
      comparison: -1,
    });
    expect(planUpdate({ ...base, target: "0.1.1", check: true, install: tarball })).toMatchObject({
      action: "report",
      comparison: 0,
    });
  });

  it("--check reports even from a source checkout, where an upgrade would be refused", () => {
    // Reporting changes nothing, so the layout must not gate it.
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

describe("confirmationMode (the gate in front of every upgrade)", () => {
  it("--yes proceeds without a prompt, interactive or not", () => {
    expect(confirmationMode(true, true)).toBe("proceed");
    expect(confirmationMode(true, false)).toBe("proceed");
  });
  it("a non-TTY without --yes demands --yes instead of hanging on a prompt nobody can answer", () => {
    expect(confirmationMode(undefined, false)).toBe("needs-yes");
    expect(confirmationMode(false, false)).toBe("needs-yes");
    expect(getMessages("en").update.needsYes()).toContain("--yes");
    expect(getMessages("zh").update.needsYes()).toContain("--yes");
  });
  it("a terminal without --yes gets the interactive prompt", () => {
    expect(confirmationMode(undefined, true)).toBe("prompt");
  });
});

describe("command registration", () => {
  it("registers `update` with its three options in both languages", () => {
    for (const lang of ["en", "zh"] as const) {
      const program = new Command();
      registerUpdateCommand(program, getMessages(lang));
      const cmd = program.commands.find((c) => c.name() === "update");
      expect(cmd).toBeDefined();
      const flags = cmd?.options.map((o) => o.flags) ?? [];
      expect(flags).toContain("--check");
      expect(flags).toContain("--release <tag>");
      expect(flags).toContain("-y, --yes");
      expect(cmd?.description()).toBeTruthy();
    }
  });
});
