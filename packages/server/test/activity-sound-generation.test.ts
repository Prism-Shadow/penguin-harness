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
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { SoundSetup } from "../src/activities/sound-types.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { speechWave } from "./audio-fixtures.js";

const PROJECT = "sounder-activities";
const FIXTURE = new URL("./fixtures/sound-effect.mp3", import.meta.url);

describe("sound generation through Harness sessions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    let output: "mp3" | "invalid" | "wav" = "mp3";
    const prompts: string[] = [];
    // Stands in for the Session that would run generate-sound.mjs: it writes what the helper
    // would have, and nothing reaches a provider.
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
        // "wav" stands for audio the ElevenLabs helper never writes.
        if (output === "wav")
          await fs.writeFile(path.join(row.workspace!, "sound.wav"), speechWave(2400));
        else
          await fs.writeFile(
            path.join(row.workspace!, "sound.mp3"),
            output === "invalid" ? Buffer.from("not audio") : await fs.readFile(FIXTURE),
          );
        yield requestEnd("completed");
      },
    });
    const t = await createTestApp();
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "sounder");
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
      await client.post(base, { productCode: "p", refNum: 1, title: "Sounds" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "Listen for sounds",
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
                  key: "door",
                  description: "A door",
                  script: '<audio kind="sfx" duration="3">a wooden door creaks</audio>',
                },
                { key: "hello", description: "Greeting", script: "Hello!" },
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
    const generate = async (assetKey = "door", provider = "elevenlabs") =>
      client.post(`${endpoint}/generate-sound`, {
        agentId: "default_agent",
        expectedRevision: (await current()).draft.contentRevision,
        language: "en-US",
        assetKey,
        provider,
      });
    async function started(assetKey = "door") {
      const response = await generate(assetKey);
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => waiting.has(run.sessionId!));
      return run;
    }
    async function finish(run: ActivityRun, value: "mp3" | "invalid" | "wav" = "mp3") {
      output = value;
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      return (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((entry) => entry.runId === run.runId)!;
    }
    return { t, client, endpoint, prompts, current, setVault, generate, started, finish, service };
  }

  it("refuses without the provider's key, naming it, and for narration or an unknown provider", async () => {
    const f = await fixture();
    await f.setVault(["GEMINI_API_KEY"]);
    const missing = await f.generate();
    expect(missing.status).toBe(400);
    const body = (await missing.json()) as { error: { code: string; message: string } };
    expect(JSON.stringify(body)).toContain("sound_credential_missing");
    expect(JSON.stringify(body)).toContain("ELEVENLABS_API_KEY");
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const spoken = await f.generate("hello");
    expect(spoken.status).toBe(422);
    expect(JSON.stringify(await spoken.json())).toContain("sound_invalid");
    const unknown = await f.generate("door", "musicgen");
    expect(unknown.status).toBe(422);
    expect(JSON.stringify(await unknown.json())).toContain("sound_kind_unsupported");
    // External coding agents never see a Penguin agent's Vault.
    await expect(
      f.service.start(
        PROJECT,
        (await f.current()).id,
        "default_agent",
        (await f.current()).draft.contentRevision,
        { sound: { language: "en-US", assetKey: "door", provider: "elevenlabs" } },
        { codingAgentId: "claude" },
      ),
    ).rejects.toMatchObject({ code: "runtime_unsupported" });
    const listed = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(listed.runs).toEqual([]);
  });

  it("reports which providers the chosen agent can use", async () => {
    const f = await fixture();
    const setup = async () =>
      (await (
        await f.client.get(`/api/projects/${PROJECT}/activities/sound-setup?agentId=default_agent`)
      ).json()) as SoundSetup;
    expect((await setup()).providers).toEqual([
      expect.objectContaining({
        id: "elevenlabs",
        available: false,
        problem: "credential_missing",
        credential: "ELEVENLABS_API_KEY",
      }),
      expect.objectContaining({ id: "agenthub", available: false, problem: "no_model" }),
      expect.objectContaining({ id: "musicgen", kinds: ["music"] }),
      expect.objectContaining({
        id: "audiogen",
        kinds: ["sfx"],
        models: { sfx: "facebook/audiogen-medium" },
      }),
      expect.objectContaining({
        id: "audioldm",
        kinds: ["sfx"],
        models: { sfx: "cvssp/audioldm-s-full-v2" },
      }),
    ]);
    await f.setVault(["ELEVENLABS_API_KEY"]);
    expect((await setup()).providers[0]).toMatchObject({ id: "elevenlabs", available: true });
    expect((await f.client.get(`/api/projects/${PROJECT}/activities/sound-setup`)).status).toBe(
      400,
    );
  });

  it("stages the helper, keeps the MP3 as a candidate, and binds it only when accepted", async () => {
    const f = await fixture();
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const run = await f.started();
    expect(run.kind).toBe("audio");
    expect(run.audio?.sound).toEqual({
      provider: "elevenlabs",
      model: "sound-generation",
      kind: "sfx",
      prompt: "a wooden door creaks",
      targetDurationMs: 3000,
    });
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    const workspace = session.workspace!;
    expect(JSON.parse(await fs.readFile(path.join(workspace, "sound-input.json"), "utf8"))).toEqual(
      run.audio?.sound,
    );
    expect(await fs.readFile(path.join(workspace, "sound-input.json"), "utf8")).not.toContain(
      "fake-test-only",
    );
    expect(JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8"))).toEqual({
      private: true,
      type: "module",
    });
    expect(await fs.readFile(path.join(workspace, "generate-sound.mjs"), "utf8")).toContain(
      "api.elevenlabs.io",
    );
    expect(f.prompts.at(-1)).toContain("generate-sound.mjs");

    const summary = await f.finish(run);
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    const fixtureBytes = await fs.readFile(FIXTURE);
    const played = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    expect(played.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await played.arrayBuffer())).toEqual(fixtureBytes);
    const door = async () =>
      (await f.current()).draft.mediaPlan!.manifest.assets["en-US"]!.find(
        (asset) => asset.key === "door",
      )!;
    expect((await door()).path).toBeUndefined();

    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const bound = await door();
    expect(bound.path).toBe("media/loom/p/p-1/audios/english/door.mp3");
    expect(bound.generatedAudio).toMatchObject({ runId: run.runId, format: "mp3" });
    // Playback and the requested length stay; the take's own length is not recorded.
    expect(bound).toMatchObject({ kind: "sfx", channel: "sfx", loop: false, volume: 1 });
    expect(bound.targetDurationMs).toBe(3000);
    expect(bound.durationMs).toBeUndefined();
    // The bound clip still plays after acceptance, as MP3.
    const replay = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    expect(replay.headers.get("content-type")).toBe("audio/mpeg");

    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const assembly = path.join(f.t.root, "sound-assembly");
    await authoring.prepareAudioMedia(
      PROJECT,
      (await f.current()).id,
      assembly,
      (await f.current()).draft.contentRevision,
    );
    expect(await fs.readFile(path.join(assembly, bound.path!))).toEqual(fixtureBytes);
  });

  it("refuses to accept after the prompt was edited, and fails a run whose output is not MP3", async () => {
    const f = await fixture();
    await f.setVault(["ELEVENLABS_API_KEY"]);
    const run = await f.started();
    expect((await f.finish(run)).status).toBe("succeeded");
    // Edit the prompt, then try to accept the take made from the old one.
    const detail = await f.current();
    const manifest = structuredClone(detail.draft.mediaPlan!.manifest);
    manifest.assets["en-US"]!.find((asset) => asset.key === "door")!.script =
      '<audio kind="sfx" duration="3">a heavy iron gate</audio>';
    const edited = await f.client.put(`${f.endpoint}/media`, {
      manifest,
      expectedRevision: detail.draft.contentRevision,
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const revision = ((await edited.json()) as ActivityDraft).contentRevision;
    const refused = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
      expectedRevision: revision,
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "audio_changed",
    );
    // Even against the current revision, a take made from another prompt is not this sound's.
    const { candidate } = (await (
      await f.client.get(`${f.endpoint}/runs/${run.runId}/candidate`)
    ).json()) as { candidate: string };
    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    await expect(
      authoring.applyAudio(PROJECT, detail.id, run.audio!, JSON.parse(candidate), revision),
    ).rejects.toMatchObject({ code: "audio_changed" });
    expect((await f.current()).draft.mediaPlan!.manifest.assets["en-US"]![0]!.path).toBeUndefined();

    const bad = await f.started();
    const failed = await f.finish(bad, "invalid");
    expect(failed.status).toBe("failed");
    expect(failed.hasCandidate).toBe(false);
    // An ElevenLabs run collects only sound.mp3; a WAV in its workspace is not its take.
    const wave = await f.finish(await f.started(), "wav");
    expect(wave.status).toBe("failed");
    expect(wave.hasCandidate).toBe(false);
  });
});
