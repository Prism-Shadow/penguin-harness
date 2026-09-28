/**
 * Sounds proposed by a model run, through a fake agent: the run is handed the words it is
 * asked about, what it writes is checked before it becomes a candidate, and accepting it
 * fills only the words that still have no sounds.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft, ActivityRun } from "../src/activities/domain.js";
import type { BookWordsRefresh } from "../src/activities/book-word-types.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { catBookSpec } from "./activity-fixtures.js";

describe("phonemes runs", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    let output: unknown = {};
    const inputs: unknown[] = [];
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
        inputs.push(
          JSON.parse(await fs.readFile(path.join(row.workspace!, "phonemes-input.json"), "utf8")),
        );
        await fs.writeFile(
          path.join(row.workspace!, "phonemes.json"),
          typeof output === "string" ? output : JSON.stringify(output),
        );
        yield requestEnd("completed");
      },
    });
    // espeak-ng is not installed here, so every word waits for the model.
    const t = await createTestApp({
      espeakPorts: { run: async () => ({ ok: false, stdout: "" }) },
    });
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "phonics");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "phonics-work" })).status).toBe(201);
    await t.deps.projectConfigService.writeRaw("phonics-work", {
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
    const base = "/api/projects/phonics-work/activities";
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const created = (await (
      await client.post(base, {
        productCode: "cat-book",
        refNum: 1,
        title: "Cat book",
        activityType: "book",
      })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const applied = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
        spec: catBookSpec(),
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const planned = (await (
      await client.post(`${endpoint}/plan-media`, { expectedRevision: applied.contentRevision })
    ).json()) as ActivityDraft;
    const refreshed = (await (
      await client.post(`${endpoint}/book-words/refresh`, {
        language: "en-US",
        bookMode: "decodable",
        expectedRevision: planned.contentRevision,
      })
    ).json()) as BookWordsRefresh;
    expect(refreshed.missing).toEqual(["the", "cat", "sat", "ran"]);

    async function run(draft: ActivityDraft, words: string[], next: unknown) {
      output = next;
      const response = await client.post(`${endpoint}/generate-phonemes`, {
        agentId: "default_agent",
        expectedRevision: draft.contentRevision,
        language: "en-US",
        words,
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const started = (await response.json()) as ActivityRun;
      expect(started).toMatchObject({
        kind: "phonemes",
        status: "running",
        phonemes: { language: "en-US", words },
      });
      await waitFor(() => waiting.has(started.sessionId!));
      complete();
      await waitFor(() => t.deps.manager.statusOf(started.sessionId!) === "idle");
      await service.reconcile();
      const runs = (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRun[] }
      ).runs;
      const { candidate } = (await (
        await client.get(`${endpoint}/runs/${started.runId}/candidate`)
      ).json()) as { candidate: string | null };
      return { ...runs.find((entry) => entry.runId === started.runId)!, candidate };
    }
    return { client, endpoint, refreshed, run, inputs };
  }

  const words = (draft: ActivityDraft) =>
    draft.mediaPlan!.manifest.assets["en-US"]!.filter((asset) => asset.role === "bookWord");

  it("proposes sounds for the missing words, and is refused once the draft has moved on", async () => {
    const { client, endpoint, refreshed, run, inputs } = await setup();
    const result = await run(refreshed.draft, ["the", "cat", "ran"], {
      the: ["ð", "ə"],
      cat: ["k", "ˈæ", "t"],
    });
    expect(result.status, result.error ?? "").toBe("succeeded");
    expect(inputs[0]).toEqual({ language: "en-US", words: ["the", "cat", "ran"] });
    expect(JSON.parse(result.candidate!)).toEqual({
      language: "en-US",
      phonemes: { the: ["ð", "ə"], cat: ["k", "æ", "t"] },
    });

    // The author gives "cat" sounds of their own before accepting the proposal.
    const own = await client.put(`${endpoint}/book-words/book-word-cat-77af778b51/phonemes`, {
      phonemes: ["k", "a", "t"],
      expectedRevision: refreshed.draft.contentRevision,
    });
    const stale = await client.post(`${endpoint}/runs/${result.runId}/accept-phonemes`, {
      expectedRevision: ((await own.json()) as ActivityDraft).contentRevision,
    });
    // Proposed against an older draft, so it is refused rather than applied over the edit.
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "draft_conflict" } });
  });

  it("accepts a proposal into the draft it was made for", async () => {
    const { client, endpoint, refreshed, run } = await setup();
    const result = await run(refreshed.draft, ["the", "sat"], { the: ["ð", "ə"] });
    expect(result.status, result.error ?? "").toBe("succeeded");
    const accepted = await client.post(`${endpoint}/runs/${result.runId}/accept-phonemes`, {
      expectedRevision: refreshed.draft.contentRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const draft = (await accepted.json()) as ActivityDraft;
    expect(
      words(draft).map((asset) => [asset.normalizedWord, asset.phonemes, asset.phonemeSource]),
    ).toEqual([
      ["the", ["ð", "ə"], "model"],
      ["cat", undefined, undefined],
      ["sat", undefined, undefined],
      ["ran", undefined, undefined],
    ]);
  });

  it("fails a run that sounds out a word it was not asked about, or writes something else", async () => {
    const { refreshed, run } = await setup();
    const stray = await run(refreshed.draft, ["cat"], { dog: ["d", "ɔ", "g"] });
    expect(stray.status).toBe("failed");
    expect(stray.error).toContain("dog");
    const notSounds = await run(refreshed.draft, ["cat"], { cat: "k æ t" });
    expect(notSounds.status).toBe("failed");
  });

  it("refuses words that are not the book's", async () => {
    const { client, endpoint, refreshed } = await setup();
    const response = await client.post(`${endpoint}/generate-phonemes`, {
      agentId: "default_agent",
      expectedRevision: refreshed.draft.contentRevision,
      language: "en-US",
      words: ["penguin"],
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "phonemes_invalid" } });
    const none = await client.post(`${endpoint}/generate-phonemes`, {
      agentId: "default_agent",
      expectedRevision: refreshed.draft.contentRevision,
      language: "en-US",
      words: [],
    });
    expect(none.status).toBe(400);
  });
});
