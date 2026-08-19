/**
 * The generic protocol client family for custom / user-defined model groups, and the pure
 * helpers the config dialog composes around it. Kept out of models-page.tsx so the in-field
 * protocol control (protocol-suffix.tsx) can share them without importing the page back.
 *
 * The probing itself is server-side (packages/server/src/services/protocol-detect.ts); these
 * only decide what the dialog shows and what is worth sending there.
 */

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
