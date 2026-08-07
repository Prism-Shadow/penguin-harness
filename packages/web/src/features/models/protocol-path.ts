/**
 * Protocol-path suffix for the config dialog's base URL field: the path the AgentHub
 * client appends to a custom base URL, shown inside the field so the user knows which
 * endpoint shape the URL must serve. Verified against the vendored agenthub 0.4.1
 * clients and the SDKs they construct:
 * - Anthropic direct (claude-* clients, `@anthropic-ai/sdk`): POST {base}/v1/messages —
 *   the SDK's default base URL (https://api.anthropic.com) carries no /v1; the request
 *   path does, so a custom base URL gains the full /v1/messages.
 * - OpenAI direct (gpt-* clients): the Responses API, POST {base}/responses (the SDK's
 *   default base URL https://api.openai.com/v1 already ends in /v1, and a custom base
 *   URL replaces it whole).
 * - Google direct (gemini-* clients, `@google/genai`): {base}/v1beta/models/<id>:… —
 *   the SDK joins base URL + API version (v1beta) + the models path.
 * - Every OpenAI-compatible client — explicit `client_type: "openai"` (gateways,
 *   custom and user-defined groups) plus the DeepSeek / GLM / Kimi direct clients —
 *   POST {base}/chat/completions.
 */

/**
 * The protocol path appended to the base URL for a model entry. An explicit client
 * type wins over group membership (a `client_type: "openai"` entry inside a vendor
 * group still goes through the generic OpenAI-compatible client); with no client type
 * the entry is auto-routed within its vendor group, so the group implies the client
 * family. Pure display logic: the empty-input hint must work before anything is typed,
 * so it keys off (provider, clientType) only, never the current base URL value.
 */
export function protocolPathForModel(provider: string, clientType: string): string {
  const t = clientType.trim().toLowerCase();
  if (t.includes("openai")) return "/chat/completions";
  // Legacy explicit client types (historical config): pin the family like auto-routing would.
  if (t.includes("claude")) return "/v1/messages";
  if (t.includes("gemini")) return "/v1beta/models";
  if (t.includes("gpt")) return "/responses";
  // Any other explicit client type (deepseek-v4 / glm-* / kimi-*): all speak chat completions.
  if (t !== "") return "/chat/completions";
  switch (provider) {
    case "anthropic":
      return "/v1/messages";
    case "openai":
      return "/responses";
    case "google":
      return "/v1beta/models";
    default:
      return "/chat/completions";
  }
}
