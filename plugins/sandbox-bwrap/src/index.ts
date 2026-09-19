/**
 * @prismshadow/penguin-plugin-sandbox-bwrap — a bubblewrap sandbox backend.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page
 * and the harness resolves it from the installation (see the server's plugin/loader.ts).
 * It compiles against the `@prismshadow/penguin-core/plugin` surface (types, plus the
 * decorators its bundle carries) and has no runtime dependency on the harness — and
 * none on the DSH ecosystem either:
 * it talks to `bwrap` directly and implements every dimension of the sandbox interface,
 * including the two DSH's vocabulary does not cover.
 *
 * The bwrap profile is built in order, because bwrap applies mounts in order and a
 * later mount shadows an earlier one:
 *
 *   --ro-bind / /  --dev /dev  --proc /proc  --die-with-parent   the read-only world
 *   [writable temp]    --tmpfs /tmp  --bind <tmpdir> <same>         a private, writable /tmp
 *   [workspace-write]  --bind <workspaceRoot> <same>
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
import { execFile, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
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

/** This backend's own settings, as it reads them from its group. */
export interface BwrapSettings {
  /** The bwrap program: a path or a command on PATH. */
  runner: string;
  /** How long the first check that the runner works may take. */
  probeTimeoutMs: number;
}

/**
 * The bwrap this plugin SHIPS for the host it is running on, or "" when it carries none.
 *
 * A deployment must not depend on the distribution having bubblewrap — most do not install it,
 * and an operator who has to run `apt install bubblewrap` before the sandbox works is an
 * operator whose sandbox is off. The binary lives beside the built module
 * (`vendor/<platform>-<arch>/bin/bwrap`, see scripts/vendor-bwrap.mjs) and finds its own
 * libcap through an `$ORIGIN/../lib` rpath, which is what lets a backend that only rewrites an
 * argv use it: there is no environment to set.
 */
export function vendoredRunner(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  runnable: (p: string) => boolean = executable,
): string {
  const candidate = fileURLToPath(
    new URL(`../vendor/${platform}-${arch}/bin/bwrap`, import.meta.url),
  );
  return runnable(candidate) ? candidate : "";
}

/** Present AND executable: a package installer may drop the exec bit, and then it is not ours to run. */
function executable(target: string): boolean {
  try {
    accessSync(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Its group's stored document (defaults merged) as settings; anything unusable falls back. */
export function bwrapSettingsOf(
  doc: Record<string, unknown>,
  vendored: string = vendoredRunner(),
): BwrapSettings {
  const runner = typeof doc.runner === "string" ? doc.runner.trim() : "";
  const seconds = doc.probeTimeoutSeconds;
  return {
    // What a deployment names wins; then the one shipped here; and only then a host's own.
    runner: runner !== "" ? runner : vendored !== "" ? vendored : "bwrap",
    probeTimeoutMs:
      typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : PROBE_TIMEOUT_MS,
  };
}

/** Test seams: inject the probe verdict, and the settings the provider reads at each confine. */
export interface PenguinBwrapInternals {
  probe?: (timeoutMs: number, runner: string) => boolean;
  runner?: string;
  settings?: () => BwrapSettings;
}

/**
 * What this backend requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
export abstract class BwrapConfigReader extends Interface<{
  get(name: string): Record<string, unknown>;
}>() {}

/** The settings group this backend declares (its contribution id), drawn inside the Sandbox card. */
export const BWRAP_GROUP = "sandbox-bwrap";

/**
 * The writable roots a policy grants, canonical and deduplicated: the workspace under
 * `workspace-write`, and the temp areas whenever the policy makes temp writable (either mode).
 */
export function writableRoots(policy: SandboxPolicy): string[] {
  const roots = [
    ...(policy.mode === "workspace-write" ? [policy.workspaceRoot] : []),
    ...(policy.writableTemp === true ? ["/tmp", tmpdir()] : []),
  ].map((root) => path.resolve(root));
  return [...new Set(roots)];
}

/** The bwrap profile arguments for one policy (everything before `--` and the caller's argv). */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  // Full access binds the root read-WRITE: the filesystem is unrestricted, and only the other
  // dimensions below (a network cut, a masked path) still apply — which is the whole reason a
  // full-access policy reached a backend at all.
  const rootBind = policy.mode === "danger-full-access" ? "--bind" : "--ro-bind";
  const args = [rootBind, "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"];
  const roots = writableRoots(policy);
  if (policy.writableTemp === true) args.push("--tmpfs", "/tmp");
  for (const root of roots) {
    if (root === "/tmp") continue; // already a writable tmpfs above
    args.push("--bind", root, root);
  }
  if (policy.network === "local") {
    // An empty network namespace also loses the host's loopback, so "localhost only" has no
    // spelling here. The service never routes it here (no network-local dimension); refuse
    // rather than read it as an open network.
    throw new Error("penguin-bwrap cannot confine to the local network (localhost only)");
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
/** The argv that checks bwrap can build the base profile at all. */
const BASE_PROFILE_PROBE = [
  "--ro-bind",
  "/",
  "/",
  "--dev",
  "/dev",
  "--proc",
  "/proc",
  "--die-with-parent",
  "--",
  "true",
];

function defaultProbe(timeoutMs: number, runner: string): boolean {
  const probe = spawnSync(runner, BASE_PROFILE_PROBE, { timeout: timeoutMs, stdio: "ignore" });
  return probe.status === 0;
}

/** The base-profile probe, without blocking the process: what the load-time check runs. */
function probeAsync(timeoutMs: number, runner: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(runner, BASE_PROFILE_PROBE, { timeout: timeoutMs }, (err) => resolve(err === null));
  });
}

/**
 * Loads the backend, checking first that it can serve on this host — and rejecting, with the
 * reason, when it cannot: it runs on Linux only, and needs a bwrap that accepts the base profile.
 * A backend mounted without being able to serve would be routed policies and fail every command;
 * one that declined without a reason would leave nobody able to tell why. The sandbox service
 * records the rejection and the settings page shows it, and loads it again after the next save
 * of the sandbox card. The confine-time probe stays, for a runner changed while mounted.
 */
export async function loadPenguinBwrapProvider(
  internals: PenguinBwrapInternals & { platform?: NodeJS.Platform } = {},
): Promise<SandboxProvider | null> {
  const platform = internals.platform ?? process.platform;
  // Not this host's backend: a decline, not a failure — the deployment installed it for
  // its Linux machines, and saying so on every Windows card would be noise.
  if (platform !== "linux") return null;
  const { runner, probeTimeoutMs } = internals.settings?.() ?? {
    runner: internals.runner ?? (vendoredRunner() || "bwrap"),
    probeTimeoutMs: PROBE_TIMEOUT_MS,
  };
  const usable = internals.probe
    ? internals.probe(probeTimeoutMs, runner)
    : await probeAsync(probeTimeoutMs, runner);
  if (!usable) {
    throw new Error(
      `'${runner}' is missing or refuses the base profile (are unprivileged user namespaces enabled on this host? \`sysctl kernel.unprivileged_userns_clone\`)`,
    );
  }
  return createPenguinBwrapProvider(internals);
}

/**
 * The backend. It reads its settings at each confine, so an edit applies to the next spawn;
 * the probe runs lazily (the first confine with a given runner) and is cached per runner: an
 * unavailable bwrap throws — fail-closed — rather than degrading to a weaker profile, because
 * the dimensions routed here (network, mask-paths) have no weaker form.
 */
export function createPenguinBwrapProvider(internals: PenguinBwrapInternals = {}): SandboxProvider {
  const probe = internals.probe ?? defaultProbe;
  const settings =
    internals.settings ??
    (() => ({
      runner: internals.runner ?? (vendoredRunner() || "bwrap"),
      probeTimeoutMs: PROBE_TIMEOUT_MS,
    }));
  const usable = new Map<string, boolean>();
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      const { runner, probeTimeoutMs } = settings();
      if (!usable.has(runner)) usable.set(runner, probe(probeTimeoutMs, runner));
      if (!usable.get(runner)) {
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
 * The plugin's one module: a provider on the sandbox slot, the code half of the
 * contribution the decorator declares (its manifest is generated into ifaces.json from
 * here). Created per App, so a hot swap gets a fresh provider.
 */
@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "sandbox-bwrap.quick-start",
        prompt:
          "Test the sandbox your commands run under. Run three separate commands: write a file inside this Workspace, write a file in your home directory outside it, and fetch https://example.com. Report which succeeded and which were denied; if all three succeed, the sandbox is off (Settings → Plugins → Sandbox).",
        promptZh:
          "测试你执行命令时所处的沙盒。分三条命令执行：在当前工作区内写一个文件、在工作区外的家目录写一个文件、访问 https://example.com。报告哪些成功、哪些被拒；如果三条都成功，说明沙盒处于关闭状态（设置 → 插件 → 沙盒）。",
      },
    ],
    "SandboxModule.providers": [
      {
        id: "sandbox-bwrap.provider",
        name: "penguin-bwrap",
        dimensions: ["fs-write", "network", "mask-paths"],
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "sandbox-bwrap",
        parent: "sandbox",
        title: "Bubblewrap",
        properties: {
          runner: {
            type: "string",
            title: "bwrap program",
            titleZh: "bwrap 程序",
            description:
              "A path or a command on PATH; empty uses the bubblewrap this plugin ships, falling back to one on PATH where it carries none for this host.",
            descriptionZh:
              "路径或 PATH 上的命令名；留空则使用本插件自带的 bubblewrap，若没有适配本机的自带版本，再回退到 PATH 上的。",
            placeholder: "bwrap",
          },
          probeTimeoutSeconds: {
            type: "number",
            title: "Probe timeout (seconds)",
            titleZh: "探测超时（秒）",
            description:
              "How long the first check that bwrap works may take before it counts as unusable (1–30).",
            descriptionZh: "首次检查 bwrap 是否可用时最多等待多久（1–30），超时即视为不可用。",
            default: 5,
            // The confine-time probe blocks the server while it runs; a hanging runner must
            // not stall it for longer than this.
            minimum: 1,
            maximum: 30,
          },
        },
      },
    ],
  },
})
export class SandboxBwrap {
  @Use() private readonly config!: BwrapConfigReader;
  @Bind("sandbox-bwrap.provider") provider!: SandboxProviderSource;

  setup() {
    const config = this.config;
    // A loader, not a load: after a save of the sandbox card the service calls it again if the
    // check failed, so a corrected program mounts the backend without a restart.
    this.provider = () =>
      loadPenguinBwrapProvider({
        settings: () => bwrapSettingsOf(config.get(BWRAP_GROUP)),
      });
  }
}

const plugin: Plugin = { modules: [SandboxBwrap] };
export default plugin;
