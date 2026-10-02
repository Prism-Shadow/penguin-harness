/**
 * What the sandbox's settings document (settings-store.ts declares it) means for a NEW Session:
 * whether the switch is on, and the policy and approval mode the Session starts with. Pure
 * reads of the stored document — nothing here writes it.
 *
 * With the switch off, a new Session starts unconfined and its approval mode is the request's
 * (or the server's fallback). With it on, it starts from the card's default preset: that row's
 * file mode, network and approval mode, plus the card's temp-directory and masked-path
 * settings. A preset with the file system Off and the network open confines nothing, so a
 * Session started from it (Full Access, Always Ask) is unconfined.
 */
import type { SandboxMode, SandboxSettings as Policy } from "@prismshadow/penguin-core/plugin";
import type { ApprovalMode, PluginConfiguration, SessionSandboxPreset } from "../api/types.js";
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
 * What a new Session starts with under a stored document. `saved` says whether anything was
 * ever stored for the group: a document stored before the card had a default preset (no
 * `defaultPreset`) keeps confining by its own `mode` and `network`, which the card no longer
 * shows, until the card is saved once — every save writes the default preset
 * (`SandboxSettingsStatus.saving`).
 * TODO(sandbox-switch-compat): the pre-preset reading stays while documents saved before the
 * default preset can be on disk; it goes with the switch's fallback above, by the same
 * decision (see the 2026-10-02 backward-compatibility changelog entry).
 */
export function sandboxStartOf(
  schema: PluginConfiguration | undefined,
  doc: Record<string, unknown>,
  saved: boolean,
): SandboxStart {
  if (!sandboxEnabledOf(doc)) return { policy: UNCONFINED };
  if (saved && doc.defaultPreset === undefined) return { policy: legacyPolicyOf(doc) };
  const presets = sandboxPresetsOf(schema, doc);
  const preset =
    presets.find((p) => p.id === doc.defaultPreset) ??
    presets.find((p) => p.id === DEFAULT_PRESET);
  if (preset === undefined) return { policy: UNCONFINED };
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

/** The card's temp-directory and masked-path settings, as policy fields. */
function extrasOf(doc: Record<string, unknown>): Pick<Policy, "maskPaths" | "writableTemp"> {
  const maskPaths = Array.isArray(doc.maskPaths)
    ? doc.maskPaths.filter((p): p is string => typeof p === "string" && p !== "")
    : [];
  return {
    ...(maskPaths.length > 0 ? { maskPaths } : {}),
    ...(doc.writableTemp === false ? { writableTemp: false } : {}),
  };
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
