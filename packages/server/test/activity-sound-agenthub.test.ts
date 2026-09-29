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
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { AgenthubSoundModel } from "../src/activities/sound-models.js";
import { AGENTHUB_VERSION } from "../src/activities/sound-models.js";
import { soundProviderFor, soundSetup } from "../src/activities/audio-providers.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { SoundSetup } from "../src/activities/sound-types.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { fakeMp3Encoding, mp3OfWave, soundMp3, speechWave } from "./audio-fixtures.js";

// The catalogue this build ships is empty. Tests pass a stand-in to prove that one entry is
// all a hub sound model needs; nothing here reaches agenthub or a provider.
const TUNE: AgenthubSoundModel = {
  id: "test-tune",
  kinds: ["music", "sfx"],
  credential: "GEMINI_API_KEY",
  format: "wav",
  minAgenthub: "0.4.15",
};

const PROJECT = "hubsounder-activities";

describe("the model hub's sound catalogue", () => {
  it("offers nothing while empty, and says so", () => {
    expect(soundProviderFor("music", "agenthub", ["GEMINI_API_KEY"])).toEqual({
      problem: "no_model",
    });
    expect(soundProviderFor("sfx", "agenthub", null)).toEqual({ problem: "no_model" });
    expect(soundSetup(["GEMINI_API_KEY"]).find((entry) => entry.id === "agenthub")).toEqual({
      id: "agenthub",
      kinds: ["music", "sfx"],
      credential: "",
      models: {},
      available: false,
      problem: "no_model",
      modelChoices: [],
    });
  });

  it("offers an entry's model with its key and format, and skips one newer than the pinned agenthub", () => {
    const catalogue: AgenthubSoundModel[] = [
      { ...TUNE, id: "fx-only", kinds: ["sfx"], credential: "OTHER_KEY", format: "mp3" },
      TUNE,
      { ...TUNE, id: "future", minAgenthub: "99.0.0" },
    ];
    expect(soundProviderFor("music", "agenthub", ["GEMINI_API_KEY"], undefined, catalogue)).toEqual(
      {
        provider: "agenthub",
        model: "test-tune",
        credential: "GEMINI_API_KEY",
        format: "wav",
      },
    );
    expect(soundProviderFor("sfx", "agenthub", ["OTHER_KEY"], undefined, catalogue)).toMatchObject({
      model: "fx-only",
      format: "mp3",
    });
    expect(
      soundProviderFor("sfx", "agenthub", ["GEMINI_API_KEY"], "test-tune", catalogue),
    ).toMatchObject({
      model: "test-tune",
    });
    // With no model named, the first the Vault can use, not the first listed.
    expect(
      soundProviderFor("sfx", "agenthub", ["GEMINI_API_KEY"], undefined, catalogue),
    ).toMatchObject({ model: "test-tune", format: "wav" });
    expect(soundProviderFor("sfx", "agenthub", [], undefined, catalogue)).toEqual({
      problem: "credential_missing",
      credential: "OTHER_KEY",
    });
    expect(soundProviderFor("music", "agenthub", null, "future", catalogue)).toEqual({
      problem: "model_unknown",
    });
    expect(soundProviderFor("music", "agenthub", null, "fx-only", catalogue)).toEqual({
      problem: "model_unknown",
    });
    // ElevenLabs keeps its fixed models; naming another is refused, not substituted.
    expect(soundProviderFor("music", "elevenlabs", null, "test-tune", catalogue)).toEqual({
      problem: "model_unknown",
    });
    const hub = soundSetup(["GEMINI_API_KEY"], catalogue).find((entry) => entry.id === "agenthub")!;
    expect(hub).toEqual({
      id: "agenthub",
      kinds: ["music", "sfx"],
      credential: "GEMINI_API_KEY",
      models: { music: "test-tune", sfx: "test-tune" },
      available: true,
      modelChoices: [
        { id: "fx-only", kinds: ["sfx"], credential: "OTHER_KEY", available: false },
        { id: "test-tune", kinds: ["music", "sfx"], credential: "GEMINI_API_KEY", available: true },
      ],
    });
    expect(soundSetup([], catalogue).find((entry) => entry.id === "agenthub")).toMatchObject({
      available: false,
      problem: "credential_missing",
      credential: "OTHER_KEY",
    });
  });
});

describe("sound generation through a model hub model", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  type Output = "wav" | "mp3" | "both" | "invalid-wav";

  async function fixture(catalogue?: AgenthubSoundModel[]) {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    let output: Output = "wav";
    // Stands in for the Session that would install agenthub and run generate-sound.mjs: it
    // writes what the helper would have.
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(_input, options) {
        yield requestBegin();
        await new Promise<void>((resolve) => {
          complete = resolve;
          waiting.add(row.sessionId);
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        const workspace = row.workspace!;
        if (output === "wav" || output === "both")
          await fs.writeFile(path.join(workspace, "sound.wav"), speechWave(2400));
        if (output === "invalid-wav")
          await fs.writeFile(path.join(workspace, "sound.wav"), Buffer.from("RIFF-not-a-wave"));
        if (output === "mp3" || output === "both")
          await fs.writeFile(path.join(workspace, "sound.mp3"), soundMp3(5));
        yield requestEnd("completed");
      },
    });
    const t = await createTestApp({
      ...fakeMp3Encoding,
      ...(catalogue ? { soundModelPorts: { agenthubModels: catalogue } } : {}),
    });
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "hubsounder");
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
      await client.post(base, { productCode: "p", refNum: 1, title: "Hub sounds" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "Listen for music",
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Listen",
            audio: {
              tracks: [
                {
                  key: "tune",
                  description: "A tune",
                  script: '<audio kind="music" duration="4">a playful marimba loop</audio>',
                },
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
    const setVault = async (keys: string[]) =>
      expect(
        (
          await client.put(`/api/projects/${PROJECT}/agents/default_agent/vault`, {
            entries: keys.map((key) => ({ key, value: "fake-test-only" })),
          })
        ).status,
      ).toBe(200);
    const generate = async (extra: Record<string, unknown> = {}) =>
      client.post(`${endpoint}/generate-sound`, {
        agentId: "default_agent",
        expectedRevision: (await current()).draft.contentRevision,
        language: "en-US",
        assetKey: "tune",
        provider: "agenthub",
        ...extra,
      });
    async function started(extra: Record<string, unknown> = {}) {
      const response = await generate(extra);
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => waiting.has(run.sessionId!));
      return run;
    }
    async function finish(run: ActivityRun, value: Output) {
      output = value;
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      return (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((entry) => entry.runId === run.runId)!;
    }
    const tune = async () =>
      (await current()).draft.mediaPlan!.manifest.assets["en-US"]!.find(
        (asset) => asset.key === "tune",
      )!;
    return { t, client, endpoint, setVault, generate, started, finish, tune };
  }

  it("lists the hub as unavailable and refuses a run with no_model while the catalogue is empty", async () => {
    const f = await fixture();
    await f.setVault(["GEMINI_API_KEY"]);
    const setup = (await (
      await f.client.get(`/api/projects/${PROJECT}/activities/sound-setup?agentId=default_agent`)
    ).json()) as SoundSetup;
    expect(setup.providers.map((entry) => entry.id)).toEqual(["elevenlabs", "agenthub"]);
    expect(setup.providers[1]).toMatchObject({
      available: false,
      problem: "no_model",
      modelChoices: [],
    });
    const refused = await f.generate();
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "sound_no_model",
    );
    const listed = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(listed.runs).toEqual([]);
  });

  it("stages the agenthub helper for an injected model and keeps its WAV, as MP3, only when accepted", async () => {
    const f = await fixture([TUNE]);
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const missing = await f.generate();
    expect(missing.status).toBe(400);
    expect(JSON.stringify(await missing.json())).toContain("GEMINI_API_KEY");
    const unknown = await f.generate({ model: "not-offered" });
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(await unknown.json())).toContain("sound_model_unknown");

    await f.setVault(["GEMINI_API_KEY"]);
    const run = await f.started({ model: "test-tune" });
    expect(run.audio?.sound).toEqual({
      provider: "agenthub",
      model: "test-tune",
      kind: "music",
      prompt: "a playful marimba loop",
      targetDurationMs: 4000,
      credential: "GEMINI_API_KEY",
      format: "wav",
    });
    const workspace = f.t.deps.sessionsRepo.findById(run.sessionId!)!.workspace!;
    expect(JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8"))).toEqual({
      private: true,
      type: "module",
      dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION },
    });
    expect(JSON.parse(await fs.readFile(path.join(workspace, "sound-input.json"), "utf8"))).toEqual(
      run.audio?.sound,
    );
    expect(await fs.readFile(path.join(workspace, "sound-input.json"), "utf8")).not.toContain(
      "fake-test-only",
    );
    expect(await fs.readFile(path.join(workspace, "generate-sound.mjs"), "utf8")).toContain(
      "@prismshadow/agenthub",
    );

    const summary = await f.finish(run, "wav");
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    const played = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    // The model's WAV is kept as MP3, as the media repository keeps audio.
    expect(played.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await played.arrayBuffer())).toEqual(mp3OfWave(speechWave(2400)));
    expect((await f.tune()).path).toBeUndefined();
    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const bound = await f.tune();
    expect(bound.path).toBe("media/loom/p/p-1/audios/english/tune.mp3");
    expect(bound.generatedAudio).toEqual({
      runId: run.runId,
      sha256: expect.any(String),
      format: "mp3",
    });
    expect(bound).toMatchObject({ kind: "music", targetDurationMs: 4000 });
  });

  it("with no model named, runs the first model whose key the Vault holds, as setup reports it", async () => {
    const f = await fixture([
      { ...TUNE, id: "other-tune", credential: "OTHER_KEY", format: "mp3" },
      TUNE,
    ]);
    await f.setVault(["GEMINI_API_KEY"]);
    const setup = (await (
      await f.client.get(`/api/projects/${PROJECT}/activities/sound-setup?agentId=default_agent`)
    ).json()) as SoundSetup;
    expect(setup.providers.find((entry) => entry.id === "agenthub")).toMatchObject({
      available: true,
      models: { music: "test-tune" },
    });
    const run = await f.started();
    expect(run.audio?.model).toBe("test-tune");
    expect(run.audio?.sound).toMatchObject({
      model: "test-tune",
      credential: "GEMINI_API_KEY",
      format: "wav",
    });
    const workspace = f.t.deps.sessionsRepo.findById(run.sessionId!)!.workspace!;
    expect(
      JSON.parse(await fs.readFile(path.join(workspace, "sound-input.json"), "utf8")),
    ).toMatchObject({ model: "test-tune", credential: "GEMINI_API_KEY", format: "wav" });
    expect((await f.finish(run, "wav")).status).toBe("succeeded");
  });

  it("collects an MP3 from a hub model, and fails a run with two outputs or a bad WAV", async () => {
    const f = await fixture([{ ...TUNE, format: "mp3" }]);
    await f.setVault(["GEMINI_API_KEY"]);
    const run = await f.started();
    expect(run.audio?.sound).toMatchObject({ model: "test-tune", format: "mp3" });
    expect((await f.finish(run, "mp3")).status).toBe("succeeded");
    const played = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    expect(played.headers.get("content-type")).toBe("audio/mpeg");
    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await f.tune()).generatedAudio).toMatchObject({ runId: run.runId, format: "mp3" });

    const both = await f.finish(await f.started(), "both");
    expect(both.status).toBe("failed");
    expect(both.hasCandidate).toBe(false);
    const bad = await f.finish(await f.started(), "invalid-wav");
    expect(bad.status).toBe("failed");
    expect(bad.hasCandidate).toBe(false);
    // A model catalogued as MP3 that leaves a WAV is refused, not bound as another format.
    const other = await f.finish(await f.started(), "wav");
    expect(other.status).toBe("failed");
    expect(other.hasCandidate).toBe(false);
  });
});
