/**
 * Protocol-path suffix for the config dialog's base URL field: the path the MMSP client
 * appends to a custom base URL, shown inside the field so the user knows which endpoint
 * shape the URL must serve. Verified against the MMSP 0.5.0 clients and the SDKs they
 * construct:
 * - `anthropic-official` (`@anthropic-ai/sdk`): POST {base}/v1/messages — the SDK's default
 *   base URL (https://api.anthropic.com) carries no /v1; the request path does, so a custom
 *   base URL gains the full /v1/messages. The compatible Messages client (`ant-messages`)
 *   serves the same shape.
 * - `openai-official`: the Responses API, POST {base}/responses (the SDK's default base URL
 *   https://api.openai.com/v1 already ends in /v1, and a custom base URL replaces it whole);
 *   its `text-embedding-*` ids go to the Embeddings API, POST {base}/embeddings. The
 *   compatible Responses client (`openai-responses`) serves the Responses shape — and it is
 *   what every OpenRouter row pins, OpenRouter serving the Responses API for all of its
 *   upstreams; `openai-embedding` serves the Embeddings shape.
 * - `gemini-official` (`@google/genai`): the Interactions API, {base}/v1beta/interactions.
 *   `gemini-generate-content` (what the Penguin Go rows pin) speaks generateContent,
 *   {base}/v1beta/models/<id>:… — the SDK joins base URL + API version (v1beta) + the
 *   resource path in both cases. A Vertex service-account key also switches
 *   `gemini-official` to generateContent, which a display keyed on the config cannot see.
 * - `deepseek-official` and `minimax-official`: each vendor's Responses API,
 *   POST {base}/responses (DeepSeek's default base URL https://api.deepseek.com carries no
 *   /v1 and the request path adds none; MiniMax's https://api.minimax.io/v1 already ends in
 *   /v1).
 * - Every Chat Completions client — `zai-official`, `moonshot-official`, `openai-chat` (the
 *   gateways other than OpenRouter, custom and user-defined groups; the bare "openai"
 *   spelling is a deprecated pre-0.4.2 alias) and `openai-chat-vllm-adapter` (the vLLM group;
 *   an openai-chat subclass that differs only in the thinking switch it sends) —
 *   POST {base}/chat/completions.
 *
 * The three generic protocol clients — `openai-responses`, `ant-messages`,
 * `openai-chat` — are also what the custom-model protocol detection stores.
 */
import { MMSP_CLIENTS, routedClientType } from "@prismshadow/penguin-core/model-catalog";

/** The official client of each first-party vendor group, which its unpinned ids route to. */
const VENDOR_GROUP_CLIENT_TYPES: Readonly<Record<string, string>> = {
  anthropic: "anthropic-official",
  openai: "openai-official",
  google: "gemini-official",
  deepseek: "deepseek-official",
  minimax: "minimax-official",
  zhipu: "zai-official",
  moonshot: "moonshot-official",
};

/**
 * The protocol path appended to the base URL for a model entry. An explicit client type
 * wins over group membership (a `client_type: "openai-chat"` entry inside a vendor group
 * still goes through the generic OpenAI-compatible client); with no client type the entry
 * routes as MMSP routes it, by the vendor family its model id begins with (core's
 * routedClientType). While the id is blank, or begins with no known family, the group's own
 * vendor client stands in — Chat Completions for every other group — and so does it for a
 * pinned client type MMSP does not know. Pure display logic: the empty-input hint must work
 * before anything is typed, so it never reads the current base URL value.
 */
export function protocolPathForModel(provider: string, clientType: string, modelId = ""): string {
  const id = modelId.trim();
  const routed = routedClientType(id, clientType);
  if (routed === "openai-official" && id.toLowerCase().startsWith("text-embedding-")) {
    return "/embeddings";
  }
  const client =
    MMSP_CLIENTS[routed ?? ""] ?? MMSP_CLIENTS[VENDOR_GROUP_CLIENT_TYPES[provider] ?? ""];
  return client?.path ?? "/chat/completions";
}
