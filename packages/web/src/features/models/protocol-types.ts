/**
 * The generic protocol client family for custom / user-defined model groups, and the pure
 * helpers the config dialog composes around it. Kept out of models-page.tsx so the in-field
 * protocol control (protocol-suffix.tsx) can share them without importing the page back.
 *
 * The probing itself is server-side (packages/server/src/services/protocol-detect.ts); these
 * only decide what the dialog shows and what is worth sending there.
 */
import { providerClientType, providerInfo } from "@prismshadow/penguin-core/model-catalog";

/**
 * AgentHub's generic protocol client types, in detection order (custom / user-defined
 * groups select among these; see the in-field protocol menu and the /models/detect probes).
 */
export const PROTOCOL_CLIENT_TYPES = ["openai-responses", "ant-messages", "openai-chat"] as const;
export type ProtocolClientType = (typeof PROTOCOL_CLIENT_TYPES)[number];

/**
 * What a custom / user-defined group falls back to whenever its protocol is undetermined:
 * the compatible client (OpenAI Chat Completions), which is the broadest of the three.
 *
 * Per maintainer, this fallback is unconditional for those groups — nothing is ever
 * inferred from the model id there, and a detection that comes back empty resolves here
 * instead of blocking the save. Vendor and gateway groups are unaffected: their entries
 * are auto-routed by a catalog-known id or pinned by the group's preset.
 */
export const DEFAULT_CUSTOM_CLIENT_TYPE = "openai-chat";

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
 * Picker value for the current clientType, or **null when nothing is selected yet**.
 *
 * The null case is load-bearing: a new custom model starts with no protocol, and the
 * control has to look that way — no checked row in the menu, no path in the field. Before
 * this returned "openai-chat" for the empty string, which rendered `/chat/completions` in
 * the field and a checkmark in the menu, i.e. a default the user never chose and could not
 * tell apart from one they did.
 *
 * A stored legacy `openai` still displays as Chat Completions (that IS its routing) without
 * rewriting the stored value — only an actual selection or a detection hit writes the
 * new-style client type.
 */
export function protocolSelectorValue(clientType: string): ProtocolClientType | null {
  const t = clientType.trim().toLowerCase();
  if (t === "") return null;
  return t === "openai-responses" || t === "ant-messages" ? t : "openai-chat";
}

/**
 * Monospace display width in `ch` units, counting wide (CJK) glyphs as two. The base URL
 * input reserves right padding for whatever the suffix renders; `.length` is exact for the
 * ASCII protocol paths but halves the reservation for a localized placeholder, which would
 * let the typed URL slide under it.
 */
export function displayWidthCh(text: string): number {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0)! > 0x2e7f ? 2 : 1;
  return width;
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
 * being auto-routed inside a first-party vendor group or pinned by a gateway preset or a
 * group-level pin. `custom` plus every user-defined group (a provider id the catalog does
 * not know).
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
 * A group that pins a protocol answers the same question one step earlier, and for a
 * stronger reason: the pin is not a fallback but the group's own semantics, so an entry
 * that reaches here without one takes it rather than the compatible-client default.
 *
 * Preset and vendor-group entries are returned untouched: their model ids ARE routable,
 * so an empty value there correctly means "let AgentHub infer from the id", and the
 * empty default must not leak into them as a bogus pin.
 */
export function protocolForPersist(provider: string, clientType: string): string {
  const t = clientType.trim();
  if (t !== "") return t;
  const pinned = providerClientType(provider);
  if (pinned !== undefined) return pinned;
  if (!isCustomLikeGroup(provider)) return t;
  return DEFAULT_CUSTOM_CLIENT_TYPE;
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
 *
 * A group that pins a protocol never reaches here either — it is not custom-like, and there
 * is nothing to probe for when the group has already decided the answer.
 */
export function needsProtocolDetectOnSave(
  action: string,
  provider: string,
  clientType: string,
): boolean {
  return action === "save" && isCustomLikeGroup(provider) && clientType.trim() === "";
}

/**
 * The client type the dialog's API-key env hint should resolve against.
 *
 * `resolveModelEnv` normally falls back to routing by model id when no client type is
 * given — right for a vendor group, wrong for a custom one: typing `claude-sonnet-5` into
 * a custom group would then claim the entry reads ANTHROPIC_API_KEY, when nothing about
 * that group routes by id and the entry will in fact be saved on the compatible client.
 * Returning the default for custom-like groups keeps the hint honest; undefined elsewhere
 * preserves the id-based routing those groups genuinely use. A group that pins a protocol
 * is the same argument again: nothing there routes by id, so the pin is what the entry will
 * be saved on and what the hint has to resolve against.
 */
export function envHintClientType(provider: string, clientType: string): string | undefined {
  const t = clientType.trim();
  if (t !== "") return t;
  return (
    providerClientType(provider) ??
    (isCustomLikeGroup(provider) ? DEFAULT_CUSTOM_CLIENT_TYPE : undefined)
  );
}

/*
 * Failure classification used to live here, splitting "unreachable" from "the endpoint
 * answered but serves none of the three". Removed deliberately (per maintainer): the
 * distinction is invisible to the person configuring a model, and phrasing one branch as
 * "the endpoint responded" read as success to users. Every failure now shows the same
 * short message naming the two things they can actually act on — the API key and the base
 * URL. The per-protocol outcomes are still reported by the detect endpoint, so the detail
 * remains available for debugging in the network response.
 */
