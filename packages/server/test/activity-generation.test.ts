import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abortEvent, requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
} from "../src/activities/domain.js";
import { ActivityGenerationService } from "../src/activities/generation.js";
import { wire, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { ProjectActivityWork } from "../src/mechanisms/projects.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { speechWave } from "./audio-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { prepareModule, verifyMediaArtifacts } from "../src/activities/waf-module.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("activity generation through Harness sessions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture(
    moduleOutput: boolean | "audio" | "image" | "media-text" = false,
    activityType: "standard" | "book" = "standard",
  ) {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    const disposed = new Set<string>();
    let output = JSON.stringify(activitySpec);
    let fatal = false;
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {
        disposed.add(row.sessionId);
      },
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
        if (options.signal.aborted) {
          yield abortEvent();
          return;
        }
        if (moduleOutput === "audio") {
          await fs.writeFile(
            path.join(row.workspace!, "speech.wav"),
            output === "invalid" ? Buffer.from("invalid") : speechWave(),
          );
        } else if (moduleOutput === "image") {
          await fs.writeFile(
            path.join(row.workspace!, "image.png"),
            output === "invalid" ? Buffer.from("invalid") : imagePng(),
          );
        } else if (moduleOutput === "media-text") {
          const target = JSON.parse(
            await fs.readFile(path.join(row.workspace!, "media-text-input.json"), "utf8"),
          ) as { language: string; assetKey: string; type: "image" | "audio" };
          await fs.writeFile(
            path.join(row.workspace!, "media-text.json"),
            output === "invalid"
              ? "invalid"
              : JSON.stringify({
                  ...target,
                  text: target.type === "audio" ? "Hello there." : "A brighter blue penguin",
                }),
          );
        } else if (moduleOutput) {
          const input = JSON.parse(
            await fs.readFile(path.join(row.workspace!, "input.json"), "utf8"),
          ) as ActivityDetail;
          const files: Record<string, string> = {
            "preview/index.html":
              "<!doctype html><title>WAF</title><script src='./runtime.js'></script>",
            "preview/runtime.js": "window.waf = true;",
            "module/dist/entry.js": "window.moduleBuilt = true;",
            "module/build.log": "typecheck and buildDebug completed",
          };
          for (const [name, content] of Object.entries(files)) {
            await fs.mkdir(path.dirname(path.join(row.workspace!, name)), { recursive: true });
            await fs.writeFile(path.join(row.workspace!, name), content);
          }
          await fs.writeFile(
            path.join(row.workspace!, "module-result.json"),
            JSON.stringify({
              files: [
                ...("bookMode" in input ? ["module/src/book-reader/model.ts"] : []),
                ...(input.draft.mediaPlan
                  ? [
                      `module/generated/${input.productCode}/refs/${input.productCode}-${input.refNum}/spec/asset_manifest.json`,
                      `module/configurations/${input.productCode}-${input.refNum}.json`,
                    ]
                  : []),
                "module/package.json",
                "module/definition.json",
                "module/src/index.ts",
                "module/res/layout.html",
                ...Object.keys(files),
              ],
            }),
          );
        } else await fs.writeFile(path.join(row.workspace!, "activity-spec.json"), output);
        yield requestEnd(fatal ? "fatal" : "completed");
      },
    });
    const t = await createTestApp();
    // Newly created sessions are adopted directly (the loader is only for resumes).
    // Substitute execution at that seam while retaining real creation and indexing.
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "generator");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "generator-activities" })).status).toBe(
      201,
    );
    await t.deps.projectConfigService.writeRaw("generator-activities", {
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
    const base = "/api/projects/generator-activities/activities";
    const activity = (await (
      await client.post(base, {
        productCode: "p",
        refNum: 1,
        title: "One",
        activityType,
      })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${activity.id}`;
    const draft = (await (
      await client.patch(`${endpoint}/description`, {
        description: "Teach sight words",
        expectedRevision: activity.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    async function start(wafRoot?: string, bookMode?: "readAlong" | "decodable") {
      const current = (await (await client.get(endpoint)).json()) as ActivityDetail;
      const response = await client.post(
        `${endpoint}/${wafRoot ? "assemble-module" : "generate-spec"}`,
        {
          agentId: "default_agent",
          expectedRevision: current.draft.contentRevision,
          ...(wafRoot ? { wafRoot } : {}),
          ...(bookMode ? { bookMode } : {}),
        },
      );
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      expect(run.status, run.error ?? "").toBe("running");
      await waitFor(() => waiting.has(run.sessionId!));
      return run;
    }
    async function finish(run: ActivityRun, value = JSON.stringify(activitySpec), fail = false) {
      output = value;
      fatal = fail;
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      const summary = (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((r) => r.runId === run.runId)!;
      const { candidate } = (await (
        await client.get(`${endpoint}/runs/${run.runId}/candidate`)
      ).json()) as { candidate: string | null };
      return { ...summary, candidate };
    }
    return {
      t,
      client,
      activity,
      draft,
      endpoint,
      service,
      start,
      startAudio: async (configure = true) => {
        let current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        if (!current.draft.mediaPlan) {
          const saved = await client.post(`${endpoint}/apply-generated-spec`, {
            spec: {
              ...activitySpec,
              scenes: [
                {
                  id: "intro",
                  description: "Listen",
                  audio: {
                    tracks: [{ key: "welcome", description: "Greeting", script: "Hello!" }],
                  },
                },
              ],
            },
            expectedRevision: current.draft.contentRevision,
          });
          expect(saved.status).toBe(200);
          const draft = (await saved.json()) as ActivityDraft;
          expect(
            (
              await client.post(`${endpoint}/plan-media`, {
                expectedRevision: draft.contentRevision,
              })
            ).status,
          ).toBe(200);
          current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        }
        if (configure)
          expect(
            (
              await client.put("/api/projects/generator-activities/agents/default_agent/vault", {
                entries: [{ key: "GEMINI_API_KEY", value: "fake-test-only" }],
              })
            ).status,
          ).toBe(200);
        const response = await client.post(`${endpoint}/generate-audio`, {
          agentId: "default_agent",
          expectedRevision: current.draft.contentRevision,
          language: "en-US",
          assetKey: "welcome",
          voice: "Kore",
        });
        if (!configure) return response;
        expect(response.status, await response.clone().text()).toBe(202);
        const run = (await response.clone().json()) as ActivityRun;
        expect(run.status, run.error ?? "").toBe("running");
        await waitFor(() => waiting.has(run.sessionId!));
        return response;
      },
      startImage: async (configure = true) => {
        let current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        if (!current.draft.mediaPlan) {
          const saved = await client.post(`${endpoint}/apply-generated-spec`, {
            spec: {
              ...activitySpec,
              scenes: [
                {
                  id: "intro",
                  description: "Look",
                  media: { images: [{ key: "cover", description: "A blue penguin" }] },
                },
              ],
            },
            expectedRevision: current.draft.contentRevision,
          });
          expect(saved.status).toBe(200);
          const draft = (await saved.json()) as ActivityDraft;
          expect(
            (
              await client.post(`${endpoint}/plan-media`, {
                expectedRevision: draft.contentRevision,
              })
            ).status,
          ).toBe(200);
          current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        }
        if (!configure)
          return client.post(`${endpoint}/generate-image`, {
            agentId: "default_agent",
            expectedRevision: current.draft.contentRevision,
            language: "en-US",
            assetKey: "cover",
          });
        expect(
          (
            await client.put("/api/projects/generator-activities/agents/default_agent/vault", {
              entries: [{ key: "GEMINI_API_KEY", value: "fake-test-only" }],
            })
          ).status,
        ).toBe(200);
        const response = await client.post(`${endpoint}/generate-image`, {
          agentId: "default_agent",
          expectedRevision: current.draft.contentRevision,
          language: "en-US",
          assetKey: "cover",
        });
        expect(response.status, await response.clone().text()).toBe(202);
        const run = (await response.clone().json()) as ActivityRun;
        expect(run.status, run.error ?? "").toBe("running");
        await waitFor(() => waiting.has(run.sessionId!));
        return response;
      },
      startMediaText: async (type: "image" | "audio" = "image") => {
        let current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        if (!current.draft.mediaPlan) {
          const saved = await client.post(`${endpoint}/apply-generated-spec`, {
            spec: {
              ...activitySpec,
              scenes: [
                {
                  id: "intro",
                  description: "Look",
                  ...(type === "image"
                    ? { media: { images: [{ key: "cover", description: "A blue penguin" }] } }
                    : {
                        audio: {
                          tracks: [{ key: "voice", description: "Say it", script: "Penguin" }],
                        },
                      }),
                },
              ],
            },
            expectedRevision: current.draft.contentRevision,
          });
          expect(saved.status).toBe(200);
          const draft = (await saved.json()) as ActivityDraft;
          const planned = await client.post(`${endpoint}/plan-media`, {
            expectedRevision: draft.contentRevision,
          });
          expect(planned.status, await planned.clone().text()).toBe(200);
          current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        }
        const manifest = structuredClone(current.draft.mediaPlan!.manifest);
        manifest.assets["en-US"]![0]!.path =
          type === "image" ? "media/existing-cover.png" : "media/existing-voice.wav";
        if (type === "audio") {
          const authoring = t.deps.tree.api<ActivityAuthoring>(
            "ActivitiesModule",
            "ActivityAuthoring",
          );
          const stored = await authoring.storeAudio(
            "generator-activities",
            activity.id,
            `run_${"a".repeat(32)}`,
            speechWave(),
          );
          manifest.assets["en-US"]![0]!.generatedAudio = {
            runId: stored.runId,
            sha256: stored.sha256,
          };
          manifest.assets["en-US"]![0]!.path = `media/generated/${stored.runId}.wav`;
        }
        manifest.assets["es-MX"] = [
          {
            ...manifest.assets["en-US"]![0]!,
            ...(type === "image" ? { description: "Un pingüino azul" } : { script: "Di hola" }),
          },
        ];
        const bound = await client.put(`${endpoint}/media`, {
          expectedRevision: current.draft.contentRevision,
          manifest,
        });
        expect(bound.status, await bound.clone().text()).toBe(200);
        current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        const response = await client.post(`${endpoint}/generate-media-text`, {
          agentId: "default_agent",
          expectedRevision: current.draft.contentRevision,
          language: "en-US",
          assetKey: type === "image" ? "cover" : "voice",
        });
        expect(response.status, await response.clone().text()).toBe(202);
        const run = (await response.clone().json()) as ActivityRun;
        expect(run.status, run.error ?? "").toBe("running");
        await waitFor(() => waiting.has(run.sessionId!));
        return response;
      },
      startModule: async (withMedia = false) => {
        const current = (await (await client.get(endpoint)).json()) as ActivityDetail;
        expect(
          (
            await client.post(`${endpoint}/apply-generated-spec`, {
              spec: withMedia
                ? {
                    ...activitySpec,
                    scenes: [
                      {
                        id: "intro",
                        description: "Look",
                        media: { images: [{ key: "cat", description: "A cat" }] },
                      },
                    ],
                  }
                : activitySpec,
              expectedRevision: current.draft.contentRevision,
            })
          ).status,
        ).toBe(200);
        const root = path.join(t.root, "waf-checkout");
        for (const name of ["framework/src", "modules", "media"])
          await fs.mkdir(path.join(root, name), { recursive: true });
        await fs.writeFile(path.join(root, "framework/package.json"), "{}");
        if (withMedia) {
          const saved = (await (await client.get(endpoint)).json()) as ActivityDetail;
          const planned = (await (
            await client.post(`${endpoint}/plan-media`, {
              expectedRevision: saved.draft.contentRevision,
            })
          ).json()) as ActivityDraft;
          const manifest = planned.mediaPlan!.manifest;
          manifest.assets["en-US"]![0]!.path = "media/cat.png";
          expect(
            (
              await client.put(`${endpoint}/media`, {
                expectedRevision: planned.contentRevision,
                manifest,
              })
            ).status,
          ).toBe(200);
          await fs.writeFile(path.join(root, "media/cat.png"), "cat fixture");
        }
        return start(root);
      },
      finish,
      disposed,
      endTask: async (run: ActivityRun) => {
        complete();
        await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      },
    };
  }

  it("keeps speech as a candidate until acceptance, preserves accepted audio on regeneration, and stages it for WAF", async () => {
    const f = await fixture("audio");
    expect((await f.startAudio(false)).status).toBe(400);
    const run = (await (await f.startAudio()).json()) as ActivityRun;
    expect(run.kind).toBe("audio");
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    expect(
      await fs.readFile(path.join(session.workspace!, "generate-speech.mjs"), "utf8"),
    ).toContain("AutoLLMClient");
    expect(
      await fs.readFile(path.join(session.workspace!, "speech-input.json"), "utf8"),
    ).not.toContain("fake-test-only");
    const result = await f.finish(run);
    expect(result.status, result.error ?? "").toBe("succeeded");
    const current = async () => (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect((await current()).draft.mediaPlan!.manifest.assets["en-US"]![0]!.path).toBeUndefined();
    const playback = await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`);
    expect(playback.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await playback.arrayBuffer())).toEqual(speechWave());
    const outsider = await provisionUser(f.t.app, "audio_outsider");
    expect(
      (await apiClient(f.t.app, outsider.cookie).get(`${f.endpoint}/runs/${run.runId}/audio`))
        .status,
    ).toBe(404);
    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const saved = (await current()).draft;
    expect(saved.mediaPlan!.manifest.assets["en-US"]![0]!.generatedAudio?.runId).toBe(run.runId);
    const second = (await (await f.startAudio()).json()) as ActivityRun;
    const secondSession = f.t.deps.sessionsRepo.findById(second.sessionId!)!;
    const speechInput = JSON.parse(
      await fs.readFile(path.join(secondSession.workspace!, "input.json"), "utf8"),
    );
    expect(speechInput.draft.mediaPlan).toEqual({ manifest: saved.mediaPlan!.manifest });
    expect(speechInput.draft.mediaPlan.manifest.assets["en-US"][0].generatedAudio).toEqual(
      saved.mediaPlan!.manifest.assets["en-US"]![0]!.generatedAudio,
    );
    expect((await f.finish(second, "invalid")).status).toBe("failed");
    expect((await current()).draft).toEqual(saved);
    const third = (await (await f.startAudio()).json()) as ActivityRun;
    expect((await f.finish(third)).status).toBe("succeeded");
    expect((await current()).draft).toEqual(saved);
    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const workspace = path.join(f.t.root, "audio-assembly");
    await authoring.prepareAudioMedia(
      "generator-activities",
      f.activity.id,
      workspace,
      saved.contentRevision,
    );
    expect(await fs.readFile(path.join(workspace, `media/generated/${run.runId}.wav`))).toEqual(
      speechWave(),
    );
    const waf = path.join(f.t.root, "audio-waf");
    for (const name of ["framework/src", "modules", "media"])
      await fs.mkdir(path.join(waf, name), { recursive: true });
    await fs.writeFile(path.join(waf, "framework/package.json"), "{}");
    await prepareModule(workspace, await current(), waf);
    const exported = await fs.readFile(
      path.join(workspace, "module/generated/p/refs/p-1/spec/asset_manifest.json"),
      "utf8",
    );
    expect(exported).not.toContain("generatedAudio");
    expect(exported).toContain(run.runId);
    const previewAudio = path.join(workspace, "preview/media/generated", `${run.runId}.wav`);
    await fs.mkdir(path.dirname(previewAudio), { recursive: true });
    await fs.writeFile(previewAudio, speechWave());
    const read = (file: string) => fs.readFile(file, "utf8");
    await verifyMediaArtifacts(workspace, await current(), read);
    await fs.writeFile(previewAudio, speechWave(96));
    await expect(verifyMediaArtifacts(workspace, await current(), read)).rejects.toThrow(
      "accepted speech audio",
    );
    const updated = await f.client.patch(`${f.endpoint}/description`, {
      description: "Changed",
      expectedRevision: saved.contentRevision,
    });
    const revision = ((await updated.json()) as ActivityDraft).contentRevision;
    expect(
      (
        await f.client.post(`${f.endpoint}/runs/${third.runId}/accept-audio`, {
          expectedRevision: revision,
        })
      ).status,
    ).toBe(409);
    expect((await current()).draft.mediaPlan).toEqual(saved.mediaPlan);
  });

  it("retains a playable conflict candidate without applying it when a draft changes during speech", async () => {
    const f = await fixture("audio");
    const run = (await (await f.startAudio()).json()) as ActivityRun;
    await f.client.patch(`${f.endpoint}/description`, {
      description: "Edited during generation",
      expectedRevision: run.inputRevision,
    });
    const result = await f.finish(run);
    expect(result.status).toBe("conflict");
    expect((await f.client.get(`${f.endpoint}/runs/${run.runId}/audio`)).status).toBe(200);
    expect(
      (
        await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-audio`, {
          expectedRevision: run.inputRevision,
        })
      ).status,
    ).toBe(409);
  });

  it("keeps image candidates immutable, accepts explicitly, preserves them on failure, and verifies WAF bytes", async () => {
    const f = await fixture("image");
    const missingCredential = await f.startImage(false);
    expect(missingCredential.status).toBe(400);
    expect(((await missingCredential.json()) as { error: { code: string } }).error.code).toBe(
      "image_credential_missing",
    );
    const run = (await (await f.startImage()).json()) as ActivityRun;
    expect(run.kind).toBe("image");
    expect(run.image).toEqual({
      language: "en-US",
      assetKey: "cover",
      prompt: "A blue penguin",
      model: "gemini-3.1-flash-image",
    });
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    expect(
      await fs.readFile(path.join(session.workspace!, "image-input.json"), "utf8"),
    ).not.toContain("fake-test-only");
    const result = await f.finish(run);
    expect(result.status, result.error ?? "").toBe("succeeded");
    const current = async () => (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const beforeAccept = await current();
    const candidateResult = JSON.parse(result.candidate!) as { runId: string; sha256: string };
    const forgedManifest = structuredClone(beforeAccept.draft.mediaPlan!.manifest);
    const forgedAsset = forgedManifest.assets["en-US"]![0]!;
    forgedAsset.path = `media/generated/${run.runId}.png`;
    forgedAsset.generatedImage = candidateResult;
    const forged = await f.client.put(`${f.endpoint}/media`, {
      expectedRevision: beforeAccept.draft.contentRevision,
      manifest: forgedManifest,
    });
    expect(forged.status).toBe(422);
    expect((await current()).draft.mediaPlan).toEqual(beforeAccept.draft.mediaPlan);
    const preview = await f.client.get(`${f.endpoint}/runs/${run.runId}/image`);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(imagePng());
    const outsider = await provisionUser(f.t.app, "image_outsider");
    expect(
      (await apiClient(f.t.app, outsider.cookie).get(`${f.endpoint}/runs/${run.runId}/image`))
        .status,
    ).toBe(404);
    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-image`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const saved = (await current()).draft;
    const savedAsset = saved.mediaPlan!.manifest.assets["en-US"]![0]!;
    expect(savedAsset.path).toBe(`media/generated/${run.runId}.png`);
    expect(savedAsset.generatedImage).toEqual({
      runId: run.runId,
      sha256: expect.any(String),
    });
    const retainedManifest = structuredClone(saved.mediaPlan!.manifest);
    retainedManifest.assets["en-US"]![0]!.description = "A blue penguin, editorial update";
    const retainedResponse = await f.client.put(`${f.endpoint}/media`, {
      expectedRevision: saved.contentRevision,
      manifest: retainedManifest,
    });
    expect(retainedResponse.status, await retainedResponse.clone().text()).toBe(200);
    const retained = (await retainedResponse.json()) as ActivityDraft;
    expect(retained.mediaPlan!.manifest.assets["en-US"]![0]!.generatedImage).toEqual(
      savedAsset.generatedImage,
    );

    const second = (await (await f.startImage()).json()) as ActivityRun;
    expect(second.runId).not.toBe(run.runId);
    const secondSession = f.t.deps.sessionsRepo.findById(second.sessionId!)!;
    const imageInput = JSON.parse(
      await fs.readFile(path.join(secondSession.workspace!, "input.json"), "utf8"),
    );
    expect(imageInput.draft.mediaPlan.manifest.assets["en-US"][0].generatedImage).toEqual(
      savedAsset.generatedImage,
    );
    expect((await f.finish(second, "invalid")).status).toBe("failed");
    expect((await current()).draft).toEqual(retained);
    expect(await f.client.get(`${f.endpoint}/runs/${run.runId}/image`)).toHaveProperty(
      "status",
      200,
    );

    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const workspace = path.join(f.t.root, "image-assembly");
    await authoring.prepareImageMedia(
      "generator-activities",
      f.activity.id,
      workspace,
      retained.contentRevision,
    );
    expect(await fs.readFile(path.join(workspace, `media/generated/${run.runId}.png`))).toEqual(
      imagePng(),
    );
    const waf = path.join(f.t.root, "image-waf");
    for (const name of ["framework/src", "modules", "media"])
      await fs.mkdir(path.join(waf, name), { recursive: true });
    await fs.writeFile(path.join(waf, "framework/package.json"), "{}");
    await prepareModule(workspace, await current(), waf);
    const previewImage = path.join(workspace, "preview/media/generated", `${run.runId}.png`);
    await fs.mkdir(path.dirname(previewImage), { recursive: true });
    await fs.writeFile(previewImage, imagePng());
    const read = (file: string) => fs.readFile(file, "utf8");
    await verifyMediaArtifacts(workspace, await current(), read);
    await fs.writeFile(previewImage, Buffer.from("tampered"));
    await expect(verifyMediaArtifacts(workspace, await current(), read)).rejects.toThrow(
      "Image output must be a complete PNG",
    );
  });

  it("retains a previewable image conflict without applying it when the draft changes", async () => {
    const f = await fixture("image");
    const run = (await (await f.startImage()).json()) as ActivityRun;
    await f.client.patch(`${f.endpoint}/description`, {
      description: "Edited during generation",
      expectedRevision: run.inputRevision,
    });
    const result = await f.finish(run);
    expect(result.status).toBe("conflict");
    expect((await f.client.get(`${f.endpoint}/runs/${run.runId}/image`)).status).toBe(200);
    expect(
      (
        await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-image`, {
          expectedRevision: run.inputRevision,
        })
      ).status,
    ).toBe(409);
  });

  it("reviews media text as a candidate, accepts it explicitly, and preserves media bindings", async () => {
    const f = await fixture("media-text");
    const run = (await (await f.startMediaText()).json()) as ActivityRun;
    expect(run.kind).toBe("media-text");
    expect(run.mediaText).toEqual({
      language: "en-US",
      assetKey: "cover",
      type: "image",
      text: "A blue penguin",
    });
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    const input = JSON.parse(
      await fs.readFile(path.join(session.workspace!, "media-text-input.json"), "utf8"),
    );
    expect(input).toEqual(run.mediaText);
    const result = await f.finish(run);
    expect(result.status, result.error ?? "").toBe("succeeded");
    const candidate = JSON.parse(result.candidate!) as Record<string, unknown>;
    expect(candidate).toEqual({
      language: "en-US",
      assetKey: "cover",
      type: "image",
      text: "A brighter blue penguin",
    });
    const outsider = await provisionUser(f.t.app, "media_text_outsider");
    expect(
      (await apiClient(f.t.app, outsider.cookie).get(`${f.endpoint}/runs/${run.runId}/candidate`))
        .status,
    ).toBe(404);
    const before = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const beforeSpec = before.draft.spec;
    const beforeSpanish = before.draft.mediaPlan!.manifest.assets["es-MX"]![0];
    const beforeUsages = before.draft.mediaPlan!.manifest.assets["en-US"]![0]!.usages;
    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-media-text`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const after = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const asset = after.draft.mediaPlan!.manifest.assets["en-US"]![0]!;
    expect(asset.description).toBe("A brighter blue penguin");
    expect(asset.path).toBe("media/existing-cover.png");
    expect(asset.usages).toEqual(beforeUsages);
    expect(after.draft.mediaPlan!.manifest.assets["es-MX"]![0]).toEqual(beforeSpanish);
    expect(after.draft.spec).toEqual(beforeSpec);
  });

  it("keeps a media-text conflict previewable and refuses acceptance after a draft edit", async () => {
    const f = await fixture("media-text");
    const run = (await (await f.startMediaText()).json()) as ActivityRun;
    await f.client.patch(`${f.endpoint}/description`, {
      description: "Edited during media text generation",
      expectedRevision: run.inputRevision,
    });
    const result = await f.finish(run);
    expect(result.status).toBe("conflict");
    expect(result.candidate).toContain("A brighter blue penguin");
    expect(
      (
        await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-media-text`, {
          expectedRevision: run.inputRevision,
        })
      ).status,
    ).toBe(409);
  });

  it("updates only an accepted audio script while retaining its existing binding", async () => {
    const f = await fixture("media-text");
    const run = (await (await f.startMediaText("audio")).json()) as ActivityRun;
    expect(run.mediaText).toEqual({
      language: "en-US",
      assetKey: "voice",
      type: "audio",
      text: "Penguin",
    });
    const before = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const beforeAsset = before.draft.mediaPlan!.manifest.assets["en-US"]![0]!;
    const beforeSpec = before.draft.spec;
    const result = await f.finish(run);
    expect(result.status).toBe("succeeded");
    expect(JSON.parse(result.candidate!)).toMatchObject({
      type: "audio",
      text: "Hello there.",
    });
    const accepted = await f.client.post(`${f.endpoint}/runs/${run.runId}/accept-media-text`, {
      expectedRevision: run.inputRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const after = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const afterAsset = after.draft.mediaPlan!.manifest.assets["en-US"]![0]!;
    expect(afterAsset.script).toBe("Hello there.");
    expect(afterAsset.description).toBe(beforeAsset.description);
    expect(afterAsset.path).toBe(beforeAsset.path);
    expect(beforeAsset.generatedAudio).toBeDefined();
    expect(afterAsset.generatedAudio).toEqual(beforeAsset.generatedAudio);
    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    expect(
      await authoring.readAudio(
        "generator-activities",
        f.activity.id,
        afterAsset.generatedAudio!.runId,
        afterAsset.generatedAudio!.sha256,
      ),
    ).toEqual(speechWave());
    expect(afterAsset.usages).toEqual(beforeAsset.usages);
    expect(after.draft.spec).toEqual(beforeSpec);
  });

  it("retains an invalid book candidate as failed without changing the saved draft", async () => {
    const f = await fixture(false, "book");
    const before = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const invalidBook = {
      ...activitySpec,
      scenes: [
        {
          id: "story-1",
          description: "Story page 1",
          role: "story",
          media: { images: [], video: [], animations: [] },
          audio: {
            tracks: [{ key: "story-audio", description: "Narration", script: "Read the page." }],
          },
        },
      ],
    };
    const result = await f.finish(await f.start(), JSON.stringify(invalidBook));
    expect(result.status).toBe("failed");
    expect(result.error).toContain("exactly one primary image");
    expect(result.candidate).toBe(JSON.stringify(invalidBook));
    expect((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).toEqual(before);
  });

  it("applies a valid book candidate with ordered pages and required media", async () => {
    const f = await fixture(false, "book");
    const validBook = {
      ...activitySpec,
      id: "storybook",
      moduleFolder: "waf-module-storybook",
      title: "Storybook",
      scenes: [
        {
          id: "cover",
          description: "Cover page",
          role: "cover",
          media: { images: [{ key: "cover-image", description: "A clear cover." }] },
          audio: { tracks: [] },
        },
        {
          id: "title",
          description: "Title page",
          role: "title",
          media: { images: [{ key: "title-image", description: "A clear title page." }] },
          audio: { tracks: [] },
        },
        {
          id: "story-1",
          description: "Story page 1",
          role: "story",
          media: { images: [{ key: "story-1-image", description: "A clear story scene." }] },
          audio: {
            tracks: [{ key: "story-1-audio", description: "Narration", script: "Read the page." }],
          },
        },
      ],
    };
    const result = await f.finish(await f.start(), JSON.stringify(validBook));
    expect(result.status, result.error ?? "").toBe("succeeded");
    expect(((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.spec).toEqual(
      validBook,
    );
  });

  it("assembles an explicit read-along book, stages its compiled policy, and rejects mode tampering", async () => {
    const f = await fixture(true, "book");
    const validBook = {
      ...activitySpec,
      id: "storybook-assembly",
      moduleFolder: "waf-module-storybook-assembly",
      title: "Storybook assembly",
      scenes: [
        {
          id: "cover",
          description: "Cover page",
          role: "cover",
          media: { images: [{ key: "cover-image", description: "A clear cover." }] },
          audio: { tracks: [] },
        },
        {
          id: "title",
          description: "Title page",
          role: "title",
          media: { images: [{ key: "title-image", description: "A clear title page." }] },
          audio: { tracks: [] },
        },
        {
          id: "story-1",
          description: "Story page 1",
          role: "story",
          media: { images: [{ key: "story-1-image", description: "A clear story scene." }] },
          audio: {
            tracks: [{ key: "story-1-audio", description: "Narration", script: "Read the page." }],
          },
        },
      ],
    };
    const current = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const saved = (await (
      await f.client.post(`${f.endpoint}/apply-generated-spec`, {
        spec: validBook,
        expectedRevision: current.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const planned = (await (
      await f.client.post(`${f.endpoint}/plan-media`, {
        expectedRevision: saved.contentRevision,
      })
    ).json()) as ActivityDraft;
    const root = path.join(f.t.root, "book-waf-checkout");
    for (const name of ["framework/src", "modules", "media"])
      await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, "framework/package.json"), "{}");
    const beforeRuns = f.t.deps.db.prepare("SELECT * FROM activity_runs").all();
    const beforeSessions = f.t.deps.db.prepare("SELECT session_id FROM sessions").all();
    for (const mode of [undefined, "invalid"] as const) {
      const response = await f.client.post(`${f.endpoint}/assemble-module`, {
        agentId: "default_agent",
        expectedRevision: planned.contentRevision,
        wafRoot: root,
        ...(mode === undefined ? {} : { bookMode: mode }),
      });
      expect(response.status).toBe(422);
      expect(f.t.deps.db.prepare("SELECT * FROM activity_runs").all()).toEqual(beforeRuns);
      expect(f.t.deps.db.prepare("SELECT session_id FROM sessions").all()).toEqual(beforeSessions);
    }
    const run = await f.start(root, "readAlong");
    expect(run.bookMode).toBe("readAlong");
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    const input = JSON.parse(
      await fs.readFile(path.join(session.workspace!, "input.json"), "utf8"),
    );
    expect(input.bookMode).toBe("readAlong");
    expect(
      await fs.readFile(path.join(session.workspace!, "module/src/book-reader/model.ts"), "utf8"),
    ).toContain("export class BookReaderModel");
    const result = await f.finish(run);
    expect(result.status, result.error ?? "").toBe("succeeded");
    const configuration = JSON.parse(
      await fs.readFile(path.join(session.workspace!, "module/configurations/p-1.json"), "utf8"),
    );
    expect(configuration.p.book.mode).toBe("readAlong");
    expect(configuration.p["en-US"].scenes.map((scene: { role: string }) => scene.role)).toEqual([
      "cover",
      "title",
      "story",
    ]);
    const after = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect(after.draft.spec).toEqual(validBook);
    expect(after.draft.contentRevision).toBe(run.inputRevision);

    const tampered = await f.start(root, "readAlong");
    const tamperedSession = f.t.deps.sessionsRepo.findById(tampered.sessionId!)!;
    const configFile = path.join(tamperedSession.workspace!, "module/configurations/p-1.json");
    const tamperedConfig = JSON.parse(await fs.readFile(configFile, "utf8"));
    tamperedConfig.p.book.mode = "decodable";
    await fs.writeFile(configFile, JSON.stringify(tamperedConfig));
    // An agent changing the staging file cannot change the server-owned choice.
    await fs.writeFile(
      path.join(tamperedSession.workspace!, "input.json"),
      JSON.stringify({ ...input, bookMode: "decodable" }),
    );
    const rejected = await f.finish(tampered);
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toContain("selected book reading policy");

    const missingModel = await f.start(root, "readAlong");
    const missingModelSession = f.t.deps.sessionsRepo.findById(missingModel.sessionId!)!;
    await fs.unlink(path.join(missingModelSession.workspace!, "module/src/book-reader/model.ts"));
    const missingModelResult = await f.finish(missingModel);
    expect(missingModelResult.status).toBe("failed");
    expect(missingModelResult.error).toContain("required artifact");
  });

  it("reads legacy book drafts but rejects invalid assembly before allocating a run or Session", async () => {
    const f = await fixture();
    const saved = await f.client.post(`${f.endpoint}/apply-generated-spec`, {
      spec: { ...activitySpec, scenes: [{ id: "story", description: "Read the story" }] },
      expectedRevision: f.draft.contentRevision,
    });
    expect(saved.status).toBe(200);
    // Represent a book saved before book-specific validation was introduced.
    f.t.deps.db
      .prepare("UPDATE activities SET activity_type = 'book' WHERE id = ?")
      .run(f.activity.id);
    const before = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect(before.draft.status).toBe("valid");
    const sessionsBefore = f.t.deps.db.prepare("SELECT session_id FROM sessions").all();
    const response = await f.client.post(`${f.endpoint}/assemble-module`, {
      agentId: "default_agent",
      expectedRevision: before.draft.contentRevision,
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("exactly one primary image");
    expect(f.t.deps.db.prepare("SELECT * FROM activity_runs").all()).toEqual([]);
    expect(f.t.deps.db.prepare("SELECT session_id FROM sessions").all()).toEqual(sessionsBefore);
    expect((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).toEqual(before);
  });

  it("rejects malformed media-text output without changing the draft", async () => {
    const f = await fixture("media-text");
    const run = (await (await f.startMediaText()).json()) as ActivityRun;
    const before = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect((await f.finish(run, "invalid")).status).toBe("failed");
    await expect((await f.client.get(f.endpoint)).json()).resolves.toEqual(before);
  });

  it("assembles a WAF module through the same Session approvals and retains draft identity", async () => {
    const f = await fixture(true);
    const run = await f.startModule();
    expect(run.kind).toBe("module");
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    expect(
      JSON.parse(await fs.readFile(path.join(session.workspace!, "module/definition.json"), "utf8"))
        .engine,
    ).toBe("html");
    const result = await f.finish(run);
    expect(result.status).toBe("succeeded");
    expect(result.kind).toBe("module");
    expect(JSON.parse(result.candidate!).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "preview/runtime.js", sha256: expect.any(String) }),
      ]),
    );
    const detail = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect(detail.draft.contentRevision).toBe(run.inputRevision);
    expect(detail.draft.spec).toEqual(activitySpec);
  });
  it("collects approved media artifacts and rejects a model that changes their bindings", async () => {
    const f = await fixture(true);
    const run = await f.startModule(true);
    const saved = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect(Object.keys(saved.draft.mediaPlan!.requirements)).not.toHaveLength(0);
    const firstSession = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    const input = JSON.parse(
      await fs.readFile(path.join(firstSession.workspace!, "input.json"), "utf8"),
    );
    expect(input.draft.mediaPlan).toEqual({ manifest: saved.draft.mediaPlan!.manifest });
    expect((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).toEqual(saved);
    const result = await f.finish(run);
    expect(result.status).toBe("succeeded");
    expect(JSON.parse(result.candidate!).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "module/generated/p/refs/p-1/spec/asset_manifest.json" }),
      ]),
    );
    const next = await f.startModule(true);
    const session = f.t.deps.sessionsRepo.findById(next.sessionId!)!;
    await fs.writeFile(
      path.join(session.workspace!, "module/configurations/p-1.json"),
      JSON.stringify({ p: { "en-US": { cat: "{{MEDIA}}/wrong.png" } } }),
    );
    const rejected = await f.finish(next);
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toContain("approved media configuration");
  });
  it("detects media edits made while assembly artifacts are being verified", async () => {
    const f = await fixture(true);
    const run = await f.startModule(true);
    const open = fs.open.bind(fs);
    let reads = 0;
    const spy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (
        String(args[0]).replaceAll("\\", "/").endsWith("module/configurations/p-1.json") &&
        ++reads === 2
      ) {
        const current = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
        const manifest = current.draft.mediaPlan!.manifest;
        manifest.assets["en-US"]![0]!.description = "Reviewed during collection";
        expect(
          (
            await f.client.put(`${f.endpoint}/media`, {
              manifest,
              expectedRevision: current.draft.contentRevision,
            })
          ).status,
        ).toBe(200);
      }
      return open(...args);
    });
    try {
      const result = await f.finish(run);
      expect(reads).toBe(2);
      expect(result.status).toBe("conflict");
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps module output as a conflict when the input draft changes", async () => {
    const f = await fixture(true);
    const run = await f.startModule();
    await f.client.patch(`${f.endpoint}/description`, {
      description: "Changed during assembly",
      expectedRevision: run.inputRevision,
    });
    const result = await f.finish(run);
    expect(result.status).toBe("conflict");
    expect(JSON.parse(result.candidate!).previewPath).toBe("preview/index.html");
  });

  it("does not mark module files from a failed Session as a successful assembly", async () => {
    const f = await fixture(true);
    const run = await f.startModule();
    expect((await f.finish(run, "", true)).status).toBe("failed");
  });

  it("requires a valid saved spec before admitting module work", async () => {
    const f = await fixture(true);
    const response = await f.client.post(`${f.endpoint}/assemble-module`, {
      agentId: "default_agent",
      expectedRevision: f.draft.contentRevision,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "module_spec_required" } });
    expect(
      f.t.deps.db.prepare("SELECT COUNT(*) AS count FROM activity_module_runs").get(),
    ).toMatchObject({ count: 0 });
  });

  it("captures inputs in a separate workspace, then validates, applies and reopens the saved result", async () => {
    const f = await fixture();
    const run = await f.start();
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    expect(session.workspace).toBe(path.join(f.t.root, "activity-runs", run.runId));
    const input = JSON.parse(
      await fs.readFile(path.join(session.workspace!, "input.json"), "utf8"),
    );
    expect(input.draft.description).toBe("Teach sight words");
    expect(input.draft.contentRevision).toBe(f.draft.contentRevision);
    expect((await f.finish(run)).status).toBe("succeeded");
    const reopened = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect(reopened.draft.spec).toEqual(activitySpec);
    expect(reopened.draft.status).toBe("valid");
    expect(await f.service.candidate("generator-activities", f.activity.id, run.runId)).toBe(
      JSON.stringify(activitySpec),
    );
  });

  it("preserves a candidate when the draft changes, and starts a fresh retry", async () => {
    const f = await fixture();
    const run = await f.start();
    expect(
      (
        await f.client.post(`${f.endpoint}/generate-spec`, {
          agentId: "default_agent",
          expectedRevision: f.draft.contentRevision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.client.patch(`${f.endpoint}/description`, {
          description: "New instructions",
          expectedRevision: f.draft.contentRevision,
        })
      ).status,
    ).toBe(200);
    const conflict = await f.finish(run);
    expect(conflict.status).toBe("conflict");
    expect(conflict.candidate).toBe(JSON.stringify(activitySpec));
    expect(
      ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.spec,
    ).toBeNull();
    const retry = await f.start();
    expect(retry.runId).not.toBe(run.runId);
    expect(retry.inputRevision).not.toBe(run.inputRevision);
    expect((await f.finish(retry)).status).toBe("succeeded");
  });

  it("keeps invalid output and a failed model's output without changing the draft", async () => {
    const f = await fixture();
    const invalid = await f.finish(await f.start(), "{bad json");
    expect(invalid.status).toBe("failed");
    expect(invalid.candidate).toBe("{bad json");
    const fatal = await f.finish(await f.start(), JSON.stringify(activitySpec), true);
    expect(fatal.status).toBe("failed");
    expect(fatal.candidate).toBe(JSON.stringify(activitySpec));
    expect(
      ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.contentRevision,
    ).toBe(f.draft.contentRevision);
  });

  it("cancels without applying and retains terminal history", async () => {
    const f = await fixture();
    const run = await f.start();
    const cancelled = await f.client.post(`${f.endpoint}/runs/${run.runId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
    await f.service.reconcile();
    expect((await f.service.list("generator-activities", f.activity.id))[0]?.status).toBe(
      "cancelled",
    );
    expect(
      ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.contentRevision,
    ).toBe(f.draft.contentRevision);
  });

  it("lists compact summaries and authorizes candidate retrieval by project and activity", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.finish(run);
    const response = await f.client.get(`${f.endpoint}/runs`);
    const { runs } = (await response.json()) as { runs: ActivityRunSummary[] };
    expect(runs[0]).toMatchObject({ runId: run.runId, hasCandidate: true, status: "succeeded" });
    expect(runs[0]).not.toHaveProperty("candidate");
    expect(JSON.stringify(runs)).not.toContain(activitySpec.activityDescription);
    const candidateUrl = `${f.endpoint}/runs/${run.runId}/candidate`;
    expect(await (await f.client.get(candidateUrl)).json()).toEqual({
      candidate: JSON.stringify(activitySpec),
    });
    const outsider = await provisionUser(f.t.app, "outsider");
    const other = apiClient(f.t.app, outsider.cookie);
    expect((await other.get(candidateUrl)).status).toBe(404);
    expect((await f.client.post("/api/projects", { projectId: "generator-other" })).status).toBe(
      201,
    );
    expect(
      (await f.client.get(candidateUrl.replace("generator-activities", "generator-other"))).status,
    ).toBe(404);
    const second = (await (
      await f.client.post("/api/projects/generator-activities/activities", {
        productCode: "p",
        refNum: 2,
        title: "Two",
      })
    ).json()) as ActivityDetail;
    expect((await f.client.get(candidateUrl.replace(f.activity.id, second.id))).status).toBe(404);
    expect(
      (await f.client.post("/api/projects/generator-activities/members", { userId: "outsider" }))
        .status,
    ).toBe(201);
    expect((await other.get(candidateUrl)).status).toBe(200);
    // Fill the page with payloads much larger than their metadata. None of these
    // candidate bytes should cross the history endpoint or enter its JSON parsing.
    const large = "x".repeat(256 * 1024);
    for (let i = 0; i < 50; i++) {
      const { candidate: _, ...metadata } = run;
      const stored = { ...metadata, runId: `run_large_${i}`, status: "failed", hasCandidate: true };
      f.t.deps.db
        .prepare(
          "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          stored.runId,
          stored.projectId,
          stored.activityId,
          stored.status,
          stored.createdAt,
          JSON.stringify(stored),
        );
      f.t.deps.db
        .prepare("INSERT INTO activity_run_candidates (run_id, candidate) VALUES (?, ?)")
        .run(stored.runId, large);
    }
    const page = await (await f.client.get(`${f.endpoint}/runs`)).text();
    expect(JSON.parse(page).runs).toHaveLength(50);
    expect(page.length).toBeLessThan(50_000);
    expect(page).not.toContain('"candidate":');
    const records = f.t.deps.db.prepare("SELECT record_json FROM activity_runs").all();
    expect(JSON.stringify(records).length).toBeLessThan(50_000);
  });

  it("retains the session reference and releases a creation that finishes during shutdown", async () => {
    const f = await fixture();
    const createSession = f.t.deps.sessionService.createSession.bind(f.t.deps.sessionService);
    const entered = deferred();
    const release = deferred();
    vi.spyOn(f.t.deps.sessionService, "createSession").mockImplementation(async (...args) => {
      entered.resolve();
      await release.promise;
      return createSession(...args);
    });
    const started = f.client.post(`${f.endpoint}/generate-spec`, {
      agentId: "default_agent",
      expectedRevision: f.draft.contentRevision,
    });
    await entered.promise;
    const stopping = (await f.t.deps.hmr.ensure()).api.shutdown();
    release.resolve();
    await stopping;
    const run = (await (await started).json()) as ActivityRun;
    expect(run.status).toBe("interrupted");
    expect(run.sessionId).not.toBeNull();
    expect(f.t.deps.sessionsRepo.findById(run.sessionId!)).toBeDefined();
    expect(f.disposed.has(run.sessionId!)).toBe(true);
    expect((await f.service.list("generator-activities", f.activity.id))[0]).toMatchObject({
      status: "interrupted",
      sessionId: run.sessionId,
    });
  });

  it.each(["shutdown", "reassembly"] as const)(
    "drains an entered publication before %s finishes",
    async (mode) => {
      const f = await fixture();
      const run = await f.start();
      const activities = f.t.deps.tree.api<ActivityAuthoring>(
        "ActivitiesModule",
        "ActivityAuthoring",
      );
      const apply = activities.applySpec.bind(activities);
      const entered = deferred();
      const release = deferred();
      vi.spyOn(activities, "applySpec").mockImplementation(async (...args) => {
        entered.resolve();
        await release.promise;
        return apply(...args);
      });
      const completion = f.finish(run);
      await entered.promise;
      let drained = false;
      const stopping = (
        mode === "shutdown"
          ? (await f.t.deps.hmr.ensure()).api.shutdown()
          : f.t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()
      ).then(() => {
        drained = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(drained).toBe(false);
        expect((await f.service.list("generator-activities", f.activity.id))[0]?.status).toBe(
          "running",
        );
        expect(
          (await activities.getActivity("generator-activities", f.activity.id)).draft.spec,
        ).toBeNull();
      } finally {
        release.resolve();
      }
      await stopping;
      expect((await completion).status).toBe("succeeded");
      const current = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
      expect(current.draft.spec).toEqual(activitySpec);
      expect((await f.service.list("generator-activities", f.activity.id))[0]?.status).toBe(
        "succeeded",
      );
    },
  );

  it("drains an entered publication before deleting a project and rejects new activity writes", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.endTask(run);
    const entered = deferred();
    const release = deferred();
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("draft.json")) {
        entered.resolve();
        await release.promise;
      }
      return rename(from, to);
    });
    const publication = f.service.reconcile();
    await entered.promise;
    let deleted = false;
    const deletion = Promise.resolve(f.client.delete("/api/projects/generator-activities")).then(
      (response) => {
        deleted = true;
        return response;
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(deleted).toBe(false);
      expect(
        (
          await f.client.patch(`${f.endpoint}/description`, {
            description: "Too late",
            expectedRevision: f.draft.contentRevision,
          })
        ).status,
      ).toBe(409);
    } finally {
      release.resolve();
    }
    await publication;
    expect((await deletion).status).toBe(204);
    await f.service.reconcile();
    expect((await f.client.get(f.endpoint)).status).toBe(404);
    await expect(fs.stat(path.join(f.t.root, "generator-activities"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(f.t.deps.db.prepare("SELECT * FROM activity_runs").all()).toEqual([]);
    expect(f.t.deps.db.prepare("SELECT * FROM activity_run_candidates").all()).toEqual([]);
  });

  it("recovers interrupted attempts without resubmitting or applying their output", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.service.shutdown();
    f.t.deps.manager.abortTask(run.sessionId!);
    await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
    // Simulate the durable record left by abrupt process termination.
    run.candidate = JSON.stringify(activitySpec);
    f.t.deps.db
      .prepare("INSERT INTO activity_run_candidates (run_id, candidate) VALUES (?, ?)")
      .run(run.runId, run.candidate);
    const { candidate: _, ...metadata } = run;
    f.t.deps.db
      .prepare("UPDATE activity_runs SET status = 'running', record_json = ? WHERE run_id = ?")
      .run(JSON.stringify({ ...metadata, hasCandidate: true }), run.runId);
    const restarted = wire(ActivityGenerationService, {
      config: f.t.deps.config,
      projectWork: f.t.deps.tree.api<ProjectActivityWork>("ProjectsModule", "ProjectActivityWork"),
      db: f.t.deps.db,
      activities: f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring"),
      agents: f.t.deps.agentConfigService,
      sessions: f.t.deps.manager,
      sessionService: f.t.deps.sessionService,
      channels: f.t.deps.channels,
      log: { line: () => {} },
    });
    let dispose: () => void = () => {};
    restarted.setup({
      effect: (fn: () => void) => {
        dispose = fn;
      },
    } as ClassCtx);
    try {
      const recovered = (await restarted.list("generator-activities", f.activity.id))[0]!;
      expect(recovered.status).toBe("interrupted");
      expect(await restarted.candidate("generator-activities", f.activity.id, run.runId)).toBe(
        run.candidate,
      );
      expect(recovered.sessionId).toBe(run.sessionId);
      expect(
        ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.spec,
      ).toBeNull();
    } finally {
      await restarted.shutdown();
      dispose();
    }
  });
});
