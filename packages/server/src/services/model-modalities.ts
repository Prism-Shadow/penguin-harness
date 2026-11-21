/**
 * What MMSP knows about a configured model: the client a request to it is routed to, and the
 * modalities MMSP's registry lists for the model on that client. A tool-model binding's `accepts`
 * reads both (services/tool-model-bindings.ts), so a plugin judges a model by what goes in and
 * comes out of it without carrying a copy of MMSP's registry.
 */
import { listSupportedModels } from "@prismshadow/mmsp";
import { routedClientType } from "@prismshadow/mmsp/credentials";

/** A model as MMSP sees it; every field absent when MMSP knows nothing of it. */
export interface ModelModalities {
  /** The MMSP client a request goes to (`openai-image`, `google-official` …). */
  client?: string;
  /** What the registry says the model takes and returns on that client (`Text`, `Image` …). */
  input?: string[];
  output?: string[];
}

const registry = listSupportedModels();

/**
 * The routed client for an id and its effective client type, and the registry's modalities for
 * the model on that client. A remote MMSP server (`mmsp`) serves any registered model, so any of
 * the model's rows answers for it there.
 */
export function modelModalities(modelId: string, clientType?: string): ModelModalities {
  const client = routedClientType(modelId, clientType) ?? undefined;
  if (client === undefined) return {};
  const listed = registry.find(
    (m) => m.model === modelId && (m.client === client || client === "mmsp"),
  );
  return {
    client,
    ...(listed !== undefined
      ? { input: [...listed.input_modalities], output: [...listed.output_modalities] }
      : {}),
  };
}
