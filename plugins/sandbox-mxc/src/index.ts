/**
 * @prismshadow/penguin-plugin-sandbox-mxc — a Windows sandbox backend over Microsoft
 * MXC (Microsoft eXecution Containers).
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page
 * and the harness resolves it from the installation. It compiles against the
 * `@prismshadow/penguin-core/plugin` surface (types, plus the decorators its bundle
 * carries) and has no runtime dependency on the
 * harness or on any other backend.
 *
 * WHY THIS EXISTS: Windows has no bubblewrap and no sandbox-exec, and the DSH adaptor's
 * Windows rung (restricted tokens + ACLs) governs file writes only. MXC's
 * `processcontainer` backend is the one mechanism that expresses all three dimensions
 * of this harness's sandbox interface on Windows, and it maps onto them directly:
 *
 *   fs-write    → filesystem.readwritePaths / readonlyPaths
 *   mask-paths  → filesystem.deniedPaths
 *   network     → network.allowOutbound: false  (MXC's default is already deny)
 *
 * WINDOWS ONLY, deliberately. MXC also carries Linux (bubblewrap/LXC) and macOS
 * (Seatbelt) backends, but this harness already ships native, live-verified plugins for
 * those; declaring them here too would only add an untested second path to a solved
 * problem. On any non-Windows host this backend declines and the routing moves on.
 *
 * The SDK is an OPTIONAL PEER DEPENDENCY, loaded through a dynamic import for the same
 * reason the DSH adaptor loads its chain that way: it carries ~40MB of per-platform
 * binaries plus a native pty module, so only a deployment that actually wants it pays
 * for it, and an installation missing it surfaces as an unavailable capability (the
 * sandbox service then fails closed for a confining policy) rather than a broken boot.
 *
 * COUPLING SURFACE, stated because MXC is Public Preview and its schema may move before
 * 1.0. Beyond the published `buildSandboxPayload`/`getPlatformSupport` API this backend
 * relies on exactly two internals, both verified against 0.7.0 and both asserted in the
 * tests: the runner is `bin/<arch>/wxc-exec.exe` inside the SDK package, and it takes
 * the whole config as `--config-base64 <base64 JSON>` with the command inside the
 * config (which is what lets an argv-rewriting seam host it at all — there is no
 * trailing argv to append).
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import type {
  ConfinedArgv,
  Plugin,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";

/** Default probe budget; a probe that hangs must not hang the first spawn forever. */
const PROBE_TIMEOUT_MS = 5_000;
/** The smoke run starts a whole shell, so it is given more room than the runner's own probe. */
const SMOKE_TIMEOUT_MS = 20_000;

/** The MXC policy schema this backend writes. Pinned: a preview schema is a moving target. */
const MXC_POLICY_VERSION = "0.7.0-alpha";

/** The narrow slice of the MXC SDK this backend uses (see the coupling note above). */
export interface MxcSdk {
  buildSandboxPayload(
    script: string,
    policy: Record<string, unknown>,
    workingDirectory?: string,
    containerName?: string,
    containment?: string,
  ): Record<string, unknown>;
}

/** Test seams: inject the SDK, the runner path, the probe verdict and the smoke result. */
export interface MxcInternals {
  sdk?: MxcSdk;
  runnerPath?: string;
  probe?: (runner: string, timeoutMs: number) => boolean;
  platform?: NodeJS.Platform;
  /** The exit code of the load-time smoke run (see smokeShell), or null when it never ran. */
  smoke?: (runner: string, sdk: MxcSdk) => number | null;
  /** The shell the smoke run starts; defaults to the one the harness would spawn. */
  shell?: ShellCommand;
}

/** A shell as it is invoked: the program, then the arguments before the command string. */
export interface ShellCommand {
  command: string;
  args: string[];
}

/** Windows' STATUS_DLL_INIT_FAILED: a process died while loading its DLLs, before running anything. */
export const STATUS_DLL_INIT_FAILED = 0xc0000142;

/**
 * The shell the harness will hand this backend to confine, resolved the way core's
 * `resolveShell` does on Windows (packages/core/src/environment/tools/command/shell.ts):
 * `PENGUIN_SHELL`, else the first `bash` on PATH that is not the WSL launcher under
 * System32, else the bundled MinGit shell, else pwsh, else Windows PowerShell. Only the
 * program matters here — the smoke run below starts it with a command that does nothing.
 */
export function smokeShell(env: NodeJS.ProcessEnv = process.env): ShellCommand {
  const explicit = env.PENGUIN_SHELL?.trim();
  if (explicit !== undefined && explicit !== "") return { command: explicit, args: ["-lc"] };
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  const found = spawnSync("where", ["bash"], { encoding: "utf8", windowsHide: true });
  const bash = (found.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (bash !== undefined && !bash.toLowerCase().startsWith(`${systemRoot.toLowerCase()}\\`)) {
    return { command: bash, args: ["-lc"] };
  }
  const bundled = env.PENGUIN_BUNDLED_SHELL?.trim();
  if (bundled !== undefined && bundled !== "") return { command: bundled, args: ["-lc"] };
  const pwsh = spawnSync("where", ["pwsh"], { encoding: "utf8", windowsHide: true });
  const command = pwsh.status === 0 ? "pwsh" : "powershell";
  return { command, args: ["-NoLogo", "-NoProfile", "-Command"] };
}

/**
 * Starts the shell inside a container and returns its exit code (null when the runner itself
 * could not be run). MXC confines with an AppContainer, and an AppContainer denies the global
 * object namespace — so an MSYS2 shell (Git Bash, the harness's first choice on Windows) dies
 * at STATUS_DLL_INIT_FAILED before its first instruction, while creating its
 * `\BaseNamedObjects\msys-*` directory. No policy and no file permission reaches that, which
 * is why the shell is tried here rather than left to fail on every command the agent runs.
 */
function defaultSmoke(runner: string, sdk: MxcSdk, shell: ShellCommand): number | null {
  const argv = [shell.command, ...shell.args, "exit 0"];
  const config = sdk.buildSandboxPayload(
    toCommandLine(argv),
    mxcPolicyFor({ mode: "read-only", workspaceRoot: os.tmpdir(), writableTemp: true }),
    os.tmpdir(),
    undefined,
    "process",
  );
  const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  const run = spawnSync(runner, ["--config-base64", encoded], {
    timeout: SMOKE_TIMEOUT_MS,
    stdio: "ignore",
    windowsHide: true,
  });
  return run.error !== undefined ? null : run.status;
}

/** What to do about a shell that cannot start in a container, as the settings card will say it. */
export function smokeFailureReason(shell: ShellCommand, status: number): string {
  if (status === STATUS_DLL_INIT_FAILED) {
    return (
      `the shell '${shell.command}' cannot start inside a Windows container: it died while ` +
      "loading its DLLs (STATUS_DLL_INIT_FAILED, 0xC0000142). A confined command runs as an " +
      "AppContainer identity, which is denied the global object namespace, and an MSYS2 shell " +
      "(Git Bash) needs a directory there — `NtCreateDirectoryObject(\\BaseNamedObjects\\msys-*)` " +
      "returns access denied. No sandbox policy or file permission grants it, so confinement on " +
      "this host needs a shell that does not need one (cmd.exe runs), set through PENGUIN_SHELL."
    );
  }
  return `the shell '${shell.command}' exited ${status} inside a test container, so no confined command would run`;
}

/** The directories a Windows process writes temp files to: %TEMP%, %TMP% and os.tmpdir(), deduplicated. */
export function temporaryDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ...new Set(
      [env.TEMP, env.TMP, os.tmpdir()]
        .filter((d): d is string => typeof d === "string" && d !== "")
        .map((d) => path.resolve(d)),
    ),
  ];
}

/**
 * Quotes one argument the way `CommandLineToArgvW` parses it, so the argv the harness
 * handed us survives the round trip through MXC's single `commandLine` string. The
 * backslash rules are the fiddly part: a run of backslashes is only doubled when it
 * precedes a quote (a closing one included), which is why the two cases below differ.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg.length > 0 && !/[ \t\n\v"]/.test(arg)) return arg;
  let quoted = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      quoted += "\\".repeat(backslashes) + char;
    }
    backslashes = 0;
  }
  quoted += "\\".repeat(backslashes * 2) + '"';
  return quoted;
}

/** The argv the harness is about to spawn, as one Windows command line. */
export function toCommandLine(argv: readonly string[]): string {
  return argv.map(quoteWindowsArg).join(" ");
}

/** The MXC SandboxPolicy for one harness policy: the three dimensions, mapped. */
export function mxcPolicyFor(
  policy: SandboxPolicy,
  tempDirs: readonly string[] = temporaryDirs(),
): Record<string, unknown> {
  // MXC grants nothing it is not told to: without the temp directory a Git Bash (MSYS2)
  // shell fails while loading its runtime, before it runs anything (0xC0000142).
  const readwritePaths = [
    ...new Set([
      ...(policy.mode === "workspace-write" ? [policy.workspaceRoot] : []),
      ...(policy.writableTemp === true ? tempDirs : []),
    ]),
  ];
  return {
    version: MXC_POLICY_VERSION,
    filesystem: {
      // The whole volume readable, the workspace writable under workspace-write, and
      // the masked paths denied outright — MXC's deniedPaths outranks the grants above.
      readonlyPaths: [path.parse(path.resolve(policy.workspaceRoot)).root],
      readwritePaths,
      deniedPaths: [...(policy.maskPaths ?? [])],
    },
    // MXC defaults to deny; say it explicitly so the intent survives a schema default change.
    network: { allowOutbound: policy.network === "none" ? false : true },
  };
}

/** The runner shipped inside the installed SDK: bin/<arch>/wxc-exec.exe. */
export function resolveRunner(requireFrom: NodeRequire = createRequire(import.meta.url)): string {
  const manifest = requireFrom.resolve("@microsoft/mxc-sdk/package.json");
  return path.join(path.dirname(manifest), "bin", process.arch, "wxc-exec.exe");
}

/** Functional probe: the runner answers `--probe` on a host where it can actually confine. */
function defaultProbe(runner: string, timeoutMs: number): boolean {
  const probe = spawnSync(runner, ["--probe"], { timeout: timeoutMs, stdio: "ignore" });
  return probe.status === 0;
}

/** This backend's own settings, as it reads them from its group. */
export interface MxcSettings {
  /** A runner path to use instead of the one the MXC SDK ships; null for the SDK's. */
  runner: string | null;
}

/** Its group's stored document as settings; an empty runner means the SDK's own. */
export function mxcSettingsOf(doc: Record<string, unknown>): MxcSettings {
  const runner = typeof doc.runner === "string" ? doc.runner.trim() : "";
  return { runner: runner !== "" ? runner : null };
}

/**
 * What this backend requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
export abstract class MxcConfigReader extends Interface<{
  get(name: string): Record<string, unknown>;
}>() {}

/** The settings group this backend declares (its contribution id), drawn inside the Sandbox card. */
export const MXC_GROUP = "sandbox-mxc";

/**
 * Loads the backend, checking first that it can serve on this host — and rejecting, with the
 * reason, when it cannot: a non-Windows host, an installation without the optional SDK, a
 * runner that reports no usable containment, or a shell that cannot start inside one. The sandbox service records the rejection and the
 * settings page shows it, so the backend is never silently absent, and a host where MXC cannot
 * contain is known at load rather than discovered by the first command.
 */
export async function loadMxcProvider(
  internals: MxcInternals = {},
  settings: () => MxcSettings = () => ({ runner: null }),
): Promise<SandboxProvider | null> {
  const platform = internals.platform ?? process.platform;
  // Not this host's backend: a decline, not a failure (see penguin-bwrap's loader).
  if (platform !== "win32") return null;
  let sdk: MxcSdk;
  let runner: string;
  try {
    sdk = internals.sdk ?? ((await import("@microsoft/mxc-sdk")) as unknown as MxcSdk);
    runner = internals.runnerPath ?? resolveRunner();
  } catch (err) {
    throw new Error(
      `@microsoft/mxc-sdk is not installed (an optional peer dependency of this backend): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const probe = internals.probe ?? defaultProbe;
  // Checked with the runner the settings name, the one the first command would use.
  const checked = settings().runner ?? runner;
  const usable = internals.probe
    ? internals.probe(checked, PROBE_TIMEOUT_MS)
    : await new Promise<boolean>((resolve) => {
        execFile(checked, ["--probe"], { timeout: PROBE_TIMEOUT_MS }, (err) =>
          resolve(err === null),
        );
      });
  if (!usable) {
    throw new Error(`the MXC runner '${checked}' is missing or reports no usable containment`);
  }
  // The runner containing SOMETHING is not the same as this host's shell being able to run
  // inside it, so the shell itself is started once, here.
  const shell = internals.shell ?? smokeShell();
  const status = internals.smoke
    ? internals.smoke(checked, sdk)
    : defaultSmoke(checked, sdk, shell);
  if (status !== 0 && status !== null) throw new Error(smokeFailureReason(shell, status));
  return createMxcProvider(sdk, runner, probe, settings);
}

/**
 * The backend itself, over an already-resolved SDK and default runner (the unit-testable
 * core). It reads its settings at each confine; the probe is cached per runner, so a runner
 * set in them is checked once, at the first spawn that uses it.
 */
export function createMxcProvider(
  sdk: MxcSdk,
  defaultRunner: string,
  probe: (runner: string, timeoutMs: number) => boolean = defaultProbe,
  settings: () => MxcSettings = () => ({ runner: null }),
): SandboxProvider {
  const usable = new Map<string, boolean>();
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      const runner = settings().runner ?? defaultRunner;
      if (!usable.has(runner)) usable.set(runner, probe(runner, PROBE_TIMEOUT_MS));
      if (!usable.get(runner)) {
        throw new Error(
          "penguin-mxc cannot confine on this host: the MXC runner is missing or reports no " +
            "usable containment; refusing to run the command unconfined.",
        );
      }
      const config = sdk.buildSandboxPayload(
        // The command travels INSIDE the config — MXC takes no trailing argv, which is
        // exactly what lets this argv-rewriting seam host it.
        toCommandLine(argv),
        mxcPolicyFor(policy),
        policy.workspaceRoot,
        undefined,
        "process",
      );
      const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
      return {
        argv: [runner, "--config-base64", encoded],
        // processcontainer enforces the policy it accepts; MXC reports its own inability
        // through the probe and through structured errors, not by confining less.
        enforcement: "full",
        // Win32 denial dialects: cmd, PowerShell/.NET, and Node's own EACCES text.
        denialSignatures: ["access is denied", "access to the path", "permission denied"],
        runnerFailureRules: [{ fatalSignatures: ["wxc-exec", "mxc error"] }],
      };
    },
  };
}

/**
 * The plugin's one module: a provider on the sandbox slot, the code half of the
 * contribution the decorator declares (its manifest is generated into ifaces.json from
 * here). Created per App, so a hot swap gets a fresh provider.
 */
@Component({
  contributes: {
    "SandboxModule.providers": [
      {
        id: "sandbox-mxc.provider",
        name: "penguin-mxc",
        dimensions: ["fs-write", "network", "mask-paths"],
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "sandbox-mxc",
        parent: "sandbox",
        title: "MXC",
        properties: {
          runner: {
            type: "string",
            title: "wxc-exec program",
            titleZh: "wxc-exec 程序",
            description: "A path to the MXC runner; empty uses the one the MXC SDK ships.",
            descriptionZh: "MXC 运行器的路径；留空则使用 MXC SDK 自带的那个。",
            placeholder: "wxc-exec.exe",
          },
        },
      },
    ],
  },
})
export class SandboxMxc {
  @Use() private readonly config!: MxcConfigReader;
  @Bind("sandbox-mxc.provider") provider!: SandboxProviderSource;

  setup() {
    const config = this.config;
    this.provider = loadMxcProvider({}, () => mxcSettingsOf(config.get(MXC_GROUP)));
  }
}

const plugin: Plugin = { modules: [SandboxMxc] };
export default plugin;
