/**
 * The RSI toolkits the Optimize tab offers, built from the plugin library each time the dialog
 * opens: one option per plugin of the library's `rsi` category (GET /api/plugins). Nothing here
 * lists the toolkits, so one an admin installs on the Plugins page is offered the next time the
 * dialog opens, and one that is removed is gone.
 *
 * The default toolkit is the product's own loop and is told apart by its plugin name: it comes
 * first, keeps the form the tab has always had, and preselects its optimizer beside the evaluator
 * that ships in the Agent Evaluation plugin. Every other toolkit runs its paper's loop through one
 * Skill of its own: the one named like the plugin, else the first Skill its quick start preselects
 * that it ships, else its only Skill. A plugin none of these settles is not offered. The label and
 * the hint are the plugin's own display name and short description, in the reader's language.
 */
import type { PluginItem, PluginLibraryResponse } from "@prismshadow/penguin-server/api";
import { localizedText } from "./skill-use";

/** The plugin library's category the self-evolution toolkits are filed under. */
export const RSI_CATEGORY = "rsi";

/** The plugin of the product's own trial → reflect → improve loop. */
export const DEFAULT_TOOLKIT_PLUGIN = "default-rsi-toolkit";
/** The default loop's optimizer Skill, shipped in the default toolkit. */
export const OPTIMIZATION_SKILL = "agent-optimization";
/** The Skill every evaluation goes through, shipped in the Agent Evaluation plugin. */
export const EVALUATION_SKILL = "agent-evaluation";

/** One option of the Method select. */
export interface RsiMethod {
  /** The plugin that ships the toolkit: the option's value, and what the missing-Skill notice names. */
  plugin: string;
  /** The default loop's form (round limit, target score), or a paper's loop with its own budget. */
  kind: "default" | "paper";
  /** The optimizer Skill the conversation preselects and the tail hands the work to. */
  skill: string;
  /** The plugin's display name, else its name. */
  label: string;
  /** The plugin's short description, else its full one; "" when it carries neither. */
  hint: string;
}

/** The library's self-evolution toolkits: the plugins of its `rsi` category. */
export function rsiToolkits(library: PluginLibraryResponse): PluginItem[] {
  return library.groups.find((group) => group.id === RSI_CATEGORY)?.plugins ?? [];
}

/** The Skill a paper toolkit runs, or null when its manifest does not settle one. */
function paperSkill(plugin: PluginItem): string | null {
  const shipped = plugin.skills.map((skill) => skill.name);
  if (shipped.includes(plugin.name)) return plugin.name;
  const preselected = plugin.quickStart?.skills?.find((skill) => shipped.includes(skill));
  if (preselected !== undefined) return preselected;
  return shipped.length === 1 ? shipped[0]! : null;
}

/** A description as the reader's language picks it: short before full, Chinese before English in zh. */
function hintOf(plugin: PluginItem, locale: "zh" | "en"): string {
  return locale === "zh"
    ? plugin.shortDescriptionZh ||
        plugin.descriptionZh ||
        plugin.shortDescription ||
        plugin.description
    : plugin.shortDescription || plugin.description;
}

/** The Method select's options for these toolkits: the default first, the rest in library order. */
export function rsiMethods(toolkits: readonly PluginItem[], locale: "zh" | "en"): RsiMethod[] {
  const methods: RsiMethod[] = [];
  for (const plugin of toolkits) {
    const isDefault = plugin.name === DEFAULT_TOOLKIT_PLUGIN;
    const skill = isDefault ? OPTIMIZATION_SKILL : paperSkill(plugin);
    if (skill === null) continue;
    methods.push({
      plugin: plugin.name,
      kind: isDefault ? "default" : "paper",
      skill,
      label: localizedText(locale, plugin.title || plugin.name, plugin.titleZh),
      hint: hintOf(plugin, locale),
    });
  }
  return methods.sort((a, b) => Number(b.kind === "default") - Number(a.kind === "default"));
}

/** The option `plugin` names when it is offered, else the first one; null when none is. */
export function pickRsiMethod(methods: readonly RsiMethod[], plugin: string): RsiMethod | null {
  return methods.find((method) => method.plugin === plugin) ?? methods[0] ?? null;
}
