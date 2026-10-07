/**
 * Scene compositions (experimental): an agent writes an animated HTML page for one scene from
 * its description and images. What this proves: the experiment switch gates it, a scene with
 * no image is refused, the run stages exactly the template, scripts and images it may use,
 * what the agent wrote is checked before it is kept, and the page is served only on the
 * preview origin behind a signed link. The Session is a fake; nothing reaches a model.
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
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import {
  COMPOSITION_BRIDGE,
  compositionProblem,
  compositionTemplate,
  parseFrames,
} from "../src/activities/composition.js";
import type { CompositionCandidate } from "../src/activities/composition-types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";

const PROJECT = "composer-scenes";

/** A page the way an agent should write it: the template, one image and one timeline. */
function goodPage(extra = "") {
  return compositionTemplate(640, 480)
    .replace(
      "<!-- The frames go here: elements positioned inside the stage, using images/ files. -->",
      `<img id="sky" src="images/sky.png" alt="" style="width:100%" />${extra}`,
    )
    .replace(
      "// timeline.to(...), timeline.from(...), one section per frame of frames.json.",
      'timeline.from("#sky", { opacity: 0, duration: 3 }).to("#sky", { x: 40, duration: 3 });',
    );
}

const FRAMES = {
  frames: [
    { id: "frame-1", description: "The sky fades in", seconds: 3 },
    { id: "frame-2", description: "The sky drifts right", seconds: 3 },
  ],
};

describe("scene compositions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    let page = goodPage();
    let frames: unknown = FRAMES;
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
        await fs.writeFile(path.join(row.workspace!, "composition.html"), page);
        await fs.writeFile(path.join(row.workspace!, "frames.json"), JSON.stringify(frames));
        yield requestEnd("completed");
      },
    });
    const t = await createTestApp();
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "composer");
    const client = apiClient(t.app, owner.cookie);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
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
      await client.post(base, { productCode: "p", refNum: 1, title: "Scenes" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "A short story about the sky",
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "The sky at dawn",
            media: {
              images: [{ key: "sky", description: "A blue sky" }],
              video: [{ key: "intro-video", description: "The sky slowly brightens" }],
            },
          },
          {
            id: "outro",
            description: "The end",
            media: { animations: [{ key: "outro-animation", description: "Stars appear" }] },
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
    const plannedDraft = (await planned.json()) as ActivityDraft;
    // Bind the scene's image to an upload, as an author would.
    const sky = imagePng(4, 3);
    const uploaded = await client.post(`${endpoint}/media-uploads`, {
      name: "sky.png",
      dataBase64: sky.toString("base64"),
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { path: skyPath } = (await uploaded.json()) as { path: string };
    const manifest = structuredClone(plannedDraft.mediaPlan!.manifest);
    manifest.assets["en-US"]!.find((asset) => asset.key === "sky")!.path = skyPath;
    const bound = await client.put(`${endpoint}/media`, {
      manifest,
      expectedRevision: plannedDraft.contentRevision,
    });
    expect(bound.status, await bound.clone().text()).toBe(200);

    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const current = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const experiment = async (on: boolean) =>
      expect((await admin.put("/api/admin/settings", { activityVideoExperiment: on })).status).toBe(
        200,
      );
    const compose = async (assetKey = "intro-video") =>
      client.post(`${endpoint}/compose-video`, {
        agentId: "default_agent",
        expectedRevision: (await current()).draft.contentRevision,
        language: "en-US",
        assetKey,
      });
    async function started() {
      const response = await compose();
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => waiting.has(run.sessionId!));
      return run;
    }
    async function finish(run: ActivityRun, output: { page?: string; frames?: unknown } = {}) {
      page = output.page ?? goodPage();
      frames = output.frames ?? FRAMES;
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      return (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((entry) => entry.runId === run.runId)!;
    }
    /** Where the link for a run's composition sends an author. */
    async function link(runId: string) {
      const redirect = await client.get(`${endpoint}/runs/${runId}/composition-link`);
      expect(redirect.status, await redirect.clone().text()).toBe(302);
      return new URL(redirect.headers.get("location")!);
    }
    /** A request on the host a link was issued for, with no cookie at all. */
    const onPreview = (location: URL, pathname: string) =>
      t.app.request(new URL(pathname, location.origin).toString(), {
        headers: { host: location.host },
      });
    return {
      t,
      client,
      admin,
      endpoint,
      prompts,
      sky,
      experiment,
      compose,
      started,
      finish,
      link,
      onPreview,
    };
  }

  it("does nothing while the experiment is off, and an admin turns it on", async () => {
    const f = await fixture();
    const setup = async () =>
      (await (await f.client.get(`/api/projects/${PROJECT}/activities/video-setup`)).json()) as {
        enabled: boolean;
      };
    expect(await setup()).toEqual({ enabled: false });
    const refused = await f.compose();
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("experiment_off");
    // Off is said first, even for a draft that has moved on since the author loaded it.
    const stale = await f.client.post(`${f.endpoint}/compose-video`, {
      agentId: "default_agent",
      expectedRevision: "not-the-current-revision",
      language: "en-US",
      assetKey: "intro-video",
    });
    expect(stale.status).toBe(403);
    expect(JSON.stringify(await stale.json())).toContain("experiment_off");
    const settings = async () =>
      (
        (await (await f.admin.get("/api/admin/settings")).json()) as {
          settings: { activityVideoExperiment: boolean };
        }
      ).settings.activityVideoExperiment;
    expect(await settings()).toBe(false);
    // Only an admin may turn it on.
    expect(
      (await f.client.put("/api/admin/settings", { activityVideoExperiment: true })).status,
    ).toBe(403);
    await f.experiment(true);
    expect(await settings()).toBe(true);
    expect(await setup()).toEqual({ enabled: true });
    const runs = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(runs.runs).toEqual([]);
  });

  it("refuses a scene with no bound image, and an asset that is not a video or animation", async () => {
    const f = await fixture();
    await f.experiment(true);
    const empty = await f.compose("outro-animation");
    expect(empty.status).toBe(409);
    expect(JSON.stringify(await empty.json())).toContain("composition_no_images");
    const image = await f.compose("sky");
    expect(image.status).toBe(422);
    expect(JSON.stringify(await image.json())).toContain("composition_asset_invalid");
    const runs = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(runs.runs).toEqual([]);
  });

  it("refuses a scene image too large to be served back", async () => {
    const f = await fixture();
    await f.experiment(true);
    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const read = vi.spyOn(authoring, "imageContent").mockResolvedValue({
      bytes: Buffer.alloc(8 * 1024 * 1024 + 1),
      mimeType: "image/png",
    });
    const refused = await f.client.post(`${f.endpoint}/compose-video`, {
      agentId: "default_agent",
      expectedRevision: ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft
        .contentRevision,
      language: "en-US",
      assetKey: "intro-video",
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(await refused.json())).toContain("composition_image_too_large");
    expect(read).toHaveBeenCalledWith(
      PROJECT,
      expect.any(String),
      expect.objectContaining({ assetKey: "sky" }),
    );
    const runs = (await (await f.client.get(`${f.endpoint}/runs`)).json()) as { runs: unknown[] };
    expect(runs.runs).toEqual([]);
  });

  it("stages the template, the vendored scripts and the scene's images", async () => {
    const f = await fixture();
    await f.experiment(true);
    const run = await f.started();
    expect(run.kind).toBe("composition");
    expect(run.composition).toMatchObject({
      language: "en-US",
      assetKey: "intro-video",
      sceneId: "intro",
      width: 640,
      height: 480,
      images: [{ key: "sky", file: "images/sky.png" }],
    });
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    const workspace = session.workspace!;
    expect(
      JSON.parse(await fs.readFile(path.join(workspace, "composition-input.json"), "utf8")),
    ).toEqual({
      sceneId: "intro",
      description: "The sky at dawn",
      assetDescription: "The sky slowly brightens",
      width: 640,
      height: 480,
      frameSeconds: 3,
      minSeconds: 6,
      maxSeconds: 60,
      images: [{ key: "sky", file: "images/sky.png" }],
    });
    expect(await fs.readFile(path.join(workspace, "images", "sky.png"))).toEqual(f.sky);
    expect(await fs.readFile(path.join(workspace, "gsap.min.js"), "utf8")).toContain("GSAP");
    expect(await fs.readFile(path.join(workspace, "penguin-composition.js"), "utf8")).toBe(
      COMPOSITION_BRIDGE,
    );
    const template = await fs.readFile(path.join(workspace, "composition-template.html"), "utf8");
    expect(template).toContain(`content="default-src 'self' 'unsafe-inline'"`);
    expect(template).toContain("width: 640px");
    expect(template).toContain("height: 480px");
    expect(f.prompts.at(-1)).toContain("composition.html");
    expect(f.prompts.at(-1)).toContain("window.__composition.timeline");
    await f.finish(run);
  });

  it("keeps a page that passes its checks and serves it only on the preview origin", async () => {
    const f = await fixture();
    await f.experiment(true);
    const run = await f.started();
    const summary = await f.finish(run);
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    const { candidate } = (await (
      await f.client.get(`${f.endpoint}/runs/${run.runId}/candidate`)
    ).json()) as { candidate: string };
    const kept = JSON.parse(candidate) as CompositionCandidate;
    expect(kept.frames.map((frame) => frame.id)).toEqual(["frame-1", "frame-2"]);
    expect(kept.seconds).toBe(6);

    const location = await f.link(run.runId);
    expect(location.hostname).toBe("127.0.0.1");
    expect(location.pathname).toMatch(/^\/preview\/composition\/[^/]+\/composition\.html$/);
    const base = location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1);
    const page = await f.onPreview(location, location.pathname);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toBe("default-src 'self' 'unsafe-inline'");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await page.text()).toBe(goodPage());
    const image = await f.onPreview(location, `${base}images/sky.png`);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(f.sky);
    expect(await (await f.onPreview(location, `${base}gsap.min.js`)).text()).toContain("GSAP");
    expect(await (await f.onPreview(location, `${base}penguin-composition.js`)).text()).toBe(
      COMPOSITION_BRIDGE,
    );
    // Only the staged files, and only on the host the link names.
    expect((await f.onPreview(location, `${base}frames.json`)).status).toBe(404);
    expect((await f.onPreview(location, `${base}input.json`)).status).toBe(404);
    const elsewhere = await f.t.app.request(
      new URL(location.pathname, "http://localhost").toString(),
      { headers: { host: "localhost" } },
    );
    expect(elsewhere.status).toBe(404);
    const forged = await f.onPreview(
      location,
      "/preview/composition/forged.token/composition.html",
    );
    expect(forged.status).toBe(404);
    // The App origin has no route that serves a composition.
    const onApp = await f.client.get(
      `${f.endpoint}/runs/${run.runId}/composition/composition.html`,
    );
    expect(onApp.status).toBe(404);
    expect(await onApp.text()).not.toContain("<html");
    // A page changed after it was checked is not served.
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    await fs.writeFile(
      path.join(session.workspace!, "composition.html"),
      goodPage('<img src="https://cdn.example.com/x.png" />'),
    );
    expect((await f.onPreview(location, location.pathname)).status).toBe(404);
    // Switched off, the link stops working and no new one is handed out.
    await f.experiment(false);
    expect((await f.onPreview(location, `${base}images/sky.png`)).status).toBe(404);
    expect((await f.client.get(`${f.endpoint}/runs/${run.runId}/composition-link`)).status).toBe(
      403,
    );
  });

  it("fails a page that reaches the network, naming the check", async () => {
    const f = await fixture();
    await f.experiment(true);
    const run = await f.started();
    const summary = await f.finish(run, {
      page: goodPage('<script src="https://cdn.example.com/gsap.js"></script>'),
    });
    expect(summary.status).toBe("failed");
    expect(summary.composition?.problem).toBe("composition_network");
    expect(summary.error).toContain("cdn.example.com");
    expect(summary.hasCandidate).toBe(false);
    expect((await f.client.get(`${f.endpoint}/runs/${run.runId}/composition-link`)).status).toBe(
      404,
    );
  });

  it("fails frames that do not add up to a composition", async () => {
    const f = await fixture();
    await f.experiment(true);
    const run = await f.started();
    const summary = await f.finish(run, {
      frames: { frames: [{ id: "only", description: "Too short", seconds: 2 }] },
    });
    expect(summary.status).toBe("failed");
    expect(summary.composition?.problem).toBe("composition_frames");
  });
});

describe("composition checks", () => {
  const staged = new Set(["gsap.min.js", "penguin-composition.js", "images/sky.png"]);

  it("passes the page an agent should write", () => {
    expect(compositionProblem(goodPage(), staged)).toBeNull();
  });

  it("names each thing a page may not do", () => {
    const code = (html: string) => compositionProblem(html, staged)?.code ?? null;
    expect(code(goodPage('<img src="images/cloud.png" />'))).toBe("composition_reference");
    expect(code(goodPage('<div style="background:url(data:image/png;base64,AA)"></div>'))).toBe(
      "composition_reference",
    );
    expect(code(goodPage('<img src="//cdn.example.com/x.png" />'))).toBe("composition_network");
    expect(code(goodPage("<script>fetch('images/sky.png')</script>"))).toBe("composition_network");
    expect(code(goodPage("<script>timeline.to('#sky', { x: Math.random() })</script>"))).toBe(
      "composition_random",
    );
    expect(code(goodPage().replace("window.__composition.timeline = timeline;", ""))).toBe(
      "composition_timeline",
    );
    expect(code(goodPage().replace(/<meta http-equiv[^>]*>/, ""))).toBe("composition_template");
    expect(code(goodPage().replace('<script src="penguin-composition.js"></script>', ""))).toBe(
      "composition_template",
    );
    expect(code(goodPage(`<p>${"x".repeat(520 * 1024)}</p>`))).toBe("composition_size");
    // A script variable named like an attribute is not a reference; prose may say "fetch".
    expect(
      code(goodPage('<p>The dog will fetch the ball.</p><script>const data = "zoom";</script>')),
    ).toBeNull();
  });

  it("checks the frames add up to 6 to 60 seconds with unique ids", () => {
    expect(parseFrames(JSON.stringify(FRAMES)).seconds).toBe(6);
    const code = (value: unknown) => {
      try {
        parseFrames(typeof value === "string" ? value : JSON.stringify(value));
        return null;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(code("not json")).toBe("composition_frames");
    expect(code({ frames: [] })).toBe("composition_frames");
    expect(
      code({
        frames: [
          { id: "a", description: "x", seconds: 3 },
          { id: "a", description: "y", seconds: 3 },
        ],
      }),
    ).toBe("composition_frames");
    expect(code({ frames: [{ id: "a", description: "x", seconds: 61 }] })).toBe(
      "composition_frames",
    );
  });
});
