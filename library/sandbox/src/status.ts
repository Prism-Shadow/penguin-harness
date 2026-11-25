/**
 * The Sandbox card's live status reads (`PluginConfigPage.status`'s pure half): what this machine
 * enforces and by what, why each installed backend that is not in use is not, a warning when the
 * saved policy needs isolation no usable backend implements, the enum options no backend here can
 * honour, and which backend packages this OS defaults to — as the embedded plugin index declares
 * them, since the host names no backend of its own. Its report lists every registered backend on
 * one line — in use, installed but not in use (why folded under it), for another platform —
 * linked to the page of the plugin that registered it, where that backend's own options and
 * checks are.
 *
 * The plugin host crosses these reads through a STRUCTURAL port: the display name of a loaded
 * plugin's package, injected by the caller. The card's status CONTRIBUTOR itself (the component
 * that owns these reads and the plugin host that feeds them) stays with the harness's plugin
 * machinery — nothing here imports it.
 */
import type { SandboxDimension } from "@prismshadow/penguin-core/plugin";
import { SANDBOX_DIMENSIONS } from "./dimensions.js";
import type { Sandbox, SandboxBackend } from "./service.js";
import type { SandboxConfigNotice } from "./policy.js";

/** One enum option a settings group cannot honour on this machine, and why. */
export interface SandboxConfigUnavailable {
  field: string;
  /** A `table` field's column: the option is unavailable in every cell of that column. */
  column?: string;
  /** An enum option, or a boolean field's position: "true" or "false". */
  value: string;
  reason: string;
  reasonZh?: string;
}

/** One precondition the plugin checks on this machine, as the sandbox's status reports it. */
export interface SandboxStatusCheck {
  id: string;
  /** What is checked, in a few words ("Display", "Accessibility"). */
  label: string;
  labelZh?: string;
  /**
   * `ok` holds; `action` needs a person; `unknown` could not be told yet; `na` does not apply
   * on this machine.
   */
  state: "ok" | "action" | "unknown" | "na";
  /** One line in the plugin's own words: what was found, or what to do. */
  text?: string;
  textZh?: string;
  /** Folded under the row: a tool's own words, paths; lines separated by `\n`. */
  details?: string;
  detailsZh?: string;
  /** The action drawn on this row (open System Settings). */
  action?: string;
  /** A Settings page this row opens, drawn as a link on the row (`plugin:<specifier>`). */
  page?: string;
}

/** A loaded plugin's display name, from its card. */
export interface SandboxPluginTitle {
  title: string;
  titleZh?: string;
}

/**
 * The display name of a loaded plugin's package, by the specifier the plugin list names it
 * with — the plugin host's title lookup, injected. Undefined when the package is not loaded
 * or carries no titled card.
 */
export type SandboxTitleOf = (specifier: string) => SandboxPluginTitle | undefined;

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
  backends: readonly SandboxBackend[],
  failures: ReadonlyArray<{ name: string; reason: string }>,
): SandboxConfigNotice {
  const serving: SandboxBackend[] = [];
  const covered: SandboxDimension[] = [];
  for (const backend of backends) {
    const adds = backend.dimensions.filter((d) => !covered.includes(d));
    if (adds.length === 0) continue;
    serving.push(backend);
    covered.push(...adds);
  }
  const nameOf = (b: SandboxBackend) =>
    b.mechanism !== undefined ? `${b.mechanism} (${b.name})` : b.name;
  const enforced = SANDBOX_DIMENSIONS.filter((d) => covered.includes(d));
  const missing = SANDBOX_DIMENSIONS.filter((d) => !covered.includes(d));
  const en = (ds: readonly SandboxDimension[]) => andList(ds.map((d) => DIMENSION_WORDS[d][0]));
  const zh = (ds: readonly SandboxDimension[]) => ds.map((d) => DIMENSION_WORDS[d][1]).join("、");
  const notice: SandboxConfigNotice = {
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
  backends: readonly SandboxBackend[],
): SandboxConfigUnavailable[] {
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
  backends: readonly SandboxBackend[],
): SandboxConfigUnavailable[] {
  const covers = (d: SandboxDimension) => backends.some((b) => b.dimensions.includes(d));
  const unavailable: SandboxConfigUnavailable[] = [];
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
 * One line per registered backend, in routing order: its plugin's name (the backend's own when no
 * plugin registered it), where it stands, and a link to that plugin's page. A backend that has not
 * settled yet is not known.
 */
export function backendChecks(sandbox: Sandbox, titleOf: SandboxTitleOf): SandboxStatusCheck[] {
  const mounted = new Map(sandbox.backends().map((b) => [b.name, b]));
  const failed = new Map(sandbox.failures().map((f) => [f.name, f.reason]));
  const declined = new Set(sandbox.declined());
  return sandbox.origins().map(({ name, package: pkg }): SandboxStatusCheck => {
    const title = pkg === undefined ? undefined : titleOf(pkg);
    const base = {
      id: name,
      label: title?.title ?? name,
      ...(title?.titleZh !== undefined ? { labelZh: title.titleZh } : {}),
      ...(pkg !== undefined ? { page: `plugin:${pkg}` } : {}),
    };
    const serving = mounted.get(name);
    if (serving !== undefined) {
      const by = serving.mechanism !== undefined ? ` (${serving.mechanism})` : "";
      return { ...base, state: "ok", text: `In use${by}`, textZh: `在用${by}` };
    }
    const reason = failed.get(name);
    if (reason !== undefined) {
      return {
        ...base,
        state: "action",
        text: "Installed, not in use",
        textZh: "已安装，未启用",
        details: reason,
      };
    }
    if (declined.has(name)) {
      return { ...base, state: "na", text: "For another platform", textZh: "适用于其他平台" };
    }
    return { ...base, state: "unknown", text: "Checking…", textZh: "检查中…" };
  });
}
