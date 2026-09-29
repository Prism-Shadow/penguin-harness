import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWave } from "../src/activities/audio.js";
import { runLocalAudioWorker } from "../src/activities/local-audio.js";

describe("native audio worker", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });
  async function fixture(code: string) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-local-audio-"));
    roots.push(root);
    const entry = path.join(root, "runtime.mjs");
    await fs.writeFile(entry, code);
    // Kokoro's actual Node runtime uses a CommonJS Transformers instance for its cache.
    const transformers = path.join(root, "node_modules", "@huggingface", "transformers");
    await fs.mkdir(transformers, { recursive: true });
    await fs.writeFile(path.join(transformers, "index.js"), "exports.env = {};");
    return { moduleUrl: pathToFileURL(entry).href, cacheDir: path.join(root, "models"), root };
  }

  it("concatenates Kokoro stream chunks and configures its actual cache", async () => {
    const data = await fixture(`
      import { createRequire } from 'node:module';
      const { env } = createRequire(import.meta.url)('@huggingface/transformers');
      export class TextSplitterStream {
        push(text) { this.text = text; }
        close() { this.closed = true; }
      }
      export class KokoroTTS {
        static async from_pretrained(model, options) {
          if (model !== 'kokoro-test' || options.device !== 'cpu' || !env.cacheDir.endsWith('models')) throw Error('bad configuration');
          return new KokoroTTS();
        }
        model = { dispose: async () => {} };
        tokenizer() { return { input_ids: { dims: [1, 10] } }; }
        async *stream(splitter, { voice }) {
          if (!splitter.closed || splitter.text !== 'Two sentences.' || voice !== 'af_heart') throw Error('bad input');
          yield { audio: { audio: new Float32Array([0, 0.5]), sampling_rate: 24000 } };
          yield { audio: { audio: new Float32Array([-0.5, 1]), sampling_rate: 24000 } };
        }
      }
    `);
    const bytes = await runLocalAudioWorker(
      {
        ...data,
        provider: "kokoro",
        model: "kokoro-test",
        text: "Two sentences.",
        voice: "af_heart",
      },
      new AbortController().signal,
    );
    expect(inspectWave(bytes, "test").bytes).toBe(52);
    const pcm = Buffer.from(bytes);
    expect([44, 46, 48, 50].map((offset) => pcm.readInt16LE(offset))).toEqual([
      0, 16384, -16383, 32767,
    ]);
  });

  it("runs MusicGen with the requested length and resamples to the candidate WAV format", async () => {
    const data = await fixture(`
      export class AutoTokenizer {
        static async from_pretrained() { return text => ({ prompt: text }); }
      }
      export class MusicgenForConditionalGeneration {
        static async from_pretrained(model, options) {
          if (model !== 'musicgen-test' || options.dtype.encodec_decode !== 'fp32') throw Error('bad configuration');
          return new this();
        }
        config = { audio_encoder: { sampling_rate: 32000 } };
        async generate(input) {
          if (input.max_new_tokens !== 100 || input.prompt !== 'Piano') throw Error('bad input');
          return { data: new Float32Array(64000).fill(0.25) };
        }
        async dispose() {}
      }
      export default { AutoTokenizer, MusicgenForConditionalGeneration };
    `);
    const bytes = await runLocalAudioWorker(
      { ...data, provider: "musicgen", model: "musicgen-test", text: "Piano", seconds: 2 },
      new AbortController().signal,
    );
    expect(inspectWave(bytes, "test")).toMatchObject({ durationMs: 2000, mimeType: "audio/wav" });
  });

  it("terminates blocked inference on cancellation", async () => {
    const data = await fixture("while (true) {};");
    const controller = new AbortController();
    const result = runLocalAudioWorker({ ...data, provider: "musicgen" }, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(result).rejects.toThrow("cancelled");
  });

  it("rejects a crashed worker and hides runtime errors", async () => {
    const exited = await fixture("process.exit(1);");
    await expect(
      runLocalAudioWorker({ ...exited, provider: "musicgen" }, new AbortController().signal),
    ).rejects.toThrow("without a result");
    const failed = await fixture("throw new Error('sensitive runtime detail');");
    await expect(
      runLocalAudioWorker({ ...failed, provider: "musicgen" }, new AbortController().signal),
    ).rejects.toThrow("Local audio generation failed.");
  });
});
