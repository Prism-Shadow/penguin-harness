/**
 * @prismshadow/penguin-plugin-sandbox-seatbelt — a macOS Seatbelt sandbox backend.
 *
 * A PLUGIN PACKAGE, not part of the platform: a deployment lists it in plugins.json and
 * the harness resolves it from the installation. It compiles against the type-only
 * `@prismshadow/penguin-core/plugin` surface and has no runtime dependency on the
 * harness or on any other backend.
 *
 * Seatbelt is the macOS counterpart to bubblewrap here, and it expresses all three
 * dimensions of the sandbox interface natively — as POLICY rules rather than mounts:
 *
 *   (allow default)                                 start from the host's world
 *   (deny file-write*)                              nothing is writable…
 *   (allow file-write* (literal "/dev/null") …)     …beyond the required sinks
 *   [workspace-write] (allow file-write* (subpath <root>) …)
 *   [network: none]   (deny network*)
 *   [mask-paths]      (deny file-read* file-write* (subpath <p>))
 *
 * Rule ORDER is the counterpart to bwrap's mount order: in SBPL the LAST matching rule
 * wins, so the mask denials are emitted after the write allowances — otherwise masking
 * a path inside the workspace would be overridden by the workspace's own allowance.
 *
 * Paths are canonicalized before they enter the profile: Seatbelt matches the real
 * filesystem path, and on macOS `/tmp` and `/var` are symlinks into `/private`, so an
 * uncanonicalized subpath rule silently matches nothing.
 *
 * `sandbox-exec` is deprecated by Apple but ships on every macOS; if it ever stops
 * working, the probe below is what turns that into a fail-closed refusal rather than an
 * unconfined run.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ConfinedArgv,
  PluginContext,
  SandboxPolicy,
  SandboxProvider,
} from "@prismshadow/penguin-core/plugin";

/** Default probe budget; a probe that hangs must not hang the first spawn forever. */
const PROBE_TIMEOUT_MS = 5_000;

/** The write sinks a confined process needs even under read-only. */
const REQUIRED_WRITE_SINKS = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/dtracehelper"];

/** Test seams: inject the probe verdict and the runner name. */
export interface SeatbeltInternals {
  probe?: (timeoutMs: number) => boolean;
  runner?: string;
}

/** Canonical path (symlinks resolved), falling back to a lexical resolve for paths that do not exist yet. */
export function canonicalPath(target: string): string {
  try {
    return realpathSync(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

/** The writable roots `workspace-write` grants: the workspace plus the temp areas, canonical and deduplicated. */
export function writableRoots(policy: SandboxPolicy): string[] {
  if (policy.mode !== "workspace-write") return [];
  return [...new Set([policy.workspaceRoot, "/tmp", tmpdir()].map(canonicalPath))];
}

/** Quote one path as an SBPL string literal. */
function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The SBPL profile for one policy: the exact text handed to `sandbox-exec -p`. */
export function seatbeltProfile(policy: SandboxPolicy): string {
  const forms = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${REQUIRED_WRITE_SINKS.map((sink) => `(literal ${sbplString(sink)})`).join(" ")})`,
  ];
  const roots = writableRoots(policy);
  if (roots.length > 0) {
    forms.push(
      `(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`,
    );
  }
  if (policy.network === "none") {
    // Seatbelt filters network natively: no sockets at all, outbound or inbound.
    forms.push("(deny network*)");
  }
  // LAST: a mask must outrank the write allowances above, including a masked path that
  // happens to sit inside the workspace.
  for (const target of policy.maskPaths ?? []) {
    const canonical = canonicalPath(target);
    forms.push(`(deny file-read* file-write* (subpath ${sbplString(canonical)}))`);
  }
  return forms.join(" ");
}

/** The `sandbox-exec` arguments before the caller's argv. */
export function seatbeltArgs(policy: SandboxPolicy): string[] {
  return ["-p", seatbeltProfile(policy)];
}

/**
 * Functional probe: apply the real read-only profile through `sandbox-exec` and run
 * `true` under it. Exit 0 means the kernel accepted AND enforced the profile
 * (`sandbox-exec` exits non-zero when `sandbox_init` refuses it). A missing binary —
 * every non-macOS host — fails the spawn and probes unusable the same way, on purpose.
 */
function defaultProbe(timeoutMs: number, runner: string): boolean {
  const probe = spawnSync(
    runner,
    [...seatbeltArgs({ mode: "read-only", workspaceRoot: "/" }), "--", "true"],
    { timeout: timeoutMs, stdio: "ignore" },
  );
  return probe.status === 0;
}

/**
 * The backend. The probe runs once, lazily (first confine), and is cached; an
 * unusable Seatbelt throws — fail-closed — rather than degrading to a weaker profile.
 */
export function createSeatbeltProvider(internals: SeatbeltInternals = {}): SandboxProvider {
  const runner = internals.runner ?? "sandbox-exec";
  const probe = internals.probe ?? ((timeoutMs: number) => defaultProbe(timeoutMs, runner));
  let usable: boolean | undefined;
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      usable ??= probe(PROBE_TIMEOUT_MS);
      if (!usable) {
        throw new Error(
          `penguin-seatbelt cannot confine on this host: '${runner}' is missing or refuses the ` +
            "profile (it exists only on macOS); refusing to run the command unconfined.",
        );
      }
      return {
        argv: [runner, ...seatbeltArgs(policy), "--", ...argv],
        // Seatbelt enforces the whole profile it accepts; nothing here is best-effort.
        enforcement: "full",
        // Seatbelt denials surface as EPERM; a denied network call also shows up as an
        // unreachable/refused socket, which the first two cover in practice.
        denialSignatures: ["operation not permitted", "permission denied"],
        runnerFailureRules: [{ fatalSignatures: [`${runner}: `] }],
      };
    },
  };
}

/** The plugin: registered per App creation, like every other backend. Default export = the plugin. */
export function activate(ctx: PluginContext): void {
  // Backends register per App creation — a hot swap re-registers them into the fresh
  // registry — so the subscription is to the event, not a one-time registration here.
  ctx.on("initialize", (iface) => {
    iface.sandbox.registerProvider("penguin-seatbelt", createSeatbeltProvider());
  });
}
