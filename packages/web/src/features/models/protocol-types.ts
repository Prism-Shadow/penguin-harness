/**
 * The generic protocol client family for custom / user-defined model groups, and the pure
 * helpers the config dialog composes around it. Kept out of models-page.tsx so the in-field
 * protocol control (protocol-suffix.tsx) can share them without importing the page back.
 *
 * The probing itself is server-side (packages/server/src/services/protocol-detect.ts); these
 * only decide what the dialog shows and what is worth sending there.
 */
import {
  effectiveConnection,
  modelEnvPreviewKey,
  providerInfo,
} from "@prismshadow/penguin-core/model-catalog";
import type { ProviderConnectionShape } from "@prismshadow/penguin-core/model-catalog";

/**
 * MMSP's generic protocol client types (three of its compatible clients), in detection order
 * (custom / user-defined groups select among these; see the in-field protocol menu and the
 * /models/detect probes).
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
 * are routed by the vendor family their id begins with, or pinned by the group's preset.
 */
export const DEFAULT_CUSTOM_CLIENT_TYPE = "openai-chat";

/**
 * Whether a stored client_type belongs to the generic protocol family the picker can
 * represent: the three protocol clients, the bare `openai` alias (legacy default for
 * custom groups; routes to openai-chat), or empty. Any other explicit type (a vendor client
 * such as `deepseek-official`, another compatible client such as `google-genai`,
 * or a legacy vendor-pinned config like `deepseek-v4` that MMSP no longer knows) keeps the
 * read-only note instead — showing the picker there would silently rewrite it.
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
 * The protocol a row would be used with if it stored none of its own: its group's
 * `[providers.<id>]` protocol, or none (MMSP then routes by the id's vendor family). Callers pass
 * what core's effectiveConnection resolves for the group; omitted, the group sets none.
 */
export interface InheritedProtocol {
  clientType?: string | undefined;
}

/**
 * The `client_type` actually persisted for a row: its own protocol, or nothing — a row with no
 * protocol of its own follows its group (`inherited`), which is what lets a protocol set once on
 * the group reach every model in it.
 *
 * One case must still write a value: a custom-like entry that would otherwise resolve to no
 * protocol at all. MMSP's AutoLLMClient routes an entry with no client type by the vendor family
 * its id begins with, and THROWS for an id of no known family (`No client for model "<id>": its
 * family is not known`) rather than falling back — so such an entry saved with nothing is a
 * model that cannot start, or, when its id happens to begin with a vendor family, one sent to
 * that vendor's official client instead of speaking the endpoint's protocol. The dialog's save
 * path detects the protocol before submitting; this is the last-resort net for the paths that
 * do not (set-default, set-vision-proxy, remove), where probing the endpoint would be the wrong
 * thing to do.
 *
 * Every other group's entries with nothing inherited stay empty: an empty value there means "let
 * MMSP route by the id's vendor family", which is how a first-party vendor's ids are placed.
 */
export function protocolForPersist(
  provider: string,
  clientType: string,
  inherited: InheritedProtocol = {},
): string {
  const t = clientType.trim();
  if (t !== "") return t;
  if (inherited.clientType?.trim()) return "";
  return isCustomLikeGroup(provider) ? DEFAULT_CUSTOM_CLIENT_TYPE : "";
}

/**
 * Whether committing this dialog action must detect the protocol before it may proceed: the
 * user pressed save on a custom-like entry that has no protocol of its own and inherits none.
 * Detection is preferred over guessing there because the endpoint is the authority, and because
 * a wrong guess surfaces much later as a failing session rather than a failing save.
 *
 * Detection is optional everywhere else: a protocol picked by hand, one inherited from the
 * group, and every group that is not custom-like never trigger it — there is
 * nothing to probe for when the answer is already decided. Nor do the other actions
 * (set-default / set-vision-proxy / remove): those are not the user declaring the model ready,
 * and probing an endpoint as a side effect of "make this the default" would be surprising.
 * Those paths stay safe through protocolForPersist instead.
 */
export function needsProtocolDetectOnSave(
  action: string,
  provider: string,
  clientType: string,
  inherited: InheritedProtocol = {},
): boolean {
  return (
    action === "save" &&
    isCustomLikeGroup(provider) &&
    clientType.trim() === "" &&
    !inherited.clientType?.trim()
  );
}

/**
 * The client type the dialog's API-key env hint should resolve against: the protocol the entry
 * will actually be used with (its own, else its group's — effectiveConnection), and for a
 * custom-like entry that resolves to none, the compatible client it will be saved on.
 *
 * `resolveModelEnv` falls back to routing by model id when no client type is given — right for
 * a vendor group, wrong for a custom one: typing `claude-sonnet-5` into a custom group would then
 * claim the entry reads ANTHROPIC_API_KEY, when nothing about that group routes by id. A group
 * that pins a protocol is the same argument again: nothing there routes by id, so the pin is
 * what the hint has to resolve against.
 */
export function envHintClientType(
  provider: string,
  clientType: string,
  modelId = "",
  group?: ProviderConnectionShape,
): string | undefined {
  const effective = effectiveConnection({ provider, modelId: modelId.trim(), clientType }, group);
  return (
    effective.clientType ?? (isCustomLikeGroup(provider) ? DEFAULT_CUSTOM_CLIENT_TYPE : undefined)
  );
}

/**
 * The variable the dialog's API-key field may promise for the entry as drafted, or undefined
 * when nothing should be promised: core's modelEnvPreviewKey — the same function the server's
 * GET /models preview reads, so the hint and the card's "read from environment variable" can
 * never disagree — over the EFFECTIVE shape: the form's own protocol and base URL where it has
 * them, its group's where it does not. A gateway row follows its group's endpoint, so it resolves
 * to nothing — a hint reading "leave empty to use OPENAI_API_KEY" on a TokenDance or OpenRouter
 * row would promise the user's OpenAI key to a third party; a group pointed at a proxy resolves
 * to nothing either, and so does a vLLM or custom row with no base URL anywhere, so the field
 * never suggests running a self-hosted id against api.openai.com.
 */
export function envHintKeyFor(
  provider: string,
  modelId: string,
  clientType: string,
  baseUrl: string,
  group?: ProviderConnectionShape,
): string | undefined {
  const effective = effectiveConnection(
    { provider, modelId: modelId.trim(), clientType, baseUrl },
    group,
  );
  return modelEnvPreviewKey({
    provider,
    modelId: modelId.trim(),
    clientType: envHintClientType(provider, clientType, modelId, group),
    baseUrl: effective.baseUrl ?? "",
  });
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
