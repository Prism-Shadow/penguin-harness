import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectWave } from "../src/activities/audio.js";
import { LOCAL_AUDIO_MODELS } from "../src/activities/local-audio-models.js";
import { runLocalAudioWorker } from "../src/activities/local-audio.js";

// Explicit opt-in: the full checkpoints need gigabytes of disk and native RAM.
const cacheDir = process.env.PENGUIN_AUDIO_SMOKE_CACHE;
describe.skipIf(!cacheDir)("real native sound-effect models", () => {
  it.each(["audiogen", "audioldm"] as const)(
    "generates a five-second %s WAV in the cancellable worker",
    async (provider) => {
      const moduleUrl = pathToFileURL(
        createRequire(import.meta.url).resolve("@huggingface/transformers"),
      ).href;
      const bytes = await runLocalAudioWorker(
        {
          provider,
          model: LOCAL_AUDIO_MODELS[provider].model,
          moduleUrl,
          cacheDir,
          adapterUrl: new URL(`../src/activities/local-audio-${provider}.mjs`, import.meta.url)
            .href,
          text: "A dog barks loudly, barking, woof woof.",
          seconds: 5,
        },
        new AbortController().signal,
      );
      expect(inspectWave(bytes, "native model")).toMatchObject({
        durationMs: 5000,
        mimeType: "audio/wav",
      });
      const pcm = Buffer.from(bytes);
      let energy = 0;
      for (let i = 44; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
      expect(Math.sqrt(energy / ((pcm.length - 44) / 2))).toBeGreaterThan(0.00001);
      await writeFile(path.join(cacheDir!, `${provider}-worker.wav`), bytes);
    },
    600_000,
  );
});
