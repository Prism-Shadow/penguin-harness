/**
 * The Sandbox card's live status (`PluginConfigPage.status`): whether the saved policy can be
 * enforced, which backends are in use, and why each other one is not — a backend that failed to
 * load, failed its check or runs on another platform is named with its reason, never left out —
 * plus the enum options no backend here can honour and the backend package this OS defaults
 * to. A code contribution, so it must not require plugin configuration itself.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { PluginConfigNotice } from "../api/types.js";
import type { SettingsGroupStatus } from "../plugin/config-page.js";
import { Sandbox, SandboxModule } from "./service.js";
import { requestedDimensions } from "./dimensions.js";
import {
  DEFAULT_PRESET,
  prePresetNotice,
  prePresetStartOf,
  sandboxEnabledOf,
} from "./settings-policy.js";

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
      // The switch and the default as the card shows them, for a document saved before they
      // existed: the switch off its old policy; the default the row that gives that document's
      // start, or none when no row does.
      derive: (values, stored, configuration) => {
        // Read off the whole document: a pre-switch one's mode and network are not fields.
        const prePreset = prePresetStartOf(configuration, stored);
        const { defaultPreset: chosen, ...rest } = values;
        const defaultPreset = prePreset !== undefined ? prePreset.row : (chosen ?? DEFAULT_PRESET);
        return {
          ...rest,
          enabled: sandboxEnabledOf(stored),
          ...(defaultPreset !== undefined ? { defaultPreset } : {}),
        };
      },
      // A save pins the default the card shows, so what new Sessions start from changes only
      // when an administrator picks a row. A document saved before the default preset that no
      // row matches shows none: the save writes none, and its own start stays (settings-policy.ts).
      saving: (update, current) =>
        update.defaultPreset !== undefined || current.defaultPreset === undefined
          ? update
          : { ...update, defaultPreset: current.defaultPreset },
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
      notices: (stored, configuration): PluginConfigNotice[] => {
        const notices: PluginConfigNotice[] = [];
        const prePreset = prePresetNotice(stored, configuration);
        if (prePreset !== undefined) notices.push(prePreset);
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
