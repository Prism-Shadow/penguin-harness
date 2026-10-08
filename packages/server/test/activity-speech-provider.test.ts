import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
} from "../src/activities/domain.js";
import { speechProviderFor, speechSetup } from "../src/activities/audio-providers.js";
import { validateManifest } from "../src/activities/media.js";
import { speechTargets } from "../src/activities/pipeline-run.js";
import {
  ELEVENLABS_BUILTIN_VOICE_ID,
  ELEVENLABS_DEFAULT_OPTION,
  ELEVENLABS_DEFAULT_VOICE,
  isVoiceOf,
  speechCatalogue,
} from "../src/activities/voice-catalogue.js";
import type { ElevenLabsVoices, SpeechSetup } from "../src/activities/speech-types.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import {
  fakeMp3Encoding,
  fakeMediaHelper,
  mp3OfWave,
  soundMp3,
  speechWave,
} from "./audio-fixtures.js";

const PROJECT = "speaker-activities";
const VOICE_ID = "AbCdEfGhIj0123456789";

describe("choosing who speaks a narration", () => {
  it("picks the narration's provider, ElevenLabs when it names none, and never substitutes", () => {
    // A narration naming no provider is ElevenLabs', so Gemini's key alone does not speak it.
    expect(speechProviderFor({}, ["GEMINI_API_KEY"])).toEqual({
      problem: "credential_missing",
      credential: "ELEVENLABS_API_KEY",
    });
    expect(speechProviderFor({}, ["ELEVENLABS_API_KEY"])).toMatchObject({
      provider: "elevenlabs",
    });
    expect(speechProviderFor({ speechProvider: "gemini" }, ["GEMINI_API_KEY"])).toEqual({
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
      problem: "runtime_missing",
      credential: "kokoro-js",
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
      {
        id: "kokoro",
        credential: "",
        available: false,
        problem: "runtime_missing",
        timings: false,
      },
    ]);
    // The ElevenLabs default is always offered: it has Loom's voice to stand for.
    expect(new Set(speechCatalogue().map((option) => option.providerId))).toEqual(
      new Set(["gemini", "kokoro", "elevenlabs"]),
    );
    expect(speechCatalogue().at(-1)).toMatchObject({
      id: ELEVENLABS_DEFAULT_VOICE,
      label: "ElevenLabs default",
      providerId: "elevenlabs",
      model: "eleven_v3",
    });
    // The account's library, when listed, replaces the bare default.
    const library = [{ ...speechCatalogue().at(-1)!, voiceName: "Sarah" }];
    expect(speechCatalogue(library).at(-1)).toEqual(library[0]);
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
      validateManifest(manifest({ type: "audio", speechProvider: "unknown" }), address),
    ).toThrow(/speech provider/);
    expect(() =>
      validateManifest(manifest({ type: "image", speechProvider: "gemini" }), address),
    ).toThrow(/speech provider/);
  });
});

describe("speech through the provider seam", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    // The server runs the speech helper itself; this one writes what a test says it wrote.
    const helper = fakeMediaHelper();
    const t = await createTestApp({ ...fakeMp3Encoding, mediaHelperPorts: helper.ports });
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
    const current = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const hello = async () =>
      (await current()).draft.mediaPlan!.manifest.assets["en-US"]!.find(
        (asset) => asset.key === "hello",
      )!;
    /** Every key holds a fake value, unless `values` names one. */
    const setVault = async (keys: string[], values: Record<string, string> = {}) =>
      expect(
        (
          await client.put(`/api/projects/${PROJECT}/agents/media_agent/vault`, {
            entries: keys.map((key) => ({ key, value: values[key] ?? "fake-test-only" })),
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
      // No agent speaks it: the run has no Session, only the helper the server runs.
      expect(run.sessionId).toBeNull();
      await waitFor(() => helper.waiting(run.runId) !== null);
      return run;
    }
    const runOf = async (run: ActivityRun) =>
      (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((entry) => entry.runId === run.runId)!;
    async function finish(
      run: ActivityRun,
      files: Record<string, Buffer | string>,
      result?: { ok: false; error: string },
    ) {
      await helper.finish(files, result);
      let summary = await runOf(run);
      const deadline = Date.now() + 5000;
      while (summary.status === "running" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        summary = await runOf(run);
      }
      return summary;
    }
    const accept = async (run: ActivityRun) => {
      const response = await client.post(`${endpoint}/runs/${run.runId}/accept-audio`, {
        expectedRevision: (await current()).draft.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    return {
      t,
      client,
      endpoint,
      helper,
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

  it("refuses ElevenLabs without its key, naming it, and a voice it does not speak with", async () => {
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
    // A Gemini voice is not one ElevenLabs speaks with.
    expect((await f.generate("Kore")).status).toBe(422);
    const unknown = await f.generate(VOICE_ID, "unknown");
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(await unknown.json())).toContain("speech_provider_unknown");
    const listed = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(listed.runs).toEqual([]);
  });

  it("resolves the default voice when a run starts: the Vault's, else Loom's, handed to the helper", async () => {
    const f = await fixture();
    const spokenWith = async (run: ActivityRun) =>
      JSON.parse(
        await fs.readFile(path.join(f.helper.waiting(run.runId)!, "speech-input.json"), "utf8"),
      ).voice;
    await f.setVault(["ELEVENLABS_API_KEY"]);
    await f.choose("elevenlabs");
    const run = await f.started(ELEVENLABS_DEFAULT_VOICE);
    // The run still says "default"; the helper is handed the voice it stands for.
    expect(run.audio).toMatchObject({
      voice: ELEVENLABS_DEFAULT_VOICE,
      voiceId: ELEVENLABS_BUILTIN_VOICE_ID,
    });
    expect(await spokenWith(run)).toBe(ELEVENLABS_BUILTIN_VOICE_ID);
    await f.finish(run, {}, { ok: false, error: "stopped by the test" });
    await f.setVault(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"], {
      ELEVENLABS_VOICE_ID: VOICE_ID,
    });
    const named = await f.started(ELEVENLABS_DEFAULT_VOICE);
    expect(named.audio?.voiceId).toBe(VOICE_ID);
    expect(await spokenWith(named)).toBe(VOICE_ID);
    // A voice the author chose is spoken as it is.
    await f.finish(named, {}, { ok: false, error: "stopped by the test" });
    const chosen = await f.started(VOICE_ID);
    expect(chosen.audio?.voiceId).toBeUndefined();
    expect(await spokenWith(chosen)).toBe(VOICE_ID);
  });

  it("lists the Media Agent's ElevenLabs voices, the default first, and keeps the list a while", async () => {
    const f = await fixture();
    const voicesOf = async (query = "") =>
      (await (
        await f.client.get(`/api/projects/${PROJECT}/activities/elevenlabs-voices${query}`)
      ).json()) as ElevenLabsVoices;
    // Without the key there is nothing to ask: only the default, and why.
    expect(await voicesOf()).toEqual({
      voices: [ELEVENLABS_DEFAULT_OPTION],
      problem: "credential_missing",
    });
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const real = globalThis.fetch;
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.elevenlabs.io/")) return real(input, init);
      asked.push((init?.headers as Record<string, string>)["xi-api-key"]!);
      return new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: ELEVENLABS_BUILTIN_VOICE_ID,
              name: "Sarah",
              preview_url: "https://x.test/s.mp3",
            },
            { voice_id: VOICE_ID, name: "Aaron" },
          ],
        }),
      );
    });
    const listed = await voicesOf();
    expect(listed.problem).toBeUndefined();
    expect(listed.voices.map((voice) => [voice.id, voice.label, voice.voiceName])).toEqual([
      [ELEVENLABS_DEFAULT_VOICE, ELEVENLABS_DEFAULT_OPTION.label, "Sarah"],
      [VOICE_ID, "Aaron", undefined],
    ]);
    // The Vault value goes to ElevenLabs and nowhere else.
    expect(asked).toEqual(["fake-test-only"]);
    expect(JSON.stringify(listed)).not.toContain("fake-test-only");
    // Kept a while; ?refresh=1 asks again.
    await voicesOf();
    expect(asked).toHaveLength(1);
    await voicesOf("?refresh=1");
    expect(asked).toHaveLength(2);
  });

  it("reports the providers and voices for the Media Agent", async () => {
    const f = await fixture();
    await f.setVault(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
    const setup = (await (
      await f.client.get(`/api/projects/${PROJECT}/activities/speech-setup`)
    ).json()) as SpeechSetup;
    expect(setup.providers).toEqual([
      expect.objectContaining({ id: "gemini", available: false, problem: "credential_missing" }),
      expect.objectContaining({ id: "elevenlabs", available: true, timings: true }),
      expect.objectContaining({ id: "kokoro", timings: false }),
    ]);
    expect(setup.catalogue.map((option) => option.id)).toContain(ELEVENLABS_DEFAULT_VOICE);
    // An agent named in the query changes nothing: the Media Agent's Vault answers.
    const named = (await (
      await f.client.get(`/api/projects/${PROJECT}/activities/speech-setup?agentId=default_agent`)
    ).json()) as SpeechSetup;
    expect(named).toEqual(setup);
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
    // ElevenLabs is called with Node's own fetch: nothing to install, the Vault as its env.
    expect(f.helper.calls.at(-1)).toMatchObject({
      install: false,
      vault: { ELEVENLABS_API_KEY: "fake-test-only" },
    });
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
    expect(bound.path).toBe("media/loom/p/p-1/audios/english/hello.mp3");
    // The model it was spoken with is kept, so a later model makes it again.
    expect(bound.generatedAudio).toEqual({
      runId: run.runId,
      sha256: expect.any(String),
      format: "mp3",
      model: "eleven_v3",
      // The default voice as it resolved: the Vault's ELEVENLABS_VOICE_ID is not a voice id here.
      voice: ELEVENLABS_BUILTIN_VOICE_ID,
    });
    expect(speechTargets((await f.current()).draft.mediaPlan!.manifest)).toEqual([]);
    // It saved no voice of its own, so a Vault naming another default voice keeps it: the
    // stage would replace a clip the author accepted without their hearing it.
    expect(
      speechTargets((await f.current()).draft.mediaPlan!.manifest, { elevenLabsDefault: VOICE_ID }),
    ).toEqual([]);
    // It saved no voice of its own, so a run choosing another voice speaks it again.
    expect(
      speechTargets((await f.current()).draft.mediaPlan!.manifest, { chosen: VOICE_ID }),
    ).toEqual([{ language: "en-US", assetKey: "hello" }]);
    const chosen = await f.current();
    const changed = structuredClone(chosen.draft.mediaPlan!.manifest);
    changed.assets["en-US"]!.find((entry) => entry.key === "hello")!.speechModel = "eleven_v4";
    const saved = await f.client.put(`${f.endpoint}/media`, {
      manifest: changed,
      expectedRevision: chosen.draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(speechTargets((await f.current()).draft.mediaPlan!.manifest)).toEqual([
      { language: "en-US", assetKey: "hello" },
    ]);
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
    // A helper that failed says why in its own words, and nothing it left behind is kept.
    const refused = await f.started(VOICE_ID, "elevenlabs");
    const settled = await f.finish(
      refused,
      { "speech.mp3": soundMp3(10) },
      { ok: false, error: "provider refused: plan or key" },
    );
    expect(settled).toMatchObject({ status: "failed", error: "provider refused: plan or key" });
    expect((await f.client.get(`${f.endpoint}/runs/${refused.runId}/audio`)).status).not.toBe(200);
  });

  it("keeps Gemini speech as MP3 made from its WAV, no provider on the run, and no timings even from a stray file", async () => {
    const f = await fixture();
    await f.setVault(["GEMINI_API_KEY"]);
    // Gemini is no longer the default, so the narration names it.
    await f.choose("gemini");
    const run = await f.started("Kore");
    expect(run.audio).toEqual({
      language: "en-US",
      assetKey: "hello",
      script: "Hello, big [pause] cat!",
      voice: "Kore",
      model: "gemini-3.1-flash-tts-preview",
    });
    // Gemini goes through agenthub, which the helper's package.json installs first.
    expect(f.helper.calls.at(-1)).toMatchObject({
      install: true,
      vault: { GEMINI_API_KEY: "fake-test-only" },
    });
    // A timings file on a Gemini run is not its provider's, so it is ignored.
    const summary = await f.finish(run, {
      "speech.wav": speechWave(4800),
      "speech-timings.json": JSON.stringify(timings),
    });
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    await f.accept(run);
    const bound = await f.hello();
    // The media repository keeps audio as MP3, so Gemini's WAV is converted.
    expect(bound.path).toBe("media/loom/p/p-1/audios/english/hello.mp3");
    expect(bound.generatedAudio).toMatchObject({
      runId: run.runId,
      format: "mp3",
      model: "gemini-3.1-flash-tts-preview",
      voice: "Kore",
    });
    const played = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    expect(played.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await played.arrayBuffer())).toEqual(mp3OfWave(speechWave(4800)));
    expect(bound.wordTimings).toBeUndefined();
    expect(bound.durationMs).toBeUndefined();
  });
});
