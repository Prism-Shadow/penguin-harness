/**
 * @prismshadow/penguin-plugin-sandbox-winuser — a Windows sandbox backend that confines by
 * IDENTITY: each agent command runs as a dedicated local account that owns nothing.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page and
 * the harness resolves it from the installation. It compiles against the
 * `@prismshadow/penguin-core/plugin` surface and has no runtime dependency on the harness.
 *
 * WHY THIS EXISTS. Windows' container mechanisms cannot run the shell this harness uses.
 * MXC's `processcontainer` is an AppContainer, and an MSYS2 shell (Git Bash) dies inside one
 * at STATUS_DLL_INIT_FAILED while creating `\BaseNamedObjects\msys-*` — the global object
 * namespace an AppContainer exists to deny. A restricted token fails a step later, at the
 * shell's signal pipe. Both were measured on a Windows 11 host; neither is a configuration
 * mistake, and no policy reaches either. What DOES run Git Bash is an ordinary token that
 * simply belongs to someone else, which is the design here (and the one Codex ships on
 * Windows):
 *
 *   fs-write    → the Workspace is opened to the sandbox group; everything else is already
 *                 unreachable, since one local user cannot read another's profile
 *   network     → two accounts, one of them blocked outbound by firewall rules the setup
 *                 adds; `network: "none"` picks that one
 *   mask-paths  → an explicit Deny for the group, which outranks the Workspace's grant
 *
 * WHAT IT COSTS. Confinement is coarser than a container's: a sandbox account is a normal
 * account, so anything readable by every local user stays readable, and isolation ends at the
 * filesystem and the network. In exchange the agent gets the shell it actually uses.
 *
 * SETUP IS ELEVATED, ONCE. Creating local accounts and firewall rules needs administrator
 * rights, so it is a script (`setup/penguin-sandbox-setup.ps1`) a person runs, not something a
 * server does behind their back. Until it has run, this backend declines with the command to
 * run — never silently, and never by failing the first agent command.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import type {
  ConfinedArgv,
  Plugin,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";
import { readState, stateFile } from "./state.js";
import type { WinUserState } from "./state.js";
import type { LaunchJob } from "./launch.js";

export { readState, stateFile, sandboxHome } from "./state.js";
export type { WinUserState, SandboxAccount } from "./state.js";

/** The settings group this backend declares (its contribution id), drawn inside the Sandbox card. */
export const WINUSER_GROUP = "sandbox-winuser";

/** This backend's own settings, as it reads them from its group. */
export interface WinUserSettings {
  /** Open the shell's own directory to the sandbox accounts, so the shell can load its files. */
  grantProgramDir: boolean;
}

/** Its group's stored document as settings; an absent value is the default. */
export function winUserSettingsOf(doc: Record<string, unknown>): WinUserSettings {
  return { grantProgramDir: doc.grantProgramDir !== false };
}

/**
 * Quotes one argument the way `CommandLineToArgvW` parses it: the command travels to
 * `CreateProcessWithLogonW` as ONE string, so the argv the harness handed us has to survive
 * the round trip. Backslashes are special only before a quote, which is the whole rule.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let quoted = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    quoted += "\\".repeat(backslashes) + ch;
    backslashes = 0;
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`;
}

/** One command line out of an argv, each argument quoted as above. */
export function toCommandLine(argv: readonly string[]): string {
  return argv.map(quoteWindowsArg).join(" ");
}

/** The job the launcher is handed: the policy as permissions, and the command under it. */
export function jobFor(policy: SandboxPolicy, argv: readonly string[]): LaunchJob {
  const programDir = programRoot(argv[0] ?? "");
  return {
    access: policy.mode === "workspace-write" ? "modify" : "read",
    workspaceRoot: policy.workspaceRoot,
    ...(policy.network !== undefined ? { network: policy.network } : {}),
    ...(policy.maskPaths !== undefined && policy.maskPaths.length > 0
      ? { maskPaths: [...policy.maskPaths] }
      : {}),
    commandLine: toCommandLine(argv),
    ...(programDir !== "" ? { programDir } : {}),
  };
}

/**
 * The directory a program needs opened to run: its install root, which for a
 * `…\<tool>\bin\<prog>.exe` layout is the parent of `bin` — an MSYS shell loads its DLLs from
 * a sibling of it. Empty for a bare command, whose directory we cannot know.
 */
export function programRoot(command: string): string {
  if (!path.win32.isAbsolute(command)) return "";
  const dir = path.win32.dirname(command);
  return path.win32.basename(dir).toLowerCase() === "bin" ? path.win32.dirname(dir) : dir;
}

/** Where the launcher lives, beside this module in the built package. */
export function launcherPath(): string {
  return fileURLToPath(new URL("./launch.js", import.meta.url));
}

/** What a host without the accounts is told, with the command that creates them. */
export function setupInstructions(file: string = stateFile()): string {
  return (
    `this host has no sandbox accounts yet (${file} is missing). Run the plugin's ` +
    "setup/penguin-sandbox-setup.ps1 from an elevated PowerShell once — it creates the local " +
    "group, the two accounts and the firewall rules that block the offline one — then the " +
    "backend serves without a restart."
  );
}

/** Test seams: the state to serve, the platform to claim, and the Node that runs the launcher. */
export interface WinUserInternals {
  state?: WinUserState | null;
  platform?: NodeJS.Platform;
  node?: string;
  launcher?: string;
}

/**
 * Loads the backend, checking that it can serve here: a Windows host, and a setup that has run.
 * A host that is not Windows declines (another backend serves it); a Windows host without the
 * accounts REJECTS with the setup command, so the Sandbox card says what to do rather than
 * every agent command failing.
 */
export async function loadWinUserProvider(
  internals: WinUserInternals = {},
  settings: () => WinUserSettings = () => ({ grantProgramDir: true }),
): Promise<SandboxProvider | null> {
  const platform = internals.platform ?? process.platform;
  if (platform !== "win32") return null;
  const state = internals.state !== undefined ? internals.state : readState();
  if (state === null) throw new Error(setupInstructions());
  return createWinUserProvider(internals, settings);
}

/** The backend itself: every confined command becomes the launcher, run as a sandbox account. */
export function createWinUserProvider(
  internals: WinUserInternals = {},
  settings: () => WinUserSettings = () => ({ grantProgramDir: true }),
): SandboxProvider {
  const node = internals.node ?? process.execPath;
  const launcher = internals.launcher ?? launcherPath();
  return {
    dimensions: ["fs-write", "network", "mask-paths"],
    confine(argv, policy): ConfinedArgv {
      const job = jobFor(policy, argv);
      const encoded = Buffer.from(
        JSON.stringify(settings().grantProgramDir ? job : { ...job, programDir: undefined }),
        "utf8",
      ).toString("base64");
      return {
        // The job travels base64-encoded, and the password never travels at all: the launcher
        // reads it from a file only the harness's account and administrators can open.
        argv: [node, launcher, encoded],
        enforcement: "full",
        // Win32 denial dialects: cmd, PowerShell/.NET, and Node's own EACCES text.
        denialSignatures: ["access is denied", "access to the path", "permission denied"],
        runnerFailureRules: [{ fatalSignatures: ["penguin-winuser:"] }],
      };
    },
  };
}

/**
 * What this backend requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
export abstract class WinUserConfigReader extends Interface<{
  get(name: string): Record<string, unknown>;
}>() {}

/**
 * The plugin's one module: a provider on the sandbox slot, the code half of the contribution
 * the decorator declares. Created per App, so a hot swap gets a fresh provider.
 */
@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "sandbox-winuser.quick-start",
        prompt:
          "Test the sandbox your commands run under. Run three separate commands: write a file inside this Workspace, write a file in your home directory outside it, and fetch https://example.com. Report which succeeded and which were denied; if all three succeed, the sandbox is off (Settings → Plugins → Sandbox).",
        promptZh:
          "测试你执行命令时所处的沙盒。分三条命令执行：在当前工作区内写一个文件、在工作区外的家目录写一个文件、访问 https://example.com。报告哪些成功、哪些被拒；如果三条都成功，说明沙盒处于关闭状态（设置 → 插件 → 沙盒）。",
      },
    ],
    "SandboxModule.providers": [
      {
        id: "sandbox-winuser.provider",
        name: "penguin-winuser",
        dimensions: ["fs-write", "network", "mask-paths"],
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "sandbox-winuser",
        parent: "sandbox",
        title: "Windows account",
        properties: {
          grantProgramDir: {
            type: "boolean",
            title: "Open the shell's directory",
            titleZh: "开放 Shell 所在目录",
            description:
              "Let the sandbox accounts read and execute the shell's own install directory. A shell installed under your profile is unreadable to any other account, and the command cannot start without it.",
            descriptionZh:
              "允许沙盒账户读取并执行 Shell 自身的安装目录。装在你的用户目录下的 Shell 对其他账户不可读，缺少它命令无法启动。",
            default: true,
          },
        },
      },
    ],
  },
})
export class SandboxWinUser {
  @Use() private readonly config!: WinUserConfigReader;
  @Bind("sandbox-winuser.provider") provider!: SandboxProviderSource;

  setup() {
    const config = this.config;
    this.provider = loadWinUserProvider({}, () => winUserSettingsOf(config.get(WINUSER_GROUP)));
  }
}

const plugin: Plugin = { modules: [SandboxWinUser] };
export default plugin;
