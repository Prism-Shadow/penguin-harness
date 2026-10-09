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
 * The card's live status (what this machine enforces, which backends are not in use and why)
 * is `SandboxSettingsStatus`, in settings-status.ts.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { PluginConfig } from "../plugin/config.js";
import { Sandbox, SandboxModule } from "./service.js";
import { sandboxStartOf } from "./settings-policy.js";

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
        // Off, the card shows the switch alone: the presets, notices and backends' own settings
        // matter only to a confined Session.
        switch: "enabled",
        properties: {
          // No default: a document saved before the switch derives it (sandboxEnabledOf), and
          // with nothing saved that reads as off, the default mode being Off.
          enabled: {
            type: "boolean",
            title: "Enable",
            titleZh: "启用",
            description:
              "Whether new sessions start in the sandbox. On: from the default preset. Off: with full file and network access, held only by their ask mode. Sessions that already exist keep their own policy.",
            descriptionZh:
              "新会话是否进入沙盒。打开：从默认预设开始。关闭：拥有完全的文件与网络访问，只受询问模式约束。已有会话保留各自的策略。",
          },
          // The composer's menu: each preset a named mode, network level and approval mode, and
          // the default (marked after its name): the row a new Session starts from while on.
          // Full Access keeps its promise (nothing confined, everything approved): only its
          // name, whether the menu lists it and whether it is the default can change.
          presets: {
            type: "table",
            title: "Presets",
            titleZh: "预设",
            description:
              "Named combinations of file access, network and ask mode. The pinned ones are what the composer's permission menu offers, and the one marked (Default) is what a new session starts from while the sandbox is on; changing it reaches new sessions only. A session keeps its own three values, and the menu names it by the first row that matches. Each name's \"?\" says what the row is for.",
            descriptionZh:
              "文件访问、网络与询问模式的命名组合。固定的行出现在输入框的权限菜单里；沙盒打开时，新会话从标有（默认）的行开始，改动只影响此后新建的会话。会话只保存自己的三项取值，菜单按第一个匹配的行为它命名。每个名称旁的「?」说明这一行的用途。",
            rowChoice: { field: "defaultPreset", title: "Default", titleZh: "默认" },
            columnGroup: {
              title: "Action",
              titleZh: "操作",
              description:
                "Pin: listed in the composer's permission menu. Handle: drag to reorder (or focus it and use the arrow keys); the order is the menu's. …: set the row as the default, or delete a preset you added (built-in ones can only be unpinned).",
              descriptionZh:
                "图钉：列在输入框的权限菜单里。手柄：拖动调整顺序（或聚焦后按上下方向键），菜单按此顺序列出。…：设为默认，或删除你新增的预设（内置预设只能取消固定）。",
              columns: ["enabled"],
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
                    description: "Commands and file tools may write anywhere.",
                    descriptionZh: "命令与文件工具可以写任何位置。",
                  },
                  {
                    value: "workspace-write",
                    title: "Workspace write only",
                    titleZh: "仅工作区可写",
                    description:
                      "Commands and file tools may write only the workspace, the session's scratchpad and the temp directory.",
                    descriptionZh: "命令与文件工具只能写工作区、会话的 scratchpad 与临时目录。",
                  },
                  {
                    value: "read-only",
                    title: "Read-only",
                    titleZh: "只读",
                    description:
                      "Commands and file tools may write nothing but the temp directory.",
                    descriptionZh: "命令与文件工具除临时目录外什么都不能写。",
                  },
                ],
              },
              {
                name: "network",
                type: "enum",
                title: "Network",
                titleZh: "网络",
                description:
                  "What a confined command, hook script or read_file URL may reach. Localhost allows only this machine. Each limit needs a backend that can enforce it — sandbox-dsh confines files only — and is greyed out where the backends in use cannot.",
                descriptionZh:
                  "被封禁的命令、钩子脚本与 read_file 的 URL 能访问的网络。仅本机只允许访问本机。每种限制都需要能实施它的后端（sandbox-dsh 只封禁文件），在用的后端不能实施时显示为灰色。",
                options: [
                  {
                    value: "open",
                    title: "Full access",
                    titleZh: "完全访问",
                    description: "Any address can be reached.",
                    descriptionZh: "可以访问任何地址。",
                  },
                  {
                    value: "local",
                    title: "Localhost only",
                    titleZh: "仅本机",
                    description: "Only this machine can be reached.",
                    descriptionZh: "只能访问本机。",
                  },
                  {
                    value: "none",
                    title: "No network",
                    titleZh: "无网络",
                    description: "Nothing can be reached.",
                    descriptionZh: "无法访问任何网络。",
                  },
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
                  {
                    value: "allow-all",
                    title: "Approve everything",
                    titleZh: "全部批准",
                    description: "Every tool call runs without asking.",
                    descriptionZh: "每个工具调用都直接执行，不询问。",
                  },
                  {
                    value: "read-only",
                    title: "Approve read-only",
                    titleZh: "批准只读",
                    description: "Calls that only read run; every other call asks you first.",
                    descriptionZh: "只读的调用直接执行，其余调用先询问你。",
                  },
                  {
                    value: "always-ask",
                    title: "Ask every time",
                    titleZh: "每次询问",
                    description: "Every tool call asks you first.",
                    descriptionZh: "每个工具调用都先询问你。",
                  },
                  {
                    value: "deny-all",
                    title: "Deny everything",
                    titleZh: "全部拒绝",
                    description: "Every tool call is refused.",
                    descriptionZh: "每个工具调用都被拒绝。",
                  },
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
                description:
                  "No sandbox and nothing asked: the agent writes files, runs commands and uses the network freely. For work you trust and watch.",
                descriptionZh:
                  "不进沙盒，也不询问：Agent 可以随意写文件、执行命令、联网。适合你信任并在旁照看的工作。",
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
                description:
                  "No sandbox, but every tool call waits for your approval. For approving the work step by step.",
                descriptionZh: "不进沙盒，但每个工具调用都要等你批准。适合一步步审批。",
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
                description:
                  "Commands and file tools change files only inside the workspace; the network is open and calls run without asking. For everyday coding.",
                descriptionZh:
                  "命令与文件工具只能改工作区内的文件；网络不受限，调用无需询问。适合日常编码。",
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
                description:
                  "Nothing can be written but the temp directory; the network is open and calls run without asking. For exploring, reviewing and answering questions.",
                descriptionZh:
                  "除临时目录外什么都不能写；网络不受限，调用无需询问。适合浏览代码、审阅与答疑。",
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
                description:
                  "Like Workspace Write, but every tool call asks you first. For careful edits.",
                descriptionZh: "与「仅工作区可写」相同，但每个工具调用都先询问你。适合谨慎的修改。",
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
                description:
                  "Every tool call is refused, so the agent can only talk. For a conversation with no tool use.",
                descriptionZh: "每个工具调用都被拒绝，Agent 只能对话。适合不使用工具的纯对话。",
              },
            ],
          },
          // The row a new Session starts from while the switch is on, drawn only as the table's
          // "(Default)" marker. No declared default: the derive hook shows DEFAULT_PRESET, or for a
          // document stored before it the row giving that document's start, else none
          // (settings-policy.ts, prePresetStartOf).
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
              "Confined commands, hook scripts and file tools may write the system temp directory, in either mode. Shells and most tools need one to start; off keeps it read-only too. Off needs a backend that can close it — sandbox-dsh cannot — and is greyed out where the backends in use cannot.",
            descriptionZh:
              "被封禁的命令、钩子脚本与文件工具在两种模式下都可以写系统临时目录。Shell 与大多数工具需要它才能启动；关闭后临时目录同样只读。关闭需要能关闭它的后端（sandbox-dsh 不能），在用的后端不能关闭时显示为灰色。",
            default: true,
          },
          maskPaths: {
            type: "list",
            advanced: true,
            title: "Masked paths",
            titleZh: "屏蔽路径",
            description:
              "Paths hidden from confined commands, hook scripts and file tools, reads included. Needs a backend that masks paths — sandbox-dsh does not: without one, every command is refused while any is listed.",
            descriptionZh:
              "对被封禁的命令、钩子脚本与文件工具隐藏的路径，读取也不例外。需要能屏蔽路径的后端（sandbox-dsh 不能）：没有这样的后端时，只要列了路径，每条命令都会被拒绝。",
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
      sandbox.configure(sandboxStartOf(schema(), pluginConfig.get(SANDBOX_GROUP)).policy);
    }
    pluginConfig.watch(SANDBOX_GROUP, (doc) =>
      sandbox.configure(sandboxStartOf(schema(), doc).policy),
    );
  }
}
