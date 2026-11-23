/**
 * What MMSP knows about a configured model: the client a request to it is routed to, and the
 * modalities MMSP's registry lists for the model on that client. A tool-model binding's `accepts`
 * reads both (services/tool-model-bindings.ts), so a plugin judges a model by what goes in and
 * comes out of it without carrying a copy of MMSP's registry.
 */
import { listSupportedModels } from "@prismshadow/mmsp";
import { sameEndpoint } from "@prismshadow/penguin-core/model-connection";
import { CLIENT_CREDENTIALS, routedClientType } from "@prismshadow/mmsp/credentials";

/** A model as MMSP sees it; every field absent when MMSP knows nothing of it. */
export interface ModelModalities {
  /** The MMSP client a request goes to (`openai-image`, `google-official` …). */
  client?: string;
  /** What the registry says the model takes and returns on that client (`Text`, `Image` …). */
  input?: string[];
  output?: string[];
  /** A Google audio-to-text conversation on the actual registered endpoint and protocol. */
  audioTranscription?: boolean;
}

const registry = listSupportedModels();

/** A proxy may have a narrower modality set than another route for the same model ID. */
export function modelModalities(
  modelId: string,
  clientType?: string,
  baseUrl?: string,
): ModelModalities {
  const client = routedClientType(modelId, clientType) ?? undefined;
  if (client === undefined) return {};
  const credentials = CLIENT_CREDENTIALS[client]!;
  const endpoint = baseUrl || process.env[credentials.baseUrlEnv] || credentials.defaultBaseUrl;
  const rows = registry.filter((row) => row.model === modelId);
  const exact = rows.find((row) => row.client === client && sameEndpoint(row.base_url, endpoint));
  // Other bindings already support custom servers forwarding their registered model natively.
  const listed =
    exact ?? rows.find((row) => row.client === client) ?? (client === "mmsp" ? rows[0] : undefined);
  return {
    client,
    ...(listed && { input: [...listed.input_modalities], output: [...listed.output_modalities] }),
    ...((client === "google-official" || client === "google-genai") && {
      audioTranscription:
        exact?.input_modalities.includes("Audio") === true &&
        exact.output_modalities.length === 1 &&
        exact.output_modalities[0] === "Text",
    }),
  };
}
