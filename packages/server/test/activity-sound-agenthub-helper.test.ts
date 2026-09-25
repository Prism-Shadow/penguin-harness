import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inspectWave } from "../src/activities/audio.js";
import { inspectMp3 } from "../src/activities/sound.js";
import { soundMp3, speechWave } from "./audio-fixtures.js";

const HUB_INPUT = {
  provider: "agenthub",
  model: "test-tune",
  kind: "music",
  prompt: " a playful marimba loop ",
  targetDurationMs: 4000,
  credential: "GEMINI_API_KEY",
  format: "wav",
};

type Item = { mime: string; base64: string };

/**
 * Runs generate-sound.mjs's agenthub branch in its own process against a stand-in
 * `@prismshadow/agenthub` whose `AutoLLMClient` records what it was asked and streams the
 * given items. Nothing reaches a model.
 */
async function runHubHelper({
  input = HUB_INPUT as Record<string, unknown>,
  items = [] as Item[],
  terminal = "stop",
  providerError = false,
  credential = "fake-test-only" as string | null,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-hub-sound-test-"));
  try {
    await fs.copyFile(
      new URL(
        "../../../plugins/agent-development/skills/unified-llm-api/scripts/generate-sound.mjs",
        import.meta.url,
      ),
      path.join(root, "generate-sound.mjs"),
    );
    await fs.writeFile(path.join(root, "sound-input.json"), JSON.stringify(input));
    const module = path.join(root, "node_modules/@prismshadow/agenthub");
    await fs.mkdir(module, { recursive: true });
    await fs.writeFile(
      path.join(module, "package.json"),
      JSON.stringify({ type: "module", exports: "./index.js" }),
    );
    const source = items
      .map(
        (item) =>
          `{type:"inline_data",mime_type:${JSON.stringify(item.mime)},data:Buffer.from(${JSON.stringify(item.base64)},"base64")}`,
      )
      .join(",");
    await fs.writeFile(
      path.join(module, "index.js"),
      `import fs from "node:fs";
export class AutoLLMClient {
  constructor(options) { this.options = options; }
  async *streamingResponse(request) {
    fs.writeFileSync("request.json", JSON.stringify({ client: this.options, request }));
    ${providerError ? 'throw new Error("secret-test-provider-header");' : ""}
    yield { content_items: [${source}] };
    ${terminal === "missing" ? "" : `yield { content_items: [], finish_reason: ${JSON.stringify(terminal)}, usage_metadata: {} };`}
  }
}`,
    );
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.GEMINI_API_KEY;
    delete env.ELEVENLABS_API_KEY;
    if (credential) env.GEMINI_API_KEY = credential;
    const result = spawnSync(process.execPath, ["generate-sound.mjs"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10000,
    });
    const read = async (name: string) =>
      fs.readFile(path.join(root, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    const request = await read("request.json");
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      request: request
        ? (JSON.parse(request.toString("utf8")) as {
            client: Record<string, unknown>;
            request: { messages: { content_items: { text: string }[] }[] };
          })
        : null,
      wav: await read("sound.wav"),
      mp3: await read("sound.mp3"),
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const pcm = (samples: number) => speechWave(samples).subarray(44).toString("base64");

describe("generate-sound.mjs through agenthub", () => {
  it("asks the named model once and wraps streamed PCM as a WAV the server accepts", async () => {
    const result = await runHubHelper({
      items: [
        { mime: "audio/L16;codec=pcm;rate=24000", base64: pcm(1200) },
        { mime: "audio/pcm", base64: pcm(1200) },
      ],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.request!.client).toEqual({ model: "test-tune" });
    const text = result.request!.request.messages[0]!.content_items[0]!.text;
    expect(text).toContain("a piece of music about 4 seconds long");
    expect(text).toContain("\na playful marimba loop");
    expect(result.mp3).toBeNull();
    expect(result.wav).toEqual(speechWave(2400));
    expect(inspectWave(result.wav!, "run_test").durationMs).toBe(100);
    expect(result.stdout).toContain("sound.wav");
    expect(result.stdout + result.stderr).not.toContain("fake-test-only");
  });

  it("joins MPEG items into sound.mp3, and keeps a single WAV as it came", async () => {
    const frames = soundMp3(4, false);
    const mp3 = await runHubHelper({
      input: { ...HUB_INPUT, kind: "sfx", format: "mp3" },
      items: [
        { mime: "audio/mpeg", base64: frames.subarray(0, 834).toString("base64") },
        { mime: "audio/mpeg", base64: frames.subarray(834).toString("base64") },
      ],
    });
    expect(mp3.status, mp3.stderr).toBe(0);
    expect(mp3.request!.request.messages[0]!.content_items[0]!.text).toContain("a sound effect");
    expect(mp3.mp3).toEqual(frames);
    expect(mp3.wav).toBeNull();
    expect(inspectMp3(mp3.mp3!, "run_test").format).toBe("mp3");

    const wave = await runHubHelper({
      items: [{ mime: "audio/wav", base64: speechWave(48).toString("base64") }],
    });
    expect(wave.status, wave.stderr).toBe(0);
    expect(wave.wav).toEqual(speechWave(48));
  });

  it.each([
    { name: "another audio type", items: [{ mime: "audio/ogg", base64: pcm(10) }] },
    {
      name: "mixed types",
      items: [
        { mime: "audio/pcm", base64: pcm(10) },
        { mime: "audio/mpeg", base64: soundMp3(1, false).toString("base64") },
      ],
    },
    {
      name: "two WAVs",
      items: [
        { mime: "audio/wav", base64: speechWave(4).toString("base64") },
        { mime: "audio/wav", base64: speechWave(4).toString("base64") },
      ],
    },
    { name: "PCM at another rate", items: [{ mime: "audio/L16;rate=44100", base64: pcm(10) }] },
    { name: "no audio", items: [] },
    {
      name: "MP3 from a model catalogued as WAV",
      items: [{ mime: "audio/mpeg", base64: soundMp3(4, false).toString("base64") }],
    },
  ])("refuses $name and writes nothing", async ({ items }) => {
    const result = await runHubHelper({ items });
    expect(result.status).toBe(1);
    expect(result.wav).toBeNull();
    expect(result.mp3).toBeNull();
    expect(result.stderr).toContain("GEMINI_API_KEY");
  });

  it("refuses an unfinished stream", async () => {
    const result = await runHubHelper({
      items: [{ mime: "audio/pcm", base64: pcm(10) }],
      terminal: "missing",
    });
    expect(result.status).toBe(1);
    expect(result.wav).toBeNull();
  });

  it("needs the model's key and never loads the client without it", async () => {
    const result = await runHubHelper({
      items: [{ mime: "audio/pcm", base64: pcm(10) }],
      credential: null,
    });
    expect(result.status).toBe(1);
    expect(result.request).toBeNull();
    expect(result.stderr).toContain("GEMINI_API_KEY");
  });

  it.each([
    { ...HUB_INPUT, format: "ogg" },
    { ...HUB_INPUT, credential: "lower_case" },
    { ...HUB_INPUT, credential: undefined },
    { ...HUB_INPUT, model: "../escape" },
    { ...HUB_INPUT, kind: "speech" },
  ])("refuses invalid hub input without asking a model (%o)", async (input) => {
    const result = await runHubHelper({
      input,
      items: [{ mime: "audio/pcm", base64: pcm(10) }],
    });
    expect(result.status).toBe(1);
    expect(result.request).toBeNull();
  });

  it("never echoes a model's error", async () => {
    const result = await runHubHelper({ providerError: true });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("secret-test-provider-header");
    expect(result.stderr).not.toContain("fake-test-only");
  });
});
