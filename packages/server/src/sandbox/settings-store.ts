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
 * `SandboxSettingsStatus` reports which backends can enforce the policy, as live notices; it
 * is a code contribution, so it must not require plugin configuration itself.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SandboxMode, SandboxSettings as Policy } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigNotice } from "../api/types.js";
import { PluginConfig } from "../plugin/config.js";
import type { SettingsGroupStatus } from "../plugin/config.js";
import { Sandbox, SandboxModule } from "./service.js";

/** The sandbox's group name (its contribution id), and the parent a backend's group names. */
export const SANDBOX_GROUP = "sandbox";

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

/** A stored document (defaults merged) as the service's policy. */
export function sandboxPolicyOf(doc: Record<string, unknown>): Policy {
  const mode = MODES.includes(doc.mode as SandboxMode)
    ? (doc.mode as SandboxMode)
    : "danger-full-access";
  const maskPaths = Array.isArray(doc.maskPaths)
    ? doc.maskPaths.filter((p): p is string => typeof p === "string" && p !== "")
    : [];
  return {
    mode,
    ...(doc.cutNetwork === true ? { network: "none" as const } : {}),
    ...(maskPaths.length > 0 ? { maskPaths } : {}),
  };
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
          "The confinement agent commands run under, enforced by a sandbox backend plugin. Applies to the next command spawn.",
        descriptionZh: "Agent 执行命令时的封禁策略，由沙盒后端插件实施。对下一次命令启动生效。",
        properties: {
          mode: {
            type: "enum",
            title: "Confinement mode",
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
          cutNetwork: {
            type: "boolean",
            title: "Cut off the network",
            titleZh: "断开网络",
            default: false,
          },
          maskPaths: {
            type: "list",
            title: "Masked paths",
            titleZh: "屏蔽路径",
            description:
              "One absolute path per line, hidden from confined commands (reads included).",
            descriptionZh: "每行一个绝对路径，对被封禁的命令隐藏（包括读取）。",
            maxItems: 64,
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

/** The sandbox card's live notices: the mounted backends and what each enforces, or that none is mounted. */
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
      notices: (): PluginConfigNotice[] => {
        const backends = sandbox.backends();
        if (backends.length === 0) {
          return [
            {
              tone: "attention",
              text: "This deployment has no sandbox backend: a mode confines nothing until one for this platform is installed from the Plugins page.",
              textZh:
                "当前部署没有沙盒后端：在插件页安装适用于本平台的后端之前，选择任何模式都不会产生约束。",
            },
          ];
        }
        const list = backends.map((b) => `${b.name} (${b.dimensions.join(", ")})`).join(" · ");
        return [{ tone: "muted", text: `Backends: ${list}`, textZh: `后端：${list}` }];
      },
    };
  }
}
