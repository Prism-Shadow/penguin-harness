/**
 * The connection test of a tool model: the request one of its bindings names
 * (ToolModelBindings.testRequest), sent the way a plugin's tool sends a request — core's
 * streamProjectModel over the draft's connection, with none of the chat probe's knobs (a thinking
 * level, an output cap, fast mode) that a tool client refuses.
 *
 * It passes once the endpoint answered: the stream completed, or MMSP found the answer empty (a
 * test recording holds no words to transcribe, yet the endpoint, the key and the model id all
 * worked). Anything else fails with the error's message, as the chat probe's failures do.
 */
import { EmptyResponseError, UpstreamError } from "@prismshadow/mmsp";
import { streamProjectModel } from "@prismshadow/penguin-core";
import type { ProjectModelRequest } from "@prismshadow/penguin-core";
import type { ModelTestResponse } from "@prismshadow/penguin-library-model";

/** What the test sends: a binding's test request. */
export type ToolModelTestBody = Pick<ProjectModelRequest, "messages" | "config" | "idleTimeoutMs">;

export interface ToolModelTestOptions {
  provider: string;
  modelId: string;
  /** The draft's connection as it resolves: the row's own values, else its group's. */
  credential: { apiKey?: string; baseUrl?: string; clientType?: string };
  /** A managed key the host resolved for this request; it wins over the draft's, as in a Session. */
  managedApiKey?: string;
  body: ToolModelTestBody;
}

/** The longest wait between two events, unless the request names its own: the chat probe's. */
const TOOL_TEST_TIMEOUT_MS = 20_000;

/** A failure detail is cut to this many characters, as the chat probe's is. */
const MAX_MESSAGE = 300;

/** The answer was empty, directly or inside a remote MMSP server's error envelope. */
function emptyAnswer(err: unknown): boolean {
  return (
    err instanceof EmptyResponseError ||
    (err instanceof UpstreamError && err.errorType === "EmptyResponseError")
  );
}

export async function testToolModel(opts: ToolModelTestOptions): Promise<ModelTestResponse> {
  const { provider, modelId, credential, body } = opts;
  const startedAt = Date.now();
  let firstContentAt: number | null = null;
  try {
    const events = streamProjectModel(
      {
        config: {
          models: [
            {
              provider,
              model_id: modelId,
              ...(credential.clientType !== undefined
                ? { client_type: credential.clientType }
                : {}),
              ...(credential.baseUrl !== undefined ? { base_url: credential.baseUrl } : {}),
              ...(credential.apiKey !== undefined ? { api_key: credential.apiKey } : {}),
            },
          ],
        },
        model: { provider, model_id: modelId },
        messages: body.messages,
        ...(body.config !== undefined ? { uniConfig: body.config } : {}),
        ...(opts.managedApiKey !== undefined ? { apiKey: opts.managedApiKey } : {}),
        idleTimeoutMs: body.idleTimeoutMs ?? TOOL_TEST_TIMEOUT_MS,
      },
      // A test is not billed to anyone: nothing is recorded.
      () => {},
    );
    for await (const event of events) {
      if (firstContentAt === null && event.content_items.length > 0) firstContentAt = Date.now();
    }
  } catch (err) {
    if (!emptyAnswer(err)) {
      return {
        ok: false,
        message: (err instanceof Error ? err.message : String(err)).slice(0, MAX_MESSAGE),
      };
    }
  }
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    ...(firstContentAt !== null ? { ttftMs: firstContentAt - startedAt } : {}),
  };
}
