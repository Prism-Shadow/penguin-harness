/**
 * Which configured models can serve each binding: the code half of every
 * `ToolModelBindingsProvider.bindings` contribution. The host hands each model with the MMSP
 * client a request to it is routed to and what MMSP's registry says the model takes and returns
 * there; a model MMSP does not list is judged by its client alone.
 */

/** A configured model as a binding's `accepts` sees it (the host's ToolModelCandidate). */
export interface Candidate {
  provider: string;
  modelId: string;
  clientType?: string;
  vision?: boolean;
  client?: string;
  input?: string[];
  output?: string[];
}

export interface BindingCode {
  accepts(model: Candidate): boolean;
}

/** MMSP's clients that do one media or web job and cannot hold a conversation. */
const IMAGE_CLIENTS = new Set(["openai-image"]);
const SPEECH_CLIENTS = new Set(["openai-speech", "deepseek-speech"]);
const TRANSCRIPTION_CLIENTS = new Set(["openai-transcription", "deepseek-transcription"]);
const WEB_CLIENTS = new Set(["deepseek-webtool", "jina-webtool"]);
const EMBEDDING_CLIENTS = new Set(["openai-embedding"]);
const DEDICATED = new Set([
  ...IMAGE_CLIENTS,
  ...SPEECH_CLIENTS,
  ...TRANSCRIPTION_CLIENTS,
  ...WEB_CLIENTS,
  ...EMBEDDING_CLIENTS,
]);

const has = (list: string[] | undefined, modality: string) => list?.includes(modality) ?? false;

/** A web model (a search or a page fetch), by its client or its registered output. */
const isWeb = (m: Candidate) =>
  (m.client !== undefined && WEB_CLIENTS.has(m.client)) || has(m.output, "Web");

/** What one binding takes, by binding key. */
export const ACCEPTS: Record<string, (m: Candidate) => boolean> = {
  // A conversational model: text in, text out and no media, or one MMSP does not list on a client
  // that can chat.
  t2t: (m) =>
    !(m.client !== undefined && DEDICATED.has(m.client)) &&
    (m.input === undefined || has(m.input, "Text")) &&
    (m.output === undefined ||
      (has(m.output, "Text") &&
        !["Image", "Video", "Audio", "Web", "Embed"].some((x) => has(m.output, x)))),
  // MMSP names no search/fetch split: the web models' ids do (deepseek-search, jina-fetch …).
  search: (m) => isWeb(m) && m.modelId.toLowerCase().includes("search"),
  fetch: (m) => isWeb(m) && m.modelId.toLowerCase().includes("fetch"),
  t2i: (m) => (m.client !== undefined && IMAGE_CLIENTS.has(m.client)) || has(m.output, "Image"),
  t2v: (m) => has(m.output, "Video"),
  t2s: (m) =>
    (m.client !== undefined && SPEECH_CLIENTS.has(m.client)) ||
    (has(m.output, "Audio") && has(m.input, "Text")),
  s2t: (m) =>
    (m.client !== undefined && TRANSCRIPTION_CLIENTS.has(m.client)) ||
    (has(m.input, "Audio") && has(m.output, "Text") && !has(m.input, "Text")),
};

/** The code half of the binding `key`. */
export function bindingCode(key: string): BindingCode {
  const rule = ACCEPTS[key];
  return { accepts: (model) => rule?.(model) ?? false };
}
