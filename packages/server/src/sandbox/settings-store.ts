/**
 * Sandbox settings, as a settings group: the confinement every agent command spawns under is
 * declared on `PluginConfigProvider.groups` like any module's settings, drawn on the Settings
 * dialog's Plugins page and stored under `plugin-config:sandbox`, so a restart keeps it. A
 * sandbox backend that has settings of its own declares its own group with `parent: "sandbox"`
 * and reads it itself; nothing here carries a backend's values.
 *
 * `SandboxSettings` declares the group and applies what is stored to the service — on boot
 * and after every save. The service stays on the capability-free floor (a bare kernel boots
 * it with no database), and its parked context still carries the settings across a hot swap:
 * on boot a saved document wins, and with none saved the service keeps what the swap carried.
 * `SandboxSettingsStatus` reports, as live notices, whether the saved policy can be enforced,
 * which backends are in use, and why each other one is not — a backend that failed to load,
 * failed its check or runs on another platform is named with its reason, never left out. It is
 * a code contribution, so it must not require plugin configuration itself.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { PluginConfigNotice } from "../api/types.js";
import { PluginConfig } from "../plugin/config.js";
import type { SettingsGroupStatus } from "../plugin/config-page.js";
import { Sandbox, SandboxModule } from "./service.js";
import { requestedDimensions } from "./dimensions.js";
import { DEFAULT_PRESET, sandboxEnabledOf, sandboxStartOf } from "./settings-policy.js";

/**
 * The backend package each OS defaults to: what the card offers to install when the switch is
 * turned on and no backend for this OS is installed. sandbox-dsh serves every OS but is never
 * the default, because it confines the file system only.
 */
const DEFAULT_BACKEND: Partial<Record<NodeJS.Platform, string>> = {
  linux: "@penguinharness/sandbox-bwrap",
  darwin: "@penguinharness/sandbox-seatbelt",
  win32: "@penguinharness/sandbox-wsl",
};

/** The sandbox's group name (its contribution id), and the parent a backend's group names. */
export const SANDBOX_GROUP = "sandbox";

@Component({
  contributes: {
    "PluginConfigProvider.groups": [
      {
        id: "sandbox",
        order: 0,
        title: "Sandbox",
        titleZh: "沙盒",
        description:
          "The confinement new sessions start with, enforced by a sandbox backend plugin. A session keeps the policy it started with; change it from that session's permission button.",
        descriptionZh:
          "新建会话的初始封禁策略，由沙盒后端插件实施。已有会话保留创建时的策略，可在该会话的权限按钮中修改。",
        properties: {
          // No default: a document saved before the switch derives it (sandboxEnabledOf), and
          // with nothing saved that reads as off, the default mode being Off.
          enabled: {
            type: "boolean",
            title: "Enable",
            titleZh: "启用",
            description:
              "Whether new sessions start in the sandbox. On: from the default preset. Off: with full file and network access, held only by their approval mode. Sessions that already exist keep their own policy.",
            descriptionZh:
              "新会话是否进入沙盒。打开：从默认预设开始。关闭：拥有完全的文件与网络访问，只受审批模式约束。已有会话保留各自的策略。",
          },
          // The composer's menu: each preset a named mode, network level and approval mode,
          // and the Default column: the row a new Session starts from while the switch is on.
          // Full Access keeps its promise (nothing confined, everything approved): only its
          // name, whether the menu lists it and whether it is the default can change.
          presets: {
            type: "table",
            title: "Presets",
            titleZh: "预设",
            description:
              "Named combinations of file access, network and approval mode. The pinned ones are what the composer's permission menu offers, and the default is what a new session starts from while the sandbox is on. A session keeps its own three values, and the menu names it by the first row that matches.",
            descriptionZh:
              "文件访问、网络与审批方式的命名组合。固定的行出现在输入框的权限菜单里；沙盒打开时，新会话从默认行开始。会话只保存自己的三项取值，菜单按第一个匹配的行为它命名。",
            rowChoice: {
              field: "defaultPreset",
              title: "Default",
              titleZh: "默认",
              description:
                "The row a new session starts from while the sandbox is on: its file access, network and approval mode. Changing it reaches new sessions only.",
              descriptionZh:
                "沙盒打开时新会话的起点：取该行的文件访问、网络与审批方式。改动只影响此后新建的会话。",
              before: "enabled",
            },
            columnGroup: {
              title: "Menu",
              titleZh: "菜单",
              description:
                "How the composer's permission menu uses each row: the default is what a new session starts from while the sandbox is on, and a pinned row is listed in the menu.",
              descriptionZh:
                "输入框权限菜单如何使用每一行：默认行是沙盒打开时新会话的起点，固定的行会列在菜单里。",
              columns: ["defaultPreset", "enabled"],
            },
            // Presets an administrator adds: only those can be deleted; every row can be moved,
            // and the order is the composer's menu order.
            extensible: {
              add: "Add preset",
              addZh: "添加预设",
              values: {
                name: "New preset",
                enabled: false,
                mode: "workspace-write",
                network: "open",
                approvalMode: "always-ask",
              },
              valuesZh: { name: "新预设" },
            },
            pin: {
              column: "enabled",
              on: "Pinned to the menu",
              onZh: "已固定到菜单",
              off: "Not in the menu",
              offZh: "不在菜单中",
            },
            columns: [
              {
                name: "name",
                type: "string",
                title: "Name",
                titleZh: "名称",
                description:
                  "What the menu and the permission button call this row. A rename keeps what the row does; clear the box to restore the original name.",
                descriptionZh:
                  "菜单与权限按钮显示的名称。改名不改变该行的作用；清空输入框即恢复原名。",
              },
              {
                name: "mode",
                type: "enum",
                title: "Files",
                titleZh: "文件",
                description:
                  "What a confined command may write. Off: anywhere. Workspace: the session's workspace, its scratchpad and the temp directory. Read-only: the temp directory only. Needs a sandbox backend unless Off.",
                descriptionZh:
                  "被封禁的命令能写哪里。关闭：任何位置。仅工作区：会话的工作区、scratchpad 与临时目录。只读：只有临时目录。除「关闭」外都需要沙盒后端。",
                options: [
                  {
                    value: "danger-full-access",
                    title: "Off (full access)",
                    titleZh: "关闭（完全访问）",
                  },
                  { value: "workspace-write", title: "Workspace write only", titleZh: "仅工作区可写" },
                  { value: "read-only", title: "Read-only", titleZh: "只读" },
                ],
              },
              {
                name: "network",
                type: "enum",
                title: "Network",
                titleZh: "网络",
                description:
                  "What a confined command, hook script or read_file URL may reach. Localhost allows only this machine, and needs a backend that can enforce it.",
                descriptionZh:
                  "被封禁的命令、钩子脚本与 read_file 的 URL 能访问的网络。仅本机只允许访问本机，需要能实施它的后端。",
                options: [
                  { value: "open", title: "Full access", titleZh: "完全访问" },
                  { value: "local", title: "Localhost only", titleZh: "仅本机" },
                  { value: "none", title: "No network", titleZh: "无网络" },
                ],
              },
              {
                name: "approvalMode",
                type: "enum",
                title: "Ask mode",
                titleZh: "询问模式",
                description:
                  "Which tool calls run without asking: all of them, only the ones that read, none (each asks first), or none at all (every call is denied).",
                descriptionZh:
                  "哪些工具调用无需询问即可执行：全部、仅读取类、都要先询问，或全部拒绝。",
                options: [
                  { value: "allow-all", title: "Approve everything", titleZh: "全部批准" },
                  { value: "read-only", title: "Approve read-only", titleZh: "批准只读" },
                  { value: "always-ask", title: "Ask every time", titleZh: "每次询问" },
                  { value: "deny-all", title: "Deny everything", titleZh: "全部拒绝" },
                ],
              },
              {
                name: "enabled",
                type: "boolean",
                title: "Pin",
                titleZh: "固定",
                description:
                  "Whether the composer's permission menu lists this row. An unpinned row can still be the default.",
                descriptionZh: "权限菜单是否列出这一行。未固定的行仍可作为默认。",
              },
            ],
            rows: [
              {
                id: "full-access",
                values: {
                  name: "Full Access",
                  enabled: true,
                  mode: "danger-full-access",
                  network: "open",
                  approvalMode: "allow-all",
                },
                valuesZh: { name: "完全访问" },
                locked: ["mode", "network", "approvalMode"],
              },
              {
                id: "always-ask",
                values: {
                  name: "Always Ask",
                  enabled: true,
                  mode: "danger-full-access",
                  network: "open",
                  approvalMode: "always-ask",
                },
                valuesZh: { name: "每次询问" },
              },
              {
                id: "workspace-write",
                values: {
                  name: "Workspace Write",
                  enabled: true,
                  mode: "workspace-write",
                  network: "open",
                  approvalMode: "allow-all",
                },
                valuesZh: { name: "仅工作区可写" },
              },
              {
                id: "read-only",
                values: {
                  name: "Read Only",
                  enabled: true,
                  mode: "read-only",
                  network: "open",
                  approvalMode: "allow-all",
                },
                valuesZh: { name: "只读" },
              },
              {
                id: "workspace-write-ask",
                values: {
                  name: "Workspace Write with Ask",
                  enabled: false,
                  mode: "workspace-write",
                  network: "open",
                  approvalMode: "always-ask",
                },
                valuesZh: { name: "仅工作区可写并询问" },
              },
              {
                id: "denied-all",
                values: {
                  name: "Denied All",
                  enabled: false,
                  mode: "danger-full-access",
                  network: "open",
                  approvalMode: "deny-all",
                },
                valuesZh: { name: "全部拒绝" },
              },
            ],
          },
          // The row a new Session starts from while the switch is on, drawn only as the table's
          // Default column. No declared default: the derive hook shows DEFAULT_PRESET, and a
          // document stored without it is read by its own mode and network (settings-policy.ts).
          defaultPreset: {
            type: "enum",
            title: "Default preset",
            titleZh: "默认预设",
            options: [
              { value: "full-access", title: "Full Access", titleZh: "完全访问" },
              { value: "always-ask", title: "Always Ask", titleZh: "每次询问" },
              { value: "workspace-write", title: "Workspace Write", titleZh: "仅工作区可写" },
              { value: "read-only", title: "Read Only", titleZh: "只读" },
              {
                value: "workspace-write-ask",
                title: "Workspace Write with Ask",
                titleZh: "仅工作区可写并询问",
              },
              { value: "denied-all", title: "Denied All", titleZh: "全部拒绝" },
            ],
          },
          writableTemp: {
            type: "boolean",
            advanced: true,
            title: "Temporary directory writable",
            titleZh: "临时目录可写",
            description:
              "Confined commands, hook scripts and file tools may write the system temp directory, in either mode. Shells and most tools need one to start; off keeps it read-only too.",
            descriptionZh:
              "被封禁的命令、钩子脚本与文件工具在两种模式下都可以写系统临时目录。Shell 与大多数工具需要它才能启动；关闭后临时目录同样只读。",
            default: true,
          },
          maskPaths: {
            type: "list",
            advanced: true,
            title: "Masked paths",
            titleZh: "屏蔽路径",
            description:
              "Paths hidden from confined commands, hook scripts and file tools, reads included.",
            descriptionZh: "对被封禁的命令、钩子脚本与文件工具隐藏的路径，读取也不例外。",
            hint: "One absolute path per line, at most 64.",
            hintZh: "每行一个绝对路径，最多 64 条。",
            maxItems: 64,
            // POSIX `/…`, Windows `C:\…` or `C:/…`, or a UNC `\\server\…`.
            pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)",
            patternErrorMessage: "must list absolute paths",
          },
        },
      },
    ],
  },
})
export class SandboxSettings {
  @Use() private readonly pluginConfig!: PluginConfig;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  setup() {
    const { pluginConfig, sandbox } = this;
    // A saved document wins; with none saved the service keeps what the swap carried —
    // applying the defaults here would un-confine a deployment on every hot update.
    const schema = () => pluginConfig.schema(SANDBOX_GROUP);
    if (pluginConfig.saved(SANDBOX_GROUP)) {
      sandbox.configure(sandboxStartOf(schema(), pluginConfig.get(SANDBOX_GROUP), true).policy);
    }
    pluginConfig.watch(SANDBOX_GROUP, (doc) =>
      sandbox.configure(sandboxStartOf(schema(), doc, true).policy),
    );
  }
}

/**
 * The sandbox card's live notices: a warning when the saved mode needs isolation no usable
 * backend implements (every command would be refused), the backends in use, and each backend
 * that failed to load, with its reason. A backend that declined because this host is not its
 * platform is no fault of the deployment — it is named only when nothing else serves, where
 * it explains why.
 */
@Component({
  contributes: {
    "PluginConfigPage.status": [{ id: "sandbox.status", group: "sandbox" }],
  },
})
export class SandboxSettingsStatus {
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  @Bind("sandbox.status") status!: SettingsGroupStatus;
  setup() {
    const sandbox = this.sandbox;
    this.status = {
      // The switch as the card shows it: derived for a document saved before it existed.
      derive: (values, stored) => ({
        ...values,
        // Read off the whole document: a pre-switch one's mode and network are not fields.
        enabled: sandboxEnabledOf(stored),
        defaultPreset: values.defaultPreset ?? DEFAULT_PRESET,
      }),
      // Every save pins the default preset: a document stored before it existed is read by
      // its own mode and network until then (settings-policy.ts).
      saving: (update, current) =>
        update.defaultPreset !== undefined
          ? update
          : { ...update, defaultPreset: current.defaultPreset ?? DEFAULT_PRESET },
      // A backend for this OS is installed when it is in use or failed (to load, or its check):
      // one that declined is for another OS. Installing the default would not fix a failure.
      backend: () => {
        const recommended = DEFAULT_BACKEND[process.platform];
        return {
          installed: sandbox.backends().length > 0 || sandbox.failures().length > 0,
          ...(recommended !== undefined ? { recommended } : {}),
        };
      },
      // A backend reads its own group (drawn inside this card) at load: after a save of the
      // card, one that failed its check — a wrong program path — loads again, no restart.
      saved: () => sandbox.retryFailed(),
      // The local level needs a backend that declares it; where none does, the option is
      // shown greyed out and a save choosing it is refused.
      unavailable: () => {
        if (sandbox.backends().some((b) => b.dimensions.includes("network-local"))) return [];
        const why = {
          value: "local",
          reason: "no sandbox backend on this host supports it",
          reasonZh: "本机的沙盒后端不支持",
        };
        return [{ field: "presets", column: "network", ...why }];
      },
      notices: (): PluginConfigNotice[] => {
        const notices: PluginConfigNotice[] = [];
        const backends = sandbox.backends();
        const settings = sandbox.currentSettings();
        if (settings.mode !== "danger-full-access") {
          const required = requestedDimensions(settings);
          const served = backends.some((b) => required.every((d) => b.dimensions.includes(d)));
          if (!served) {
            const needs = required.join(" + ");
            notices.push({
              tone: "attention",
              text: `The saved mode needs ${needs}, and no usable backend implements it: every agent command and hook script is refused until one does.`,
              textZh: `当前保存的模式需要 ${needs}，但没有可用的后端实现它：在有后端能实施之前，Agent 的每条命令与钩子脚本都会被拒绝。`,
            });
          }
        }
        if (backends.length === 0) {
          const declined = sandbox.declined();
          const elsewhere =
            declined.length === 0
              ? ""
              : ` ${declined.join(", ")} ${declined.length === 1 ? "is" : "are"} installed, but for another platform.`;
          const elsewhereZh =
            declined.length === 0 ? "" : `已安装 ${declined.join("、")}，但它们适用于其他平台。`;
          notices.push({
            tone: "attention",
            // Only confinement needs a backend: with the switch off nothing is refused.
            onlyWhen: "enabled",
            text: `This deployment has no usable sandbox backend: until one for this platform is installed from the Plugins page, every mode but Off refuses every agent command and hook script.${elsewhere}`,
            textZh: `当前部署没有可用的沙盒后端：在插件页安装适用于本平台的后端之前，除「关闭」外的任何模式都会拒绝 Agent 的每条命令与钩子脚本。${elsewhereZh}`,
          });
        } else {
          const list = backends.map((b) => `${b.name} (${b.dimensions.join(", ")})`).join(" · ");
          notices.push({ tone: "muted", text: `Backends: ${list}`, textZh: `后端：${list}` });
        }
        // A failure while another backend serves is worth saying, but it is not the card's
        // headline — confinement works. With nothing serving it is the headline.
        const tone = backends.length === 0 ? "attention" : "muted";
        for (const { name, reason } of sandbox.failures()) {
          notices.push({
            tone,
            text: `${name} is not in use: ${reason}`,
            textZh: `${name} 未启用：${reason}`,
          });
        }
        return notices;
      },
    };
  }
}
