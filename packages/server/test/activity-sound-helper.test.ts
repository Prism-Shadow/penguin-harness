import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { soundMp3 } from "./audio-fixtures.js";

/**
 * The helper runs in its own process with `fetch` replaced before it loads, so no request
 * ever leaves the machine: the stub records what it was asked and answers as configured.
 */
async function runHelper({
  input = {
    provider: "elevenlabs",
    model: "sound-generation",
    kind: "sfx",
    prompt: "a door creaks",
    targetDurationMs: 2500,
  } as Record<string, unknown>,
  status = 200,
  credential = "fake-test-only" as string | null,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sound-test-"));
  try {
    await fs.copyFile(
      new URL(
        "../../../plugins/agent-development/skills/unified-llm-api/scripts/generate-sound.mjs",
        import.meta.url,
      ),
      path.join(root, "generate-sound.mjs"),
    );
    await fs.writeFile(path.join(root, "sound-input.json"), JSON.stringify(input));
    const body = soundMp3(3).toString("base64");
    await fs.writeFile(
      path.join(root, "stub-fetch.mjs"),
      `import fs from "node:fs";
      globalThis.fetch = async (url, init) => {
        fs.writeFileSync("request.json", JSON.stringify({ url: String(url), method: init.method, headers: init.headers, body: JSON.parse(init.body) }));
        const status = ${status};
        return new Response(status === 200 ? Buffer.from(${JSON.stringify(body)}, "base64") : "secret-test-provider-body", { status });
      };`,
    );
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.ELEVENLABS_API_KEY;
    if (credential) env.ELEVENLABS_API_KEY = credential;
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(path.join(root, "stub-fetch.mjs")).href, "generate-sound.mjs"],
      { cwd: root, env, encoding: "utf8", timeout: 10000 },
    );
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
      request: request ? (JSON.parse(request.toString("utf8")) as Record<string, unknown>) : null,
      output: await read("sound.mp3"),
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("generate-sound.mjs", () => {
  it("asks ElevenLabs for a sound effect and writes sound.mp3", async () => {
    const result = await runHelper();
    expect(result.status, result.stderr).toBe(0);
    expect(result.request).toEqual({
      url: "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
      method: "POST",
      headers: {
        "xi-api-key": "fake-test-only",
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: { text: "a door creaks", duration_seconds: 2.5 },
    });
    expect(result.output).toEqual(soundMp3(3));
    expect(result.stdout).not.toContain("fake-test-only");
  });

  it("asks for music with its model and length", async () => {
    const result = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "music_v1",
        kind: "music",
        prompt: " gentle marimba loop ",
        targetDurationMs: 30000,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.request).toMatchObject({
      url: "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
      body: { prompt: "gentle marimba loop", model_id: "music_v1", music_length_ms: 30000 },
    });
    const free = await runHelper({
      input: { provider: "elevenlabs", model: "music_v1", kind: "music", prompt: "rain" },
    });
    expect(free.request).toMatchObject({ body: { prompt: "rain", model_id: "music_v1" } });
    expect((free.request!.body as Record<string, unknown>).music_length_ms).toBeUndefined();
  });

  it("asks each endpoint for the nearest length it can make", async () => {
    const sfx = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "sound-generation",
        kind: "sfx",
        prompt: "long wind",
        targetDurationMs: 45000,
      },
    });
    expect(sfx.request).toMatchObject({ body: { text: "long wind", duration_seconds: 30 } });
    const music = await runHelper({
      input: {
        provider: "elevenlabs",
        model: "music_v1",
        kind: "music",
        prompt: "short sting",
        targetDurationMs: 1000,
      },
    });
    expect(music.request).toMatchObject({ body: { music_length_ms: 3000 } });
  });

  it.each([
    { provider: "agenthub", model: "sound-generation", kind: "sfx", prompt: "x" },
    { provider: "elevenlabs", model: "music_v1", kind: "sfx", prompt: "x" },
    { provider: "elevenlabs", model: "sound-generation", kind: "sfx", prompt: "   " },
    { provider: "elevenlabs", model: "sound-generation", kind: "sfx", prompt: "x".repeat(2001) },
    {
      provider: "elevenlabs",
      model: "sound-generation",
      kind: "sfx",
      prompt: "x",
      targetDurationMs: 999,
    },
    {
      provider: "elevenlabs",
      model: "sound-generation",
      kind: "sfx",
      prompt: "x",
      targetDurationMs: 60001,
    },
  ])("refuses invalid input without calling the provider (%o)", async (input) => {
    const result = await runHelper({ input });
    expect(result.status).toBe(1);
    expect(result.request).toBeNull();
    expect(result.output).toBeNull();
  });

  it("needs the key and never calls without it", async () => {
    const result = await runHelper({ credential: null });
    expect(result.status).toBe(1);
    expect(result.request).toBeNull();
    expect(result.stderr).toContain("ELEVENLABS_API_KEY");
  });

  it.each([401, 403])(
    "says a refused key or plan plainly on %i and writes nothing",
    async (status) => {
      const result = await runHelper({ status });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("provider refused: plan or key\n");
      expect(result.output).toBeNull();
    },
  );

  it("names a rejected request without blaming the key", async () => {
    const result = await runHelper({ status: 422 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTP 422");
    expect(result.stderr).toContain("length");
    expect(result.stderr).not.toContain("ELEVENLABS_API_KEY");
    expect(result.stderr).not.toContain("secret-test-provider-body");
    expect(result.output).toBeNull();
  });

  it("never echoes a failed provider's response", async () => {
    const result = await runHelper({ status: 500 });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("secret-test-provider-body");
    expect(result.stderr).not.toContain("fake-test-only");
    expect(result.output).toBeNull();
  });
});
