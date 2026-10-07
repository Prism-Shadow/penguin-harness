/**
 * A decodable book's word recordings through the service: the drawn-out script written from a
 * word's sounds, the recording accepted with its sounds' timings, a script change that unbinds
 * the recording, and the Build check. A fake Session stands in for the speech helper and a fake
 * runner for espeak-ng, so nothing reaches a provider or starts a program.
 */
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
import type { BookWordsRefresh } from "../src/activities/book-word-types.js";
import { ActivityGenerationService } from "../src/activities/generation.js";
import type { EspeakRunner } from "../src/activities/phonemes.js";
import { drawnOutScript, geminiScript } from "../src/activities/pronunciation.js";
import type { ReadinessCheck } from "../src/activities/readiness-types.js";
import { ELEVENLABS_DEFAULT_VOICE } from "../src/activities/voice-catalogue.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { catBookSpec } from "./activity-fixtures.js";
import { soundMp3 } from "./audio-fixtures.js";

const PROJECT = "word_recorder-books";
const SOUNDS: Record<string, string> = { the: "ð ə", cat: "k ˈæ t", sat: "s ˈæ t", ran: "ɹ æ n" };
const CAT_KEY = "book-word-cat-77af778b51";

describe("recording a decodable book's words", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    let output: Record<string, Buffer | string> = {};
    const inputs: Record<string, unknown>[] = [];
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
        inputs.push(
          JSON.parse(await fs.readFile(path.join(row.workspace!, "speech-input.json"), "utf8")),
        );
        await new Promise<void>((resolve) => {
          complete = resolve;
          waiting.add(row.sessionId);
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        for (const [name, bytes] of Object.entries(output))
          await fs.writeFile(path.join(row.workspace!, name), bytes);
        yield requestEnd("completed");
      },
    });
    const run: EspeakRunner = async (_program, args) => {
      if (args[0] === "--version") return { ok: true, stdout: "eSpeak NG text-to-speech: 1.51" };
      const sounds = SOUNDS[args[args.length - 1]!];
      return sounds ? { ok: true, stdout: `${sounds}\n` } : { ok: false, stdout: "" };
    };
    const t = await createTestApp({ espeakPorts: { run } });
    cleanups.push(t.cleanup);
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    const owner = await provisionUser(t.app, "word_recorder");
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
    const vault = await client.put(`/api/projects/${PROJECT}/agents/default_agent/vault`, {
      entries: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"].map((key) => ({
        key,
        value: "fake-test-only",
      })),
    });
    expect(vault.status).toBe(200);
    const base = `/api/projects/${PROJECT}/activities`;
    const created = (await (
      await client.post(base, {
        productCode: "cat-book",
        refNum: 1,
        title: "Cat book",
        activityType: "book",
      })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "A cat book",
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const applied = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: catBookSpec(),
      expectedRevision: described.contentRevision,
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: ((await applied.json()) as ActivityDraft).contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const refreshed = await client.post(`${endpoint}/book-words/refresh`, {
      language: "en-US",
      bookMode: "decodable",
      expectedRevision: ((await planned.json()) as ActivityDraft).contentRevision,
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    expect(((await refreshed.json()) as BookWordsRefresh).missing).toEqual([]);
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const current = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const cat = async () =>
      (await current()).draft.mediaPlan!.manifest.assets["en-US"]!.find(
        (asset) => asset.key === CAT_KEY,
      )!;
    async function record(files: Record<string, Buffer | string>) {
      const response = await client.post(`${endpoint}/generate-audio`, {
        agentId: "default_agent",
        expectedRevision: (await current()).draft.contentRevision,
        language: "en-US",
        assetKey: CAT_KEY,
        voice: ELEVENLABS_DEFAULT_VOICE,
        provider: "elevenlabs",
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const started = (await response.json()) as ActivityRun;
      await waitFor(() => waiting.has(started.sessionId!));
      output = files;
      complete();
      await waitFor(() => t.deps.manager.statusOf(started.sessionId!) === "idle");
      await service.reconcile();
      const summary = (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((entry) => entry.runId === started.runId)!;
      expect(summary.status, summary.error ?? "").toBe("succeeded");
      const accepted = await client.post(`${endpoint}/runs/${started.runId}/accept-audio`, {
        expectedRevision: (await current()).draft.contentRevision,
      });
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      return started;
    }
    const readiness = async () =>
      (
        (await (await client.get(`${endpoint}/readiness`)).json()) as { checks: ReadinessCheck[] }
      ).checks.filter((check) => check.id === "words");
    return {
      client,
      endpoint,
      authoring,
      created,
      current,
      cat,
      record,
      readiness,
      inputs,
      waiting,
      finish: () => complete(),
      manager: t.deps.manager,
    };
  }

  it("records a word from its drawn-out script and keeps its sounds' timings", async () => {
    const f = await fixture();
    // Refreshed words carry the script for their provider: Gemini, as none is named yet.
    expect((await f.cat()).script).toBe(geminiScript("cat", ["k", "æ", "t"]));
    expect(await f.readiness()).toEqual([
      { id: "words", level: "warn", language: "en-US", recorded: 0, total: 4, timed: 0 },
    ]);
    const detail = await f.current();
    const prepared = await f.authoring.prepareWordRecordings(
      PROJECT,
      f.created.id,
      "elevenlabs",
      detail.draft.contentRevision,
    );
    const word = prepared.mediaPlan!.manifest.assets["en-US"]!.find((a) => a.key === CAT_KEY)!;
    expect(word.speechProvider).toBe("elevenlabs");
    expect(word.script).toBe('[very slowly] [drawn out] "/kæːːːt/" [short pause] cat.');
    const run = await f.record({
      "speech.mp3": soundMp3(40),
      "speech-timings.json": JSON.stringify([
        { word: "kæːːːt", startMs: 0, endMs: 1200 },
        { word: "cat", startMs: 1500, endMs: 1900 },
      ]),
    });
    const recorded = await f.cat();
    expect(recorded.path).toBe(`media/loom/cat-book/cat-book-1/audios/english/${recorded.key}.mp3`);
    expect(recorded.generatedAudio).toMatchObject({ runId: run.runId, format: "mp3" });
    expect(recorded.phonemeTimings).toEqual([
      { phoneme: "k", startMs: 0, endMs: 400 },
      { phoneme: "æ", startMs: 400, endMs: 800 },
      { phoneme: "t", startMs: 800, endMs: 1200 },
    ]);
    expect(recorded.wholeWordTiming).toEqual({ startMs: 1500, endMs: 1900 });
    expect(await f.readiness()).toEqual([
      { id: "words", level: "warn", language: "en-US", recorded: 1, total: 4, timed: 1 },
    ]);
    // The drawn-out script is read as written.
    expect(f.inputs.at(-1)).not.toHaveProperty("delivery");

    // The author binds another file: the timings measured on the generated clip do not
    // describe it, and the script it was not made from is left as it is.
    const bound = await f.current();
    const rebound = structuredClone(bound.draft.mediaPlan!.manifest);
    const other = rebound.assets["en-US"]!.find((a) => a.key === CAT_KEY)!;
    other.path = "media/audio/cat.mp3";
    delete other.generatedAudio;
    delete other.wordTimings;
    delete other.durationMs;
    const rebind = await f.client.put(`${f.endpoint}/media`, {
      manifest: rebound,
      expectedRevision: bound.draft.contentRevision,
    });
    expect(rebind.status, await rebind.clone().text()).toBe(200);
    const other2 = await f.cat();
    expect(other2.path).toBe("media/audio/cat.mp3");
    expect(other2.phonemeTimings).toBeUndefined();
    expect(other2.wholeWordTiming).toBeUndefined();
    expect(other2.script).toBe('[very slowly] [drawn out] "/kæːːːt/" [short pause] cat.');
    expect(await f.readiness()).toEqual([
      { id: "words", level: "warn", language: "en-US", recorded: 1, total: 4, timed: 0 },
    ]);

    // Switching the word to Gemini rewrites its script, so the ElevenLabs clip no longer says
    // it as the script does: the clip is unbound, with its timings, to be recorded again.
    const restored = await f.current();
    const back = structuredClone(restored.draft.mediaPlan!.manifest);
    Object.assign(
      back.assets["en-US"]!.find((a) => a.key === CAT_KEY)!,
      {
        path: recorded.path,
        generatedAudio: recorded.generatedAudio,
      },
    );
    expect(
      (
        await f.client.put(`${f.endpoint}/media`, {
          manifest: back,
          expectedRevision: restored.draft.contentRevision,
        })
      ).status,
    ).toBe(200);
    const again = await f.current();
    const manifest = structuredClone(again.draft.mediaPlan!.manifest);
    manifest.assets["en-US"]!.find((a) => a.key === CAT_KEY)!.speechProvider = "gemini";
    const saved = await f.client.put(`${f.endpoint}/media`, {
      manifest,
      expectedRevision: again.draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const switched = await f.cat();
    expect(switched.script).toBe(geminiScript("cat", ["k", "æ", "t"]));
    expect(switched.path).toBeUndefined();
    expect(switched.phonemeTimings).toBeUndefined();
  });

  it("asks Gemini to follow a word's script as a direction, not read it out", async () => {
    const f = await fixture();
    const response = await f.client.post(`${f.endpoint}/generate-audio`, {
      agentId: "default_agent",
      expectedRevision: (await f.current()).draft.contentRevision,
      language: "en-US",
      assetKey: CAT_KEY,
      voice: "Kore",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const started = (await response.json()) as ActivityRun;
    await waitFor(() => f.waiting.has(started.sessionId!));
    expect(f.inputs.at(-1)).toMatchObject({
      script: geminiScript("cat", ["k", "æ", "t"]),
      delivery: "direction",
    });
    f.finish();
    await waitFor(() => f.manager.statusOf(started.sessionId!) === "idle");
  });

  it("keeps a script the author wrote, whatever the sounds or provider", async () => {
    const f = await fixture();
    const detail = await f.current();
    const manifest = structuredClone(detail.draft.mediaPlan!.manifest);
    const word = manifest.assets["en-US"]!.find((a) => a.key === CAT_KEY)!;
    word.script = "Cat. Say it slowly: c, a, t. Cat.";
    word.customScript = true;
    word.customized = true;
    word.speechProvider = "elevenlabs";
    const saved = await f.client.put(`${f.endpoint}/media`, {
      manifest,
      expectedRevision: detail.draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await f.cat()).script).toBe("Cat. Say it slowly: c, a, t. Cat.");
    // Clearing the mark gives the word its script from its sounds again.
    const later = await f.current();
    const cleared = structuredClone(later.draft.mediaPlan!.manifest);
    delete cleared.assets["en-US"]!.find((a) => a.key === CAT_KEY)!.customScript;
    await f.client.put(`${f.endpoint}/media`, {
      manifest: cleared,
      expectedRevision: later.draft.contentRevision,
    });
    expect((await f.cat()).script).toBe(drawnOutScript("cat", ["k", "æ", "t"]));
  });
});
