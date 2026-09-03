/**
 * Protocol-path suffix for the config dialog's base URL field: the path the AgentHub
 * client appends to a custom base URL, shown inside the field so the user knows which
 * endpoint shape the URL must serve. Verified against the vendored agenthub 0.4.6
 * clients and the SDKs they construct:
 * - Anthropic direct (claude-* clients, `@anthropic-ai/sdk`): POST {base}/v1/messages —
 *   the SDK's default base URL (https://api.anthropic.com) carries no /v1; the request
 *   path does, so a custom base URL gains the full /v1/messages. The generic Anthropic
 *   Messages protocol client (`client_type: "ant-messages"`) serves the same shape.
 * - OpenAI direct (gpt-* clients): the Responses API, POST {base}/responses (the SDK's
 *   default base URL https://api.openai.com/v1 already ends in /v1, and a custom base
 *   URL replaces it whole). The generic Responses protocol client
 *   (`client_type: "openai-responses"`) serves the same shape.
 * - Google direct (gemini-* clients, `@google/genai`): {base}/v1beta/models/<id>:… —
 *   the SDK joins base URL + API version (v1beta) + the models path.
 * - MiniMax direct (minimax-m3 client): MiniMax's Responses API, POST {base}/responses
 *   (its default base URL https://api.minimax.io/v1 already ends in /v1).
 * - DeepSeek direct (deepseek-v4 client): DeepSeek's Responses API, POST {base}/responses
 *   (agenthub 0.4.6 moved this client off Chat Completions; its default base URL
 *   https://api.deepseek.com carries no /v1, and the request path adds none).
 * - Every OpenAI Chat Completions compatible client — explicit
 *   `client_type: "openai-chat"` (gateways, custom and user-defined groups; the bare
 *   "openai" spelling is a deprecated pre-0.4.2 alias), `client_type: "vllm-openai-chat"`
 *   (the vLLM group; an openai-chat subclass that differs only in the thinking switch it
 *   sends), plus the GLM / Kimi direct clients — POST {base}/chat/completions.
 *
 * The three generic protocol clients — `openai-responses`, `ant-messages`,
 * `openai-chat` — are also what the custom-model protocol detection stores.
 */

/**
 * The protocol path appended to the base URL for a model entry. An explicit client
 * type wins over group membership (a `client_type: "openai-chat"` entry inside a vendor
 * group still goes through the generic OpenAI-compatible client); with no client type
 * the entry is auto-routed within its vendor group, so the group implies the client
 * family. Pure display logic: the empty-input hint must work before anything is typed,
 * so it keys off (provider, clientType) only, never the current base URL value.
 */
export function protocolPathForModel(provider: string, clientType: string): string {
  const t = clientType.trim().toLowerCase();
  // The generic protocol clients (agenthub 0.4.2): checked before the substring matches
  // below — "openai-responses" also contains "openai" but speaks the Responses API.
  // Order mirrors AutoLLMClient's routing.
  if (t.includes("ant-messages")) return "/v1/messages";
  if (t.includes("openai-responses")) return "/responses";
  // openai-chat / vllm-openai-chat / openai-embedding / the deprecated bare "openai" alias.
  // AgentHub places vllm-openai-chat one branch earlier, matched by exact equality; here the
  // substring reaches the same path, so the two orderings cannot disagree.
  if (t.includes("openai")) return "/chat/completions";
  // Legacy explicit client types (historical config): pin the family like auto-routing would.
  if (t.includes("claude")) return "/v1/messages";
  if (t.includes("gemini")) return "/v1beta/models";
  if (t.includes("gpt")) return "/responses";
  if (t.includes("minimax")) return "/responses";
  if (t.includes("deepseek")) return "/responses";
  // Any other explicit client type (glm-* / kimi-*): all speak chat completions.
  if (t !== "") return "/chat/completions";
  switch (provider) {
    case "anthropic":
      return "/v1/messages";
    case "openai":
      return "/responses";
    case "minimax":
      return "/responses";
    case "deepseek":
      return "/responses";
    case "google":
      return "/v1beta/models";
    default:
      return "/chat/completions";
  }
}
