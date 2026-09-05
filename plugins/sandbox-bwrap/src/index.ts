/**
 * @prismshadow/penguin-plugin-sandbox-bwrap — a bubblewrap sandbox backend.
 *
 * A PLUGIN PACKAGE, not part of the platform: a deployment lists it in plugins.json and
 * the harness resolves it from the installation (see the server's plugin/loader.ts).
 * It compiles against the type-only `@prismshadow/penguin-core/plugin` surface and
 * carries no runtime dependency on the harness — and none on the DSH ecosystem either:
 * it talks to `bwrap` directly and implements every dimension of the sandbox interface,
 * including the two DSH's vocabulary does not cover.
 *
 * The bwrap profile is built in order, because bwrap applies mounts in order and a
 * later mount shadows an earlier one:
 *
 *   --ro-bind / /  --dev /dev  --proc /proc  --die-with-parent   the read-only world
 *   [workspace-write]  --tmpfs /tmp  --bind <workspaceRoot> <same>
 *   [network: none]    --unshare-net                             no network namespace
 *   [mask-paths]       --tmpfs <dir> | --ro-bind /dev/null <file>  shadowing the above
 *   --  <the caller's argv>
 *
 * Masking is why order matters: the entries must come after the read-only bind of `/`
 * that would otherwise expose them. A path that does not exist is skipped — there is
 * nothing to hide, and materializing an empty directory there would change the
 * filesystem view rather than restrict it.
 *
 * Known limitation, verified live: `--unshare-net` gives the process an empty network
 * namespace (its /proc/net/dev holds only `lo`, and nothing resolves or connects), but
 * `/sys` still arrives through the read-only bind of `/`, so `/sys/class/net` keeps
 * listing the HOST's interfaces. Network ACCESS is enforced; host network topology
 * remains readable as stale metadata. Mask it explicitly with `maskPaths` if that
 * matters for a deployment.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type {
  ConfinedArgv,
  Plugin,
  SandboxPolicy,
  SandboxProvider,
} from "@prismshadow/penguin-core/plugin";

/** Default probe budget; a probe that hangs must not hang the first spawn forever. */
const PROBE_TIMEOUT_MS = 5_000;

/** Test seams: inject the probe verdict and capture the runner name. */
export interface PenguinBwrapInternals {
  probe?: (timeoutMs: number) => boolean;
  runner?: string;
}

/** The writable roots `workspace-write` grants: the workspace plus the temp areas, canonical and deduplicated. */
export function writableRoots(policy: SandboxPolicy): string[] {
  if (policy.mode !== "workspace-write") return [];
  const roots = [policy.workspaceRoot, "/tmp", tmpdir()].map((root) => path.resolve(root));
  return [...new Set(roots)];
}

/** The bwrap profile arguments for one policy (everything before `--` and the caller's argv). */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"];
  if (policy.mode === "workspace-write") {
    args.push("--tmpfs", "/tmp");
    for (const root of writableRoots(policy)) {
      if (root === "/tmp") continue; // already a writable tmpfs above
      args.push("--bind", root, root);
    }
  }
  if (policy.network === "none") args.push("--unshare-net");
  for (const target of policy.maskPaths ?? []) {
    const resolved = path.resolve(target);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(resolved).isDirectory();
    } catch {
      continue; // nothing there to hide
    }
    if (isDirectory) args.push("--tmpfs", resolved);
    else args.push("--ro-bind", "/dev/null", resolved);
  }
  return args;
}

/** Functional probe: can bwrap actually create the base profile on this host? */
function defaultProbe(timeoutMs: number, runner: string): boolean {
  const probe = spawnSync(
    runner,
    ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent", "--", "true"],
    { timeout: timeoutMs, stdio: "ignore" },
  );
  return probe.status === 0;
}

/**
 * The backend. The probe runs once, lazily (first confine), and is cached: an
 * unavailable bwrap throws — fail-closed — rather than degrading to a weaker profile,
 * because the dimensions routed here (network, mask-paths) have no weaker form.
 */
export function createPenguinBwrapProvider(internals: PenguinBwrapInternals = {}): SandboxProvider {
  const runner = internals.runner ?? "bwrap";
  const probe = internals.probe ?? ((timeoutMs: number) => defaultProbe(timeoutMs, runner));
  let usable: boolean | undefined;
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      usable ??= probe(PROBE_TIMEOUT_MS);
      if (!usable) {
        throw new Error(
          `penguin-bwrap cannot confine on this host: '${runner}' is missing or refuses the ` +
            "base profile; refusing to run the command unconfined. Install bubblewrap, or " +
            "drop the network / mask-paths requirements so another backend can serve the policy.",
        );
      }
      return {
        argv: [runner, ...bwrapProfileArgs(policy), "--", ...argv],
        // bwrap enforces the whole profile it accepts: mounts, and the network
        // namespace when asked. Nothing here is best-effort.
        enforcement: "full",
        // The kernel's dialect under these mounts: a write to the read-only world is
        // EROFS, a write into a masked tmpfs (or through the /dev/null file mask) is
        // EACCES/EPERM.
        denialSignatures: ["read-only file system", "permission denied", "operation not permitted"],
        runnerFailureRules: [{ fatalSignatures: [`${runner}: `] }],
      };
    },
  };
}

/**
 * The plugin: one module, whose manifest is package.json#penguin.modules[0] (one
 * provider on the sandbox.providers slot); this default export binds the provider by
 * that contribution id. Created per App, so a hot swap gets a fresh provider.
 */
const plugin: Plugin = {
  modules: {
    SandboxBwrap: {
      create: () => ({ api: {}, bind: { "sandbox-bwrap.provider": createPenguinBwrapProvider() } }),
    },
  },
};
export default plugin;
