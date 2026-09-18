/**
 * @prismshadow/penguin-plugin-sandbox-wsl — a Windows sandbox backend that confines in a Linux
 * distro: each agent command runs in a dedicated WSL2 distro, as an unprivileged account, under
 * bubblewrap.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page and the
 * harness resolves it from the installation. It compiles against the
 * `@prismshadow/penguin-core/plugin` surface and has no runtime dependency on the harness.
 *
 *   fs-write    → bwrap binds the Workspace (read-write or read-only) at its /mnt path; the
 *                 distro is read-only and every other Windows drive is hidden
 *   network     → `network: "none"` leaves the command in an empty network namespace
 *   mask-paths  → a tmpfs over a directory, /dev/null over a file
 *
 * WHAT MAKES IT A SANDBOX. WSL's interop lets a Linux process start a Windows program, and that
 * program is an ordinary host process: inside bwrap with the network cut, `cmd.exe` still wrote
 * to the Windows disk and reached the internet (measured on Windows 11, WSL 2.7). The distro
 * this backend sets up switches interop off in its /etc/wsl.conf, and `check` proves it stays
 * off. It is also why the distro is its own and not the person's Ubuntu.
 *
 * WHAT IT COSTS. Commands run in Linux, not in Git Bash: Windows toolchains (node.exe, git.exe)
 * cannot run confined, so the distro carries its own (the packages setting). A Windows path in
 * a command means nothing there; the Workspace is at `/mnt/<drive>/…`.
 *
 * SETUP. Installing WSL needs an administrator once: `installWsl` raises Windows' own consent
 * prompt for the script shipped in setup/. Everything after that runs as the harness's own
 * user: `initialize` downloads the base rootfs (Ubuntu by default, Alpine as the small option),
 * imports it, installs bubblewrap and the packages, and switches interop off, and `check` runs
 * real commands through the sandbox. Each reports the step it is on while it runs. Until the
 * distro exists, the backend declines to load and says so.
 */
import { fileURLToPath } from "node:url";
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type {
  ConfinedArgv,
  Plugin,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";
import { readHost, readState } from "./host.js";
import { launchJob, wslSettingsOf } from "./tasks.js";
import type { WslSettings } from "./tasks.js";

export { bwrapArgs, chdirRoots, linuxProgram, toLinuxPath } from "./profile.js";
export {
  launchJob,
  parseMinirootfs,
  parseUbuntuSums,
  provisionScript,
  resolveRelease,
  wslSettingsOf,
} from "./tasks.js";
export { Tasks, check, initialize, installWsl, remove } from "./tasks.js";
export type { BaseImage, CheckLine, TaskKind, TaskOutcome } from "./tasks.js";
export type { WslSettings } from "./tasks.js";

/** Where the launcher lives, beside this module in the built package. */
export function launcherPath(): string {
  return fileURLToPath(new URL("./launch.js", import.meta.url));
}

/** Test seams. */
export interface WslInternals {
  platform?: NodeJS.Platform;
  node?: string;
  launcher?: string;
}

/** Why the backend cannot serve yet, or null when it can. */
async function unavailable(settings: WslSettings): Promise<string | null> {
  const state = readState();
  if (state === null) {
    return "the sandbox distro is not initialized";
  }
  if (state.distro !== settings.distro) {
    return `the distro setting names ${settings.distro}, but ${state.distro} is the one initialized: initialize again`;
  }
  const host = await readHost();
  if (host.wsl !== "installed")
    return `WSL does not work on this machine: ${host.problem ?? "not installed"}`;
  if (!host.distros.some((d) => d.toLowerCase() === state.distro.toLowerCase())) {
    return `the distro ${state.distro} is gone from WSL: initialize again`;
  }
  return null;
}

/**
 * Loads the backend: on Windows only (elsewhere it declines — another backend serves), and only
 * once the distro exists. Until then it rejects with what is missing.
 */
export async function loadWslProvider(
  settings: () => WslSettings,
  internals: WslInternals = {},
): Promise<SandboxProvider | null> {
  if ((internals.platform ?? process.platform) !== "win32") return null;
  const reason = await unavailable(settings());
  if (reason !== null) throw new Error(reason);
  return createWslProvider(settings, internals);
}

export function createWslProvider(
  settings: () => WslSettings,
  internals: WslInternals = {},
): SandboxProvider {
  const node = internals.node ?? process.execPath;
  const launcher = internals.launcher ?? launcherPath();
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy: SandboxPolicy): ConfinedArgv {
      const state = readState();
      if (state === null) {
        throw new Error("penguin-wsl cannot confine: the sandbox distro is not initialized");
      }
      const job = launchJob(argv, policy, settings(), state);
      return {
        argv: [node, launcher, Buffer.from(JSON.stringify(job), "utf8").toString("base64")],
        // In the desktop app `node` is the app's own binary, which runs a script only with this.
        env: { ELECTRON_RUN_AS_NODE: "1" },
        enforcement: "full",
        denialSignatures: ["read-only file system", "permission denied", "operation not permitted"],
        runnerFailureRules: [{ fatalSignatures: ["penguin-wsl:", "bwrap: ", "Wsl/"] }],
      };
    },
  };
}

@Component({
  contributes: {
    "SandboxModule.providers": [
      {
        id: "sandbox-wsl.provider",
        name: "penguin-wsl",
        dimensions: ["fs-write", "network", "mask-paths"],
      },
    ],
  },
})
export class SandboxWsl {
  @Bind("sandbox-wsl.provider") provider!: SandboxProviderSource;

  setup() {
    this.provider = loadWslProvider(() => wslSettingsOf({}));
  }
}

const plugin: Plugin = { modules: [SandboxWsl] };
export default plugin;
