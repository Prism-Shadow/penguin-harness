/**
 * Sandbox settings, as settings groups: the confinement every agent command spawns under is a
 * schema contributed to `PluginConfigProvider.groups`, and each mounted backend's own options
 * (declared on its `SandboxModule.providers` contribution) are groups drawn inside it. The
 * Plugins page draws and saves them like any plugin's options, so neither the sandbox nor a
 * backend ships a page of its own; the values live where every entry's do (`server_settings`,
 * `plugin-config:<name>`), so a restart keeps them.
 *
 * Two nodes, because the kernel creates a slot's contributors before its owner: the groups
 * only read the sandbox service, and a second node reads the stored documents back through
 * `PluginConfig` and applies them. The service itself stays on the capability-free floor (a
 * bare kernel boots it with no database), and its parked context still carries the settings
 * across a hot swap; on boot a stored document wins.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SandboxMode, SandboxSettings } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigNotice, PluginConfiguration } from "../api/types.js";
import { PluginConfig, parsePluginConfiguration } from "../plugin/config.js";
import type { SettingsGroup, SettingsGroupSource } from "../plugin/config.js";
import { Sandbox, SandboxModule } from "./service.js";

/** The sandbox's own group: its name is the store key and the parent of every backend's group. */
export const SANDBOX_GROUP = "sandbox";

/** The group a backend's own options are stored and drawn under. */
export const backendGroup = (backend: string): string => `${SANDBOX_GROUP}:${backend}`;

/** The confinement policy, as a schema the settings page draws. */
export const SANDBOX_CONFIGURATION: PluginConfiguration = {
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
        { value: "danger-full-access", title: "Off (full access)", titleZh: "关闭（完全访问）" },
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
      description: "One absolute path per line, hidden from confined commands (reads included).",
      descriptionZh: "每行一个绝对路径，对被封禁的命令隐藏（包括读取）。",
      maxItems: 64,
    },
  },
};

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

/** A stored document (defaults merged) as the service's settings. */
export function sandboxSettingsOf(doc: Record<string, unknown>): SandboxSettings {
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

/** What the sandbox's card reports beside its fields: which backends can enforce it, or that none can. */
function backendNotices(sandbox: Sandbox): PluginConfigNotice[] {
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
}

/** The sandbox's group, then one group per mounted backend that declares options. */
@Component({
  contributes: {
    "PluginConfigProvider.groups": [{ id: "sandbox.settings", order: 0 }],
  },
})
export class SandboxSettingsGroups {
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  @Bind("sandbox.settings") groups!: SettingsGroupSource;
  setup() {
    const sandbox = this.sandbox;
    this.groups = {
      groups: () => {
        const declared = sandbox.declaredConfigurations();
        const backends: SettingsGroup[] = [];
        // Mounted ones only: a backend that cannot serve this host (MXC off Windows) loads as
        // nothing, and options for it would be a form for something that is not here.
        for (const { name } of sandbox.backends()) {
          if (declared[name] === undefined) continue;
          try {
            const configuration = parsePluginConfiguration(
              declared[name],
              `SandboxModule.providers "${name}"`,
            );
            if (configuration !== undefined) {
              backends.push({ name: backendGroup(name), parent: SANDBOX_GROUP, configuration });
            }
          } catch (err) {
            console.warn(`[sandbox] ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return [
          {
            name: SANDBOX_GROUP,
            configuration: SANDBOX_CONFIGURATION,
            notices: backendNotices(sandbox),
          },
          ...backends,
        ];
      },
    };
  }
}

/** Applies the stored documents to the service on boot and after every save. */
@Component()
export class SandboxSettingsApplier {
  @Use() private readonly pluginConfig!: PluginConfig;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  setup() {
    const { pluginConfig, sandbox } = this;
    // A saved document wins; with none saved the service keeps what the swap carried —
    // applying the defaults here would un-confine a deployment on every hot update.
    if (pluginConfig.saved(SANDBOX_GROUP)) {
      sandbox.configure(sandboxSettingsOf(pluginConfig.get(SANDBOX_GROUP)));
    }
    pluginConfig.watch(SANDBOX_GROUP, (doc) => sandbox.configure(sandboxSettingsOf(doc)));
    for (const name of Object.keys(sandbox.declaredConfigurations())) {
      pluginConfig.watch(backendGroup(name), (doc) => sandbox.configureBackend(name, doc));
    }
    // A backend's group is listed once it has mounted, and its defaults come from that
    // listing; backends load asynchronously, so their stored options are read after that.
    void sandbox.whenReady().then(() => {
      for (const name of Object.keys(sandbox.declaredConfigurations())) {
        sandbox.configureBackend(name, pluginConfig.get(backendGroup(name)));
      }
    });
  }
}
