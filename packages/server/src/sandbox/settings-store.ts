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
import type { SandboxMode, SandboxSettings as Policy } from "@prismshadow/penguin-core/plugin";
import type {
  PluginConfigNotice,
  PluginConfiguration,
  SessionSandboxPreset,
} from "../api/types.js";
import { PluginConfig, resolveTable } from "../plugin/config.js";
import type { SettingsGroupStatus } from "../plugin/config-page.js";
import { Sandbox, SandboxModule } from "./service.js";
import { requestedDimensions } from "./dimensions.js";

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

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

/**
 * Whether the switch is on in a stored document (defaults merged). A document saved before the
 * switch existed has no `enabled`: it reads as on exactly when its policy confined anything — a
 * mode other than Off, or (under Off) a network cut or masked paths, which also need a backend —
 * so a deployment that was confined stays confined. The document is never rewritten for it.
 * TODO(sandbox-switch-compat): a save writes only the fields it changes, so a pre-switch
 * document keeps lacking `enabled` until its switch is toggled; the fallback can go only when
 * the maintainers choose a one-time migration or an announced break for such documents (see
 * the 2026-10-02 backward-compatibility changelog entry).
 */
export function sandboxEnabledOf(doc: Record<string, unknown>): boolean {
  if (typeof doc.enabled === "boolean") return doc.enabled;
  const policy = configuredPolicyOf(doc);
  return policy.mode !== "danger-full-access" || requestedDimensions(policy).length > 1;
}

/**
 * A stored document (defaults merged) as the service's policy: the configured one while the
 * switch is on, nothing confined while it is off. The mode, network and the rest stay stored
 * while off, and apply again when the switch is turned back on.
 */
export function sandboxPolicyOf(doc: Record<string, unknown>): Policy {
  return sandboxEnabledOf(doc) ? configuredPolicyOf(doc) : { mode: "danger-full-access" };
}

/** The policy the document's fields describe, whatever the switch says. */
function configuredPolicyOf(doc: Record<string, unknown>): Policy {
  const mode = MODES.includes(doc.mode as SandboxMode)
    ? (doc.mode as SandboxMode)
    : "danger-full-access";
  const maskPaths = Array.isArray(doc.maskPaths)
    ? doc.maskPaths.filter((p): p is string => typeof p === "string" && p !== "")
    : [];
  return {
    mode,
    ...(doc.network === "none" || doc.network === "local" ? { network: doc.network } : {}),
    ...(maskPaths.length > 0 ? { maskPaths } : {}),
    ...(doc.writableTemp === false ? { writableTemp: false } : {}),
  };
}

/**
 * The group's presets table as the composer reads it: every row in table order, disabled ones
 * included. `schema` is the group's declared configuration, `doc` its stored document — the
 * table's cells are stored only where they differ from the declaration.
 */
export function sandboxPresetsOf(
  schema: PluginConfiguration | undefined,
  doc: Record<string, unknown>,
): SessionSandboxPreset[] {
  const field = schema?.properties.presets;
  if (field?.type !== "table") return [];
  return resolveTable(field, doc.presets).map(({ id, values, valuesZh }) => ({
    id,
    name: values.name as string,
    ...(valuesZh?.name !== undefined ? { nameZh: valuesZh.name } : {}),
    enabled: values.enabled === true,
    mode: values.mode as SessionSandboxPreset["mode"],
    network: values.network as SessionSandboxPreset["network"],
    approvalMode: values.approvalMode as SessionSandboxPreset["approvalMode"],
  }));
}

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
            title: "Confine new sessions",
            titleZh: "新会话进入沙盒",
            description:
              "Off: a new session starts with full file and network access, held only by its approval mode. Sessions that already exist keep their own policy.",
            descriptionZh:
              "关闭时，新会话拥有完全的文件与网络访问，只受审批模式约束。已有会话保留各自的策略。",
          },
          // The composer's menu: each preset a named mode, network level and approval mode.
          // Names and mappings only — the fields below are the policy, and sandboxPolicyOf never
          // reads this. Declared first so the card draws the table on top. Full Access keeps
          // its promise (nothing confined, everything approved): only its name and whether the
          // menu lists it can change.
          presets: {
            type: "table",
            title: "Presets",
            titleZh: "预设",
            description:
              "What the composer's permission menu offers. A rename keeps the mapping; a Session keeps its own mode, network and approval mode, and the menu names it by the first row that matches.",
            descriptionZh:
              "输入框权限菜单提供的选项。改名不改映射；会话只保存自己的封禁模式、网络与审批方式，菜单按第一个匹配的行为它命名。",
            columns: [
              { name: "name", type: "string", title: "Name", titleZh: "名称" },
              { name: "enabled", type: "boolean", title: "In menu", titleZh: "进菜单" },
              {
                name: "mode",
                type: "enum",
                title: "Files",
                titleZh: "文件",
                options: [
                  { value: "danger-full-access", title: "Off", titleZh: "关闭" },
                  { value: "workspace-write", title: "Workspace", titleZh: "仅工作区" },
                  { value: "read-only", title: "Read-only", titleZh: "只读" },
                ],
              },
              {
                name: "network",
                type: "enum",
                title: "Network",
                titleZh: "网络",
                options: [
                  { value: "open", title: "Full", titleZh: "完全" },
                  { value: "local", title: "Localhost", titleZh: "仅本机" },
                  { value: "none", title: "None", titleZh: "无"} ,
                ],
              },
              {
                name: "approvalMode",
                type: "enum",
                title: "Ask mode",
                titleZh: "询问模式",
                options: [
                  { value: "allow-all", title: "Approve all", titleZh: "全部批准" },
                  { value: "read-only", title: "Approve reads", titleZh: "批准只读" },
                  { value: "always-ask", title: "Ask every time", titleZh: "每次询问" },
                  { value: "deny-all", title: "Deny all", titleZh: "全部拒绝" },
                ],
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
          mode: {
            type: "enum",
            title: "Confinement mode",
            advanced: true,
            titleZh: "封禁模式",
            default: "danger-full-access",
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
          network: {
            type: "enum",
            title: "Network",
            advanced: true,
            titleZh: "网络",
            description:
              "What a confined command, hook script or read_file URL may reach. Local network allows only this machine's localhost, and needs a backend that can enforce it.",
            descriptionZh:
              "被封禁的命令、钩子脚本与 read_file 的 URL 能访问的网络。本地网络只允许访问本机 localhost，需要能实施它的后端。",
            default: "open",
            options: [
              { value: "open", title: "Full access", titleZh: "完全访问" },
              {
                value: "local",
                title: "Local network (localhost only)",
                titleZh: "本地网络（仅本机 localhost）",
              },
              { value: "none", title: "No network", titleZh: "无网络" },
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
              "One absolute path per line, hidden from confined commands, hook scripts and file tools (reads included).",
            descriptionZh: "每行一个绝对路径，对被封禁的命令、钩子脚本与文件工具隐藏（包括读取）。",
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
    if (pluginConfig.saved(SANDBOX_GROUP)) {
      sandbox.configure(sandboxPolicyOf(pluginConfig.get(SANDBOX_GROUP)));
    }
    pluginConfig.watch(SANDBOX_GROUP, (doc) => sandbox.configure(sandboxPolicyOf(doc)));
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
      derive: (values) => ({ ...values, enabled: sandboxEnabledOf(values) }),
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
        // The presets' network column follows the same rule as the field.
        return [
          { field: "network", ...why },
          { field: "presets", column: "network", ...why },
        ];
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
