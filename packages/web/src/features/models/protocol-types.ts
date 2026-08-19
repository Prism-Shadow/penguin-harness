/**
 * The generic protocol client family for custom / user-defined model groups, and the pure
 * helpers the config dialog composes around it. Kept out of models-page.tsx so the in-field
 * protocol control (protocol-suffix.tsx) can share them without importing the page back.
 *
 * The probing itself is server-side (packages/server/src/services/protocol-detect.ts); these
 * only decide what the dialog shows and what is worth sending there.
 */
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";

/**
 * AgentHub's generic protocol client types, in detection order (custom / user-defined
 * groups select among these; see the in-field protocol menu and the /models/detect probes).
 */
export const PROTOCOL_CLIENT_TYPES = ["openai-responses", "ant-messages", "openai-chat"] as const;
export type ProtocolClientType = (typeof PROTOCOL_CLIENT_TYPES)[number];

/**
 * Whether a stored client_type belongs to the generic protocol family the picker can
 * represent: the three protocol clients, the bare `openai` alias (legacy default for
 * custom groups; routes to openai-chat), or empty. Any other explicit type (a legacy
 * vendor-pinned config like `deepseek-v4`) keeps the read-only note instead — showing
 * the picker there would silently rewrite it.
 */
export function isGenericProtocolClientType(clientType: string): boolean {
  const t = clientType.trim().toLowerCase();
  return t === "" || t === "openai" || (PROTOCOL_CLIENT_TYPES as readonly string[]).includes(t);
}

/**
 * Picker value for the current clientType: `openai` / empty display as Chat Completions
 * (their effective routing) without rewriting the stored value — only an actual selection
 * or a detection hit writes the new-style client type.
 */
export function protocolSelectorValue(clientType: string): ProtocolClientType {
  const t = clientType.trim().toLowerCase();
  return t === "openai-responses" || t === "ant-messages" ? t : "openai-chat";
}

/** A base URL detection can probe: absolute http(s) (mirrors the server-side check; anything else 400s). */
export function detectableBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Custom-like group: the entry picks its own protocol from the generic trio, rather than
 * being auto-routed inside a first-party vendor group or pinned by a gateway preset.
 * `custom` plus every user-defined group (a provider id the catalog does not know).
 */
export function isCustomLikeGroup(provider: string): boolean {
  return provider === "custom" || providerInfo(provider) === undefined;
}

/**
 * The `client_type` actually persisted for a row.
 *
 * A custom-like entry must never reach the config with an empty protocol: AgentHub's
 * AutoLLMClient resolves an unmatched client type by THROWING (`"<type> is not
 * supported"`) rather than falling back, and a custom model id matches none of its
 * substring rules — so an entry saved with no protocol is a model that cannot start.
 * The dialog's save path detects the protocol before submitting; this is the last-resort
 * net for the paths that do not (set-default, set-vision-proxy, remove), where probing
 * the endpoint would be the wrong thing to do.
 *
 * Preset and vendor-group entries are returned untouched: their model ids ARE routable,
 * so an empty value there correctly means "let AgentHub infer from the id", and the
 * empty default must not leak into them as a bogus pin.
 */
export function protocolForPersist(provider: string, clientType: string): string {
  const t = clientType.trim();
  if (t !== "" || !isCustomLikeGroup(provider)) return t;
  return "openai-chat";
}

/**
 * Whether committing this dialog action must detect the protocol before it may proceed:
 * the user pressed save/add on a custom-like entry that still has no protocol. Detection
 * is preferred over guessing here because the endpoint is the authority, and because a
 * wrong guess surfaces much later as a failing session rather than a failing save.
 *
 * Deliberately NOT the other actions (set-default / set-vision-proxy / remove): those are
 * not the user declaring the model ready, and probing an endpoint as a side effect of
 * "make this the default" would be surprising. Those paths stay safe through
 * protocolForPersist instead.
 */
export function needsProtocolDetectOnSave(
  action: string,
  provider: string,
  clientType: string,
): boolean {
  return action === "save" && isCustomLikeGroup(provider) && clientType.trim() === "";
}

/** Why a detection run produced no protocol — picks which explanation the popup shows. */
export type ProtocolDetectFailure = "unreachable" | "none";

/**
 * Reads the per-probe outcomes to tell "we could not reach this endpoint at all" apart
 * from "we reached it and none of the three protocols were served". Only the former is
 * worth telling the user to check the URL/network over; the latter means picking a
 * protocol by hand is the way forward.
 */
export function classifyDetectFailure(
  probes: readonly { outcome: string }[],
): ProtocolDetectFailure {
  if (probes.length === 0) return "none";
  const unreachable = probes.every((p) => p.outcome === "timeout" || p.outcome === "network_error");
  return unreachable ? "unreachable" : "none";
}
