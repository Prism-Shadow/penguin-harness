/**
 * The payload a preview serves, composed from files on disk.
 *
 * The decisions are unit-tested in `activity-sandbox-configuration`,
 * `activity-sandbox-declaration` and `activity-sandbox-ref-assets`. What this covers is the
 * part that can only go wrong once they are put together: reading the right files, finding
 * the right build, and refusing clearly when there is nothing to serve.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxBuilder } from "../src/activities/sandbox-builder.js";
import { mediaVersion } from "../src/activities/media-origin.js";
import {
  ActivitySandboxService,
  playLinkExpiry,
  PLAY_TOKEN_TTL_MS,
} from "../src/activities/sandbox-service.js";
import { HttpError } from "../src/http/errors.js";

const PROJECT = "proj";
const ACTIVITY = "act_1";

const definition = {
  id: "sightWords",
  schemaVersion: "2.0.0",
  engine: "html",
  require: { entry: { type: "javascript", url: "entry.js" } },
  themes: { park: { assets: {}, properties: { key: "park" } } },
};

const spec = {
  id: "sight-words",
  title: "Sight Words",
  activityDescription: "Practice",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: false,
  },
  scenes: [{ id: "intro", description: "Choose a word" }],
};

interface Built {
  runId: string;
  status: string;
  kind: string;
  createdAt: string;
}

/** A sandbox service with its two dependencies stood in for, over a real temp root. */
async function sandbox(options: {
  runs?: Built[];
  configuration?: unknown;
  manifest?: unknown;
  contentRevision?: string;
  spec?: unknown;
  /** A WAF checkout the service may fall back on; none by default. */
  wafRoot?: string | null;
  /** The product the activity belongs to, for finding its folder in the checkout. */
  moduleFolder?: string | null;
  canonical?: boolean;
  /** An author's edits, as the authoring service would report them for this ref. */
  edits?: Partial<Record<"configuration" | "assessment", { value: unknown; stale: boolean }>>;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sandbox-"));
  const runs = options.runs ?? [
    { runId: "run_new", status: "succeeded", kind: "module", createdAt: "2026-09-02" },
  ];
  for (const run of runs) {
    const moduleDir = path.join(root, "activity-runs", run.runId, "module");
    await fs.mkdir(path.join(moduleDir, "configurations"), { recursive: true });
    await fs.writeFile(
      path.join(moduleDir, "definition.json"),
      JSON.stringify({
        ...definition,
        themes: { park: { assets: {}, properties: { run: run.runId } } },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(moduleDir, "package.json"),
      JSON.stringify({ version: "3.0.0" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(moduleDir, "configurations", "sight-words-1.json"),
      JSON.stringify(options.configuration ?? { sightWords: { intro: "Hello" } }),
      "utf8",
    );
  }

  const activity = {
    id: ACTIVITY,
    collectionId: "col",
    productCode: "sight-words",
    refNum: 1,
    title: "Sight Words 1",
    draft: {
      draftId: "draft_1",
      status: "valid",
      spec: options.spec === undefined ? spec : options.spec,
      contentRevision: options.contentRevision ?? "revision0123456789",
      ...(options.manifest ? { mediaPlan: { manifest: options.manifest } } : {}),
    },
  };

  const service = new ActivitySandboxService();
  Object.assign(service, {
    activities: {
      getActivity: async () => activity,
      isCanonicalRef: () => options.canonical ?? true,
      effectiveModuleDocument: async (_project: string, _activity: unknown, kind: string) =>
        options.edits?.[kind as "configuration"] ?? null,
      productOf: () =>
        options.moduleFolder ? { moduleFolder: options.moduleFolder, canonicalRefNum: 1 } : null,
      draftWorkspace: () => path.join(root, "draft"),
    },
    // The real query returns only succeeded module runs; the service filters them again.
    generation: { list: async () => runs, moduleBuilds: async () => runs },
    config: { root },
    locateWafRoot: async () => options.wafRoot ?? null,
  });
  return { service, root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe("the payload a preview serves", () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function build(options: Parameters<typeof sandbox>[0] = {}) {
    const made = await sandbox(options);
    cleanups.push(made.cleanup);
    return made;
  }

  it("carries the module's declaration, its configuration and the layout", async () => {
    const { service } = await build({});
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.id).toBe("preview:sightWords");
    expect(payload.layout.name).toBe("mainOnly");
    expect(payload.configuration.resolution).toBe("640x480");
    expect(payload.configuration.sightWords).toEqual({ intro: "Hello" });
  });

  it("points the module's own files at a route the preview serves", async () => {
    // A definition names its files relative to itself; left alone they resolve against the
    // harness and fetch nothing.
    const { service } = await build({});
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    const required = payload.layout.compartments.main.require as Record<string, { url: string }>;
    expect(required.entry!.url).toBe(
      `/api/projects/${PROJECT}/activities/${ACTIVITY}/sandbox/module/entry.js`,
    );
  });

  it("serves the newest succeeded build, not the newest build", async () => {
    // A failed build leaves a half-written workspace; serving it would preview code that
    // did not compile.
    const { service } = await build({
      runs: [
        { runId: "run_old", status: "succeeded", kind: "module", createdAt: "2026-09-01" },
        { runId: "run_broken", status: "failed", kind: "module", createdAt: "2026-09-09" },
      ],
    });
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.layout.compartments.main.properties).toEqual({ run: "run_old" });
  });

  it("ignores runs that are not module builds", async () => {
    const { service } = await build({
      runs: [
        { runId: "run_module", status: "succeeded", kind: "module", createdAt: "2026-09-01" },
        { runId: "run_audio", status: "succeeded", kind: "audio", createdAt: "2026-09-09" },
      ],
    });
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.layout.compartments.main.properties).toEqual({ run: "run_module" });
  });

  it("scopes the configuration to the requested language", async () => {
    const { service } = await build({
      configuration: {
        sightWords: { "en-US": { intro: "Hello", outro: "Bye" }, "es-MX": { intro: "Hola" } },
      },
    });
    const payload = await service.payload(PROJECT, ACTIVITY, { languageCode: "es-MX" });
    expect(payload.configuration.sightWords).toEqual({
      "en-US": { intro: "Hello", outro: "Bye" },
      "es-MX": { intro: "Hola", outro: "Bye" },
    });
  });

  it("starts on the scene the preview asked for", async () => {
    const { service } = await build({});
    const payload = await service.payload(PROJECT, ACTIVITY, { startSceneId: "scene-4" });
    expect((payload.configuration.sightWords as Record<string, unknown>).__loomPreview).toEqual({
      startSceneId: "scene-4",
    });
  });

  it("overlays this ref's media, versioned by the file it points at", async () => {
    const { service, root } = await build({
      manifest: {
        assets: {
          "en-US": [
            { key: "intro", type: "audio", path: "media/a.mp3" },
            { key: "outro", type: "audio", path: "media/missing.mp3" },
          ],
        },
      },
    });
    await fs.mkdir(path.join(root, "draft", "media"), { recursive: true });
    await fs.writeFile(path.join(root, "draft", "media", "a.mp3"), "sound", "utf8");
    const stat = await fs.stat(path.join(root, "draft", "media", "a.mp3"));
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    const assets = payload.layout.compartments.main.assets as Record<string, { url: string }>;
    // The token is resolved to where this preview serves media, versioned by the file's own
    // size and time, so a replaced file is a new URL even when the draft did not change.
    expect(assets.intro!.url).toBe(
      `/api/projects/proj/activities/act_1/sandbox/media/a.mp3?v=${mediaVersion(stat)}`,
    );
    // A file that is not there yet has no version to name, so its URL is revalidated.
    expect(assets.outro!.url).toBe("/api/projects/proj/activities/act_1/sandbox/media/missing.mp3");
  });

  it("caches a media URL for good only while its version names the file", async () => {
    const { service, root } = await build({});
    await fs.mkdir(path.join(root, "draft", "media"), { recursive: true });
    await fs.writeFile(path.join(root, "draft", "media", "a.mp3"), "sound", "utf8");
    const stat = await fs.stat(path.join(root, "draft", "media", "a.mp3"));
    const current = await service.media(PROJECT, ACTIVITY, "a.mp3", {
      version: mediaVersion(stat),
    });
    expect(current.headers["Cache-Control"]).toBe("private, max-age=31536000, immutable");
    const stale = await service.media(PROJECT, ACTIVITY, "a.mp3", { version: "old-1" });
    expect(stale.headers["Cache-Control"]).toBe("private, no-cache");
  });

  it("declares the navbar compartment even with nothing in it", async () => {
    // The runtime expects the compartment to exist; an absent one is a different failure
    // from an empty one.
    const { service } = await build({});
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.layout.compartments.navBar).toEqual({ id: "navBar" });
    expect(payload.configuration.navBar).toEqual({});
  });

  it("names the assessment only when the activity uses one", async () => {
    const { service } = await build({});
    expect("assessmentKey" in (await service.payload(PROJECT, ACTIVITY, {}))).toBe(false);

    const withAssessment = await build({
      spec: { ...spec, runtime: { ...spec.runtime, usesAssessment: true } },
    });
    expect((await withAssessment.service.payload(PROJECT, ACTIVITY, {})).assessmentKey).toBe(
      "sightWords",
    );
  });

  it("serves a file the payload's URLs point at", async () => {
    const { service, root } = await build({});
    await fs.writeFile(
      path.join(root, "activity-runs", "run_new", "module", "entry.js"),
      "export const x = 1;",
      "utf8",
    );
    const served = await service.moduleFile(PROJECT, ACTIVITY, "entry.js");
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(served.headers["cache-control"]).toBe("no-store");
    expect(new TextDecoder().decode(served.body)).toBe("export const x = 1;");
  });

  it("reports a module file that is not there", async () => {
    const { service } = await build({});
    await expect(service.moduleFile(PROJECT, ACTIVITY, "missing.js")).rejects.toThrow(
      "No file at missing.js",
    );
  });

  it("refuses a module path that climbs out of the build", async () => {
    const { service } = await build({});
    await expect(service.moduleFile(PROJECT, ACTIVITY, "../../secrets.js")).rejects.toThrow(
      "not a module file",
    );
  });

  it("refuses a module file before checking whether a build exists", async () => {
    // A bad path is a bad path either way, and answering it differently would tell a
    // caller which activities have been built.
    const { service } = await build({ runs: [] });
    await expect(service.moduleFile(PROJECT, ACTIVITY, "build.log")).rejects.toThrow(
      "not a module file",
    );
  });

  it("builds on demand and reports it in an author's words", async () => {
    const { service } = await build({});
    let builds = 0;
    Object.assign(service, {
      builder: new SandboxBuilder({
        build: async () => {
          builds += 1;
          return { ok: true, log: "compiled" };
        },
        sources: async () => [Date.now()],
        now: () => Date.now(),
      }),
    });
    const report = await service.build(PROJECT, ACTIVITY);
    expect(report.ok).toBe(true);
    expect(report.message).toBe("Built.");
    expect(report.log).toBe("compiled");
    expect(builds).toBe(1);
  });

  it("coalesces concurrent requests into one build", async () => {
    // Four scene edits in a row must not start four webpack builds.
    const { service } = await build({});
    let builds = 0;
    let release: (() => void) | null = null;
    Object.assign(service, {
      builder: new SandboxBuilder({
        build: async () => {
          builds += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { ok: true, log: "compiled" };
        },
        sources: async () => [Date.now()],
        now: () => Date.now(),
      }),
    });
    const requests = [1, 2, 3, 4].map(() => service.build(PROJECT, ACTIVITY, true));
    await vi.waitFor(() => expect(release).not.toBeNull());
    release!();
    const reports = await Promise.all(requests);
    expect(builds).toBe(1);
    expect(reports.filter((report) => report.joined)).toHaveLength(3);
  });

  it("reports a failed build as failed, with its output", async () => {
    // Never as a preview that simply never appears.
    const { service } = await build({});
    Object.assign(service, {
      builder: new SandboxBuilder({
        build: async () => ({ ok: false, log: "Module not found: ./missing" }),
        sources: async () => [Date.now()],
        now: () => Date.now(),
      }),
    });
    const report = await service.build(PROJECT, ACTIVITY, true);
    expect(report.ok).toBe(false);
    expect(report.message).toBe("The build failed; see its output.");
    expect(report.log).toContain("Module not found");
  });

  it("refuses to build from a ref that does not own the module", async () => {
    // A build writes into the shared module, and only the canonical ref owns it.
    const { service } = await build({});
    Object.assign(service, {
      activities: {
        ...(service as unknown as { activities: Record<string, unknown> }).activities,
        isCanonicalRef: () => false,
        productOf: () => ({ canonicalRefNum: 4 }),
      },
    });
    await expect(service.build(PROJECT, ACTIVITY)).rejects.toThrow("Build it from that ref");
  });

  it("refuses to build when there is no module workspace", async () => {
    const { service } = await build({ runs: [] });
    await expect(service.build(PROJECT, ACTIVITY)).rejects.toThrow("No module has been built");
  });

  it("refuses when nothing has been built, rather than serving an empty preview", async () => {
    const { service } = await build({ runs: [] });
    await expect(service.payload(PROJECT, ACTIVITY, {})).rejects.toThrow(HttpError);
    await expect(service.payload(PROJECT, ACTIVITY, {})).rejects.toThrow(
      "No module has been built",
    );
  });

  it("refuses when there is no specification", async () => {
    const { service } = await build({ spec: null });
    await expect(service.payload(PROJECT, ACTIVITY, {})).rejects.toThrow(
      "Save a specification before previewing",
    );
  });

  it("refuses a theme the built module does not have, and says which it has", async () => {
    const { service } = await build({
      spec: { ...spec, runtime: { ...spec.runtime, theme: "space" } },
    });
    await expect(service.payload(PROJECT, ACTIVITY, {})).rejects.toThrow('has no theme "space"');
  });

  it("serves an empty configuration when the build has none for this ref", async () => {
    // Reported as an activity with nothing configured, not as a missing build: the module
    // is there and an author can see that its configuration is not.
    const { service, root } = await build({});
    await fs.rm(path.join(root, "activity-runs", "run_new", "module", "configurations"), {
      recursive: true,
      force: true,
    });
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.configuration.sightWords).toEqual({});
  });

  it("sizes each bound asset from the draft's media, then the checkout's", async () => {
    const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];
    const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-waf-"));
    cleanups.push(() => fs.rm(checkout, { recursive: true, force: true }));
    const { service, root } = await build({
      wafRoot: checkout,
      manifest: {
        productCode: "sight-words",
        refNum: 1,
        assets: {
          "en-US": [
            {
              key: "hi",
              type: "audio",
              description: "",
              path: "media/uploads/hi.wav",
              usages: usage,
            },
            {
              key: "cat",
              type: "image",
              description: "",
              path: "media/images/cat.png",
              usages: usage,
            },
            {
              key: "gone",
              type: "image",
              description: "",
              path: "media/images/gone.png",
              usages: usage,
            },
            { key: "bye", type: "audio", description: "", usages: usage },
          ],
        },
      },
    });
    await fs.mkdir(path.join(root, "draft", "media", "uploads"), { recursive: true });
    await fs.writeFile(path.join(root, "draft", "media", "uploads", "hi.wav"), Buffer.alloc(120));
    await fs.mkdir(path.join(checkout, "media", "images"), { recursive: true });
    await fs.writeFile(path.join(checkout, "media", "images", "cat.png"), Buffer.alloc(30));
    expect(await service.mediaStats(PROJECT, ACTIVITY)).toEqual([
      {
        language: "en-US",
        key: "hi",
        type: "audio",
        bound: true,
        bytes: 120,
        mimeType: "audio/wav",
      },
      {
        language: "en-US",
        key: "cat",
        type: "image",
        bound: true,
        bytes: 30,
        mimeType: "image/png",
      },
      {
        language: "en-US",
        key: "gone",
        type: "image",
        bound: true,
        bytes: null,
        mimeType: "image/png",
      },
      { language: "en-US", key: "bye", type: "audio", bound: false, bytes: null, mimeType: null },
    ]);
  });

  it("reads the module's configuration file for this ref, and says where from", async () => {
    const { service } = await build({ configuration: { rounds: 3 } });
    expect(await service.moduleDocuments(PROJECT, ACTIVITY)).toEqual({
      source: "run",
      configuration: {
        file: "configurations/sight-words-1.json",
        value: { rounds: 3 },
        edited: false,
        stale: false,
        editable: true,
      },
      assessment: null,
      canonicalRefNum: null,
    });
    const { service: none } = await build({ runs: [] });
    expect(await none.moduleDocuments(PROJECT, ACTIVITY)).toEqual({
      source: null,
      configuration: null,
      assessment: null,
      canonicalRefNum: null,
    });
  });

  it("puts an author's edit before the module's own document, and says so", async () => {
    const { service } = await build({
      configuration: { rounds: 3 },
      edits: { configuration: { value: { rounds: 5 }, stale: true } },
    });
    const documents = await service.moduleDocuments(PROJECT, ACTIVITY, false);
    expect(documents.configuration).toEqual({
      file: "configurations/sight-words-1.json",
      value: { rounds: 5 },
      edited: true,
      stale: true,
      editable: false,
    });
    // With no module yet, the edit is still there to read, from the draft.
    const { service: unbuilt } = await build({
      runs: [],
      edits: { assessment: { value: { items: [] }, stale: false } },
    });
    const early = await unbuilt.moduleDocuments(PROJECT, ACTIVITY);
    expect(early.source).toBe("draft");
    expect(early.configuration).toBeNull();
    expect(early.assessment).toMatchObject({
      file: "assessments/sight-words-1.json",
      edited: true,
      editable: true,
    });
  });

  it("does not offer the shared assessment for editing on a ref that is not canonical", async () => {
    const { service } = await build({
      canonical: false,
      moduleFolder: "waf-module-sight-words",
      edits: { assessment: { value: { items: [{ title: "q" }] }, stale: false } },
    });
    const documents = await service.moduleDocuments(PROJECT, ACTIVITY);
    expect(documents.assessment).toMatchObject({ edited: true, editable: false });
    expect(documents.configuration).toMatchObject({ edited: false, editable: true });
    expect(documents.canonicalRefNum).toBe(1);
  });

  it("serves an edited configuration in the payload", async () => {
    const { service } = await build({
      edits: { configuration: { value: { sightWords: { intro: "Edited" } }, stale: false } },
    });
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.configuration.sightWords).toEqual({ intro: "Edited" });
  });
});

describe("a play link's expiry", () => {
  const hour = 60 * 60 * 1000;

  it("never lasts less than the full lifetime", () => {
    for (const now of [0, 1, hour - 1, hour, 1_790_000_123_456])
      expect(playLinkExpiry(now) - now).toBeGreaterThanOrEqual(PLAY_TOKEN_TTL_MS);
  });

  it("is the same within the hour, so a reload reuses the cached media", () => {
    const start = 1_790_000_000_000 - (1_790_000_000_000 % hour) + 1;
    expect(playLinkExpiry(start)).toBe(playLinkExpiry(start + hour - 2));
    expect(playLinkExpiry(start + hour)).toBe(playLinkExpiry(start) + hour);
  });
});
