/**
 * The Sandbox card's live status (`PluginConfigPage.status`): what this machine enforces and by
 * what, why each installed backend that is not in use is not, a warning when the saved policy
 * needs isolation no usable backend implements, the enum options no backend here can honour,
 * and which backend packages this OS defaults to — as the embedded plugin index declares them,
 * since the host names no backend of its own. Its report lists every registered backend on
 * one line — in use, installed but not in use (why folded under it), for another platform —
 * linked to the page of the plugin that registered it, where that backend's own options and
 * checks are. A code contribution, so it must not require plugin configuration itself.
 *
 * The reads themselves are `@prismshadow/penguin-library-sandbox`; what stays here is the
 * contributor half — the component that owns them and the plugin host that feeds them (the
 * backends' page links, the index's defaults for this OS).
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { PluginConfigNotice, PluginStatusReport } from "../api/types.js";
import type { SettingsGroupStatus } from "../plugin/config-page.js";
import { resolveTable } from "../plugin/config.js";
import { pluginHostFrom, pluginTitleOf } from "../plugin/host.js";
import { sandboxDefaultsFor } from "../plugin/registry.js";
import { Sandbox, SandboxModule } from "./service.js";
import { requestedDimensions } from "@prismshadow/penguin-library-sandbox/dimensions";
import {
  DEFAULT_PRESET,
  prePresetNotice,
  prePresetStartOf,
  sandboxEnabledOf,
} from "@prismshadow/penguin-library-sandbox/policy";
import {
  backendChecks,
  enforcementNotice,
  unavailableClosedTemp,
  unavailableNetworks,
} from "@prismshadow/penguin-library-sandbox/status";

export { enforcementNotice };

/**
 * The sandbox card's live notices: a warning when the saved policy needs isolation no usable
 * backend implements (every command would be refused), what the machine enforces, and each
 * backend that failed to load, with its reason. A backend that declined because this host is not
 * its platform is no fault of the deployment — it is named only when nothing else serves, where
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
  setup({ resources }: ClassCtx) {
    const sandbox = this.sandbox;
    const host = pluginHostFrom(resources);
    this.status = {
      // Every backend on a line of its own, linked to its plugin's page; "check again" loads
      // the ones that failed again, as a save does.
      report: (): PluginStatusReport | undefined => {
        const checks = backendChecks(sandbox, (specifier) => pluginTitleOf(host, specifier));
        return checks.length === 0 ? undefined : { checks, recheck: "check" };
      },
      actions: () =>
        sandbox.origins().length === 0
          ? []
          : [
              {
                id: "check",
                title: "Check again",
                titleZh: "重新检查",
                description: "Loads again every backend that failed its check.",
                descriptionZh: "重新加载每个未通过检查的后端。",
              },
            ],
      run: async (action) => {
        if (action !== "check") return { ok: false, message: `No action ${action}.` };
        await sandbox.retryFailed();
        return { ok: true, message: "Checked again.", messageZh: "已重新检查。" };
      },
      // The switch and the default as the card shows them, for a document saved before they
      // existed: the switch off its old policy; the default the row that gives that document's
      // start, or none when no row does.
      derive: (values, stored, configuration) => {
        // Read off the whole document: a pre-switch one's mode and network are not fields.
        const prePreset = prePresetStartOf(configuration, stored, resolveTable);
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
      // row matches shows none: the save writes none, and its own start stays (the policy reads).
      saving: (update, current) =>
        update.defaultPreset !== undefined || current.defaultPreset === undefined
          ? update
          : { ...update, defaultPreset: current.defaultPreset },
      // A backend for this OS is installed when it is in use or failed (to load, or its check):
      // one that declined is for another OS. Installing the defaults would not fix a failure.
      // The defaults are the index's: each backend's package declares the platforms it is the
      // default for, and none declared for this one offers nothing.
      backend: () => {
        const recommended = sandboxDefaultsFor(process.platform);
        return {
          installed: sandbox.backends().length > 0 || sandbox.failures().length > 0,
          ...(recommended.length > 0 ? { recommended } : {}),
        };
      },
      // A backend reads its own group (drawn inside this card) at load: after a save of the
      // card, one that failed its check — a wrong program path — loads again, no restart.
      saved: () => sandbox.retryFailed(),
      // Greyed out with the reason; a save choosing one is refused.
      unavailable: () => [
        ...unavailableNetworks(sandbox.backends()),
        ...unavailableClosedTemp(sandbox.backends()),
      ],
      notices: (stored, configuration): PluginConfigNotice[] => {
        const notices: PluginConfigNotice[] = [];
        const prePreset = prePresetNotice(stored, configuration, resolveTable);
        if (prePreset !== undefined) notices.push(prePreset);
        const backends = sandbox.backends();
        const settings = sandbox.currentSettings();
        const required = requestedDimensions(settings);
        // Full access needs a backend too once it cuts the network or masks a path.
        if (settings.mode !== "danger-full-access" || required.length > 1) {
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
        if (backends.length > 0) {
          // Confinement works: a backend that is not in use is disclosed under the headline.
          notices.push(enforcementNotice(backends, sandbox.failures()));
          return notices;
        }
        const declined = sandbox.declined();
        const elsewhere =
          declined.length === 0
            ? ""
            : ` ${declined.join(", ")} ${declined.length === 1 ? "is" : "are"} installed, but for another platform.`;
        const elsewhereZh =
          declined.length === 0 ? "" : `已安装 ${declined.join("、")}，但它们适用于其他平台。`;
        notices.push({
          tone: "attention",
          text: `This deployment has no usable sandbox backend: until one for this platform is installed from the Plugins page, every mode but Full access refuses every agent command and hook script.${elsewhere}`,
          textZh: `当前部署没有可用的沙盒后端：在插件页安装适用于本平台的后端之前，除「完全访问」外的任何模式都会拒绝 Agent 的每条命令与钩子脚本。${elsewhereZh}`,
        });
        // Why each installed backend is not in use is on its own line in the report.
        return notices;
      },
    };
  }
}
