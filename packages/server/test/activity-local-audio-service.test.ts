import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import workerThreads from "node:worker_threads";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAudioService, localAudioModuleUrl } from "../src/activities/local-audio.js";
import {
  LOCAL_AUDIO_MODELS,
  type LocalAudioProvider,
} from "../src/activities/local-audio-models.js";

const workers: any[] = [];
class ControlledWorker extends EventEmitter {
  terminate = vi.fn(async () => 0);
  constructor(
    _source: string,
    readonly options: any,
  ) {
    super();
    workers.push(this);
  }
}
beforeEach(() => {
  vi.spyOn(workerThreads, "Worker").mockImplementation(function (source, options) {
    return new ControlledWorker(source as string, options) as unknown as workerThreads.Worker;
  });
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  workers.splice(0);
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function installation(packages: string[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-audio-runtime-"));
  roots.push(root);
  const anchor = path.join(root, "local-audio", "package.json");
  for (const name of dependencies) {
    const dir = path.join(path.dirname(anchor), "node_modules", name);
    await fs.mkdir(dir, { recursive: true });
    if (packages.includes(name))
      await fs.writeFile(path.join(dir, "index.js"), "module.exports = {};");
    // Block NODE_PATH/global fallback so the test does not borrow the developer's runtime.
    else
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ exports: "./missing.js" }),
      );
  }
  return { root, anchor };
}
const dependencies = [
  "kokoro-js",
  "@huggingface/transformers",
  "phonemizer",
  "onnxruntime-node",
  "onnxruntime-web",
  "sharp",
];
async function service() {
  const { root } = await installation(dependencies);
  const audio = new LocalAudioService();
  Object.assign(audio, { config: { root }, hmr: { assetsDir: () => null } });
  return audio;
}
const request = (provider: LocalAudioProvider) => ({
  provider,
  model: LOCAL_AUDIO_MODELS[provider].model,
  text: "Hello",
  ...(provider === "kokoro" ? { voice: "af_heart", language: "en-US" } : {}),
});
const signal = () => new AbortController().signal;
const complete = (index: number) =>
  workers[index].emit("message", { bytes: new Uint8Array([index]) });

describe("local audio readiness", () => {
  it.each(dependencies.slice(1))(
    "does not advertise Kokoro when %s is missing",
    async (missing) => {
      const { anchor } = await installation(dependencies.filter((name) => name !== missing));
      expect(localAudioModuleUrl("kokoro", [anchor])).toBeNull();
    },
  );
  it("uses a complete fallback after an incomplete data-directory installation", async () => {
    const broken = await installation(["kokoro-js"]);
    const healthy = await installation(dependencies);
    expect(localAudioModuleUrl("kokoro", [broken.anchor, healthy.anchor])).toBe(
      pathToFileURL(path.join(path.dirname(healthy.anchor), "node_modules/kokoro-js/index.js"))
        .href,
    );
  });
  it.each(["musicgen", "audiogen", "audioldm"] as const)(
    "checks %s's native dependency",
    async (provider) => {
      const { anchor } = await installation(
        dependencies.filter((name) => name !== "onnxruntime-node"),
      );
      expect(localAudioModuleUrl(provider, [anchor])).toBeNull();
    },
  );
});

describe("local audio queue", () => {
  it("runs all providers in arrival order, with only one worker at a time", async () => {
    const audio = await service();
    const providers = ["kokoro", "musicgen", "audiogen", "audioldm"] as const;
    const jobs = providers.map((provider) => audio.generate(request(provider), signal()));
    for (let index = 0; index < jobs.length; index++) {
      await vi.waitFor(() => expect(workers).toHaveLength(index + 1));
      expect(workers[index].options.workerData.provider).toBe(providers[index]);
      complete(index);
      await expect(jobs[index]).resolves.toEqual(new Uint8Array([index]));
      expect(workers[index].terminate).toHaveBeenCalledOnce();
    }
  });
  it("cancels a queued job immediately without letting its successor overtake", async () => {
    const audio = await service();
    const first = audio.generate(request("kokoro"), signal());
    const controller = new AbortController();
    const cancelled = audio.generate(request("musicgen"), controller.signal);
    const rejection = expect(cancelled).rejects.toThrow("cancelled");
    const last = audio.generate(request("audiogen"), signal());
    controller.abort();
    await rejection;
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    complete(0);
    await first;
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[1].options.workerData.provider).toBe("audiogen");
    complete(1);
    await last;
  });
  it("waits for termination before advancing after a worker failure", async () => {
    const audio = await service();
    const first = audio.generate(request("musicgen"), signal());
    const rejection = expect(first).rejects.toThrow("broken");
    const second = audio.generate(request("kokoro"), signal());
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    let terminated!: () => void;
    workers[0].terminate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminated = resolve;
        }),
    );
    workers[0].emit("message", { error: "broken" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(workers).toHaveLength(1);
    terminated();
    await rejection;
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    complete(1);
    await second;
  });
  it("cancels both the active worker and queued jobs on shutdown", async () => {
    const audio = await service();
    let stop!: () => void;
    audio.setup({
      effect: (cleanup: () => void) => {
        stop = cleanup;
      },
    } as any);
    const first = audio.generate(request("musicgen"), signal());
    const second = audio.generate(request("kokoro"), signal());
    const rejections = [
      expect(first).rejects.toThrow("cancelled"),
      expect(second).rejects.toThrow("cancelled"),
    ];
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    stop();
    await Promise.all(rejections);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    await expect(audio.generate(request("musicgen"), signal())).rejects.toThrow("cancelled");
  });
});
