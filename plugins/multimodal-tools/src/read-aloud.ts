/**
 * Reading a reply aloud in the Web App: the reply's text spoken by the Project's speech-synthesis
 * model (the `t2s` binding), kept so that playing it again costs nothing.
 *
 * The audio is reused by Session + reply + voice model and by nothing else — not by who listens:
 * one file per reply text and model pair in the Session's `read-aloud/` folder (store.ts), named
 * by a digest of the three, and gone with the Session when the sweep removes its folder. Two
 * listeners asking for the same audio at once share one request, which stops only once every one
 * of them has left. A synthesis that fails keeps nothing, so the next press asks again.
 */
import { createHash } from "node:crypto";
import type { ModelRef, ModelRequests } from "./host.js";
import { failureReason, ToolError } from "./errors.js";
import { extensionOf, playable } from "./media.js";
import { operationRequest, PACKAGE } from "./operations.js";
import { MAX_RESULT_BYTES } from "./runs.js";
import type { StoredSpeech, ToolStore } from "./store.js";

/** A reply's audio, as the route answers it. */
export interface SpokenReply extends StoredSpeech {
  /** Where a signed-in member of the Project plays it. */
  url: string;
  /** The model that spoke it. */
  model: ModelRef;
}

interface Flight {
  controller: AbortController;
  listeners: number;
  done: Promise<StoredSpeech>;
}

/** Syntheses in flight, by Project and key: one map per process, like the runs'. */
const flights = new Map<string, Flight>();

export class ReadAloud {
  constructor(
    private readonly requests: ModelRequests,
    /** The model `t2s` runs on in a Project; a 409 when none is bound. */
    private readonly modelFor: (projectId: string) => Promise<ModelRef>,
    private readonly store: ToolStore,
  ) {}

  /** The reply's audio in the Session: the stored one, else spoken now and stored. */
  async speak(
    projectId: string,
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<SpokenReply> {
    const request = operationRequest("t2s", { text });
    const model = await this.modelFor(projectId);
    const key = createHash("sha256")
      .update(JSON.stringify([sessionId, model.provider, model.modelId, text]))
      .digest("hex")
      .slice(0, 32);
    const view = (stored: StoredSpeech): SpokenReply => ({
      ...stored,
      url: `/api/projects/${encodeURIComponent(projectId)}/multimodal-tools/sessions/${encodeURIComponent(sessionId)}/read-aloud/${stored.name}`,
      model,
    });
    if (signal?.aborted === true)
      throw new ToolError(409, "run_cancelled", "Reading aloud was stopped.");

    // Looked up and started in one step, so a second press that lands while the first is still
    // reading the store joins it instead of asking the model again.
    const id = `${projectId}\0${key}`;
    let flight = flights.get(id);
    if (flight === undefined || flight.controller.signal.aborted) {
      const controller = new AbortController();
      const started: Flight = {
        controller,
        listeners: 0,
        done: this.store
          .readSpeech(projectId, sessionId, key)
          .then(
            (stored) =>
              stored ??
              this.synthesize(projectId, sessionId, key, model, request, controller.signal),
          ),
      };
      const settle = () => {
        if (flights.get(id) === started) flights.delete(id);
      };
      started.done.then(settle, settle);
      flights.set(id, started);
      flight = started;
    }
    const joined = flight;
    joined.listeners += 1;
    let left = false;
    const leave = () => {
      left = true;
      joined.listeners -= 1;
      if (joined.listeners === 0) joined.controller.abort();
    };
    signal?.addEventListener("abort", leave, { once: true });
    try {
      // A caller that leaves stops waiting; the synthesis goes on while anyone else waits.
      const stopped = new Promise<never>((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new ToolError(409, "run_cancelled", "Reading aloud was stopped.")),
          { once: true },
        );
      });
      return view(await Promise.race([joined.done, stopped]));
    } finally {
      signal?.removeEventListener("abort", leave);
      if (!left) joined.listeners -= 1;
    }
  }

  private async synthesize(
    projectId: string,
    sessionId: string,
    key: string,
    model: ModelRef,
    request: ReturnType<typeof operationRequest>,
    signal: AbortSignal,
  ): Promise<StoredSpeech> {
    const audio: { mimeType: string; data: Uint8Array }[] = [];
    let bytes = 0;
    try {
      for await (const event of this.requests.stream(
        { projectId, sessionId, purpose: `${PACKAGE}:read-aloud` },
        model,
        { messages: request.messages, config: request.config, signal },
      )) {
        for (const item of event.content_items) {
          if (
            item.type !== "inline_data.done" ||
            !item.mime_type.toLowerCase().startsWith("audio/")
          )
            continue;
          bytes += item.data.byteLength;
          if (bytes > MAX_RESULT_BYTES) {
            throw new ToolError(
              502,
              "result_too_large",
              `The speech exceeds ${MAX_RESULT_BYTES / (1024 * 1024)} MiB.`,
            );
          }
          audio.push({ mimeType: item.mime_type, data: item.data });
        }
      }
    } catch (err) {
      if (signal.aborted) throw new ToolError(409, "run_cancelled", "Reading aloud was stopped.");
      throw new ToolError(502, "read_aloud_failed", failureReason(err));
    }
    signal.throwIfAborted();
    const first = audio[0];
    if (first === undefined)
      throw new ToolError(502, "missing_media", "The speech model returned no audio.");
    const media = playable(first);
    const extension = media === null ? undefined : extensionOf(media.mimeType);
    if (media === null || extension === undefined) {
      throw new ToolError(
        502,
        "unsupported_media",
        `The speech model returned audio in a format this tool cannot store (${first.mimeType.slice(0, 64)}).`,
      );
    }
    return this.store.writeSpeech(projectId, sessionId, key, {
      extension,
      mimeType: media.mimeType.split(";")[0]!.trim().toLowerCase(),
      data: media.data,
    });
  }
}
