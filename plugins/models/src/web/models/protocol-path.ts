/**
 * Protocol-path suffix for the config dialog's base URL field: the path the MMSP client
 * appends to a custom base URL, shown inside the field so the user knows which endpoint
 * shape the URL must serve. Verified against the MMSP 0.5.2 clients and the SDKs they
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
 * - `google-official` (`@google/genai`; `gemini-official`, its name before MMSP 0.5.2, is
 *   kept as an alias): the Interactions API, {base}/v1beta/interactions. The compatible
 *   `google-genai` client (what the Penguin Go rows pin; `gemini-generate-content` is its
 *   alias) speaks generateContent, {base}/v1beta/models/<id>:streamGenerateContent — the SDK
 *   joins base URL + API version (v1beta) + the resource path in both cases, and the suffix
 *   stops before the model id.
 * - `mmsp`: an MMSP server, POST {base}/stream (its base URL ends with /v1, as the default
 *   http://127.0.0.1:25752/v1 does).
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
 * Of the protocols the in-field menu offers, the first three — `openai-responses`,
 * `ant-messages`, `openai-chat` — are also what the custom-model protocol detection stores;
 * `google-genai` and `mmsp` are picked by hand.
 */
import { MMSP_CLIENTS, routedClientType } from "@prismshadow/penguin-core/model-catalog";

/** The official client of each first-party vendor group, which its unpinned ids route to. */
const VENDOR_GROUP_CLIENT_TYPES: Readonly<Record<string, string>> = {
  anthropic: "anthropic-official",
  openai: "openai-official",
  google: "google-official",
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
  const client =
    routedClientType(modelId.trim(), clientType) ?? VENDOR_GROUP_CLIENT_TYPES[provider] ?? "";
  return MMSP_CLIENTS[client]?.path ?? "/chat/completions";
}
