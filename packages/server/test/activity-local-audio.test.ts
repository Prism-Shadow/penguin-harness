import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail, ActivityDraft, ActivityRun } from "../src/activities/domain.js";
import { ActivityGenerationService } from "../src/activities/generation.js";
import { LocalAudioService } from "../src/activities/local-audio.js";
import { speechProviderFor, soundProviderFor } from "../src/activities/audio-providers.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { speechWave } from "./audio-fixtures.js";

describe("local audio candidates", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
  });

  async function fixture() {
    let complete!: (bytes: Uint8Array) => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(LocalAudioService.prototype, "availability").mockReturnValue({
      kokoro: true,
      musicgen: true,
    });
    const generate = vi
      .spyOn(LocalAudioService.prototype, "generate")
      .mockImplementation((_request, abort) => {
        signal = abort;
        return new Promise((resolve, reject) => {
          complete = resolve;
          abort.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      });
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "local_audio");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "local_audio-activities";
    expect((await client.post("/api/projects", { projectId })).status).toBe(201);
    const base = `/api/projects/${projectId}/activities`;
    const created = (await (
      await client.post(base, { productCode: "p", refNum: 1, title: "Local audio" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "Listen",
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      expectedRevision: described.contentRevision,
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Listen",
            audio: {
              tracks: [
                { key: "hello", description: "Greeting", script: "Hello there." },
                {
                  key: "theme",
                  description: "Music",
                  script: '<audio kind="music" duration="2">Soft piano</audio>',
                },
              ],
            },
          },
        ],
      },
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
    const adopted = vi.spyOn(t.deps.manager, "adopt");
    const current = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const start = async (provider: "kokoro" | "musicgen" = "kokoro") => {
      const response = await client.post(
        `${endpoint}/${provider === "kokoro" ? "generate-audio" : "generate-sound"}`,
        {
          agentId: "default_agent",
          expectedRevision: (await current()).draft.contentRevision,
          language: "en-US",
          assetKey: provider === "kokoro" ? "hello" : "theme",
          provider,
          ...(provider === "kokoro" ? { voice: "af_heart" } : {}),
        },
      );
      expect(response.status, await response.clone().text()).toBe(202);
      return (await response.json()) as ActivityRun;
    };
    const settled = async (run: ActivityRun, status: string) => {
      await vi.waitFor(async () =>
        expect((await service.run(projectId, created.id, run.runId)).status).toBe(status),
      );
      return service.run(projectId, created.id, run.runId);
    };
    return {
      t,
      client,
      endpoint,
      projectId,
      activityId: created.id,
      current,
      start,
      settled,
      generate,
      adopted,
      service,
      complete: () => complete(speechWave(2400)),
      signal: () => signal,
    };
  }

  it.each(["kokoro", "musicgen"] as const)(
    "produces and accepts %s without a model key or agent session",
    async (provider) => {
      const f = await fixture();
      const before = await f.current();
      const run = await f.start(provider);
      expect(run.sessionId).toBeNull();
      expect(f.adopted).not.toHaveBeenCalled();
      expect(f.generate).toHaveBeenCalledWith(
        expect.objectContaining({ provider }),
        expect.any(AbortSignal),
      );
      f.complete();
      const ready = await f.settled(run, "succeeded");
      expect(ready.candidate).toContain("audio/wav");
      expect((await f.current()).draft.contentRevision).toBe(before.draft.contentRevision);
      const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
        expectedRevision: before.draft.contentRevision,
      });
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      const asset = (await f.current()).draft.mediaPlan!.manifest.assets["en-US"]!.find(
        (item) => item.key === run.audio!.assetKey,
      )!;
      expect(asset.generatedAudio?.runId).toBe(run.runId);
      expect(asset.path).toBeTruthy();
    },
  );

  it("cancels local inference without publishing a candidate", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.service.cancel(f.projectId, f.activityId, run.runId);
    expect(f.signal()?.aborted).toBe(true);
    const done = await f.settled(run, "cancelled");
    expect(done.candidate).toBeNull();
  });

  it("refuses publication after the draft changes", async () => {
    const f = await fixture();
    const run = await f.start();
    expect(
      (
        await f.client.patch(`${f.endpoint}/description`, {
          description: "A different draft",
          expectedRevision: (await f.current()).draft.contentRevision,
        })
      ).status,
    ).toBe(200);
    f.complete();
    expect((await f.settled(run, "conflict")).candidate).toBeNull();
  });

  it("interrupts inference during server shutdown", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.service.shutdown();
    expect(f.signal()?.aborted).toBe(true);
    expect((await f.settled(run, "interrupted")).candidate).toBeNull();
  });

  it("requires the selected runtime and never substitutes an exact sound-effect model", () => {
    expect(speechProviderFor({ speechProvider: "kokoro" }, [], { kokoro: true })).toMatchObject({
      provider: "kokoro",
      credential: "",
      timings: false,
    });
    expect(speechProviderFor({ speechProvider: "kokoro" }, [], {})).toMatchObject({
      problem: "runtime_missing",
    });
    expect(
      soundProviderFor("music", "musicgen", [], undefined, [], { musicgen: true }),
    ).toMatchObject({ provider: "musicgen", model: "Xenova/musicgen-small", format: "wav" });
    expect(soundProviderFor("music", "musicgen", [], undefined, [], {})).toMatchObject({
      problem: "runtime_missing",
    });
    for (const provider of ["audiogen", "audioldm"])
      expect(soundProviderFor("sfx", provider, ["ELEVENLABS_API_KEY"])).toMatchObject({
        problem: "provider_unknown",
      });
  });
});
