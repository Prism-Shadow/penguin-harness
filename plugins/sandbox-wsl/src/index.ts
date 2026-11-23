/**
 * @penguinharness/sandbox-wsl — a Windows sandbox backend that confines in a Linux
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
 * this backend sets up switches interop off in its /etc/wsl.conf, and the check on its card
 * proves it stays off. It is also why the distro is its own and not the person's Ubuntu.
 *
 * WHAT IT COSTS. Commands run in Linux, not in Git Bash: Windows toolchains (node.exe, git.exe)
 * cannot run confined, so the distro carries its own (the packages setting). A Windows path in
 * a command means nothing there; the Workspace is at `/mnt/<drive>/…`.
 *
 * SETUP. Installing WSL needs an administrator once — the card raises Windows' own consent
 * prompt for the script shipped in setup/. Everything after that runs as the harness's own
 * user: Initialize downloads the base rootfs (Ubuntu by default, Alpine as the small option),
 * imports it, installs bubblewrap and the packages, and switches interop off. Each step shows on
 * the card while it runs.
 */
import { fileURLToPath } from "node:url";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import type {
  ConfinedArgv,
  Plugin,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";
import { readHost, readState } from "./host.js";
import {
  Tasks,
  TASK_TITLES,
  check,
  initialize,
  installWsl,
  launchJob,
  remove,
  wslSettingsOf,
} from "./tasks.js";
import type { TaskKind, WslSettings } from "./tasks.js";
import { wslReport } from "./report.js";
import type { WslReport } from "./report.js";

export { bwrapArgs, chdirRoots, linuxProgram, toLinuxPath } from "./profile.js";
export { wslReport } from "./report.js";
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

/** The settings group this backend declares: its page in Settings. */
export const WSL_GROUP = "sandbox-wsl";

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
    return "the sandbox distro is not initialized: open Settings → Plugins → Windows Sandbox and use Initialize there";
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
 * once the distro exists. Until then it rejects with what to do, which the sandbox page shows;
 * a task that finishes on this backend's card loads it again.
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
    dimensions: ["fs-write", "network", "mask-paths", "closed-temp"],
    confine(argv, policy: SandboxPolicy): ConfinedArgv {
      const state = readState();
      if (state === null) {
        throw new Error("penguin-wsl cannot confine: the sandbox distro is not initialized");
      }
      const job = launchJob(argv, policy, settings(), state, node);
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

/** What this backend requires of plugin configuration: to read the group it declares. */
@Interface()
export abstract class WslConfigReader {
  abstract get(name: string): Record<string, unknown>;
}

/** What the page reads of the sandbox: a reload of a refused backend once its distro is ready. */
@Interface()
export abstract class WslSandboxView {
  abstract retryFailed(): Promise<void>;
  abstract failures(): Array<{ name: string; reason: string }>;
}

/** The card's live half, in the consumer's own shape (see the settings page's contract). */
export interface SettingsGroupStatus {
  notices(): Array<{ tone: "attention" | "muted" | "progress"; text: string; textZh?: string }>;
  report(): WslReport;
  saved(): Promise<void>;
  actions(): Array<{
    id: string;
    title: string;
    titleZh?: string;
    description?: string;
    descriptionZh?: string;
  }>;
  run(action: string): Promise<{
    ok: boolean;
    message: string;
    messageZh?: string;
    settled?: Promise<void>;
  }>;
}

const when = (at: number) => new Date(at).toLocaleString();

/** What a finished task is called on the card. */
const DONE_TITLES: Record<TaskKind, { en: string; zh: string }> = {
  install: { en: "WSL install", zh: "WSL 安装" },
  initialize: { en: "Initialize", zh: "初始化" },
  check: { en: "Check", zh: "检查" },
  remove: { en: "Remove", zh: "移除" },
};

/**
 * The page: what this machine has (WSL, the distro, the last check), the button for the next
 * step, and the step a running task is on.
 */
@Component({
  contributes: {
    "PluginConfigPage.status": [{ id: "sandbox-wsl.status", group: "sandbox-wsl" }],
  },
})
export class SandboxWslStatus {
  @Use() private readonly config!: WslConfigReader;
  @Use() private readonly sandbox!: WslSandboxView;
  @Bind("sandbox-wsl.status") status!: SettingsGroupStatus;

  setup() {
    const config = this.config;
    const sandbox = this.sandbox;
    const settings = () => wslSettingsOf(config.get(WSL_GROUP));
    const tasks = new Tasks();
    const windows = process.platform === "win32";
    if (windows) void tasks.refreshHost();

    const initialized = () => {
      const state = readState();
      const host = tasks.host;
      return (
        state !== null &&
        state.distro === settings().distro &&
        host !== null &&
        host.distros.some((d) => d.toLowerCase() === state.distro.toLowerCase())
      );
    };

    const bodies: Record<TaskKind, () => Promise<void> | null> = {
      install: () => tasks.start("install", (report) => installWsl(report)),
      initialize: () =>
        tasks.start("initialize", async (report) => {
          const outcome = await initialize(settings(), report);
          if (!outcome.ok) return outcome;
          const verdict = await check(settings(), report);
          tasks.lastCheck = { at: Date.now(), lines: verdict.lines };
          return verdict.result.ok
            ? outcome
            : {
                ok: false,
                message: {
                  en: `${outcome.message.en} ${verdict.result.message.en}`,
                  zh: `${outcome.message.zh}${verdict.result.message.zh}`,
                },
              };
        }),
      check: () =>
        tasks.start("check", async (report) => {
          const verdict = await check(settings(), report);
          tasks.lastCheck = { at: Date.now(), lines: verdict.lines };
          return verdict.result;
        }),
      remove: () =>
        tasks.start("remove", async (report) => {
          tasks.lastCheck = null;
          return remove(settings(), report);
        }),
    };

    this.status = {
      // What a task is doing, or how the last one ended; everything else is the report's.
      notices: () => {
        if (!windows) return [];
        tasks.touchHost();
        const out: ReturnType<SettingsGroupStatus["notices"]> = [];
        const running = tasks.running;
        if (running !== null && running.kind !== "install") {
          const title = TASK_TITLES[running.kind];
          const secs = Math.round((Date.now() - running.startedAt) / 1000);
          out.push({
            tone: "progress",
            text: `${title.en} (${secs}s): ${running.step.en}`,
            textZh: `${title.zh}（${secs} 秒）：${running.step.zh}`,
          });
        }
        const last = tasks.last;
        if (last !== null && running === null) {
          out.push({
            tone: last.ok ? "muted" : "attention",
            text: `${DONE_TITLES[last.kind].en} ${last.ok ? "finished" : "failed"} at ${when(last.at)}: ${last.message.en}`,
            textZh: `${DONE_TITLES[last.kind].zh}——${last.ok ? "完成" : "失败"}于 ${when(last.at)}：${last.message.zh}`,
          });
        }
        return out;
      },
      report: () =>
        wslReport({
          platform: process.platform,
          host: tasks.host,
          running: tasks.running,
          last: tasks.last,
          state: windows ? readState() : null,
          distro: settings().distro,
          initialized: windows && tasks.host !== null && initialized(),
          lastCheck: tasks.lastCheck,
        }),
      // A task that ended, or a save of this page, may have made the backend usable: the sandbox
      // loads a refused one again.
      saved: () => sandbox.retryFailed(),
      actions: () => {
        if (!windows || tasks.running !== null || tasks.host === null) return [];
        if (tasks.host.wsl === "missing") {
          return [
            {
              id: "install",
              title: "Install WSL",
              titleZh: "安装 WSL",
              description:
                "Windows asks for permission, then runs wsl --install --no-distribution. Its progress shows here; some machines need a restart afterwards.",
              descriptionZh:
                "Windows 会请求授权，然后运行 wsl --install --no-distribution。进度显示在这里；部分机器完成后需要重启。",
            },
          ];
        }
        const init = {
          id: "initialize",
          title: initialized() ? "Initialize again" : "Initialize sandbox distro",
          titleZh: initialized() ? "重新初始化" : "初始化沙盒发行版",
          description: initialized()
            ? "Re-applies the configuration and installs the packages setting's list into the existing distro, then checks it."
            : "Downloads the base Linux, imports it as its own WSL distro, installs bubblewrap and the packages, switches interop off, then checks it. No administrator needed.",
          descriptionZh: initialized()
            ? "对现有发行版重新应用配置并安装软件包设置中的列表，然后检查。"
            : "下载基础 Linux，导入为独立的 WSL 发行版，安装 bubblewrap 与软件包，关闭 interop，然后检查。无需管理员权限。",
        };
        if (!initialized()) return [init];
        return [
          {
            id: "check",
            title: "Check confinement",
            titleZh: "检查隔离效果",
            description:
              "Runs real commands through the sandbox: interop, Workspace writes, read-only mode, the Windows drives, the network, a masked path and temp.",
            descriptionZh:
              "通过沙盒执行真实命令：interop、工作区写入、只读模式、Windows 磁盘、网络、屏蔽路径与临时目录。",
          },
          init,
          {
            id: "remove",
            title: "Remove distro",
            titleZh: "移除发行版",
            description:
              "Unregisters the sandbox distro and deletes everything inside it (not your Workspaces). The backend stays off until you initialize again.",
            descriptionZh:
              "注销沙盒发行版并删除其中所有内容（不含你的工作区）。重新初始化前后端保持停用。",
          },
        ];
      },
      run: async (action) => {
        const start = bodies[action as TaskKind];
        const settled = start?.();
        if (settled === undefined || settled === null) {
          return {
            ok: false,
            message:
              tasks.running !== null
                ? "Another task is still running on this card."
                : `No action ${action}.`,
            messageZh:
              tasks.running !== null ? "此卡片上还有任务在运行。" : `没有 ${action} 操作。`,
          };
        }
        const title = TASK_TITLES[action as TaskKind];
        return {
          ok: true,
          message: `${title.en}: its progress shows on this page.`,
          messageZh: `${title.zh}：进度显示在本页。`,
          settled,
        };
      },
    };
  }
}

@Component({
  contributes: {
    // How the Plugins page shows this backend (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "sandbox-wsl.card",
        title: "Windows Sandbox",
        titleZh: "Windows 沙箱",
        descriptionZh:
          "PenguinHarness 在 Windows 上的 WSL 沙箱后端：命令在专用的 WSL2 发行版中经 bubblewrap 运行，并关闭 Windows 互操作。",
        shortDescription: "Windows: run commands in a confined WSL2 distro.",
        shortDescriptionZh: "Windows：在受限的 WSL2 发行版中运行命令。",
        category: "sandbox",
        icon: "icon.svg",
        preinstall: false,
      },
    ],
    "SandboxModule.providers": [
      {
        id: "sandbox-wsl.provider",
        name: "penguin-wsl",
        dimensions: ["fs-write", "network", "mask-paths", "closed-temp"],
        defaultFor: ["win32"],
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "sandbox-wsl",
        title: "WSL",
        properties: {
          exposeWindowsDrives: {
            type: "boolean",
            title: "Show Windows drives read-only",
            titleZh: "以只读方式显示 Windows 磁盘",
            description:
              "Off: a confined command sees only its Workspace under /mnt. On: every Windows drive is visible read-only, your profile included.",
            descriptionZh:
              "关闭：被隔离的命令在 /mnt 下只能看到自己的工作区。打开：所有 Windows 磁盘以只读方式可见，包括你的用户目录。",
            default: false,
          },
          base: {
            type: "enum",
            title: "Base Linux",
            titleZh: "基础 Linux",
            description:
              "What the sandbox distro is built from. Ubuntu is the ordinary Linux most tools, wheels and prebuilt binaries expect. Alpine downloads about a tenth as much, but it is musl: some native npm modules, pip wheels and downloaded binaries do not run on it.",
            descriptionZh:
              "沙盒发行版基于哪个 Linux。Ubuntu 是绝大多数工具、wheel 与预编译二进制所预期的常规 Linux；Alpine 的下载量只有前者的十分之一左右，但它用 musl：部分原生 npm 模块、pip wheel 与预编译二进制无法运行。",
            options: [
              {
                value: "ubuntu",
                title: "Ubuntu 24.04 LTS (about 30 MB)",
                titleZh: "Ubuntu 24.04 LTS（约 30 MB）",
              },
              {
                value: "alpine",
                title: "Alpine (about 4 MB, musl)",
                titleZh: "Alpine（约 4 MB，musl）",
              },
            ],
            default: "ubuntu",
          },
          packages: {
            type: "list",
            title: "Packages",
            titleZh: "软件包",
            description:
              "Packages Initialize installs besides bubblewrap, one per line (for example nodejs, npm, python3). They are apt packages on Ubuntu and apk packages on Alpine. Windows toolchains cannot run inside the sandbox.",
            descriptionZh:
              "初始化时除 bubblewrap 外安装的软件包，每行一个（例如 nodejs、npm、python3）。Ubuntu 上是 apt 包，Alpine 上是 apk 包。Windows 工具链无法在沙盒内运行。",
            default: ["git", "curl", "nodejs"],
            pattern: "^[a-z0-9][a-z0-9._+-]*$",
            patternErrorMessage: "must be package names",
          },
          mirror: {
            type: "string",
            title: "Package mirror",
            titleZh: "软件包镜像",
            description:
              "Where the packages come from, empty for the official archive: an Ubuntu mirror such as https://mirrors.tuna.tsinghua.edu.cn/ubuntu, or an Alpine one such as https://mirrors.tuna.tsinghua.edu.cn/alpine. The base rootfs itself always comes from the distribution's own site.",
            descriptionZh:
              "软件包的下载地址，留空即用官方源：Ubuntu 镜像如 https://mirrors.tuna.tsinghua.edu.cn/ubuntu，Alpine 镜像如 https://mirrors.tuna.tsinghua.edu.cn/alpine。基础 rootfs 始终从发行版官方站点下载。",
            placeholder: "https://mirrors.tuna.tsinghua.edu.cn/ubuntu",
            pattern: "^https?://\\S+$",
            patternErrorMessage: "must be an http(s) URL",
          },
          distro: {
            type: "string",
            title: "Distro name",
            titleZh: "发行版名称",
            description: "The WSL distro this backend creates and runs commands in.",
            descriptionZh: "本后端创建并在其中执行命令的 WSL 发行版。",
            default: "penguin-sandbox",
            pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            patternErrorMessage: "may use letters, digits, dot, dash and underscore",
          },
        },
      },
    ],
  },
})
export class SandboxWsl {
  @Use() private readonly config!: WslConfigReader;
  @Bind("sandbox-wsl.provider") provider!: SandboxProviderSource;

  setup() {
    const config = this.config;
    const settings = () => wslSettingsOf(config.get(WSL_GROUP));
    // A loader: the service calls it again after this page's task ends or the page is saved.
    this.provider = () => loadWslProvider(settings);
  }
}

const plugin: Plugin = { modules: [SandboxWsl, SandboxWslStatus] };
export default plugin;
