/**
 * @prismshadow/penguin-plugin-sandbox-seatbelt — a macOS Seatbelt sandbox backend.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page
 * and the harness resolves it from the installation. It compiles against the
 * `@prismshadow/penguin-core/plugin` surface (types, plus the decorators its bundle
 * carries) and has no runtime dependency on the
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
 *   [network: local]  (deny network*) then allow localhost: outbound to, bind and inbound on it
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
import { execFile, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

/** The write sinks a confined process needs even under read-only. */
const REQUIRED_WRITE_SINKS = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/dtracehelper"];

/** This backend's own settings, as it reads them from its group. */
export interface SeatbeltSettings {
  /** The sandbox-exec program: a path or a command on PATH. */
  runner: string;
}

/**
 * Where macOS keeps the program this backend runs.
 *
 * Unlike the Linux backend, which ships its own bubblewrap, there is nothing to vendor here:
 * `sandbox-exec` is part of macOS, lives at a fixed path on every install, and is Apple's to
 * distribute, not ours. What the shipped binary bought there — never depending on the host's
 * setup — this buys by naming the absolute path instead of a bare command: a PATH that lacks
 * `/usr/bin`, or that puts something else called `sandbox-exec` earlier, no longer decides what
 * confines a command. A host missing it is caught by the probe at load, with the reason.
 */
export const SYSTEM_RUNNER = "/usr/bin/sandbox-exec";

/** The program to run when the settings name none: the OS's own, else a PATH lookup. */
export function defaultRunner(exists: (p: string) => boolean = existsSync): string {
  return exists(SYSTEM_RUNNER) ? SYSTEM_RUNNER : "sandbox-exec";
}

/** Its group's stored document as settings; an empty runner falls back to the OS's own. */
export function seatbeltSettingsOf(
  doc: Record<string, unknown>,
  fallback: string = defaultRunner(),
): SeatbeltSettings {
  const runner = typeof doc.runner === "string" ? doc.runner.trim() : "";
  return { runner: runner !== "" ? runner : fallback };
}

/** Test seams: inject the probe verdict, and the settings the provider reads at each confine. */
export interface SeatbeltInternals {
  probe?: (timeoutMs: number, runner: string) => boolean;
  runner?: string;
  settings?: () => SeatbeltSettings;
}

/**
 * What this backend requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
export abstract class SeatbeltConfigReader extends Interface<{
  get(name: string): Record<string, unknown>;
}>() {}

/** The settings group this backend declares (its contribution id), drawn inside the Sandbox card. */
export const SEATBELT_GROUP = "sandbox-seatbelt";

/** Canonical path (symlinks resolved), falling back to a lexical resolve for paths that do not exist yet. */
export function canonicalPath(target: string): string {
  try {
    return realpathSync(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

/**
 * The writable roots a policy grants, canonical and deduplicated: the workspace under
 * `workspace-write`, and the temp areas whenever the policy makes temp writable (either mode).
 */
export function writableRoots(policy: SandboxPolicy): string[] {
  return [
    ...new Set(
      [
        ...(policy.mode === "workspace-write" ? [policy.workspaceRoot] : []),
        ...(policy.writableTemp === true ? ["/tmp", tmpdir()] : []),
      ].map(canonicalPath),
    ),
  ];
}

/** Quote one path as an SBPL string literal. */
function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The SBPL profile for one policy: the exact text handed to `sandbox-exec -p`. */
export function seatbeltProfile(policy: SandboxPolicy): string {
  // Full access denies no writes: "(allow default)" already permits them, and only the network
  // and mask forms below still bite. A confining mode denies writes and re-allows the sinks.
  const full = policy.mode === "danger-full-access";
  const forms = full
    ? ["(version 1)", "(allow default)"]
    : [
        "(version 1)",
        "(allow default)",
        "(deny file-write*)",
        `(allow file-write* ${REQUIRED_WRITE_SINKS.map((sink) => `(literal ${sbplString(sink)})`).join(" ")})`,
      ];
  const roots = full ? [] : writableRoots(policy);
  if (roots.length > 0) {
    forms.push(
      `(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`,
    );
  }
  if (policy.network === "none") {
    // Seatbelt filters network natively: no sockets at all, outbound or inbound.
    forms.push("(deny network*)");
  }
  if (policy.network === "local") {
    // Everything is denied, then the host's loopback is let back in: connecting to a local
    // server, and binding and accepting on localhost for one's own. Later rules win in SBPL.
    forms.push(
      "(deny network*)",
      '(allow network-outbound (remote ip "localhost:*"))',
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
    );
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
 * Loads the backend, checking first that it can serve on this host — and rejecting, with the
 * reason, when it cannot: it runs on macOS only, and needs a sandbox-exec that accepts its
 * profile. The sandbox service records the rejection and the settings page shows it, so the
 * backend is never silently absent, and loads it again after the next save of the sandbox card;
 * the confine-time probe stays, for a runner changed while mounted.
 */
export async function loadSeatbeltProvider(
  internals: SeatbeltInternals & { platform?: NodeJS.Platform } = {},
): Promise<SandboxProvider | null> {
  const platform = internals.platform ?? process.platform;
  // Not this host's backend: a decline, not a failure (see penguin-bwrap's loader).
  if (platform !== "darwin") return null;
  const { runner } = internals.settings?.() ?? { runner: internals.runner ?? defaultRunner() };
  const usable = internals.probe
    ? internals.probe(PROBE_TIMEOUT_MS, runner)
    : await new Promise<boolean>((resolve) => {
        execFile(
          runner,
          [...seatbeltArgs({ mode: "read-only", workspaceRoot: "/" }), "--", "true"],
          { timeout: PROBE_TIMEOUT_MS },
          (err) => resolve(err === null),
        );
      });
  if (!usable) throw new Error(`'${runner}' is missing or refuses the Seatbelt profile`);
  return createSeatbeltProvider(internals);
}

/**
 * The backend. It reads its settings at each confine; the probe runs lazily (the first
 * confine with a given runner) and is cached per runner; an unusable Seatbelt throws —
 * fail-closed — rather than degrading to a weaker profile.
 */
export function createSeatbeltProvider(internals: SeatbeltInternals = {}): SandboxProvider {
  const probe = internals.probe ?? defaultProbe;
  const settings = internals.settings ?? (() => ({ runner: internals.runner ?? defaultRunner() }));
  const usable = new Map<string, boolean>();
  return {
    dimensions: ["fs-write", "network", "network-local", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      const { runner } = settings();
      if (!usable.has(runner)) usable.set(runner, probe(PROBE_TIMEOUT_MS, runner));
      if (!usable.get(runner)) {
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

/**
 * The plugin's one module: a provider on the sandbox slot, the code half of the
 * contribution the decorator declares (its manifest is generated into ifaces.json from
 * here). Created per App, so a hot swap gets a fresh provider.
 */
@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "sandbox-seatbelt.quick-start",
        prompt:
          "Test the sandbox your commands run under. Run three separate commands: write a file inside this Workspace, write a file in your home directory outside it, and fetch https://example.com. Report which succeeded and which were denied; if all three succeed, the sandbox is off (Settings → Plugins → Sandbox).",
        promptZh:
          "测试你执行命令时所处的沙盒。分三条命令执行：在当前工作区内写一个文件、在工作区外的家目录写一个文件、访问 https://example.com。报告哪些成功、哪些被拒；如果三条都成功，说明沙盒处于关闭状态（设置 → 插件 → 沙盒）。",
      },
    ],
    "SandboxModule.providers": [
      {
        id: "sandbox-seatbelt.provider",
        name: "penguin-seatbelt",
        dimensions: ["fs-write", "network", "network-local", "mask-paths"],
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "sandbox-seatbelt",
        parent: "sandbox",
        title: "Seatbelt",
        properties: {
          runner: {
            type: "string",
            title: "sandbox-exec program",
            titleZh: "sandbox-exec 程序",
            description:
              "A path or a command on PATH; empty uses the macOS program at /usr/bin/sandbox-exec.",
            descriptionZh:
              "路径或 PATH 上的命令名；留空则使用 macOS 自带的 /usr/bin/sandbox-exec。",
            placeholder: "/usr/bin/sandbox-exec",
          },
        },
      },
    ],
  },
})
export class SandboxSeatbelt {
  @Use() private readonly config!: SeatbeltConfigReader;
  @Bind("sandbox-seatbelt.provider") provider!: SandboxProviderSource;

  setup() {
    const config = this.config;
    // A loader: after a save of the sandbox card a failed check runs again (see penguin-bwrap).
    this.provider = () =>
      loadSeatbeltProvider({
        settings: () => seatbeltSettingsOf(config.get(SEATBELT_GROUP)),
      });
  }
}

const plugin: Plugin = { modules: [SandboxSeatbelt] };
export default plugin;
