/**
 * What the sandbox's settings document (settings-store.ts declares it) means for a NEW Session:
 * whether the switch is on, and the policy and approval mode the Session starts with, and the
 * card's notice when that start is one no preset gives. Pure reads of the stored document —
 * nothing here writes it.
 *
 * With the switch off, a new Session starts unconfined and its approval mode is the request's
 * (or the server's fallback). With it on, it starts from the card's default preset: that row's
 * file mode, network and approval mode, plus the card's temp-directory and masked-path
 * settings. A preset with the file system Off and the network open confines nothing, so a
 * Session started from it (Full Access, Always Ask) is unconfined. A document stored before the
 * card had a default preset starts Sessions by its own mode and network until one is picked.
 */
import type { SandboxMode, SandboxSettings as Policy } from "@prismshadow/penguin-core/plugin";
import type {
  ApprovalMode,
  PluginConfigNotice,
  PluginConfiguration,
  SessionSandboxPreset,
} from "../api/types.js";
import { resolveTable } from "../plugin/config.js";
import { requestedDimensions } from "./dimensions.js";

/** The preset a new Session starts from while the card has never chosen one. */
export const DEFAULT_PRESET = "workspace-write";

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

const UNCONFINED: Policy = { mode: "danger-full-access" };

/**
 * Whether the switch is on in a stored document (defaults merged). A document saved before the
 * switch existed has no `enabled`: it reads as on exactly when its policy confined anything — a
 * mode other than Off, a network that is not open, or masked paths — so a deployment that was
 * confined stays confined, and one that was not stays open. The document is never rewritten
 * for it.
 * TODO(sandbox-switch-compat): a save writes only the fields it changes, so a pre-switch
 * document keeps lacking `enabled` until its switch is toggled; the fallback can go only when
 * the maintainers choose a one-time migration or an announced break for such documents (see
 * the 2026-10-02 backward-compatibility changelog entry).
 */
export function sandboxEnabledOf(doc: Record<string, unknown>): boolean {
  if (typeof doc.enabled === "boolean") return doc.enabled;
  const policy = legacyPolicyOf(doc);
  return policy.mode !== "danger-full-access" || requestedDimensions(policy).length > 1;
}

/** What a new Session starts with: its policy, and its approval mode when the card sets one. */
export interface SandboxStart {
  policy: Policy;
  approvalMode?: ApprovalMode;
}

/**
 * What a new Session starts with under a stored document. A document stored before the card had
 * a default preset keeps starting Sessions by its own `mode` and `network` (`prePresetStartOf`)
 * until an administrator picks a row in the Default column.
 * TODO(sandbox-switch-compat): the pre-preset reading stays while documents saved before the
 * default preset can be on disk; it goes with the switch's fallback above, by the same
 * decision (see the 2026-10-02 backward-compatibility changelog entry).
 */
export function sandboxStartOf(
  schema: PluginConfiguration | undefined,
  doc: Record<string, unknown>,
): SandboxStart {
  if (!sandboxEnabledOf(doc)) return { policy: UNCONFINED };
  if (isPrePreset(doc)) return { policy: legacyPolicyOf(doc) };
  const presets = sandboxPresetsOf(schema, doc);
  const preset =
    presets.find((p) => p.id === doc.defaultPreset) ?? presets.find((p) => p.id === DEFAULT_PRESET);
  return preset === undefined ? { policy: UNCONFINED } : presetStartOf(preset, doc);
}

/**
 * Whether a document predates the default preset: it names none, and holds what the old card
 * saved — its own `mode` or `network`, or masked paths (the old card's Off mode, its default,
 * stored nothing of its own). A save pins `defaultPreset` (`SandboxSettingsStatus.saving`)
 * whenever a row gives the start such a document holds, or an administrator picks one; until
 * then it keeps this shape.
 */
function isPrePreset(doc: Record<string, unknown>): boolean {
  return (
    doc.defaultPreset === undefined &&
    (doc.mode !== undefined || doc.network !== undefined || maskPathsOf(doc).length > 0)
  );
}

/** A pre-preset document's start, and the row that gives exactly the same one, if any. */
export interface PrePresetStart {
  policy: Policy;
  /** The first row, in table order, whose start equals it; absent when none does. */
  row?: string;
}

/**
 * A pre-preset document's start (the policy its own `mode` and `network` describe, with the
 * card's temp directory and masked paths), and the first row in table order that gives the same
 * start: pinning that row as the default would change neither a new Session's policy nor its
 * approval mode. The card shows that row as the default and a save pins it; with no such row the
 * card marks none, says what is in effect, and a save leaves the start as it is. Undefined for a
 * document that is not pre-preset.
 * TODO(sandbox-switch-compat): goes with `sandboxStartOf`'s pre-preset branch, by the same
 * decision.
 */
export function prePresetStartOf(
  schema: PluginConfiguration | undefined,
  doc: Record<string, unknown>,
): PrePresetStart | undefined {
  if (!isPrePreset(doc)) return undefined;
  const policy = legacyPolicyOf(doc);
  // A pre-preset start names no approval mode: a new Session takes its request's, else the
  // server's fallback, allow-all (session-service's startApproval). A row matches only with
  // that one.
  const row = sandboxPresetsOf(schema, doc).find((p) => {
    const start = presetStartOf(p, doc);
    return start.approvalMode === "allow-all" && samePolicy(start.policy, policy);
  });
  return { policy, ...(row !== undefined ? { row: row.id } : {}) };
}

/** The start one row gives: its file mode and network with the card's extras, and its approval mode. */
function presetStartOf(preset: SessionSandboxPreset, doc: Record<string, unknown>): SandboxStart {
  const { approvalMode } = preset;
  if (preset.mode === "danger-full-access" && preset.network === "open") {
    return { policy: UNCONFINED, approvalMode };
  }
  return {
    policy: {
      mode: preset.mode,
      ...(preset.network !== "open" ? { network: preset.network } : {}),
      ...extrasOf(doc),
    },
    approvalMode,
  };
}

/** Whether two policies confine alike: mode, network, temp directory and masked paths. */
function samePolicy(a: Policy, b: Policy): boolean {
  const masks = (p: Policy) => p.maskPaths ?? [];
  return (
    a.mode === b.mode &&
    (a.network ?? "open") === (b.network ?? "open") &&
    (a.writableTemp === false) === (b.writableTemp === false) &&
    masks(a).length === masks(b).length &&
    masks(a).every((path, i) => path === masks(b)[i])
  );
}

/** The card's temp-directory and masked-path settings, as policy fields. */
function extrasOf(doc: Record<string, unknown>): Pick<Policy, "maskPaths" | "writableTemp"> {
  const maskPaths = maskPathsOf(doc);
  return {
    ...(maskPaths.length > 0 ? { maskPaths } : {}),
    ...(doc.writableTemp === false ? { writableTemp: false } : {}),
  };
}

function maskPathsOf(doc: Record<string, unknown>): string[] {
  return Array.isArray(doc.maskPaths)
    ? doc.maskPaths.filter((p): p is string => typeof p === "string" && p !== "")
    : [];
}

/** The policy a document's own `mode` and `network` describe — fields the card no longer has. */
function legacyPolicyOf(doc: Record<string, unknown>): Policy {
  const mode = MODES.includes(doc.mode as SandboxMode)
    ? (doc.mode as SandboxMode)
    : "danger-full-access";
  return {
    mode,
    ...(doc.network === "none" || doc.network === "local" ? { network: doc.network } : {}),
    ...extrasOf(doc),
  };
}

/**
 * The card's notice for a document saved before the default preset whose start no row gives:
 * the Default column marks none, so the card says what new Sessions start from and how to
 * choose a default. Values are named by the presets table's own option titles.
 * TODO(sandbox-switch-compat): goes with the pre-preset reading above.
 */
export function prePresetNotice(
  stored: Record<string, unknown>,
  configuration: PluginConfiguration,
): PluginConfigNotice | undefined {
  const start = prePresetStartOf(configuration, stored);
  if (start === undefined || start.row !== undefined) return undefined;
  const option = (column: string, value: string) =>
    configuration.properties.presets?.columns
      ?.find((c) => c.name === column)
      ?.options?.find((o) => o.value === value);
  const named = (column: string, value: string) => {
    const o = option(column, value);
    return { en: o?.title ?? value, zh: o?.titleZh ?? o?.title ?? value };
  };
  const mode = named("mode", start.policy.mode);
  const network = named("network", start.policy.network ?? "open");
  const approval = named("approvalMode", "allow-all");
  return {
    tone: "attention",
    text: `While the sandbox is on, new sessions start from the settings saved before the presets: files ${mode.en}, network ${network.en}, ask mode ${approval.en}. No preset has these values, so no row is the default, and saving the card keeps them. To change that, star a row, or add a preset with these values and star it.`,
    textZh: `沙盒打开时，新会话从预设出现之前保存的设置开始：文件「${mode.zh}」、网络「${network.zh}」、询问模式「${approval.zh}」。没有预设与之相同，因此没有一行是默认，保存卡片也会保留这些值。要改变它，给一行标星，或先添加一条同值的预设再给它标星。`,
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
