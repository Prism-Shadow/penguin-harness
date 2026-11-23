/**
 * `penguin tools …` as an Agent runs it, against a scripted model and a data root on disk.
 *
 * - Given a bound image model, an Agent's `t2i` inside its Session hands the image back to the
 *   terminal, keeps it in the Session's folder, and the request is marked as this plugin's `t2i`.
 * - Raw PCM speech comes back as a WAV file a player opens.
 * - A recording reaches the model only as the bytes the terminal sent; on DeepSeek's recognizer a
 *   container it refuses is turned away before anything is sent.
 * - Image understanding runs on the Project's vision model, with the question asked.
 * - A tool with no model, a bad option, or `--detach` outside a Session is refused, and nothing
 *   reaches the model.
 * - A run with no Session stores nothing.
 * - A detached run is found by `status` once it is done, which saves its files on request; a run
 *   in flight is stopped by `cancel`, and `status` then says it was cancelled.
 * - A run the model fails is reported with its reason and exit code 1, its files not kept.
 * - `list` shows every tool with the model it runs on, the vision model for image understanding.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyResponseError, UpstreamError } from "@prismshadow/mmsp";
import { Tools } from "../src/tools.js";
import {
  answer,
  bindings,
  modelTable,
  PNG,
  runCli,
  scriptedModel,
  tempRoot,
  WAV,
  type Reply,
} from "./helpers.js";

const PROJECT = "research";
const SESSION = "s-0001";
const IMAGE = { provider: "openai", modelId: "gpt-image-2.5-flare" };
const SPEECH = { provider: "google", modelId: "gemini-3.8-flash-tts" };
const ASR = { provider: "deepseek", modelId: "deepseek-asr" };
const VISION = { provider: "google", modelId: "gemini-4-argon" };
const agent = {
  userId: "u1",
  isAdmin: false,
  projectId: PROJECT,
  sessionId: SESSION,
  agentId: "a1",
};
const terminal = { userId: "u1", isAdmin: false, projectId: PROJECT };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

async function setup(
  reply: Parameters<typeof scriptedModel>[0],
  bound: Record<string, typeof IMAGE> = {},
) {
  const root = await tempRoot();
  roots.push(root);
  const model = scriptedModel(reply);
  const tools = new Tools({
    requests: model,
    bindings: bindings(bound),
    models: modelTable([{ ...IMAGE }, { ...SPEECH }, { ...ASR }, { ...VISION }], VISION),
    root,
  });
  const sessionDir = path.join(root, PROJECT, ".multimodal-tools", "sessions", SESSION);
  return { root, model, tools, sessionDir };
}

const image: Reply = answer([{ type: "inline_data.done", mime_type: "image/png", data: PNG }], {
  cached_tokens: 0,
  prompt_tokens: 12,
  thoughts_tokens: null,
  response_tokens: 4096,
});

describe("penguin tools", () => {
  it("hands a generated image back, keeps it in the Session, and marks the request as this plugin's t2i", async () => {
    const { model, tools, sessionDir } = await setup(() => image, { t2i: IMAGE });
    const run = await runCli(
      tools,
      ["tools", "t2i", "a", "penguin", "reading", "--aspect-ratio", "1:1", "--json"],
      agent,
    );
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.files).toHaveLength(1);
    expect(run.files[0]).toMatchObject({ mimeType: "image/png" });
    expect(Buffer.from(run.files[0]!.data)).toEqual(PNG);
    const record = JSON.parse(run.stdout) as {
      status: string;
      files: { name: string; url: string }[];
      usage: unknown;
    };
    expect(record.status).toBe("completed");
    expect(record.usage).toMatchObject({ prompt_tokens: 12, response_tokens: 4096 });
    expect(record.files[0]!.url).toContain(`/sessions/${SESSION}/files/${run.files[0]!.name}`);
    expect(await fs.readFile(path.join(sessionDir, run.files[0]!.name))).toEqual(PNG);
    expect(model.received).toHaveLength(1);
    expect(model.received[0]!.scope).toEqual({
      projectId: PROJECT,
      sessionId: SESSION,
      purpose: "@penguinharness/multimodal-tools:t2i",
    });
    expect(model.received[0]!.model).toEqual(IMAGE);
    expect(model.received[0]!.request.config).toEqual({ image_config: { aspect_ratio: "1:1" } });
    expect(model.received[0]!.request.messages[0]!.content_items).toEqual([
      { type: "text.done", text: "a penguin reading" },
    ]);
  });

  it("returns raw PCM speech as a WAV file", async () => {
    const pcm = Buffer.from([0, 0, 1, 0, 255, 255, 0, 0]);
    const { tools } = await setup(
      () =>
        answer([
          { type: "inline_data.done", mime_type: "audio/L16; rate=16000; channels=1", data: pcm },
        ]),
      { t2s: SPEECH },
    );
    const run = await runCli(tools, ["tools", "t2s", "Welcome.", "--voice", "Kore"], agent);
    expect(run.exitCode, run.stderr).toBe(0);
    const wav = Buffer.from(run.files[0]!.data);
    expect(run.files[0]!.mimeType).toBe("audio/wav");
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.subarray(44)).toEqual(pcm);
    expect(run.files[0]!.name.endsWith(".wav")).toBe(true);
  });

  it.each(["", "  \n "])(
    "completes speech recognition when the provider heard no words",
    async (transcript) => {
      const { tools } = await setup(() => answer([{ type: "text.done", text: transcript }]), {
        s2t: ASR,
      });
      const result = await runCli(
        tools,
        ["tools", "s2t", "--audio", "quiet.wav", "--json"],
        agent,
        {
          "quiet.wav": { name: "quiet.wav", data: WAV },
        },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ operation: "s2t", status: "completed" });
    },
  );

  it("accepts a completed empty ASR response locally or through an MMSP server", async () => {
    const usage = {
      cached_tokens: null,
      prompt_tokens: 1,
      thoughts_tokens: null,
      response_tokens: 0,
    };
    const client = "OpenaiTranscriptionClient";
    const wire = {
      type: "EmptyResponseError",
      client,
      finish_reason: "stop",
      usage_metadata: usage,
    };
    const empty = (client: string, finishReason: string) =>
      new EmptyResponseError({ client, finishReason, usageMetadata: usage });
    const gateway = (status: number | null) =>
      new UpstreamError({
        client: "MmspClient",
        status,
        errorType: wire.type,
        message: "No transcript",
        error: wire,
      });
    for (const [error, completed] of [
      [empty(client, "stop"), true],
      [gateway(null), true],
      [empty(client, "length"), false],
      [empty("GoogleOfficialClient", "stop"), false],
      [gateway(503), false],
    ] as const) {
      const { tools } = await setup(
        () => {
          throw error;
        },
        { s2t: ASR },
      );
      const run = await runCli(tools, ["tools", "s2t", "--audio", "quiet.wav", "--json"], agent, {
        "quiet.wav": { name: "quiet.wav", data: WAV },
      });
      expect(run.exitCode).toBe(completed ? 0 : 1);
      if (completed) expect(JSON.parse(run.stdout)).toMatchObject({ status: "completed", usage });
    }
  });

  it("transcribes the recording the terminal sent, and turns away a container DeepSeek refuses before sending", async () => {
    const { model, tools } = await setup(
      () => answer([{ type: "text.done", text: "Recorded words" }]),
      { s2t: ASR },
    );
    const ok = await runCli(tools, ["tools", "s2t", "--audio", "talk.wav"], agent, {
      "talk.wav": { name: "talk.wav", data: WAV },
    });
    expect(ok.exitCode, ok.stderr).toBe(0);
    expect(ok.stdout).toBe("Recorded words\n");
    expect(model.received[0]!.request.messages[0]!.content_items).toEqual([
      { type: "inline_data.done", mime_type: "audio/wav", data: WAV },
    ]);
    const webm = await runCli(tools, ["tools", "s2t", "--audio", "talk.webm"], agent, {
      "talk.webm": { name: "talk.webm", data: Buffer.from("1a45dfa3", "hex") },
    });
    expect(webm.exitCode).toBe(1);
    expect(webm.stderr).toContain("DeepSeek ASR accepts 16-bit PCM WAV or Ogg Opus");
    expect(model.received).toHaveLength(1);
  });

  it("reads an image with the Project's vision model and the question asked", async () => {
    const { model, tools } = await setup(() =>
      answer([{ type: "text.done", text: "A bar chart." }]),
    );
    const run = await runCli(
      tools,
      ["tools", "i2t", "--image", "chart.png", "--prompt", "What is it?"],
      agent,
      {
        "chart.png": { name: "chart.png", data: PNG },
      },
    );
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toBe("A bar chart.\n");
    expect(model.received[0]!.model).toEqual(VISION);
    expect(model.received[0]!.scope.purpose).toBe("@penguinharness/multimodal-tools:i2t");
    expect(model.received[0]!.request.messages[0]!.content_items).toEqual([
      { type: "text.done", text: "What is it?" },
      { type: "inline_data.done", mime_type: "image/png", data: PNG },
    ]);
  });

  it("refuses a tool with no model, a bad option and --detach outside a Session, sending nothing", async () => {
    const { model, tools } = await setup(() => image, { t2i: IMAGE });
    const unbound = await runCli(tools, ["tools", "t2v", "a kite"], agent);
    expect(unbound.exitCode).toBe(1);
    expect(unbound.stderr).toContain("No model is bound to t2v title");
    const badRatio = await runCli(
      tools,
      ["tools", "t2i", "a kite", "--aspect-ratio", "5:4"],
      agent,
    );
    expect(badRatio.exitCode).toBe(2);
    expect(badRatio.stderr).toContain("Unsupported aspect ratio '5:4'");
    const detached = await runCli(tools, ["tools", "t2i", "a kite", "--detach"], terminal);
    expect(detached.exitCode).toBe(2);
    expect(detached.stderr).toContain("--detach keeps the run in its Session");
    expect(model.received).toEqual([]);
  });

  it("stores nothing for a run with no Session, and still hands its file back", async () => {
    const { root, tools } = await setup(() => image, { t2i: IMAGE });
    const run = await runCli(tools, ["tools", "t2i", "a kite"], terminal);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.files).toHaveLength(1);
    expect(run.stdout.trim()).toBe(run.files[0]!.name);
    await expect(fs.stat(path.join(root, PROJECT, ".multimodal-tools"))).rejects.toThrow();
  });

  it("finds a detached run with status once done, saving its files on request", async () => {
    const { tools } = await setup(() => image, { t2i: IMAGE });
    const started = await runCli(tools, ["tools", "t2i", "a kite", "--detach", "--json"], agent);
    expect(started.exitCode, started.stderr).toBe(0);
    expect(started.files).toEqual([]);
    const { id, status } = JSON.parse(started.stdout) as { id: string; status: string };
    expect(status).toBe("running");
    await tools.runs.waitFor(PROJECT, id);
    const peek = await runCli(tools, ["tools", "status", id, "--json"], agent);
    expect(JSON.parse(peek.stdout)).toMatchObject({ id, status: "completed" });
    expect(peek.files).toEqual([]);
    const saved = await runCli(tools, ["tools", "status", id, "--out", "./images"], agent);
    expect(saved.exitCode, saved.stderr).toBe(0);
    expect(Buffer.from(saved.files[0]!.data)).toEqual(PNG);
  });

  it("stops a run in flight with cancel, and status then says it was cancelled", async () => {
    const { tools, sessionDir } = await setup(() => ({ hang: true }), { t2i: IMAGE });
    const started = await runCli(tools, ["tools", "t2i", "a kite", "--detach"], agent);
    const id = started.stdout.trim();
    const running = await runCli(tools, ["tools", "status", id, "--json"], agent);
    expect(JSON.parse(running.stdout)).toMatchObject({ status: "running" });
    const cancelled = await runCli(tools, ["tools", "cancel", id, "--json"], agent);
    expect(cancelled.exitCode, cancelled.stderr).toBe(0);
    expect(JSON.parse(cancelled.stdout)).toMatchObject({ id, status: "cancelled" });
    const after = await runCli(tools, ["tools", "status", id], agent);
    expect(after.exitCode).toBe(1);
    expect(after.stderr).toContain("cancelled");
    expect((await fs.readdir(sessionDir)).filter((f) => !f.endsWith(".json"))).toEqual([]);
  });

  it("reports a failed run with its reason and keeps none of its files", async () => {
    const { tools, sessionDir } = await setup(
      () => answer([{ type: "text.done", text: "I cannot draw that." }]),
      {
        t2i: IMAGE,
      },
    );
    const run = await runCli(tools, ["tools", "t2i", "a kite"], agent);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("The model returned no image file.");
    expect(run.files).toEqual([]);
    expect((await fs.readdir(sessionDir)).filter((f) => !f.endsWith(".json"))).toEqual([]);
  });

  it("lists every tool with the model it runs on, the vision model reading images", async () => {
    const { tools } = await setup(() => image, { t2i: IMAGE });
    const run = await runCli(tools, ["tools", "list", "--json"], agent);
    const ops = JSON.parse(run.stdout) as { operation: string; via: string; model?: unknown }[];
    expect(ops.map((o) => o.operation)).toEqual([
      "t2t",
      "i2t",
      "search",
      "fetch",
      "t2i",
      "t2v",
      "t2s",
      "s2t",
    ]);
    expect(ops.find((o) => o.operation === "t2i")).toMatchObject({ via: "binding", model: IMAGE });
    expect(ops.find((o) => o.operation === "i2t")).toMatchObject({ via: "vision", model: VISION });
    expect(ops.find((o) => o.operation === "t2v")?.model).toBeUndefined();
  });
});
