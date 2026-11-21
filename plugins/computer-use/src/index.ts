/**
 * @penguinharness/computer-use — an Agent sees and operates the apps on this computer's desktop
 * through `penguin computer`, over vercel-labs' agent-desktop (Apache-2.0).
 *
 * A PLUGIN PACKAGE, not part of the platform, and not shipped with it: an administrator installs
 * it from the plugin market, and installing it on an Agent enables its server module (PRFC-0031).
 * Everything is here — the server module, the command, the settings card and the Skill — and the
 * host knows none of it (design: 05 「Computer Use」).
 *
 *   install.ts      agent-desktop, downloaded and verified by this plugin, never by npm
 *   policy.ts       what a command line may run (default-safe, server-enforced)
 *   self-target.ts  PenguinHarness never operates itself
 *   runner.ts       one process per command, by absolute path, explicit environment
 *   cli.ts          `penguin computer …`, a member plugin command
 *   status.ts       the card's live half on Settings → Plugins
 *
 * Two modules, for the order the settings page needs (the server's plugin/config.ts): ComputerUse
 * requires the settings and contributes the command; ComputerUseStatus contributes the card's
 * status, read by the page node. Both share one service per data root (service.ts).
 */
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type { CliCommandCode } from "@prismshadow/penguin-core/cli";
import { computerCommand } from "./cli.js";
import { Probe } from "./probe.js";
import { ComputerUseService, serviceFor } from "./service.js";
import { GROUP } from "./settings.js";
import { computerUseStatus } from "./status.js";
import type { SettingsGroupStatus } from "./status.js";

export { AGENT_DESKTOP, targetKey } from "./pin.js";
export type { AgentDesktopPin, PinnedFile, TargetPin } from "./pin.js";
export {
  installAgentDesktop,
  installDirOf,
  readInstalled,
  tarballUrl,
  UnsupportedPlatformError,
} from "./install.js";
export type { Installed, InstallProgress } from "./install.js";
export { decide, MAX_BUDGET_MS } from "./policy.js";
export type { Decision, PolicySettings, RunPlan, Target } from "./policy.js";
export { parseEnvelope, runAgentDesktop } from "./runner.js";
export type { AgentDesktopProgram, Envelope, RunOutput } from "./runner.js";
export { agentDesktopEnv } from "./env.js";
export { belongsToTree, ownRoots, readProcessTable, SelfTree } from "./self-target.js";
export { ComputerUseService } from "./service.js";
export { handleComputer, computerCommand } from "./cli.js";
export { Probe, preconditionsOf } from "./probe.js";
export { readTar } from "./tar.js";

/** What this module requires of plugin configuration: to read groups, and hear their saves. */
@Interface()
export abstract class ComputerUseConfigReader {
  abstract get(name: string): Record<string, unknown>;
  abstract watch(name: string, cb: (values: Record<string, unknown>) => void): () => void;
}

/** What it requires of the server's configuration: where the data root is. */
@Interface()
export abstract class ComputerUseServerConfig {
  abstract root: string;
  abstract dbPath: string;
}

/** The service of this data root, with this generation's settings reader bound to it. */
function ready(
  root: string,
  config: ComputerUseConfigReader,
): { service: ComputerUseService; probe: Probe } {
  const service = serviceFor(root, () => new ComputerUseService({ root }));
  service.bind(config);
  probes.set(root, probes.get(root) ?? new Probe(service));
  return { service, probe: probes.get(root)! };
}

const probes = new Map<string, Probe>();

@Component({
  contributes: {
    // How the Plugins page and the market show this plugin (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "computer-use.card",
        title: "Computer Use",
        titleZh: "电脑操作",
        descriptionZh:
          "让 Agent 用 penguin computer 看见并操作这台电脑上的桌面应用：经各操作系统的无障碍树（macOS、Windows 与 Linux）读取窗口、点击、输入、选择与等待，底层是 vercel-labs 的 agent-desktop。缺省只放行观察与语义操作；物理输入、剪贴板与通知读取由管理员开启，从不操作 PenguinHarness 自身。",
        shortDescription: "See and operate desktop apps through their accessibility trees.",
        shortDescriptionZh: "经无障碍树查看并操作桌面应用。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Open the Calculator app, work out 12 × 34 with its buttons, and tell me the result it shows.",
          promptZh: "打开计算器应用，用它的按键算出 12 × 34，告诉我它显示的结果。",
          skills: ["computer-use"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "computer-use.skill.computer-use", name: "computer-use", path: "skills/computer-use" },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "computer-use",
        title: "Computer Use",
        titleZh: "电脑操作",
        description:
          "Agents see and operate the apps on this server's desktop with penguin computer, through agent-desktop. It acts as the server's own user, outside the Agent sandbox, and can operate any window on this desktop — a browser tab showing the PenguinHarness Web App included, where an Agent could approve its own requests or change settings; only the desktop app's own windows are protected. By default only administrators and their Agents may use it.",
        descriptionZh:
          "Agent 用 penguin computer 经 agent-desktop 查看并操作这台服务器桌面上的应用。它以服务端自身的用户身份运行，不受 Agent 沙盒约束，能操作这个桌面上的任何窗口——包括显示 PenguinHarness Web App 的浏览器标签页，Agent 可能在那里批准自己的请求或修改设置；只有桌面应用自己的窗口受到保护。缺省只有管理员及其 Agent 可以使用。",
        switch: "enabled",
        properties: {
          enabled: {
            type: "boolean",
            title: "Computer Use",
            titleZh: "电脑操作",
            description:
              "Off: every penguin computer command is refused and agent-desktop is not installed or run.",
            descriptionZh:
              "关闭：所有 penguin computer 命令都被拒绝，agent-desktop 不会被安装或运行。",
            default: true,
          },
          allowMembers: {
            type: "boolean",
            // Drawn under the options' security heading, with a shield (plugin status pages).
            security: true,
            title: "Allow members",
            titleZh: "允许成员使用",
            description:
              "Off: only administrators, and Agents whose conversation an administrator drives, may use penguin computer. On: every member of a Project that has the plugin enabled may. It hands them control of this machine's desktop session, which is as much as letting them run programs on this computer.",
            descriptionZh:
              "关闭：只有管理员，以及由管理员驱动对话的 Agent，可以使用 penguin computer。打开：已启用本插件的 Project 的所有成员都可以使用。这等于把这台机器的桌面会话交给他们控制，与允许他们在这台电脑上运行程序无异。",
            default: false,
          },
          physicalInput: {
            type: "boolean",
            // Drawn under the options' security heading, with a shield (plugin status pages).
            security: true,
            title: "Allow physical input",
            titleZh: "允许物理输入",
            description:
              "The real mouse and keyboard: --headed, mouse-*, hover, drag, double-click, focus and the scroll wheel. They move the user's pointer and take keyboard focus away from whatever the user is doing. Off, Agents act only through each element's accessibility API, which leaves the pointer and focus alone but cannot drive every app (some Electron and canvas apps need real input).",
            descriptionZh:
              "真实的鼠标与键盘：--headed、mouse-*、hover、drag、double-click、focus 与滚轮。它们会移动用户的指针，并把键盘焦点从用户正在做的事情上抢走。关闭时，Agent 只经各元素的无障碍接口操作，不碰指针与焦点，但并非每个应用都能这样驱动（部分 Electron 与画布类应用需要真实输入）。",
            default: false,
          },
          pauseWhileUserActive: {
            type: "boolean",
            // Drawn under the options' security heading, with a shield (plugin status pages).
            security: true,
            title: "Pause while the user is active",
            titleZh: "用户操作时暂停",
            description:
              "Commands that act on the desktop are refused (user_active) while the person at this computer is using the keyboard or mouse — their last input under 3 seconds ago — so an Agent never works the same window at the same time. Where the input idle time cannot be read (Wayland, a machine without the readers) nothing pauses, and the card says so.",
            descriptionZh:
              "当使用这台电脑的人正在用键盘或鼠标时（最近一次输入不到 3 秒），作用于桌面的命令一律被拒绝（user_active），Agent 因此不会与人同时操作同一个窗口。读不到输入空闲时间的地方（Wayland、缺少读取工具的机器）不会暂停，卡片上会注明。",
            default: true,
          },
          clipboardRead: {
            type: "boolean",
            // Drawn under the options' security heading, with a shield (plugin status pages).
            security: true,
            title: "Allow reading the clipboard",
            titleZh: "允许读取剪贴板",
            description:
              "clipboard-get: whatever was last copied on this computer, which may be a password.",
            descriptionZh: "clipboard-get：这台电脑上最近复制的内容，可能是密码。",
            default: false,
          },
          notificationRead: {
            type: "boolean",
            // Drawn under the options' security heading, with a shield (plugin status pages).
            security: true,
            title: "Allow reading notifications",
            titleZh: "允许读取通知",
            description:
              "list-notifications and wait --notification: the system's notifications, from every app.",
            descriptionZh: "list-notifications 与 wait --notification：来自所有应用的系统通知。",
            default: false,
          },
          binaryPath: {
            type: "string",
            title: "agent-desktop program path",
            titleZh: "agent-desktop 程序路径",
            description:
              "An agent-desktop program already on this server, for a machine that cannot reach the npm registry. Empty: the plugin downloads and checks the version it pins. The file is used as it is, unchecked.",
            descriptionZh:
              "这台服务器上已有的 agent-desktop 程序，供无法访问 npm registry 的机器使用。留空：插件下载并校验它钉死的版本。该文件按原样使用，不做校验。",
            placeholder: "/opt/agent-desktop/agent-desktop",
            advanced: true,
          },
        },
      },
    ],
    "PluginCliCommandsProvider.commands": [
      {
        id: "computer-use.command",
        key: "computer",
        summary: {
          en: "Operate desktop apps through their accessibility trees (agent-desktop)",
          zh: "经无障碍树操作桌面应用（agent-desktop）",
        },
        access: "member",
        requiresProjectListing: true,
        tokenCaller: "session-driver",
        files: { read: ["--text-file"], write: "--out-dir" },
      },
    ],
  },
})
export class ComputerUse {
  @Use() private readonly config!: ComputerUseConfigReader;
  @Use() private readonly server!: ComputerUseServerConfig;
  @Bind("computer-use.command") command!: CliCommandCode;

  setup(ctx: ClassCtx) {
    const root = this.server.root;
    const config = this.config;
    const { service } = ready(root, config);
    // Disposed — the plugin removed, or this generation replaced — the install in flight stops
    // unless the next generation takes the service at once (ComputerUseService.retain).
    ctx.effect(service.retain());
    // A save of the card applies at once: turning the plugin on installs agent-desktop, a program
    // path is read again.
    ctx.effect(config.watch(GROUP, () => void service.start()));
    void service.start();
    this.command = computerCommand(() => ready(root, config));
  }
}

@Component({
  contributes: {
    "PluginConfigPage.status": [{ id: "computer-use.status", group: "computer-use" }],
  },
})
export class ComputerUseStatus {
  @Use() private readonly config!: ComputerUseConfigReader;
  @Use() private readonly server!: ComputerUseServerConfig;
  @Bind("computer-use.status") status!: SettingsGroupStatus;

  setup(ctx: ClassCtx) {
    const root = this.server.root;
    const config = this.config;
    ctx.effect(ready(root, config).service.retain());
    this.status = computerUseStatus(() => ready(root, config));
  }
}

const plugin: Plugin = { modules: [ComputerUse, ComputerUseStatus] };
export default plugin;
