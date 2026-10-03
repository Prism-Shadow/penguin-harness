/**
 * @penguinharness/sandbox-dsh — the DeepSeek Harness sandbox ecosystem
 * behind this harness's own sandbox interface.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page
 * and the harness resolves it from the installation (see the server's plugin/loader.ts).
 * The DSH dependencies live HERE, in this package — the harness itself does not depend
 * on them, which is what "plugins are configuration, not built-in capability" means in
 * dependency terms.
 *
 * `@deepseek-ai/dsh-sandbox-local` carries the platform chain (dsh-bwrap → Landlock on
 * Linux, Seatbelt on macOS, the ACL restricted-token runner on Windows) and probes them
 * functionally; this file translates between its vocabulary and ours. Because DSH's
 * policy vocabulary governs file-write effects only, the adaptor declares exactly
 * `fs-write` — the service therefore never routes a network / mask-paths policy here,
 * and the adaptor never has to drop a dimension it cannot honor.
 *
 * Everything DSH loads behind the dynamic imports below, and that is load-bearing for
 * hot push (see scripts/deploy.mjs): the package reaches native-adjacent modules that a
 * pushed single-file bundle resolves from the installation, so an installation missing
 * them fails THIS load — reported fail-closed by the service — instead of failing the
 * whole platform bundle's import.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type {
  ConfinedArgv,
  Plugin,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";

/**
 * Programs the Windows ACL restricted-token runner cannot start — and they include the harness's
 * Windows default session shell (Git for Windows' bash, or the `sh.exe` of the MinGit the
 * Windows package bundles). Measured on windows-latest: a bare `bash`
 * reaches System32's WSL launcher before PATH ("Error code:
 * Bash/Service/CreateInstance/E_ACCESSDENIED"), and an MSYS bash or sh named by path aborts
 * under the write-restricted token ("fatal error - couldn't create signal pipe, Win32 error
 * 5" / "CreateFileMapping …, Win32 error 5"). In the same run both PowerShells ran confined,
 * writing inside the Workspace and denied outside it: pwsh 7.6.6 and Windows PowerShell 5.1.
 *
 * The abort is the MSYS runtime's (msys-2.0.dll, shared by Git for Windows and MSYS2), not
 * bash's, so it is refused by runtime: the POSIX shells those distributions ship, by name, and
 * any program in an MSYS `usr\bin` — the directory where every binary links that runtime.
 */
const MSYS_SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "mksh", "fish", "git-bash"]);

/** What the backend reads of the harness's session shell (core's `ShellInvocation`). */
export interface SessionShell {
  /** Executable name or path the harness spawns commands with. */
  command: string;
}

const unstartable = (program: string): boolean => {
  const segments = program.toLowerCase().split(/[\\/]+/);
  const base = (segments.at(-1) ?? "").replace(/\.exe$/i, "");
  return MSYS_SHELLS.has(base) || (segments.at(-3) === "usr" && segments.at(-2) === "bin");
};

/** The one setting that fixes an MSYS-runtime session shell, as every refusal of it words it. */
const SESSION_SHELL_FIX =
  "Set PENGUIN_SHELL=pwsh (PowerShell 7) — or PENGUIN_SHELL=powershell (Windows PowerShell " +
  "5.1) where PowerShell 7 is not installed — in the harness's environment and restart it";

/**
 * Fail this backend's load on Windows when the harness's session shell is one its ACL runner
 * cannot start. A backend whose load fails is not mounted: the sandbox service reports it with
 * this reason (the Session view's `unavailableBackends`), so the confining tier shows as
 * unavailable with the fix, rather than selectable and then refusing every command. `null` is
 * a host core that does not export the session shell (an older runtime): nothing is checked,
 * and `assertAclRunnerCanStart` still refuses per command.
 */
export function assertSessionShellConfinable(
  shell: SessionShell | null,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32" || shell === null || !unstartable(shell.command)) return;
  throw new Error(
    `sandbox-dsh cannot confine commands on Windows under the session shell "${shell.command}": ` +
      "its ACL runner does not start bash, sh or any other MSYS-runtime program (Git for " +
      "Windows, the bundled MinGit, MSYS2). " +
      `${SESSION_SHELL_FIX}.`,
  );
}

/**
 * Refuse, before the runner is involved, a spawn whose program the ACL runner cannot start.
 * Without this every confined command still fails closed, but with the runner's error — which
 * names WSL or an MSYS internal, not the setting that fixes it. The same `confine()` carries a
 * stdio MCP Server's launch command, which `PENGUIN_SHELL` does not choose: only a program that
 * IS the session shell is pointed at that setting. A `sessionShell` of `null` (a host core that
 * does not export it) cannot tell the two apart and keeps the session shell's wording.
 */
export function assertAclRunnerCanStart(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  sessionShell: SessionShell | null = null,
): void {
  const program = argv[0];
  if (platform !== "win32" || program === undefined || !unstartable(program)) return;
  if (sessionShell === null || sessionShell.command.toLowerCase() === program.toLowerCase()) {
    throw new Error(
      `sandbox-dsh cannot confine "${program}" on Windows: its ACL runner does not start bash, ` +
        `sh or any other MSYS-runtime program (Git for Windows, the bundled MinGit, MSYS2). ` +
        `${SESSION_SHELL_FIX}; refusing to run the ` +
        "command unconfined.",
    );
  }
  throw new Error(
    `sandbox-dsh cannot confine "${program}" on Windows: its ACL runner does not start bash, ` +
      "sh or any other MSYS-runtime program (Git for Windows, the bundled MinGit, MSYS2, or " +
      "System32's WSL launcher); start the program " +
      "directly, or through PowerShell; refusing to run it unconfined.",
  );
}

/**
 * The host's plugin contract, named by a variable so this package's bundle leaves the import to
 * run time: tsup inlines `@prismshadow/penguin-core/plugin` for the decorators (a literal
 * specifier), and a second, bundled copy of the session shell would be this package's
 * resolution, not the harness's. Resolved where the plugin runs, from the installation; where
 * the host's core cannot be reached the import fails and `hostSessionShell` returns `null`.
 */
const HOST_CORE: string = "@prismshadow/penguin-core/plugin";

/**
 * The harness's session shell, from the host's core; `null` when that core does not export
 * `sessionShell` (it arrived after the runtimes a hot push may still be running on) or cannot
 * be reached. Read by namespace, never as a static named import: a missing export must not
 * fail this module's linking. `load` is injectable for tests.
 */
export async function hostSessionShell(
  load: () => Promise<unknown> = () => import(HOST_CORE),
): Promise<SessionShell | null> {
  let core: { sessionShell?: unknown };
  try {
    core = (await load()) as { sessionShell?: unknown };
  } catch {
    return null;
  }
  return typeof core.sessionShell === "function" ? (core.sessionShell() as SessionShell) : null;
}

/** What `loadDshAdaptor` reads of the running process; injectable for tests. */
export interface DshLoadHost {
  platform?: NodeJS.Platform;
  /** The session shell, `null` for a host core without one; read from the host when absent. */
  sessionShell?: SessionShell | null;
}

/**
 * The rung DSH's chain selected, by the program its wrap starts: on Linux bubblewrap when it
 * passed the chain's probe, else the Landlock launcher; one rung each on macOS and Windows.
 */
export function rungName(platform: NodeJS.Platform, runner: string | undefined): string {
  if (platform === "darwin") return "Seatbelt";
  if (platform === "win32") return "the Windows ACL runner";
  return runner === "bwrap" ? "bubblewrap" : "Landlock";
}

/**
 * Mount the stock DSH chain on a bare cordis Context — exactly how DSH's own tests mount it —
 * after checking, on Windows, that its ACL runner can start the session shell at all.
 */
export async function loadDshAdaptor(host: DshLoadHost = {}): Promise<SandboxProvider | null> {
  const platform = host.platform ?? process.platform;
  const shell =
    platform !== "win32"
      ? null
      : host.sessionShell !== undefined
        ? host.sessionShell
        : await hostSessionShell();
  assertSessionShellConfinable(shell, platform);
  const { Context } = await import("@deepseek-ai/cordis");
  const { LocalSandboxProvider } = await import("@deepseek-ai/dsh-sandbox-local");
  const ctx = new Context();
  // `ctx.plugin` is cordis's own API name, not this repo's vocabulary.
  await ctx.plugin(LocalSandboxProvider, {});
  const dsh = ctx.sandbox;
  // The chain picks its rung on the first confine; do that here, so a host where no rung works
  // fails this load with DSH's reason instead of mounting a backend that refuses every command,
  // and the settings card can name the rung that serves. Nothing is spawned but the chain's own
  // probes, whose verdict DSH keeps for the provider's lifetime.
  const probe = dsh.confine([process.execPath], { mode: "read-only", workspaceRoot: tmpdir() });
  return {
    // DSH's own words: "Network and process visibility are outside this vocabulary."
    dimensions: ["fs-write"],
    mechanism:
      rungName(platform, probe.argv[0]) + (probe.enforcement === "partial" ? " (partial)" : ""),
    confine(argv, policy): ConfinedArgv {
      if (policy.mode === "danger-full-access") {
        // Unreachable: this backend implements only fs-write, so the service never hands it a
        // full-access policy (which only ever arrives with a network/mask dimension it lacks).
        throw new Error("dsh-local does not implement full filesystem access with confinement");
      }
      assertAclRunnerCanStart(argv, platform, shell);
      const confined = dsh.confine(argv, {
        mode: policy.mode,
        workspaceRoot: policy.workspaceRoot,
      });
      return {
        argv: confined.argv,
        enforcement: confined.enforcement,
        denialSignatures: confined.denialSignatures,
        runnerFailureRules: confined.runnerFailureRules,
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
      { id: "sandbox-dsh.provider", name: "dsh-local", dimensions: ["fs-write"] },
    ],
  },
})
export class SandboxDsh {
  @Bind("sandbox-dsh.provider") provider!: SandboxProviderSource;

  setup() {
    this.provider = loadDshAdaptor();
  }
}

const plugin: Plugin = { modules: [SandboxDsh] };
export default plugin;
