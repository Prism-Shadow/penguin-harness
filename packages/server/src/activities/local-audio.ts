import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  Component,
  Interface,
  Use,
  type ClassCtx,
  type Opaque,
} from "@prismshadow/penguin-core/kernel";
import type { Config, Hmr } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import {
  KOKORO_VOICES,
  LOCAL_AUDIO_MODELS,
  type LocalAudioAvailability,
  type LocalAudioProvider,
} from "./local-audio-models.js";
import { LOCAL_AUDIO_WORKER } from "./local-audio-worker.js";

export interface LocalAudioRequest {
  provider: LocalAudioProvider;
  model: string;
  text: string;
  language?: string;
  voice?: string;
  seconds?: number;
}

export abstract class LocalAudio extends Interface<{
  availability(): LocalAudioAvailability;
  generate(
    request: LocalAudioRequest,
    signal: Opaque<"AbortSignal", AbortSignal>,
  ): Promise<Opaque<"Uint8Array", Uint8Array>>;
}>() {}

/** Heavy inference is isolated from HTTP and can be stopped even while native code runs. */
export function runLocalAudioWorker(
  data: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Local audio generation cancelled."));
      return;
    }
    const cacheRoot = typeof data.cacheDir === "string" ? path.resolve(data.cacheDir) : null;
    const downloadDir = cacheRoot ? path.join(cacheRoot, ".downloads", randomUUID()) : undefined;
    const worker = new Worker(LOCAL_AUDIO_WORKER, {
      eval: true,
      workerData: { ...data, downloadDir },
    });
    let settled = false;
    const finish = (error?: Error, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      void worker
        .terminate()
        .then(async () => {
          // Termination closes native/download handles before partial files are removed.
          if (downloadDir && cacheRoot && downloadDir.startsWith(cacheRoot + path.sep))
            await rm(downloadDir, { recursive: true, force: true });
          if (error) reject(error);
          else resolve(bytes!);
        })
        .catch(reject);
    };
    const abort = () => finish(new Error("Local audio generation cancelled."));
    const timeout = setTimeout(
      () => finish(new Error("Local audio generation exceeded 30 minutes.")),
      30 * 60_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.once("error", () => finish(new Error("The local audio worker could not start.")));
    worker.once("exit", (code) =>
      finish(new Error(`The local audio worker exited without a result (code ${code}).`)),
    );
    worker.once("message", (result: { bytes?: Uint8Array; error?: string }) => {
      if (result.error || !(result.bytes instanceof Uint8Array))
        finish(new Error(result.error ?? "Invalid local audio output."));
      else finish(undefined, result.bytes);
    });
  });
}

@Component()
export class LocalAudioService implements LocalAudio {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  private busy = false;
  private readonly stopped = new AbortController();

  setup({ effect }: ClassCtx) {
    effect(() => this.stopped.abort());
  }

  private moduleUrl(provider: LocalAudioProvider): string | null {
    // Hot-loaded code lives outside node_modules. A runtime installed in the data
    // directory remains reachable across hot updates and packaged desktop installs.
    for (const anchor of [
      path.join(this.config.root, "local-audio", "package.json"),
      import.meta.url,
    ]) {
      try {
        return pathToFileURL(createRequire(anchor).resolve(LOCAL_AUDIO_MODELS[provider].package))
          .href;
      } catch {
        /* Optional on deployments without a native audio runtime. */
      }
    }
    return null;
  }
  availability(): LocalAudioAvailability {
    return {
      kokoro: this.moduleUrl("kokoro") !== null,
      musicgen: this.moduleUrl("musicgen") !== null,
      audiogen: this.moduleUrl("audiogen") !== null,
      audioldm: this.moduleUrl("audioldm") !== null,
    };
  }
  async generate(request: LocalAudioRequest, signal: AbortSignal): Promise<Uint8Array> {
    if (this.busy)
      throw new HttpError(
        409,
        "local_audio_busy",
        "Another local audio model is running. Try again when it finishes.",
      );
    const definition = LOCAL_AUDIO_MODELS[request.provider];
    const moduleUrl = this.moduleUrl(request.provider);
    if (!moduleUrl)
      throw new HttpError(
        409,
        "local_audio_missing",
        "The selected local audio runtime is not installed.",
      );
    if (
      request.model !== definition.model ||
      !request.text.trim() ||
      request.text.length > (request.provider === "kokoro" ? 5000 : 2000)
    )
      throw new HttpError(400, "local_audio_invalid", "The local audio request is invalid.");
    if (
      request.provider === "kokoro" &&
      !KOKORO_VOICES.some(
        (voice) => voice.id === request.voice && voice.languages.includes(request.language ?? ""),
      )
    )
      throw new HttpError(
        400,
        "local_audio_invalid",
        "Choose a Kokoro voice for the narration's language.",
      );
    const seconds = request.seconds ?? 10;
    const maxSeconds = request.provider === "audiogen" || request.provider === "audioldm" ? 10 : 30;
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > maxSeconds)
      throw new HttpError(
        400,
        "local_audio_invalid",
        `This local model supports clips from 1 to ${maxSeconds} seconds.`,
      );
    this.busy = true;
    try {
      return await runLocalAudioWorker(
        {
          ...request,
          seconds,
          moduleUrl,
          cacheDir: path.join(this.config.root, "models", "audio"),
          ...(request.provider === "audiogen" || request.provider === "audioldm"
            ? {
                adapterUrl: this.hmr.assetsDir()
                  ? pathToFileURL(
                      path.join(this.hmr.assetsDir()!, `local-audio-${request.provider}.mjs`),
                    ).href
                  : new URL(`./local-audio-${request.provider}.mjs`, import.meta.url).href,
              }
            : {}),
        },
        AbortSignal.any([signal, this.stopped.signal]),
      );
    } finally {
      this.busy = false;
    }
  }
}
