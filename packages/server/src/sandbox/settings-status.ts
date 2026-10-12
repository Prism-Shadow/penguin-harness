/**
 * The Sandbox card's live status (`PluginConfigPage.status`): what this machine enforces and by
 * what, why each installed backend that is not in use is not, a warning when the saved policy
 * needs isolation no usable backend implements, the enum options no backend here can honour,
 * and which backend packages this OS defaults to. A code contribution, so it must not require
 * plugin configuration itself.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SandboxDimension } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigNotice } from "../api/types.js";
import type { PluginConfigUnavailable, SettingsGroupStatus } from "../plugin/config-page.js";
import { Sandbox, SandboxModule } from "./service.js";
import { SANDBOX_DIMENSIONS, requestedDimensions } from "./dimensions.js";
import {
  DEFAULT_PRESET,
  prePresetNotice,
  prePresetStartOf,
  sandboxEnabledOf,
} from "./settings-policy.js";

/**
 * The backend packages each OS defaults to: what the card offers to install when the switch is
 * turned on and no backend for this OS is installed. Linux takes two. Bubblewrap enforces files,
 * network and masked paths, but needs unprivileged user namespaces, which Ubuntu 23.10 and later
 * grant only to AppArmor-profiled programs; sandbox-dsh confines files through Landlock, which
 * needs neither a namespace nor root, so a default Ubuntu is still confined with no step of its
 * own. Where both load, bubblewrap serves every policy (service.ts prefers the backend
 * implementing more).
 */
const DEFAULT_BACKENDS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  linux: ["@penguinharness/sandbox-bwrap", "@penguinharness/sandbox-dsh"],
  darwin: ["@penguinharness/sandbox-seatbelt"],
  win32: ["@penguinharness/sandbox-wsl"],
};

/** Each dimension as the card names it, in English and Chinese. */
const DIMENSION_WORDS: Record<SandboxDimension, readonly [string, string]> = {
  "fs-write": ["file writes", "文件写入"],
  network: ["network isolation", "网络隔离"],
  "network-local": ["localhost-only network", "仅本机网络"],
  "mask-paths": ["masked paths", "屏蔽路径"],
  "closed-temp": ["closing the temporary directory", "关闭临时目录"],
};

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

type MountedBackend = ReturnType<Sandbox["backends"]>[number];

/**
 * The card's headline while a backend serves: what this machine enforces, by the backends a
 * policy can go to, and what it does not. A backend is named when it covers a dimension none
 * preferred over it does — the backend serving every policy alone where it covers all the
 * others do. Under it are disclosed the named backends' own limits on this host, then each
 * installed backend that is not in use with its reason — the refusal names its own remedy
 * (bubblewrap's names the optional root step on Ubuntu) — and that a save of the card checks
 * them again.
 */
export function enforcementNotice(
  backends: readonly MountedBackend[],
  failures: ReadonlyArray<{ name: string; reason: string }>,
): PluginConfigNotice {
  const serving: MountedBackend[] = [];
  const covered: SandboxDimension[] = [];
  for (const backend of backends) {
    const adds = backend.dimensions.filter((d) => !covered.includes(d));
    if (adds.length === 0) continue;
    serving.push(backend);
    covered.push(...adds);
  }
  const nameOf = (b: MountedBackend) =>
    b.mechanism !== undefined ? `${b.mechanism} (${b.name})` : b.name;
  const enforced = SANDBOX_DIMENSIONS.filter((d) => covered.includes(d));
  const missing = SANDBOX_DIMENSIONS.filter((d) => !covered.includes(d));
  const en = (ds: readonly SandboxDimension[]) => andList(ds.map((d) => DIMENSION_WORDS[d][0]));
  const zh = (ds: readonly SandboxDimension[]) => ds.map((d) => DIMENSION_WORDS[d][1]).join("、");
  const notice: PluginConfigNotice = {
    tone: "muted",
    text:
      `Enforced here: ${en(enforced)}, by ${andList(serving.map(nameOf))}.` +
      (missing.length > 0 ? ` Not enforced here: ${en(missing)}.` : ""),
    textZh:
      `本机实施：${zh(enforced)}，由 ${serving.map(nameOf).join("、")} 实施。` +
      (missing.length > 0 ? `本机不实施：${zh(missing)}。` : ""),
  };
  const limits = serving.flatMap((b) => b.limits ?? []);
  const lines = [
    ...limits.map((l) => l.text),
    ...failures.map(({ name, reason }) => `${name} is installed but not in use: ${reason}`),
  ];
  const linesZh = [
    ...limits.map((l) => l.textZh ?? l.text),
    ...failures.map(({ name, reason }) => `${name} 已安装但未启用：${reason}`),
  ];
  if (failures.length > 0) {
    lines.push("Saving this card checks these backends again.");
    linesZh.push("保存此卡片会重新检查这些后端。");
  }
  return lines.length === 0
    ? notice
    : { ...notice, details: lines.join("\n"), detailsZh: linesZh.join("\n") };
}

/**
 * The temp choice where no mounted backend can close the temporary directory (the DSH adaptor
 * alone, whose temp stays writable): its off position is greyed out and a save turning it off
 * refused. With none mounted every confining choice is refused alike, which the card's warning
 * says.
 */
export function unavailableClosedTemp(
  backends: readonly MountedBackend[],
): PluginConfigUnavailable[] {
  if (backends.length === 0 || backends.some((b) => b.dimensions.includes("closed-temp"))) {
    return [];
  }
  const names = backends.map((b) => b.name).join(", ");
  return [
    {
      field: "writableTemp",
      value: "false",
      reason: `the sandbox backend in use here (${names}) cannot close the temporary directory: it stays writable`,
      reasonZh: `本机在用的沙盒后端（${names}）无法关闭临时目录：它始终可写`,
    },
  ];
}

/**
 * The network levels no mounted backend can enforce, for the presets table's network column.
 * Localhost only needs a backend declaring it, and is greyed out wherever none does. No network
 * is greyed out where a backend serves but none isolates the network — the DSH adaptor alone;
 * with none mounted every confining choice is refused alike, which the card's warning says.
 */
export function unavailableNetworks(
  backends: readonly MountedBackend[],
): PluginConfigUnavailable[] {
  const covers = (d: SandboxDimension) => backends.some((b) => b.dimensions.includes(d));
  const unavailable: PluginConfigUnavailable[] = [];
  if (!covers("network-local")) {
    unavailable.push({
      field: "presets",
      column: "network",
      value: "local",
      reason: "no sandbox backend on this host supports it",
      reasonZh: "本机的沙盒后端不支持",
    });
  }
  if (backends.length > 0 && !covers("network")) {
    const names = backends.map((b) => b.name).join(", ");
    unavailable.push({
      field: "presets",
      column: "network",
      value: "none",
      reason: `the sandbox backend in use here (${names}) confines files only and does not isolate the network`,
      reasonZh: `本机在用的沙盒后端（${names}）只封禁文件，不隔离网络`,
    });
  }
  return unavailable;
}

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
      // one that declined is for another OS. Installing the defaults would not fix a failure.
      backend: () => {
        const recommended = DEFAULT_BACKENDS[process.platform];
        return {
          installed: sandbox.backends().length > 0 || sandbox.failures().length > 0,
          ...(recommended !== undefined ? { recommended: [...recommended] } : {}),
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
        const prePreset = prePresetNotice(stored, configuration);
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
        // With nothing serving, why each installed backend is not in use is the headline.
        for (const { name, reason } of sandbox.failures()) {
          notices.push({
            tone: "attention",
            text: `${name} is not in use: ${reason}`,
            textZh: `${name} 未启用：${reason}`,
          });
        }
        return notices;
      },
    };
  }
}
