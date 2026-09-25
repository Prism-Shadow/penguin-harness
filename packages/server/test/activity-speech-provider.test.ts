import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
} from "../src/activities/domain.js";
import { ActivityGenerationService } from "../src/activities/generation.js";
import { speechProviderFor, speechSetup } from "../src/activities/audio-providers.js";
import { validateManifest } from "../src/activities/media.js";
import {
  ELEVENLABS_DEFAULT_VOICE,
  isVoiceOf,
  speechCatalogue,
} from "../src/activities/voice-catalogue.js";
import type { SpeechSetup } from "../src/activities/speech-types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { soundMp3, speechWave } from "./audio-fixtures.js";

const PROJECT = "speaker-activities";
const VOICE_ID = "AbCdEfGhIj0123456789";

describe("choosing who speaks a narration", () => {
  it("picks the narration's provider, Gemini when it names none, and never substitutes", () => {
    expect(speechProviderFor({}, ["GEMINI_API_KEY"])).toEqual({
      provider: "gemini",
      credential: "GEMINI_API_KEY",
      timings: false,
    });
    expect(speechProviderFor({ speechProvider: "elevenlabs" }, ["ELEVENLABS_API_KEY"])).toEqual({
      provider: "elevenlabs",
      credential: "ELEVENLABS_API_KEY",
      timings: true,
    });
    // ElevenLabs without its key is refused with the key's name, even though Gemini's is there.
    expect(speechProviderFor({ speechProvider: "elevenlabs" }, ["GEMINI_API_KEY"])).toEqual({
      problem: "credential_missing",
      credential: "ELEVENLABS_API_KEY",
    });
    expect(speechProviderFor({ speechProvider: "kokoro" }, ["GEMINI_API_KEY"])).toEqual({
      problem: "provider_unknown",
    });
    expect(speechProviderFor({ speechProvider: "elevenlabs" }, null)).toMatchObject({
      provider: "elevenlabs",
    });
  });

  it("reports each provider for the agent and lists the Vault's default ElevenLabs voice", () => {
    expect(speechSetup(["GEMINI_API_KEY"])).toEqual([
      { id: "gemini", credential: "GEMINI_API_KEY", available: true, timings: false },
      {
        id: "elevenlabs",
        credential: "ELEVENLABS_API_KEY",
        available: false,
        problem: "credential_missing",
        timings: true,
      },
    ]);
    expect(speechCatalogue(null).every((option) => option.providerId === "gemini")).toBe(true);
    expect(speechCatalogue(["ELEVENLABS_VOICE_ID"]).at(-1)).toMatchObject({
      id: ELEVENLABS_DEFAULT_VOICE,
      label: "ElevenLabs default",
      providerId: "elevenlabs",
      model: "eleven_v3",
    });
  });

  it("accepts only the voices each provider speaks with", () => {
    expect(isVoiceOf("gemini", "Kore")).toBe(true);
    expect(isVoiceOf("gemini", VOICE_ID)).toBe(false);
    expect(isVoiceOf("elevenlabs", VOICE_ID)).toBe(true);
    expect(isVoiceOf("elevenlabs", ELEVENLABS_DEFAULT_VOICE)).toBe(true);
    expect(isVoiceOf("elevenlabs", "Kore")).toBe(false);
    expect(isVoiceOf("elevenlabs", "short1")).toBe(false);
    expect(isVoiceOf("elevenlabs", "has space 0123456789")).toBe(false);
  });

  it("keeps a narration's provider in the manifest and refuses it anywhere else", () => {
    const address = { productCode: "p", refNum: 1 };
    const manifest = (asset: Record<string, unknown>) => ({
      ...address,
      assets: { "en-US": [{ key: "a", description: "d", usages: [], ...asset }] },
    });
    expect(
      validateManifest(manifest({ type: "audio", speechProvider: "elevenlabs" }), address).assets[
        "en-US"
      ]![0]!.speechProvider,
    ).toBe("elevenlabs");
    expect(
      validateManifest(manifest({ type: "audio" }), address).assets["en-US"]![0]!.speechProvider,
    ).toBeUndefined();
    expect(() =>
      validateManifest(manifest({ type: "audio", speechProvider: "kokoro" }), address),
    ).toThrow(/speech provider/);
    expect(() =>
      validateManifest(manifest({ type: "image", speechProvider: "gemini" }), address),
    ).toThrow(/speech provider/);
  });
});

describe("speech through the provider seam", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    // What the fake Session writes, standing in for the helper; nothing reaches a provider.
    let output: { files: Record<string, Buffer | string> } = { files: {} };
    const prompts: string[] = [];
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(input, options) {
        prompts.push(JSON.stringify(input));
        yield requestBegin();
        await new Promise<void>((resolve) => {
          complete = resolve;
          waiting.add(row.sessionId);
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        for (const [name, bytes] of Object.entries(output.files))
          await fs.writeFile(path.join(row.workspace!, name), bytes);
        yield requestEnd("completed");
      },
    });
    const t = await createTestApp();
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "speaker");
    const client = apiClient(t.app, owner.cookie);
    const project = await client.post("/api/projects", { projectId: PROJECT });
    expect(project.status, await project.clone().text()).toBe(201);
    await t.deps.projectConfigService.writeRaw(PROJECT, {
      default_model: { provider: "custom", model_id: "activity-test" },
      models: [
        {
          provider: "custom",
          model_id: "activity-test",
          api_key: "not-a-real-key",
          base_url: "http://localhost:1/v1",
          client_type: "openai-chat",
        },
      ],
    });
    const base = `/api/projects/${PROJECT}/activities`;
    const created = (await (
      await client.post(base, { productCode: "p", refNum: 1, title: "Speech" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "Say hello",
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Greet",
            audio: {
              tracks: [
                { key: "hello", description: "Greeting", script: "Hello, big [pause] cat!" },
              ],
            },
          },
        ],
      },
      expectedRevision: described.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: ((await saved.json()) as ActivityDraft).contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const current = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const hello = async () =>
      (await current()).draft.mediaPlan!.manifest.assets["en-US"]!.find(
        (asset) => asset.key === "hello",
      )!;
    const setVault = async (keys: string[]) =>
      expect(
        (
          await client.put(`/api/projects/${PROJECT}/agents/default_agent/vault`, {
            entries: keys.map((key) => ({ key, value: "fake-test-only" })),
          })
        ).status,
      ).toBe(200);
    /** Save the narration's provider (and voice) as the editor would. */
    const choose = async (speechProvider: "gemini" | "elevenlabs", voice?: string) => {
      const detail = await current();
      const manifest = structuredClone(detail.draft.mediaPlan!.manifest);
      const asset = manifest.assets["en-US"]!.find((entry) => entry.key === "hello")!;
      asset.speechProvider = speechProvider;
      if (voice) asset.voice = voice;
      const response = await client.put(`${endpoint}/media`, {
        manifest,
        expectedRevision: detail.draft.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    const generate = async (voice: string, provider?: string) =>
      client.post(`${endpoint}/generate-audio`, {
        agentId: "default_agent",
        expectedRevision: (await current()).draft.contentRevision,
        language: "en-US",
        assetKey: "hello",
        voice,
        ...(provider ? { provider } : {}),
      });
    async function started(voice: string, provider?: string) {
      const response = await generate(voice, provider);
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => waiting.has(run.sessionId!));
      return run;
    }
    async function finish(run: ActivityRun, files: Record<string, Buffer | string>) {
      output = { files };
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      return (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((entry) => entry.runId === run.runId)!;
    }
    const accept = async (run: ActivityRun) => {
      const response = await client.post(`${endpoint}/runs/${run.runId}/accept-audio`, {
        expectedRevision: (await current()).draft.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    return {
      client,
      endpoint,
      prompts,
      current,
      hello,
      setVault,
      choose,
      generate,
      started,
      finish,
      accept,
    };
  }

  const timings = [
    { word: "Hello", startMs: 0, endMs: 300 },
    { word: "big", startMs: 350, endMs: 500 },
    { word: "cat", startMs: 900, endMs: 1200 },
  ];

  it("refuses ElevenLabs without its key, naming it, and the default voice without one in the Vault", async () => {
    const f = await fixture();
    await f.setVault(["GEMINI_API_KEY"]);
    await f.choose("elevenlabs");
    const missing = await f.generate(VOICE_ID);
    expect(missing.status).toBe(400);
    // The key is named as data, so the App words it, not only in the message.
    expect(((await missing.json()) as { error: unknown }).error).toMatchObject({
      code: "speech_credential_missing",
      detail: { credential: "ELEVENLABS_API_KEY" },
    });
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const noVoice = await f.generate(ELEVENLABS_DEFAULT_VOICE);
    expect(noVoice.status).toBe(400);
    expect(JSON.stringify(await noVoice.json())).toContain("ELEVENLABS_VOICE_ID");
    // A Gemini voice is not one ElevenLabs speaks with.
    expect((await f.generate("Kore")).status).toBe(422);
    const unknown = await f.generate(VOICE_ID, "kokoro");
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(await unknown.json())).toContain("speech_provider_unknown");
    const listed = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(listed.runs).toEqual([]);
  });

  it("reports the providers and voices for the chosen agent", async () => {
    const f = await fixture();
    await f.setVault(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
    const setup = (await (
      await f.client.get(`/api/projects/${PROJECT}/activities/speech-setup?agentId=default_agent`)
    ).json()) as SpeechSetup;
    expect(setup.providers).toEqual([
      expect.objectContaining({ id: "gemini", available: false, problem: "credential_missing" }),
      expect.objectContaining({ id: "elevenlabs", available: true, timings: true }),
    ]);
    expect(setup.catalogue.map((option) => option.id)).toContain(ELEVENLABS_DEFAULT_VOICE);
    // An agent id that is not an id is refused before it names a path.
    for (const route of ["speech-setup", "sound-setup"]) {
      const probed = await f.client.get(
        `/api/projects/${PROJECT}/activities/${route}?agentId=${encodeURIComponent("../../other/agents/default_agent")}`,
      );
      expect(probed.status).toBe(400);
    }
    // Without an agent, the Gemini catalogue as before.
    const plain = (await (
      await f.client.get(`/api/projects/${PROJECT}/activities/speech-setup`)
    ).json()) as SpeechSetup;
    expect(plain.providers).toBeUndefined();
    expect(plain.catalogue.map((option) => option.id)).toEqual([
      "Kore",
      "Puck",
      "Charon",
      "Fenrir",
      "Aoede",
    ]);
    // Key names only: a Vault value never reaches the App.
    expect(JSON.stringify(setup)).not.toContain("fake-test-only");
  });

  it("collects an ElevenLabs MP3 with its word timings and records them when accepted", async () => {
    const f = await fixture();
    await f.setVault(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
    await f.choose("elevenlabs");
    const run = await f.started(ELEVENLABS_DEFAULT_VOICE);
    expect(run.audio).toMatchObject({
      provider: "elevenlabs",
      model: "eleven_v3",
      voice: ELEVENLABS_DEFAULT_VOICE,
      script: "Hello, big [pause] cat!",
    });
    expect(f.prompts.at(-1)).toContain("speech.mp3");
    const summary = await f.finish(run, {
      "speech.mp3": soundMp3(40),
      "speech-timings.json": JSON.stringify(timings),
    });
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    const played = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    expect(played.headers.get("content-type")).toBe("audio/mpeg");
    expect((await f.hello()).path).toBeUndefined();
    await f.accept(run);
    const bound = await f.hello();
    expect(bound.path).toBe(`media/generated/${run.runId}.mp3`);
    expect(bound.generatedAudio).toMatchObject({ runId: run.runId, format: "mp3" });
    expect(bound.wordTimings).toEqual(timings);
    // 40 frames of 1152 samples at 44.1 kHz.
    expect(bound.durationMs).toBe(Math.round((40 * 1152 * 1000) / 44100));
    expect(bound.speechProvider).toBe("elevenlabs");
  });

  it("fails an ElevenLabs run whose timings do not fit the script, or that wrote Gemini's file", async () => {
    const f = await fixture();
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const run = await f.started(VOICE_ID, "elevenlabs");
    const summary = await f.finish(run, {
      "speech.mp3": soundMp3(10),
      "speech-timings.json": JSON.stringify(timings.slice(0, 2)),
    });
    expect(summary.status).toBe("failed");
    expect(summary.error).toContain("word timings");
    const stray = await f.started(VOICE_ID, "elevenlabs");
    const strayed = await f.finish(stray, { "speech.wav": speechWave(2400) });
    expect(strayed.status).toBe("failed");
    expect(strayed.error).toContain("speech.wav");
  });

  it("keeps Gemini speech as before: a WAV, no provider on the run, and no timings even from a stray file", async () => {
    const f = await fixture();
    await f.setVault(["GEMINI_API_KEY"]);
    const run = await f.started("Kore");
    expect(run.audio).toEqual({
      language: "en-US",
      assetKey: "hello",
      script: "Hello, big [pause] cat!",
      voice: "Kore",
      model: "gemini-3.1-flash-tts-preview",
    });
    expect(f.prompts.at(-1)).toContain("GEMINI_API_KEY");
    // A timings file on a Gemini run is not its provider's, so it is ignored.
    const summary = await f.finish(run, {
      "speech.wav": speechWave(4800),
      "speech-timings.json": JSON.stringify(timings),
    });
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    await f.accept(run);
    const bound = await f.hello();
    expect(bound.path).toBe(`media/generated/${run.runId}.wav`);
    expect(bound.generatedAudio?.format).toBeUndefined();
    expect(bound.wordTimings).toBeUndefined();
    expect(bound.durationMs).toBeUndefined();
  });
});
