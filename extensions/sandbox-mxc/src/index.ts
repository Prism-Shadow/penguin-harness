/**
 * @prismshadow/penguin-extension-sandbox-mxc — a Windows sandbox backend over Microsoft
 * MXC (Microsoft eXecution Containers).
 *
 * A PLUGIN PACKAGE, not part of the platform: a deployment lists it in extensions.json and
 * the harness resolves it from the installation. It compiles against the type-only
 * `@prismshadow/penguin-server/extension` surface and has no runtime dependency on the
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
 * (Seatbelt) backends, but this harness already ships native, live-verified extensions for
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
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  ConfinedArgv,
  ExtensionContext,
  SandboxPolicy,
  SandboxProvider,
} from "@prismshadow/penguin-server/extension";

/** Default probe budget; a probe that hangs must not hang the first spawn forever. */
const PROBE_TIMEOUT_MS = 5_000;

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

/** Test seams: inject the SDK, the runner path, and the probe verdict. */
export interface MxcInternals {
  sdk?: MxcSdk;
  runnerPath?: string;
  probe?: (runner: string, timeoutMs: number) => boolean;
  platform?: NodeJS.Platform;
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
export function mxcPolicyFor(policy: SandboxPolicy): Record<string, unknown> {
  const readwritePaths = policy.mode === "workspace-write" ? [policy.workspaceRoot] : [];
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

/**
 * Loads the backend. Resolves to null where it cannot serve — a non-Windows host, or an
 * installation without the optional SDK — so the harness reports an unavailable
 * capability instead of a failure.
 */
export async function loadMxcProvider(
  internals: MxcInternals = {},
): Promise<SandboxProvider | null> {
  const platform = internals.platform ?? process.platform;
  if (platform !== "win32") return null;
  const sdk = internals.sdk ?? ((await import("@microsoft/mxc-sdk")) as unknown as MxcSdk);
  const runner = internals.runnerPath ?? resolveRunner();
  const probe = internals.probe ?? defaultProbe;
  return createMxcProvider(sdk, runner, probe);
}

/** The backend itself, over an already-resolved SDK and runner (the unit-testable core). */
export function createMxcProvider(
  sdk: MxcSdk,
  runner: string,
  probe: (runner: string, timeoutMs: number) => boolean = defaultProbe,
): SandboxProvider {
  let usable: boolean | undefined;
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      usable ??= probe(runner, PROBE_TIMEOUT_MS);
      if (!usable) {
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

/** The extension: registered per App creation, like every other backend. Default export = the extension. */
export function activate(ctx: ExtensionContext): void {
  // Backends register per App creation — a hot swap re-registers them into the fresh
  // registry — so the subscription is to the event, not a one-time registration here.
  ctx.on("initialize", (iface) => {
    iface.sandbox.registerProvider("penguin-mxc", loadMxcProvider());
  });
}
