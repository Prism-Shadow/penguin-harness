import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { soundMp3 } from "./audio-fixtures.js";
import { alignmentProblems } from "../src/activities/word-timings.js";

/** ElevenLabs' per-character alignment of `text`, each character 50 ms long. */
function alignment(text: string) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.05),
    character_end_times_seconds: characters.map((_, index) => (index + 1) * 0.05),
  };
}

/**
 * The helper runs in its own process with `fetch` replaced before it loads, so no request
 * ever leaves the machine: the stub records what it was asked and answers as configured.
 */
async function runHelper({
  input = {
    provider: "elevenlabs",
    model: "eleven_v3",
    voice: "AbCdEfGhIj0123456789",
    language: "en-US",
    script: "Hello, big [pause] cat!",
  } as Record<string, unknown>,
  status = 200,
  response = null as Record<string, unknown> | null,
  env = { ELEVENLABS_API_KEY: "fake-test-only" } as Record<string, string>,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-speech-test-"));
  try {
    await fs.copyFile(
      new URL(
        "../../../plugins/agent-development/skills/unified-llm-api/scripts/generate-speech.mjs",
        import.meta.url,
      ),
      path.join(root, "generate-speech.mjs"),
    );
    await fs.writeFile(path.join(root, "speech-input.json"), JSON.stringify(input));
    const body = response ?? {
      audio_base64: soundMp3(3).toString("base64"),
      alignment: alignment(String(input.script)),
    };
    await fs.writeFile(
      path.join(root, "stub-fetch.mjs"),
      `import fs from "node:fs";
      globalThis.fetch = async (url, init) => {
        fs.writeFileSync("request.json", JSON.stringify({ url: String(url), method: init.method, headers: init.headers, body: JSON.parse(init.body) }));
        const status = ${status};
        return new Response(status === 200 ? ${JSON.stringify(JSON.stringify(body))} : "secret-test-provider-body", { status });
      };`,
    );
    const childEnv: Record<string, string | undefined> = { ...process.env };
    for (const key of ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "GEMINI_API_KEY"])
      delete childEnv[key];
    Object.assign(childEnv, env);
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(path.join(root, "stub-fetch.mjs")).href, "generate-speech.mjs"],
      { cwd: root, env: childEnv, encoding: "utf8", timeout: 10000 },
    );
    const read = async (name: string) =>
      fs.readFile(path.join(root, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    const request = await read("request.json");
    const timings = await read("speech-timings.json");
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      request: request ? (JSON.parse(request.toString("utf8")) as Record<string, unknown>) : null,
      output: await read("speech.mp3"),
      timings: timings
        ? (JSON.parse(timings.toString("utf8")) as {
            word: string;
            startMs: number;
            endMs: number;
          }[])
        : null,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("generate-speech.mjs with ElevenLabs", () => {
  it("asks for speech with timestamps and writes the MP3 and one timing per spoken word", async () => {
    const result = await runHelper();
    expect(result.status, result.stderr).toBe(0);
    expect(result.request).toEqual({
      url: "https://api.elevenlabs.io/v1/text-to-speech/AbCdEfGhIj0123456789/with-timestamps?output_format=mp3_44100_128",
      method: "POST",
      headers: { "xi-api-key": "fake-test-only", "content-type": "application/json" },
      body: { text: "Hello, big [pause] cat!", model_id: "eleven_v3" },
    });
    expect(result.output).toEqual(soundMp3(3));
    // "Hello," is H..o (chars 0-4); the comma, the space and the [pause] tag are not words.
    expect(result.timings).toEqual([
      { word: "Hello", startMs: 0, endMs: 250 },
      { word: "big", startMs: 350, endMs: 500 },
      { word: "cat", startMs: 950, endMs: 1100 },
    ]);
    expect(alignmentProblems("Hello, big [pause] cat!", result.timings!)).toEqual([]);
    expect(result.stdout).not.toContain("fake-test-only");
  });

  it("keeps apostrophes and hyphens, and a bracket that never closes is spoken text", async () => {
    const script = "Don't jump-rope [softly] now [";
    const result = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voice: "AbCdEfGhIj0123456789",
        language: "en-US",
        script,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.timings!.map((timing) => timing.word)).toEqual(["Don't", "jump-rope", "now"]);
    expect(alignmentProblems(script, result.timings!)).toEqual([]);
  });

  it("never lets a word start before the previous one ended, or end where it starts", async () => {
    const result = await runHelper({
      response: {
        audio_base64: soundMp3(3).toString("base64"),
        alignment: {
          characters: ["a", " ", "b"],
          character_start_times_seconds: [0, 0.1, 0.05],
          character_end_times_seconds: [0.2, 0.2, 0.05],
        },
      },
      input: {
        provider: "elevenlabs",
        model: "eleven_v3",
        voice: "AbCdEfGhIj0123456789",
        language: "en-US",
        script: "a b",
      },
    });
    expect(result.timings).toEqual([
      { word: "a", startMs: 0, endMs: 200 },
      { word: "b", startMs: 200, endMs: 201 },
    ]);
  });

  it("speaks with the Vault's default voice", async () => {
    const result = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "eleven_v3",
        voice: "elevenlabs-default",
        language: "en-US",
        script: "Hi",
      },
      env: { ELEVENLABS_API_KEY: "fake-test-only", ELEVENLABS_VOICE_ID: "VaultVoice0123" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(String(result.request!.url)).toContain("/text-to-speech/VaultVoice0123/");
  });

  it("fails without asking when the key, the voice or the input is wrong", async () => {
    const noKey = await runHelper({ env: {} });
    expect(noKey.status).toBe(1);
    expect(noKey.request).toBeNull();
    expect(noKey.stderr).toContain("ELEVENLABS_API_KEY");
    const noVoice = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "eleven_v3",
        voice: "elevenlabs-default",
        language: "en-US",
        script: "Hi",
      },
    });
    expect(noVoice.status).toBe(1);
    expect(noVoice.request).toBeNull();
    const badModel = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "eleven_turbo",
        voice: "AbCdEfGhIj0123456789",
        language: "en-US",
        script: "Hi",
      },
    });
    expect(badModel.status).toBe(1);
    expect(badModel.request).toBeNull();
  });

  it("reports a refused key without the provider's body, and writes nothing", async () => {
    const refused = await runHelper({ status: 401 });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toBe("provider refused: plan or key\n");
    expect(refused.output).toBeNull();
    const failed = await runHelper({ status: 500 });
    expect(failed.status).toBe(1);
    expect(failed.stderr).not.toContain("secret-test-provider-body");
    expect(failed.timings).toBeNull();
    const noAlignment = await runHelper({
      response: { audio_base64: soundMp3(3).toString("base64") },
    });
    expect(noAlignment.status).toBe(1);
    expect(noAlignment.output).toBeNull();
  });

  it("still refuses a Gemini input it cannot speak, naming Gemini's key", async () => {
    const result = await runHelper({
      input: {
        model: "gemini-3.1-flash-tts-preview",
        voice: "NotAVoice",
        language: "en-US",
        script: "Hi",
      },
    });
    expect(result.status).toBe(1);
    expect(result.request).toBeNull();
    expect(result.stderr).toContain("GEMINI_API_KEY");
  });
});
