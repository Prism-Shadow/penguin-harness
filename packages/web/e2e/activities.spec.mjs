import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exercises the built React app with deterministic HTTP fixtures. No listening server
// or real credentials: this can run alongside someone's existing dev instance.
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const origin = "http://localhost:57321";
const projectId = "author-activities";
const base = `/api/projects/${projectId}/activities`;
/** A one-pixel PNG, small enough to hand straight to a file input. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);

const spec = {
  id: "words",
  title: "Sight words",
  activityDescription: "Practice words",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: false,
  },
  scenes: [{ id: "intro", description: "Choose a word" }],
};

async function fixture(page) {
  let activity = null;
  let runs = [];
  let revision = 0;
  let role = "owner";
  let historyReads = 0;
  let candidateReads = 0;
  let firstCandidateGate = Promise.resolve();
  let failCandidate = false;
  let projectAvailable = true;
  let failedHistoryReads = 0;
  let activityRequests = 0;
  let deletedProjects = 0;
  const prefsWrites = [];
  const imageRequests = [];
  let imageFailure = false;
  // Media the activity workspace holds, as the upload routes would report it.
  const uploads = [];
  const audioRequests = [];
  let imageCandidateReads = 0;
  let imageCandidateFailure = false;
  let imageGenerationFailure = false;
  let mediaTextCandidateReads = 0;
  const assembleRequests = [];
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const p = url.pathname;
    if (p.startsWith(base)) activityRequests++;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    // One stable data root, so the install-scope sweep keeps what a test seeds.
    if (p === "/api/install") return json({ installId: "install_e2e" });
    if (p === "/api/me")
      return json({
        user: { userId: "author", isAdmin: false, passwordIsInitial: false },
        previewIsolated: true,
        desktopMode: false,
        companyMode: false,
        sessionVia: "password",
        uploadLimits: {
          attachmentMaxMb: 100,
          attachmentTotalMb: 120,
          attachmentMaxCount: 20,
          imageMaxMb: 20,
          attachmentLimitMinMb: 1,
          attachmentLimitMaxMb: 200,
        },
      });
    if (p === "/api/me/prefs") {
      if (request.method() === "PUT") prefsWrites.push(request.postDataJSON());
      return json({ prefs: {} });
    }
    if (p === "/api/projects")
      return json({
        projects: [
          {
            projectId,
            name: "Activities test",
            role,
            ownerUserId: "author",
            createdAt: "2026-09-19",
          },
          {
            projectId: "second-project",
            name: "Second project",
            role: "owner",
            ownerUserId: "author",
            createdAt: "2026-09-19",
          },
        ].filter((project) => projectAvailable || project.projectId !== projectId),
      });
    if (p === `/api/projects/${projectId}` && request.method() === "DELETE") {
      deletedProjects++;
      projectAvailable = false;
      return route.fulfill({ status: 204 });
    }
    if (p === `/api/projects/${projectId}` && request.method() === "PATCH") return json({});
    if (p === `/api/projects/${projectId}/agents` || p === "/api/projects/second-project/agents")
      return json({
        agents: [
          {
            agentId: "default_agent",
            name: "Default agent",
            pluginUpdates: [],
            activeSessionCount: 0,
            sessionCount: 0,
            sessionActivity: [],
            toolCount: 0,
            version: 1,
            kernelOutdated: false,
            vaultKeyCount: 0,
            scheduleCount: 0,
            skillCount: 0,
            hookCount: 0,
            memoryCount: 0,
          },
        ],
      });
    if (p === base && request.method() === "GET") {
      const activities = activity ? [activity] : [];
      if (url.searchParams.get("summary") !== "1") return json({ activities });
      // A fixed "next spec" summary per activity: nothing here computes the real facts, and
      // no test in this file reads the home page's status text off the default fixture.
      const summaries = Object.fromEntries(
        activities.map((entry) => [
          entry.id,
          {
            canonical: true,
            hasPlan: false,
            done: 0,
            total: 3,
            status: { kind: "next", milestone: "spec" },
          },
        ]),
      );
      return json({ activities, summaries });
    }
    if (p === `${base}/speech-setup`) return json({ voices: ["Kore", "Puck"] });
    if (p === `${base}/act_test/media-uploads`) {
      if (request.method() === "POST") {
        const input = request.postDataJSON();
        const stored = {
          path: `media/loom/words/words-1/uploads/${input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-[^-]*$/, "")}-1234abcd.png`,
          name: `${input.name}`,
          kind: "image",
          mimeType: "image/png",
          byteLength: Buffer.from(input.dataBase64, "base64").byteLength,
          sha256: "a".repeat(64),
          updatedAt: "2026-09-21T10:00:00.000Z",
        };
        uploads.push(stored);
        return json(stored, 201);
      }
      return json({ media: uploads });
    }
    if (p === `${base}/act_test/media-upload`) {
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (p === `${base}/act_test/media-image`) {
      imageRequests.push(Object.fromEntries(url.searchParams));
      if (imageFailure)
        return json({ error: { code: "image_unavailable", message: "Missing image" } }, 404);
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (p === base && request.method() === "POST") {
      const input = request.postDataJSON();
      activity = {
        ...input,
        id: "act_test",
        collectionId: "col_test",
        createdAt: "2026-09-19",
        updatedAt: "2026-09-19",
        archived: false,
        draft: {
          draftId: "draft_test",
          activityId: "act_test",
          baseVersionId: null,
          contentRevision: String(++revision),
          status: "draft",
          description: "",
          spec: null,
          updatedAt: "2026-09-19",
        },
      };
      return json(activity, 201);
    }
    if (p === `${base}/act_test`) return json(activity);
    if (p === `${base}/act_test/runs`) {
      historyReads++;
      if (failedHistoryReads > 0) {
        failedHistoryReads--;
        return json({ error: { code: "internal", message: "Temporary history failure." } }, 503);
      }
      return json({
        runs: runs.map(({ candidate, ...run }) => ({ ...run, hasCandidate: candidate !== null })),
      });
    }
    if (p.startsWith(`${base}/act_test/runs/`) && p.endsWith("/candidate")) {
      candidateReads++;
      mediaTextCandidateReads += runs.some(
        (run) => p.includes(`/${run.runId}/`) && run.kind === "media-text",
      )
        ? 1
        : 0;
      if (p.includes("/run_test/")) await firstCandidateGate;
      if (failCandidate && p.includes("/run_second/")) {
        failCandidate = false;
        return json(
          { error: { code: "unavailable", message: "Candidate temporarily unavailable." } },
          503,
        );
      }
      return json({
        candidate: runs.find((run) => p.includes(`/${run.runId}/`))?.candidate ?? null,
      });
    }
    if (p.startsWith(`${base}/act_test/runs/`) && p.endsWith("/image")) {
      imageCandidateReads++;
      if (imageCandidateFailure) {
        imageCandidateFailure = false;
        return json(
          { error: { code: "unavailable", message: "Candidate temporarily unavailable." } },
          503,
        );
      }
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (p === "/api/projects/second-project/activities") return json({ activities: [] });
    if (p.startsWith("/api/projects/second-project/activities/"))
      return json({ error: { code: "activity_not_found", message: "Activity not found." } }, 404);
    if (p === `${base}/act_test/description`) {
      const body = request.postDataJSON();
      if (body.expectedRevision !== activity.draft.contentRevision)
        return json(
          {
            error: {
              code: "draft_conflict",
              message: "Draft changed. Reload it before applying your edit.",
            },
          },
          409,
        );
      activity.draft = {
        ...activity.draft,
        description: body.description,
        contentRevision: String(++revision),
        status: "draft",
      };
      return json(activity.draft);
    }
    if (p === `${base}/act_test/pipeline` && request.method() === "GET")
      return json({ pipeline: null });
    if (
      p === `${base}/act_test/generate-spec` ||
      p === `${base}/act_test/assemble-module` ||
      (p === `${base}/act_test/pipeline` && request.method() === "POST")
    ) {
      if (p.endsWith("/assemble-module")) assembleRequests.push(request.postDataJSON());
      runs.unshift({
        kind: p.endsWith("/assemble-module") ? "module" : "spec",
        inputRevision: activity.draft.contentRevision,
        runId: "run_test",
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      if (p.endsWith("/pipeline"))
        return json(
          {
            pipelineId: "pipeline_spec",
            projectId,
            activityId: activity.id,
            selection: "spec",
            status: "running",
            steps: [
              {
                step: "spec",
                status: "running",
                detail: null,
                note: null,
                done: 0,
                total: 0,
                runIds: ["run_test"],
              },
            ],
            currentRunId: "run_test",
            currentSessionId: null,
            error: null,
            startedAt: "2026-09-19T10:00:00Z",
            finishedAt: null,
          },
          202,
        );
      return json(runs[0], 202);
    }
    if (p === `${base}/act_test/generate-audio`) {
      const body = request.postDataJSON();
      // The real server refuses a second concurrent generation for one activity.
      if (runs.some((run) => run.status === "running"))
        return json(
          {
            error: {
              code: "generation_running",
              message: "This activity already has a running generation.",
            },
          },
          409,
        );
      audioRequests.push({ assetKey: body.assetKey, language: body.language, voice: body.voice });
      runs.unshift({
        kind: "audio",
        audio: {
          language: body.language,
          assetKey: body.assetKey,
          voice: body.voice,
          script: "Hello",
        },
        runId: `run_audio_${runs.length}`,
        inputRevision: activity.draft.contentRevision,
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p === `${base}/act_test/generate-image`) {
      if (imageGenerationFailure) {
        imageGenerationFailure = false;
        return json({ error: { code: "unavailable", message: "Image generation failed." } }, 503);
      }
      const body = request.postDataJSON();
      runs.unshift({
        kind: "image",
        image: {
          language: body.language,
          assetKey: body.assetKey,
          prompt: body.prompt,
          model: body.model,
        },
        runId: `run_image_${runs.length}`,
        inputRevision: activity.draft.contentRevision,
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p === `${base}/act_test/generate-media-text`) {
      const body = request.postDataJSON();
      const asset = activity.draft.mediaPlan.manifest.assets[body.language].find(
        (candidate) => candidate.key === body.assetKey,
      );
      runs.unshift({
        kind: "media-text",
        mediaText: {
          language: body.language,
          assetKey: body.assetKey,
          type: asset.type,
          text: asset.type === "audio" ? asset.script : asset.description,
        },
        runId: `run_media_text_${runs.length}`,
        inputRevision: activity.draft.contentRevision,
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p.endsWith("/accept-audio")) {
      const run = runs.find((run) => p.includes(`/${run.runId}/`));
      // The take's own language and key, as the server binds it.
      const asset = activity.draft.mediaPlan.manifest.assets[run.audio.language].find(
        (candidate) => candidate.key === run.audio.assetKey,
      );
      asset.path = `media/generated/${run.runId}.wav`;
      asset.generatedAudio = { runId: run.runId, sha256: "test" };
      activity.draft.contentRevision = String(++revision);
      return json(activity.draft);
    }
    if (p.endsWith("/accept-image")) {
      const run = runs.find((candidate) => p.includes(`/${candidate.runId}/`));
      const asset = activity.draft.mediaPlan.manifest.assets[run.image.language].find(
        (candidate) => candidate.key === run.image.assetKey,
      );
      asset.path = `media/generated/${run.runId}.png`;
      asset.generatedImage = { runId: run.runId, sha256: "test-image" };
      activity.draft.contentRevision = String(++revision);
      return json(activity.draft);
    }
    if (p.endsWith("/accept-media-text")) {
      const body = request.postDataJSON();
      const run = runs.find((candidate) => p.includes(`/${candidate.runId}/`));
      if (body.expectedRevision !== activity.draft.contentRevision)
        return json(
          { error: { code: "draft_conflict", message: "Draft changed. Reload it first." } },
          409,
        );
      const suggestion = JSON.parse(run.candidate);
      const asset = activity.draft.mediaPlan.manifest.assets[suggestion.language].find(
        (candidate) => candidate.key === suggestion.assetKey,
      );
      if (suggestion.type === "audio") asset.script = suggestion.text;
      else asset.description = suggestion.text;
      activity.draft.contentRevision = String(++revision);
      return json(activity.draft);
    }
    if (p === `${base}/act_test/apply-generated-spec`) {
      const body = request.postDataJSON();
      activity.draft = {
        ...activity.draft,
        spec: body.spec,
        contentRevision: String(++revision),
        status: "valid",
      };
      return json(activity.draft);
    }
    if (p === `${base}/act_test/plan-media` || p === `${base}/act_test/media`) {
      const body = request.postDataJSON();
      if (body.expectedRevision !== activity.draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      activity.draft = {
        ...activity.draft,
        contentRevision: String(++revision),
        mediaPlan: {
          specRevision: "spec-revision",
          manifest: body.manifest ?? {
            productCode: "words",
            refNum: 12,
            assets: {
              "en-US": [
                {
                  key: "cat",
                  type: "image",
                  description: "A cat",
                  usages: [
                    { sceneId: "intro", sourceKey: "cat", occurrence: 1, sceneOccurrenceCount: 1 },
                  ],
                },
              ],
            },
          },
        },
      };
      return json(activity.draft);
    }
    if (p === `${base}/language-setup`)
      return json({
        defaultLanguage: "en-US",
        languages: [
          { code: "en-US", label: "English" },
          { code: "es-MX", label: "Spanish" },
        ],
      });
    if (p.startsWith("/api/")) {
      if (p.endsWith("/usage/errors")) return json({ items: [], total: 0 });
      if (p.endsWith("/sessions"))
        return json({
          sessions: [],
          counts: { active: 0, archived: 0, schedule: 0, benchmark: 0 },
        });
      if (p.endsWith("/organizations")) return json({ organizations: [] });
      if (p.endsWith("/models")) return json({ models: [] });
      if (p.endsWith("/events"))
        return route.fulfill({ contentType: "text/event-stream", body: "" });
      return json({});
    }
    const asset = p.startsWith("/assets/")
      ? path.join(dist, p.slice(1))
      : path.join(dist, "index.html");
    const contentType = asset.endsWith(".js")
      ? "application/javascript"
      : asset.endsWith(".css")
        ? "text/css"
        : asset.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
    return route.fulfill({ contentType, body: await fs.readFile(asset) });
  });
  return {
    completeAudio() {
      runs[0].status = "succeeded";
      runs[0].candidate = "{}";
    },
    completeImage() {
      runs[0].status = "succeeded";
      runs[0].candidate = "image";
    },
    completeMediaText(text) {
      runs[0].status = "succeeded";
      runs[0].candidate = JSON.stringify({ ...runs[0].mediaText, text });
    },
    errors,
    audioRequests,
    finishAudio() {
      for (const run of runs)
        if (run.kind === "audio" && run.status === "running") run.status = "succeeded";
    },
    imageRequests,
    setImageFailure(value) {
      imageFailure = value;
    },
    prefsWrites,
    removeProject() {
      projectAvailable = false;
    },
    failHistory() {
      failedHistoryReads++;
    },
    changeSavedDescription() {
      activity.draft.description = "Remote description";
      activity.draft.contentRevision = String(++revision);
    },
    get activityRequests() {
      return activityRequests;
    },
    get deletedProjects() {
      return deletedProjects;
    },
    get historyReads() {
      return historyReads;
    },
    get candidateReads() {
      return candidateReads;
    },
    get imageCandidateReads() {
      return imageCandidateReads;
    },
    get mediaTextCandidateReads() {
      return mediaTextCandidateReads;
    },
    assembleRequests,
    failImageCandidate() {
      imageCandidateFailure = true;
    },
    failImageGeneration() {
      imageGenerationFailure = true;
    },
    conflictMediaText(text) {
      runs[0].status = "conflict";
      runs[0].candidate = JSON.stringify({ ...runs[0].mediaText, text });
      activity.draft.contentRevision = String(++revision);
    },
    secondCandidate() {
      runs.push({
        ...runs[0],
        runId: "run_second",
        candidate: JSON.stringify({ ...spec, title: "Second candidate" }),
      });
    },
    holdFirstCandidate() {
      let release;
      firstCandidateGate = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    failSecondCandidate() {
      failCandidate = true;
    },
    complete() {
      if (runs[0].kind === "module") {
        runs[0] = {
          ...runs[0],
          status: "succeeded",
          candidate: JSON.stringify({ previewPath: "preview/index.html", files: [] }),
        };
        return;
      }
      runs[0] = { ...runs[0], status: "succeeded", candidate: JSON.stringify(spec) };
      activity.draft = {
        ...activity.draft,
        spec,
        status: "valid",
        contentRevision: String(++revision),
      };
    },
    conflict() {
      runs[0] = {
        ...runs[0],
        status: "conflict",
        candidate: JSON.stringify(spec),
        error: "Draft changed. Reload it before applying your edit.",
      };
      activity.draft.description = "Changed in another tab";
      activity.draft.contentRevision = String(++revision);
    },
    member() {
      role = "member";
    },
  };
}

/**
 * The activity editor is a workspace: its parts live behind a rail rather than stacked
 * down one page, so a test opens the part it is about before touching it.
 */
/** The workspace's sections, under the names the Loom-style hierarchy gives them. */
const TREE_NAMES = {
  Description: "Activity Script",
  Specification: "Activity Spec",
  "Scenes and media": "Scenes",
  "Speech coverage": "Audios",
  "Media library": "Media Library",
  "Module definition": "Module Definition",
  "Generation history": "Generation History",
};

/**
 * Opens one of the right rail's panels (Stages, Player, Tests, Quality, ...), leaving it open
 * when it already is: its tab toggles.
 */
/** A rail panel's chip, whose name may carry its badge after a comma ("Tests , 2 failed"). */
function panelTab(page, name) {
  return page
    .getByRole("group", { name: "Activity panels", exact: true })
    .getByRole("button", { name: new RegExp(`^${name}( ?,|$)`) });
}

async function openPanel(page, name) {
  const tab = panelTab(page, name);
  // The tab's state, not the panel's, decides: a remembered panel may not have drawn yet.
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  const panel = page.getByRole("complementary", { name, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** The ref's menu, which opens on the ref's name beside the activity's title. */
function refMenu(page) {
  return page.locator('nav[aria-label="Breadcrumb"] button[aria-haspopup="menu"]');
}

/** Runs one of the ref's actions from its menu. */
async function refAction(page, name) {
  await refMenu(page).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function generateSpecification(page) {
  const panel = await openPanel(page, "Stages");
  await panel.getByRole("button", { name: "Stage", exact: true }).click();
  await page.getByRole("option", { name: "Generate spec", exact: true }).click();
  await panel.getByRole("button", { name: "Run", exact: true }).click();
}

/** Closes a rail panel and opens it again, so what it shows is read afresh. */
async function reopenPanel(page, name) {
  const tab = panelTab(page, name);
  if ((await tab.getAttribute("aria-pressed")) === "true") await tab.click();
  await expect(page.getByRole("complementary", { name, exact: true })).toHaveCount(0);
  return openPanel(page, name);
}

async function openSection(page, name) {
  // Level 1: Loom's hierarchy repeats "Audios" as a group inside every scene.
  const button = page.getByRole("treeitem", {
    name: TREE_NAMES[name] ?? name,
    exact: true,
    level: 1,
  });
  // On a workspace too narrow for both panes the rail is shut over the work, so its
  // sections are not on the page until it is opened. Wait for one or the other, since
  // an absent button also means the page has not rendered the rail yet.
  const expand = page.getByRole("button", { name: "Expand the activity rail", exact: true });
  await expect(button.or(expand).first()).toBeVisible();
  const opened = !(await button.count());
  // Entering the workspace can paint it narrow and then widen it as the sidebar folds, so
  // an Expand clicked mid-change can land on the rail beside the work and fold it instead.
  // Keep opening until the section is there.
  if (opened)
    await expect(async () => {
      if (!(await button.count())) await expand.click();
      await expect(button).toBeVisible({ timeout: 1_000 });
    }).toPass();
  // Clicking the section already showing re-renders the rail under the click, but a rail
  // opened just now is covering the work and has to be dismissed by choosing anyway.
  if (opened || (await button.getAttribute("aria-current")) !== "true") await button.click();
  // Scenes opens on the storyboard once there is a media plan; the media itself is one
  // step further, which is where these tests work.
  if (name === "Scenes and media") {
    const board = page.getByRole("heading", { name: "Storyboard", exact: true });
    await expect(
      board.or(page.getByRole("heading", { name: /^Media plan/ })).first(),
    ).toBeVisible();
    if (await board.count())
      await page.getByRole("button", { name: "Edit media", exact: true }).click();
  }
}

/** Plan media from the Scenes section, then step from the storyboard into the media. */
async function planMedia(page) {
  await page.getByRole("button", { name: "Plan media", exact: true }).click();
  await page.getByRole("button", { name: "Edit media", exact: true }).click();
}

/** Switching sections unmounts the pane, so its disclosures reopen each time. */
async function openManifest(page) {
  await openSection(page, "Media library");
  const summary = page.getByText("Advanced: asset manifest JSON", { exact: true });
  // The disclosure keeps its state across sections, so only open it when it is shut.
  if (
    !(await page
      .locator("details", { has: summary })
      .first()
      .evaluate((d) => d.open))
  )
    await summary.click();
}

/** Edits made in the scene's asset editor save themselves a moment later; wait for that. */
async function mediaAutosaved(page) {
  await expect(
    page.getByRole("region", { name: "Scene assets", exact: true }).getByRole("status"),
  ).toHaveText("Saved");
}

async function create(page, { activityType = "standard", readingMode = "Decodable" } = {}) {
  await page.goto(`${origin}/activities`);
  // Creation lives behind the landing's action, not inline on the page.
  await page.getByRole("button", { name: "New activity", exact: true }).click();
  await page.getByRole("textbox", { name: "Product code", exact: true }).fill("words");
  await page.getByRole("spinbutton", { name: "Reference number", exact: true }).fill("12");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Sight words");
  if (activityType === "book") {
    await page.getByRole("button", { name: "Activity type", exact: true }).click();
    await page.getByRole("option", { name: "Book", exact: true }).click();
    // A book is not created until its reading mode is chosen.
    await expect(page.getByRole("button", { name: "Create activity", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Reading mode", exact: true }).click();
    await page.getByRole("option", { name: readingMode, exact: true }).click();
  }
  const created = page.waitForRequest(
    (request) => request.url().endsWith("/activities") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Create activity", exact: true }).click();
  const body = (await created).postDataJSON();
  if (activityType === "book")
    expect(body.bookMode).toBe(readingMode === "Decodable" ? "decodable" : "readAlong");
  else expect(body).not.toHaveProperty("bookMode");
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page
    .getByRole("textbox", { name: "Activity Script", exact: true })
    .fill("Practice common sight words");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save script", exact: true })).toBeDisabled();
  await openSection(page, "Specification");
}

test("plans media, preserves unsaved bindings on navigation, and saves paths for assembly", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const plan = page.getByRole("button", { name: "Plan media", exact: true });
  await openSection(page, "Scenes and media");
  await expect(plan).toBeDisabled();
  const withMedia = {
    ...spec,
    scenes: [
      {
        id: "intro",
        description: "Look",
        media: { images: [{ key: "cat", description: "A cat" }] },
      },
    ],
  };
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(withMedia));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await plan.click();
  await openManifest(page);
  const editor = page.getByRole("textbox", { name: /^Asset manifest/ });
  await expect(editor).toBeVisible();
  await expect(page.getByText(/1 assets, 0 paths assigned, 1 unbound/)).toBeVisible();
  const manifest = JSON.parse(await editor.inputValue());
  manifest.assets["en-US"][0].path = "media/images/cat.png";
  await editor.fill(JSON.stringify(manifest));
  await refAction(page, "Reload draft");
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await openSection(page, "Media library");
  await expect(editor).toHaveValue(JSON.stringify(manifest));
  const request = page.waitForRequest(
    (request) => request.url().endsWith("/media") && request.method() === "PUT",
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  expect((await request).postDataJSON().manifest).toEqual(manifest);
  await page.reload();
  await openManifest(page);
  await expect(editor).toHaveValue(JSON.stringify(manifest, null, 2));
  await expect(page.getByText(/1 assets, 1 paths assigned, 0 unbound/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("reviews specification edits against the saved specification before saving", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const editor = page.getByRole("textbox", { name: "Specification JSON", exact: true });
  await openSection(page, "Specification");
  await editor.fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();

  // Nothing edited yet, so there is nothing to review or save.
  const save = page.getByRole("button", { name: "Save Spec", exact: true });
  await expect(save).toBeDisabled();
  const diff = page.getByRole("button", { name: "Diff", exact: true });
  await diff.click();
  await expect(page.getByText("No changes", { exact: true })).toBeVisible();
  // The diff folds unchanged lines away; edits go in with it shut.
  await diff.click();

  const edited = {
    ...spec,
    title: "Sight words, revised",
    scenes: [
      { id: "intro", description: "Choose a different word" },
      { id: "quiz", description: "Answer" },
    ],
  };
  await editor.fill(JSON.stringify(edited, null, 2));
  await expect(save).toBeEnabled();
  await expect(diff).toHaveAttribute("title", /^Unsaved changes/);

  // Loom's diff toolbar: counts with regions, previous and next, and an overview.
  await diff.click();
  const toolbar = page.getByRole("toolbar", { name: "Diff controls", exact: true });
  await expect(toolbar.getByText(/^\+\d+ −\d+ · \d+ regions?$/)).toBeVisible();
  await expect(toolbar.getByText(/^– \/ \d+$/)).toBeVisible();
  await toolbar.getByRole("button", { name: "Go to the next change", exact: true }).click();
  await expect(toolbar.getByText(/^1 \/ \d+$/)).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Change overview", exact: true }).getByRole("button").first(),
  ).toBeVisible();

  // Side by side shows the saved text next to the edit, and the choice is remembered.
  await toolbar.getByRole("button", { name: "Side by side", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Saved specification", exact: true }),
  ).toBeVisible();
  await page.reload();
  await openSection(page, "Specification");
  await expect(save).toBeDisabled();
  await editor.fill(JSON.stringify(edited, null, 2));
  await diff.click();
  await expect(toolbar.getByRole("button", { name: "Inline", exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "Inline", exact: true }).click();

  // Revert all puts the saved specification back.
  await toolbar.getByRole("button", { name: "Revert all", exact: true }).click();
  await expect(toolbar.getByText("No changes", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await diff.click();

  // Text that is not a JSON object cannot be saved, and says why.
  await editor.fill("{ not json");
  await expect(page.getByText(/^This is not valid JSON/)).toBeVisible();
  await expect(save).toBeDisabled();
  expect(f.errors).toEqual([]);
});

test("reports speech coverage and generates every missing narration at once", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  // Three narrations: one already bound, one ready to generate, one still without a script.
  // Gemini's, which this fixture's speech setup lists voices for.
  const narration = (key, extra) => ({
    key,
    type: "audio",
    speechProvider: "gemini",
    description: `${key} line`,
    usages: [{ sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
    ...extra,
  });
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          narration("greeting", { script: "Hello there", path: "media/audio/greeting.wav" }),
          narration("welcome", { script: "Welcome along" }),
          narration("prompt", { script: "Pick a word" }),
          narration("silent", {}),
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();

  await openSection(page, "Speech coverage");
  await expect(page.getByText("1 of 4 narrations bound")).toBeVisible();
  await expect(page.getByText("2 can be generated now")).toBeVisible();
  await expect(page.getByText(/1 need a script of 1.5000 characters first/)).toBeVisible();

  // The button names the same count the summary does, and asks before spending runs.
  await page.getByRole("button", { name: "Generate 2 missing", exact: true }).click();
  await expect(page.getByText(/Start 2 speech runs for en-US/)).toBeVisible();
  await page.getByRole("button", { name: "Generate 2 missing", exact: true }).last().click();

  // The server runs one generation per activity, so the queue waits rather than
  // firing both at once and having the second refused.
  await expect(page.getByText(/1 narration queued/)).toBeVisible();
  expect(f.audioRequests.map((request) => request.assetKey)).toEqual(["welcome"]);
  expect(f.audioRequests.every((request) => request.language === "en-US")).toBe(true);
  expect(f.audioRequests.every((request) => request.voice === "Kore")).toBe(true);

  // Once the first run finishes, the next narration is asked for.
  f.finishAudio();
  await expect
    .poll(() => f.audioRequests.map((request) => request.assetKey))
    .toEqual(["welcome", "prompt"]);
  await expect(page.getByRole("button", { name: "Stop queue", exact: true })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("chooses a narration's voice from the picker and applies one voice to every narration", async ({
  page,
}) => {
  const f = await fixture(page);
  const model = "gemini-3.1-flash-tts-preview";
  const catalogue = [
    ["Kore", "Firm"],
    ["Puck", "Upbeat"],
    ["Charon", "Informative"],
    ["Fenrir", "Excitable"],
    ["Aoede", "Breezy"],
  ].map(([id, description]) => ({
    id,
    label: id,
    provider: "Gemini",
    model,
    languages: [],
    previewUrl: null,
    description,
  }));
  const saved = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/speech-setup`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          provider: "Gemini",
          model,
          voices: catalogue.map((option) => option.id),
          catalogue,
          vaultKey: "GEMINI_API_KEY",
        }),
      });
    if (p === `${base}/act_test/media` && request.method() === "PUT")
      saved.push(request.postDataJSON().manifest);
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  const usages = (key) => [
    { sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 },
  ];
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          // Gemini's: the catalogue above is Gemini's alone.
          {
            key: "welcome",
            type: "audio",
            speechProvider: "gemini",
            description: "Greeting",
            script: "Hello",
            usages: usages("welcome"),
          },
          {
            key: "prompt",
            type: "audio",
            speechProvider: "gemini",
            description: "Prompt",
            script: "Pick one",
            usages: usages("prompt"),
          },
          {
            key: "theme",
            type: "audio",
            description: "Theme",
            kind: "music",
            channel: "music",
            loop: true,
            volume: 0.5,
            usages: usages("theme"),
          },
          { key: "cat", type: "image", description: "A cat", usages: usages("cat") },
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();

  // No narration names a voice yet, so the picker shows the one bulk speech would use.
  await openSection(page, "Speech coverage");
  const everyVoice = page.getByRole("button", { name: /^Voice for every narration: / });
  await expect(everyVoice).toHaveAccessibleName("Voice for every narration: Kore");
  await everyVoice.click();
  const panel = page.getByRole("dialog", { name: "Voice for every narration" });
  await expect(panel.getByText("5 voices", { exact: true })).toBeVisible();
  // One provider and one model: nothing to filter by, and no sample to play.
  await expect(panel.getByRole("button", { name: "Provider" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Preview/ })).toHaveCount(0);
  await panel.getByRole("searchbox", { name: "Search name or ID" }).fill("fen");
  await expect(panel.getByText("1 voice", { exact: true })).toBeVisible();
  await expect(panel.getByRole("option")).toHaveCount(1);
  await expect(panel.getByText("ID: Fenrir", { exact: true })).toBeVisible();
  await panel.getByRole("option", { name: /^Fenrir/ }).click();
  await expect(page.getByText("Voice set on 2 narrations.", { exact: true })).toBeVisible();
  await expect(everyVoice).toHaveAccessibleName("Voice for every narration: Fenrir");
  const applied = saved.at(-1).assets["en-US"];
  expect(Object.fromEntries(applied.map((asset) => [asset.key, asset.voice ?? null]))).toEqual({
    welcome: "Fenrir",
    prompt: "Fenrir",
    theme: null,
    cat: null,
  });

  // One narration gets a voice of its own, saved with the manifest and spoken with.
  await page.getByRole("button", { name: /^welcome/ }).click();
  const own = page.getByRole("button", { name: /^Voice: / });
  await expect(own).toHaveAccessibleName("Voice: Fenrir");
  // The trigger sits below the fold; bring it into view and let the scroll settle first,
  // since a scroll of the pane holding it closes the panel, as it does every menu's.
  await own.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await own.click();
  await page.getByRole("dialog", { name: "Voice" }).getByRole("option", { name: /^Puck/ }).click();
  await expect(own).toHaveAccessibleName("Voice: Puck");
  // The pick saves itself, without the save button.
  await expect.poll(() => saved.at(-1).assets["en-US"][0].voice).toBe("Puck");
  await page.getByRole("button", { name: "Generate audio", exact: true }).click();
  await expect.poll(() => f.audioRequests.at(-1)?.voice).toBe("Puck");
  f.completeAudio();

  await openSection(page, "Speech coverage");
  await expect(everyVoice).toHaveAccessibleName("Voice for every narration: Multiple voices");
  expect(f.errors).toEqual([]);
});

test("uploads media into the ref's uploads and binds it from the library", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  const binding = page.getByRole("textbox", { name: /^Media path/ });
  await expect(binding).toHaveValue("");
  await openSection(page, "Description");
  await expect(page.getByText("Read from the WAF checkout.")).toHaveCount(0);

  // Uploading binds the asset to the stored reference the server chose.
  await openSection(page, "Scenes and media");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "cat.png", mimeType: "image/png", buffer: PIXEL });
  await expect(binding).toHaveValue(/^media\/loom\/words\/words-1\/uploads\/cat-[a-f0-9]{8}\.png$/);
  await expect(page.getByText("Stored with this activity.")).toBeVisible();

  // Another upload does not replace the bound file at once: it is shown beside it first.
  const upload = (name) =>
    page
      .locator('input[type="file"]')
      .setInputFiles({ name, mimeType: "image/png", buffer: PIXEL });
  const comparison = page.getByRole("region", { name: "Current and new", exact: true });
  await upload("dog.png");
  await expect(comparison.getByRole("figure", { name: "Current" })).toBeVisible();
  await expect(comparison.getByRole("figure", { name: "New" })).toBeVisible();
  await expect(binding).toHaveValue(/cat-/);
  await comparison.getByRole("button", { name: "Keep current", exact: true }).click();
  await expect(comparison).toHaveCount(0);
  await expect(binding).toHaveValue(/cat-/);
  await upload("dog.png");
  await comparison.getByRole("button", { name: "Use new", exact: true }).click();
  await expect(comparison).toHaveCount(0);
  await expect(binding).toHaveValue(/^media\/loom\/words\/words-1\/uploads\/dog-[a-f0-9]{8}\.png$/);

  // Clearing and rebinding from the library reaches the same file.
  await page.getByRole("button", { name: "Clear media path", exact: true }).click();
  await expect(binding).toHaveValue("");
  await page.getByRole("button", { name: "Choose from media library", exact: true }).click();
  await expect(page.getByText("Choose a file to see it here.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search by file name", exact: true }).fill("zebra");
  await expect(page.getByText("No uploaded file matches this search.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search by file name", exact: true }).fill("cat");
  await page.getByRole("button", { name: /^cat\.png/ }).click();
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use this file", exact: true }).click();
  await expect(binding).toHaveValue(/^media\/loom\/words\/words-1\/uploads\/cat-[a-f0-9]{8}\.png$/);
  await expect(page.getByText("Stored with this activity.")).toBeVisible();

  await mediaAutosaved(page);
  await openSection(page, "Media library");
  await expect(page.getByText(/1 assets, 1 paths assigned, 0 unbound/)).toBeVisible();

  // The library lists the plan and the uploads together, and what connects them.
  await openSection(page, "Media library");
  const planned = page.getByRole("region", { name: "In the media plan", exact: true });
  const uploaded = page.getByRole("region", { name: "Uploaded files", exact: true });
  await expect(planned.getByRole("row")).toHaveCount(2);
  await expect(planned).toContainText("Uploaded");
  const dog = uploaded.getByRole("row", { name: /dog\.png/ }).first();
  await expect(dog).toContainText("Not used");
  const cat = uploaded.getByRole("row", { name: /cat\.png/ });
  const user = cat.getByRole("button");
  const key = await user.textContent();
  await page.getByRole("button", { name: "Unbound", exact: true }).click();
  await expect(planned).toContainText("Nothing matches these filters.");
  await expect(uploaded.getByRole("row", { name: /dog\.png/ }).first()).toBeVisible();
  await expect(uploaded.getByRole("row", { name: /cat\.png/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Any", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search media", exact: true }).fill("dog");
  await expect(uploaded.getByRole("row", { name: /cat\.png/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search media", exact: true }).fill("");
  await uploaded
    .getByRole("row", { name: /cat\.png/ })
    .getByRole("button")
    .click();
  await expect(page.getByRole("heading", { name: key, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Media path/ })).toHaveValue(/cat-/);
  expect(f.errors).toEqual([]);
});

test("previews only saved images and resets previews across edits and failures", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await expect(page.getByText("Assign and save a media path to preview this image.")).toBeVisible();
  const binding = page.getByRole("textbox", { name: /^Media path/ });
  await binding.fill("media/images/cat.png");
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toHaveCount(0);
  expect(f.imageRequests).toHaveLength(0);
  await mediaAutosaved(page);
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByRole("img", { name: "A cat", exact: true })).toBeVisible();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  expect(f.imageRequests[0]).toMatchObject({
    language: "en-US",
    assetKey: "cat",
  });
  expect(f.imageRequests[0]).not.toHaveProperty("wafRoot");
  expect(f.imageRequests[0].expectedRevision).toBeTruthy();
  await expect(page.getByRole("link", { name: "Open full-size image" })).toHaveAttribute(
    "href",
    /media-image\?/,
  );
  await binding.fill("media/images/different.png");
  await expect(page.getByRole("img", { name: "A cat", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Save or reload the draft before previewing its saved image."),
  ).toBeVisible();
  expect(f.imageRequests).toHaveLength(1);
  await binding.fill("media/images/cat.png");
  f.setImageFailure(true);
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByText(/^Image unavailable\./)).toBeVisible();
  f.setImageFailure(false);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  f.member();
  await page.reload();
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("edits scripts and explicitly accepts speech while regeneration keeps the accepted player", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "welcome",
          type: "audio",
          speechProvider: "gemini",
          description: "Greeting",
          script: "Hello",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const card = page.getByRole("region", { name: "English audio", exact: true });
  const script = card.getByRole("textbox", { name: /^English script/ });
  await script.fill("Hello there");
  // Speech waits for the edited script to save itself.
  await expect(card.getByRole("button", { name: "Generate audio", exact: true })).toBeDisabled();
  await mediaAutosaved(page);
  await expect(script).toHaveValue("Hello there");
  await card.getByRole("button", { name: "Generate audio", exact: true }).click();
  f.completeAudio();
  // The run settles while the page watches, and says so wherever the author is.
  await expect(page.getByText("Speech · welcome finished.", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await openSection(page, "Scenes and media");
  // Nothing is bound yet: the take is the card's candidate until Save makes it current.
  const current = card.locator('audio[aria-label="Current audio"]');
  await expect(current).toHaveCount(0);
  await expect(card.locator('audio[aria-label="Generated candidate"]')).toHaveCount(1);
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(current).toHaveCount(1);
  const source = await current.getAttribute("src");
  await expect(card.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: "Regenerate audio", exact: true }).click();
  await expect(current).toHaveAttribute("src", source);
  f.completeAudio();
  await page.reload();
  await openSection(page, "Scenes and media");
  // Advanced hears the new take beside the current one; it replaces it only on Save.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(current).toHaveAttribute("src", source);
  const candidate = card.locator('audio[aria-label="Generated candidate"]');
  await expect(candidate).toHaveCount(1);
  const next = await candidate.getAttribute("src");
  expect(next).not.toBe(source);
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(current).toHaveAttribute("src", next);
  await expect(
    card.getByText("Generate or upload a candidate to compare before saving.", { exact: true }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("stacks a card per language: Save accepts that language's take, and an upload waits for Save", async ({
  page,
}) => {
  const f = await fixture(page);
  const clip = toneWav(1);
  const saved = [];
  const accepts = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/act_test/media` && request.method() === "PUT")
      saved.push(request.postDataJSON().manifest);
    if (p.endsWith("/accept-audio")) accepts.push(p);
    if (p === `${base}/act_test/media-uploads` && request.method() === "POST") {
      const input = request.postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          path: "media/loom/words/words-1/uploads/hello-1234abcd.wav",
          name: input.name,
          kind: "audio",
          mimeType: "audio/wav",
          byteLength: Buffer.from(input.dataBase64, "base64").byteLength,
          sha256: "c".repeat(64),
          updatedAt: "2026-09-21T10:00:00.000Z",
        }),
      });
    }
    if (p === `${base}/act_test/media-upload` || /\/runs\/[^/]+\/audio$/.test(p))
      return route.fulfill({ contentType: "audio/wav", body: clip });
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  // Gemini's, which this fixture's speech setup lists voices for.
  const welcome = (script) => ({
    key: "welcome",
    type: "audio",
    speechProvider: "gemini",
    description: "Greeting",
    script,
    usages: [{ sceneId: "intro" }],
  });
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: { "en-US": [welcome("Hello")], "es-MX": [welcome("Hola")] },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const english = page.getByRole("region", { name: "English audio", exact: true });
  const spanish = page.getByRole("region", { name: "Spanish audio", exact: true });

  // Simplified shows voice, script and audio; Advanced adds the provider and the comparison.
  await expect(spanish.getByRole("textbox", { name: /^Spanish script/ })).toHaveValue("Hola");
  await expect(english.getByRole("button", { name: /^Voice: / })).toBeVisible();
  await expect(english.getByRole("button", { name: "Provider", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(english.getByRole("button", { name: "Provider", exact: true })).toBeVisible();
  await expect(english.getByRole("region", { name: "Candidate", exact: true })).toContainText(
    "Generate or upload a candidate to compare before saving.",
  );
  await page.getByRole("button", { name: "Simplified", exact: true }).click();
  await expect(english.getByRole("button", { name: "Provider", exact: true })).toHaveCount(0);

  // Spanish is generated on its own; the take waits on its card for Save.
  await spanish.getByRole("button", { name: "Generate audio", exact: true }).click();
  await expect
    .poll(() => f.audioRequests.at(-1))
    .toMatchObject({ language: "es-MX", assetKey: "welcome" });
  await expect(spanish.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled();
  f.completeAudio();
  await expect(spanish.locator('audio[aria-label="Generated candidate"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(english.locator('audio[aria-label="Generated candidate"]')).toHaveCount(0);
  await expect(english.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await spanish.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => accepts.length).toBe(1);
  await expect(spanish.locator('audio[aria-label="Current audio"]')).toHaveCount(1);
  await expect(
    spanish.getByRole("button", { name: "Regenerate audio", exact: true }),
  ).toBeVisible();
  await expect(english.getByText("No audio yet for English.", { exact: true })).toBeVisible();

  // An upload is English's candidate, heard in place of nothing, until Save binds it.
  await english
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "hello.wav", mimeType: "audio/wav", buffer: clip });
  const uploaded = english.locator('audio[aria-label="Uploaded candidate · hello.wav"]');
  await expect(uploaded).toHaveCount(1);
  const savesBefore = saved.length;
  await english.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => (saved.length > savesBefore ? saved.at(-1).assets["en-US"][0].path : null))
    .toBe("media/loom/words/words-1/uploads/hello-1234abcd.wav");
  expect(saved.at(-1).assets["es-MX"][0].path).toMatch(/^media\/generated\/run_audio_/);
  await expect(english.locator('audio[aria-label="Current audio"]')).toHaveCount(1);
  await expect(english.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(f.errors).toEqual([]);
});

test("edits image descriptions and explicitly accepts images while failed regeneration preserves the accepted image", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "cat",
          type: "image",
          description: "A friendly orange cat",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const description = page.getByRole("textbox", { name: /^Image description/ });
  await openSection(page, "Scenes and media");
  await description.fill("A friendly orange cat wearing a blue scarf");
  await expect(page.getByRole("button", { name: "Generate image", exact: true })).toBeDisabled();
  // The edited description saves itself, and then the image can be generated from it.
  await mediaAutosaved(page);
  await expect(description).toHaveValue("A friendly orange cat wearing a blue scarf");
  const generated = page.waitForRequest(
    (request) => request.url().endsWith("/generate-image") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  expect((await generated).postDataJSON()).toMatchObject({
    agentId: "media_agent",
    expectedRevision: expect.any(String),
    language: "en-US",
    assetKey: "cat",
  });
  f.completeImage();
  await page.reload();
  const candidates = page.getByRole("region", { name: "Image candidates", exact: true });
  await openSection(page, "Scenes and media");
  await expect(candidates).toBeVisible();
  await openSection(page, "Scenes and media");
  await candidates.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(
    candidates.getByRole("img", { name: "A friendly orange cat wearing a blue scarf" }),
  ).toBeVisible();
  expect(f.imageCandidateReads).toBe(1);
  await candidates.getByRole("button", { name: "Accept this image", exact: true }).click();
  const acceptedPath = page.getByRole("textbox", { name: /^Media path/ });
  await openSection(page, "Scenes and media");
  await expect(acceptedPath).toHaveValue("media/generated/run_image_0.png");
  const accepted = page.getByRole("region", { name: "Accepted image", exact: true });
  await accepted.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(accepted.locator("img")).toBeVisible();
  const acceptedSource = await accepted.locator("img").getAttribute("src");
  await expect(page.getByRole("button", { name: "Regenerate image", exact: true })).toBeVisible();
  f.failImageGeneration();
  await page.getByRole("button", { name: "Regenerate image", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Image generation failed.");
  await expect(acceptedPath).toHaveValue("media/generated/run_image_0.png");
  await expect(accepted.locator("img")).toHaveAttribute("src", acceptedSource);
  f.member();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(page.getByRole("button", { name: "Regenerate image", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept this image", exact: true })).toHaveCount(0);
  await accepted.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(accepted.locator("img")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("reviews and accepts an improved image prompt without changing its saved media", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "cat",
          type: "image",
          description: "A cat",
          path: "media/images/cat.png",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const description = page.getByRole("textbox", { name: /^Image description/ });
  const improve = page.getByRole("button", { name: "Improve image prompt", exact: true });
  await openSection(page, "Scenes and media");
  await description.fill("Unsaved prompt");
  await expect(improve).toBeDisabled();
  // The edited prompt saves itself before it can be improved.
  await mediaAutosaved(page);
  await expect(description).toHaveValue("Unsaved prompt");
  const sent = page.waitForRequest(
    (request) => request.url().endsWith("/generate-media-text") && request.method() === "POST",
  );
  await improve.click();
  expect((await sent).postDataJSON()).toMatchObject({
    agentId: "default_agent",
    expectedRevision: expect.any(String),
    language: "en-US",
    assetKey: "cat",
  });
  f.completeMediaText("A friendly orange cat wearing a blue scarf");
  await page.reload();
  await openSection(page, "Scenes and media");
  const suggestions = page.getByRole("region", { name: "Text suggestions", exact: true });
  await expect(suggestions).toBeVisible();
  await suggestions.getByRole("button", { name: "Review text", exact: true }).click();
  await expect(suggestions).toContainText("Unsaved prompt");
  await expect(suggestions).toContainText("A friendly orange cat wearing a blue scarf");
  expect(f.mediaTextCandidateReads).toBe(1);
  await suggestions.getByRole("button", { name: "Use this text", exact: true }).click();
  await expect(description).toHaveValue("A friendly orange cat wearing a blue scarf");
  await expect(page.getByRole("textbox", { name: /^Media path/ })).toHaveValue(
    "media/images/cat.png",
  );
  expect(f.errors).toEqual([]);
});

test("reviews narration suggestions, preserves existing audio provenance, and blocks stale acceptance", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "welcome",
          type: "audio",
          description: "Greeting",
          script: "Hello",
          path: "media/generated/run_audio_accepted.wav",
          generatedAudio: { runId: "run_audio_accepted", sha256: "test" },
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  // Script help is in the Advanced view.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const improve = page.getByRole("button", { name: "Improve narration script", exact: true });
  await improve.click();
  f.completeMediaText("Hello there, sight word friends.");
  await page.reload();
  await openSection(page, "Scenes and media");
  const suggestions = page.getByRole("region", { name: "Text suggestions", exact: true });
  await suggestions.getByRole("button", { name: "Review text", exact: true }).click();
  await expect(suggestions).toContainText("Hello");
  await expect(suggestions).toContainText("Hello there, sight word friends.");
  await suggestions.getByRole("button", { name: "Use this text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^English script/ })).toHaveValue(
    "Hello there, sight word friends.",
  );
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Media path/ })).toHaveValue(
    "media/generated/run_audio_accepted.wav",
  );

  const regenerate = page.getByRole("button", { name: "Improve narration script", exact: true });
  await regenerate.click();
  f.completeMediaText("A conflicting narration candidate.");
  f.conflictMediaText("A conflicting narration candidate.");
  await page.reload();
  await openSection(page, "Scenes and media");
  const conflicted = page.getByRole("region", { name: "Text suggestions", exact: true });
  await conflicted.getByRole("button", { name: "Review text", exact: true }).first().click();
  await expect(conflicted).toContainText("A conflicting narration candidate.");
  await expect(conflicted.getByRole("button", { name: "Use this text", exact: true })).toHaveCount(
    0,
  );
  expect(f.errors).toEqual([]);
});

test("members cannot edit media text", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          {
            key: "cat",
            type: "image",
            description: "A cat",
            usages: [{ sceneId: "intro" }],
          },
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  f.member();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(page.getByRole("textbox", { name: /^Image description/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Improve image prompt", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Improve narration script", exact: true }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("image candidates from a conflicting run remain view-only", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "cat",
          type: "image",
          description: "A cat",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  f.conflict();
  await page.reload();
  const candidates = page.getByRole("region", { name: "Image candidates", exact: true });
  await openSection(page, "Scenes and media");
  await expect(candidates).toBeVisible();
  await expect(
    candidates.getByRole("button", { name: "Accept this image", exact: true }),
  ).toHaveCount(0);
  await openSection(page, "Scenes and media");
  await candidates.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(candidates.locator("img")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("create, save, generate, leave and reopen a completed specification", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await generateSpecification(page);
  await openSection(page, "Generation history");
  await expect(page.getByRole("link", { name: "Open Session" })).toHaveAttribute(
    "href",
    "/chat/session_test",
  );
  await page.reload();
  await openSection(page, "Generation history");
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  f.complete();
  await openSection(page, "Specification");
  // CodeMirror draws each line as its own element, so its text runs the lines together.
  await expect(page.getByRole("textbox", { name: "Specification JSON", exact: true })).toHaveText(
    JSON.stringify(spec, null, 2).replaceAll("\n", ""),
  );
  await page.reload();
  await openSection(page, "Description");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Practice common sight words",
  );
  await openSection(page, "Generation history");
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("polling preserves unsaved edits and exposes conflicting output for review", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await generateSpecification(page);
  await openSection(page, "Generation history");
  await expect(page.getByRole("button", { name: "Cancel generation" })).toBeVisible();
  await openSection(page, "Description");
  await page.getByRole("textbox", { name: "Activity Script", exact: true }).fill("My unsaved edit");
  f.conflict();
  await openSection(page, "Generation history");
  await expect(
    page.getByText("Draft changed — candidate preserved", { exact: true }),
  ).toBeVisible();
  await openSection(page, "Description");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "My unsaved edit",
  );
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "My unsaved edit",
  );
  await refAction(page, "Reload draft");
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Changed in another tab",
  );
  await openSection(page, "Generation history");
  await page.getByText("View candidate JSON", { exact: true }).click();
  await page.getByRole("button", { name: "Copy candidate into editor" }).click();
  await openSection(page, "Specification");
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await expect(page.getByText("Validated", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("member view is read-only and mobile layout does not overflow", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  f.member();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("Only the Project owner can edit activities.")).toBeVisible();
  // Too narrow to hold a rail beside the work, so the rail starts shut and the editor
  // keeps the width rather than being squeezed into a sliver beside a menu.
  await expect(page.locator('nav[aria-label="Activity hierarchy"]')).toHaveCount(0);
  await openSection(page, "Description");
  // Choosing a section hands the workspace back instead of leaving the menu over it.
  await expect(page.locator('nav[aria-label="Activity hierarchy"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // The breadcrumb's title truncates rather than pushing the row wider than the viewport:
  // either it is long enough to be visibly clipped, or it simply fits at this width.
  const crumbTitle = page.locator('nav[aria-label="Breadcrumb"] h2');
  expect(
    await crumbTitle.evaluate(
      (el) => el.scrollWidth > el.clientWidth || el.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Opening the rail here is a temporary answer to having no room for both, so a wider
  // window and back must not leave it covering the editor again. The emulated viewport
  // change does not notify the page the way a real window resize does, so the
  // notification is sent by hand.
  const sections = page.locator('nav[aria-label="Activity hierarchy"]');
  const resize = async (width) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  };
  await page.getByRole("button", { name: "Expand the activity rail", exact: true }).click();
  await expect(sections).toHaveCount(1);
  await resize(1280);
  await expect(sections).toHaveCount(1);
  await resize(390);
  await expect(sections).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("the studio header wraps its controls instead of overlapping them", async ({ page }) => {
  const f = await fixture(page);
  await create(page);

  // Two of a set of locators overlap when their boxes intersect on both axes.
  const intersects = (a, b) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const assertNoOverlap = async (locators) => {
    const boxes = [];
    for (const locator of locators) {
      const box = await locator.boundingBox();
      expect(
        box,
        `expected a visible bounding box for ${await locator.evaluate((el) => el.outerHTML.slice(0, 80))}`,
      ).not.toBeNull();
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(intersects(boxes[i], boxes[j]), `boxes ${i} and ${j} overlap`).toBe(false);
  };
  const headerControls = () => [
    page.locator('nav[aria-label="Breadcrumb"] h2'),
    refMenu(page),
    // The draft/unsaved status pill beside the ref.
    page.locator('nav[aria-label="Breadcrumb"] span[aria-live]'),
    page.getByRole("button", { name: "Layout", exact: true }),
  ];

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await assertNoOverlap(headerControls());

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await assertNoOverlap(headerControls());
  expect(f.errors).toEqual([]);
});

test("dirty drafts block sidebar, Session, browser back, and project switches", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await generateSpecification(page);
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep this edit");
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await openSection(page, "Generation history");
  await page.getByRole("link", { name: "Open Session" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/activities\/act_test(\?section=\w+)?$/);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/activities\/act_test(\?section=\w+)?$/);
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/activities\/act_test(\?section=\w+)?$/);
  await openSection(page, "Description");
  await expect(description).toHaveText("Keep this edit");
  // Switching Projects while dirty asks too; canceling leaves the switch and edit in place.
  // The activity workspace auto-collapses the sidebar to its rail: expand it to reach the
  // project switcher, which the rail does not carry.
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Activities test", exact: true })).toBeVisible();
  await expect(description).toHaveText("Keep this edit");
  expect(await page.evaluate(() => localStorage.getItem("penguin.lastProjectId"))).not.toBe(
    "second-project",
  );
  expect(f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project")).toBe(false);
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await page
    .getByRole("region", { name: /words/ })
    .getByRole("link", { name: /Sight words/ })
    .click();
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Another edit");
  // Re-entering the workspace collapsed the sidebar again; expand it for the switcher.
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  // Discarding this time clears `dirty` and replays the switch, which now goes through.
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Second project", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("penguin.lastProjectId"))).toBe(
    "second-project",
  );
  await expect
    .poll(() => f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project"))
    .toBe(true);
  expect(f.errors).toEqual([]);
});

test("idle history polls slowly and candidate text is fetched only on expansion", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const reads = f.historyReads;
  await page.waitForTimeout(2500);
  expect(f.historyReads).toBe(reads);
  await openSection(page, "Description");
  await generateSpecification(page);
  await expect.poll(() => f.historyReads).toBeGreaterThan(reads);
  f.complete();
  f.secondCandidate();
  await openSection(page, "Generation history");
  await expect(page.getByText("Applied", { exact: true })).toHaveCount(2);
  expect(f.candidateReads).toBe(0);
  const candidates = page.getByText("View candidate JSON", { exact: true });
  const release = f.holdFirstCandidate();
  f.failSecondCandidate();
  await candidates.nth(0).click();
  await candidates.nth(1).click();
  await expect(page.getByRole("alert")).toContainText("Candidate temporarily unavailable.");
  const reviews = page
    .locator("details")
    .filter({ has: page.getByText("View candidate JSON", { exact: true }) });
  await reviews.nth(1).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(reviews.nth(1).locator("pre")).toContainText('"title":"Second candidate"');
  await expect(reviews.nth(0).locator("pre")).toContainText("Loading");
  release();
  await expect(page.locator("details pre").nth(0)).toContainText('"title":"Sight words"');
  await expect(page.locator("details pre").nth(1)).toContainText('"title":"Second candidate"');
  expect(f.candidateReads).toBe(3);
  await candidates.nth(0).click();
  await candidates.nth(0).click();
  expect(f.candidateReads).toBe(3);
  const settledReads = f.historyReads;
  await page.waitForTimeout(2500);
  expect(f.historyReads).toBe(settledReads);
  expect(f.errors).toEqual([]);
});

test("polling errors recover without clearing a save conflict or unsaved edits", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.clock.install();
  f.failHistory();
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("The server hit an internal error");
  await page.clock.fastForward(30_000);
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Description");
  await expect(description).toHaveText("Practice common sight words");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep this unsaved edit");
  f.changeSavedDescription();
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  f.failHistory();
  await page.clock.fastForward(30_000);
  await expect(page.getByRole("alert")).toHaveCount(2);
  await page.clock.fastForward(30_000);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  await expect(description).toHaveText("Keep this unsaved edit");
  expect(f.errors).toEqual([]);
});

test("an activity collapses the sidebar without changing the stored choice", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  // On the activity workspace the sidebar steps back to its rail — the full sidebar's
  // "Collapse sidebar" button (only the pinned Sidebar carries it) is not there to find.
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeHidden();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("penguin.sidebarCollapsed"))).not.toBe("1");
  expect(f.errors).toEqual([]);
});

test("collapsed rail keeps Activities reachable through the page manifest", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  // The activity workspace already auto-collapses the sidebar to its rail.
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeHidden();
  const activities = page.getByRole("link", { name: "Activities", exact: true });
  await expect(activities).toBeVisible();
  await activities.click();
  await expect(page).toHaveURL(/\/activities$/);
  expect(f.errors).toEqual([]);
});

async function projectSettings(page) {
  // The activity workspace auto-collapses the sidebar to its rail, which carries no project
  // switcher; expand it first.
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Project settings", exact: true }).click();
  return page.getByRole("dialog", { name: "Project settings", exact: true });
}

test("canceling the dirty-editor guard prevents Project deletion and remount", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep before deletion");
  const original = await description.elementHandle();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  const deleteDialog = page.getByRole("dialog", { name: "Delete Project", exact: true });
  const settings = await projectSettings(page);
  await settings.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteDialog.getByRole("button", { name: "Confirm", exact: true }).click();
  // deleteProject awaits the guard's dialog before settling, so the Delete Project dialog
  // stays open (stacked behind the discard one) until that answer comes back.
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(deleteDialog).toHaveCount(0);
  expect(f.deletedProjects).toBe(0);
  await expect(description).toHaveText("Keep before deletion");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  // Discarding this time lets the same deleteProject call finish, and the delete goes through.
  await settings.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteDialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect.poll(() => f.deletedProjects).toBe(1);
  // The replayed delete is the same call doDelete is still awaiting, so its own success
  // handling (onClose) runs and closes the whole settings dialog — not just the sub-dialog.
  await expect(settings).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("declining a refresh fallback preserves detached text without retaining Project access", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.clock.install();
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Copy this before leaving");
  const original = await description.elementHandle();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  const settings = await projectSettings(page);
  await settings.getByRole("textbox").fill("Refresh the project list");
  f.removeProject();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("This Project is no longer available.", { exact: false }),
  ).toBeVisible();
  await expect(description).toHaveText("Copy this before leaving");
  await expect(description).toBeEnabled();
  await expect(description).toHaveAttribute("aria-readonly", "true");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  await expect(page.getByRole("button", { name: "Save script", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toHaveCount(0);
  const requests = f.activityRequests;
  await page.clock.fastForward(60_000);
  expect(f.activityRequests).toBe(requests);
  expect(f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project")).toBe(false);
  await page.getByRole("button", { name: "Select a Project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Activities test owner", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(description).toHaveText("Copy this before leaving");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  // Discarding this time clears `dirty` and replays the switch, which now goes through.
  await page.getByRole("button", { name: "Select a Project", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Second project", exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("leaving with unsaved edits asks through the app's dialog", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep this edit");
  await page.getByRole("link", { name: "All activities" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/activities\/[^/?]+/);
  await page.getByRole("link", { name: "All activities" }).click();
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(page).toHaveURL(/\/activities$/);
  expect(f.errors).toEqual([]);
});

test("the script editor folds scenes, diffs against the last save and shows an agent's proposal", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  const script = [
    "Description",
    "",
    "Scene 1: Intro",
    "<video>An island.</video>",
    "Scene 2: Rocks",
    "The narrator says <audio>Find d.</audio>",
  ].join("\n");
  const box = page.getByRole("textbox", { name: "Activity Script", exact: true });
  const save = page.getByRole("button", { name: "Save script", exact: true });
  await box.fill(script);
  await save.click();
  await expect(save).toBeDisabled();
  await expect(box.locator(".cm-media-tag").first()).toHaveText("<video>");

  // Scenes fold to their headings and open again.
  const scenes = page.getByRole("button", { name: "Fold scenes", exact: true });
  await scenes.click();
  await expect(box).not.toContainText("An island.");
  await expect(box).toContainText("Scene 2: Rocks");
  await scenes.click();
  await expect(box).toContainText("An island.");

  // An edit reads against the last save, names its scene, and reverts where it stands.
  await box.fill(script.replace("Find d.", "Find lowercase d."));
  await page
    .getByRole("group", { name: "Compare", exact: true })
    .getByRole("button", { name: "Last save", exact: true })
    .click();
  await expect(page.getByText("+1 −1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scene 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to the change at line 6" })).toBeVisible();
  await page.getByRole("button", { name: "Revert", exact: true }).click();
  await expect(page.getByText("No changes", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  // A conversation's proposal marks the scenes it changes and reads as a diff until accepted.
  const proposed = script.replace("Scene 1: Intro", "Scene 1: Welcome");
  await page.route("**/*", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === `${base}/act_test/runs`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          runs: [
            {
              kind: "assist",
              inputRevision: "1",
              runId: "run_assist",
              activityId: "act_test",
              projectId,
              sessionId: "session_assist",
              status: "succeeded",
              createdAt: "2026-09-19T11:00:00Z",
              hasCandidate: false,
              error: null,
            },
          ],
        }),
      });
    if (p === `${base}/act_test/runs/run_assist/proposal`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          proposal: {
            summary: "A warmer opening",
            changes: [{ target: "description", text: proposed }],
          },
          error: null,
        }),
      });
    return route.fallback();
  });
  await page.reload();
  await openSection(page, "Description");
  await expect(box.locator(".cm-proposed-hint")).toHaveText("proposed, not applied");
  await page
    .getByRole("group", { name: "Compare", exact: true })
    .getByRole("button", { name: "Agent proposal", exact: true })
    .click();
  await expect(page.getByText("Agent proposal, read-only", { exact: true })).toBeVisible();
  await expect(box).toContainText("Scene 1: Welcome");
  await expect(box).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Accept the proposed script", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept the proposed script" })).toHaveCount(0);
  await expect(box).toHaveAttribute("contenteditable", "true");
  await expect(box).toContainText("Scene 1: Welcome");
  await expect(box.locator(".cm-proposed-hint")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("runs every stage from Stages and follows the run in its panel", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const posts = [];
  let reads = 0;
  const steps = (statuses) =>
    ["spec", "media", "speech", "images", "module"].map((step, index) => ({
      step,
      status: statuses[index],
      detail: null,
      note: step === "images" && statuses[index] === "skipped" ? "noImages" : null,
      done: step === "speech" ? 2 : 0,
      total: step === "speech" ? 2 : 0,
      runIds: [],
    }));
  const state = (status, statuses, error = null) => ({
    pipelineId: "pipeline_1",
    projectId,
    activityId: "act_test",
    selection: "all",
    status,
    steps: steps(statuses),
    currentRunId: null,
    currentSessionId: null,
    error,
    startedAt: "2026-09-23T12:00:00Z",
    finishedAt: status === "running" ? null : "2026-09-23T12:05:00Z",
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p !== `${base}/act_test/pipeline`) return route.fallback();
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (request.method() === "POST") {
      posts.push(request.postDataJSON());
      return json(state("running", ["running", "pending", "pending", "pending", "pending"]), 202);
    }
    reads++;
    if (!posts.length) return json({ pipeline: null });
    return json({
      pipeline: state("succeeded", ["succeeded", "succeeded", "succeeded", "skipped", "succeeded"]),
    });
  });
  await page.reload();
  await openPanel(page, "Stages");
  const stage = page.getByRole("button", { name: "Stage", exact: true });
  await expect(stage).toContainText("All stages");
  const stages = page.getByRole("complementary", { name: "Stages", exact: true });
  await expect(stages.getByRole("button", { name: "Generation agent", exact: true })).toBeVisible();
  await expect(stages.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await openSection(page, "Description");
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toHaveCount(0);
  await openPanel(page, "Stages");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ stage: "all", agentId: "default_agent" });
  const panel = page.getByRole("complementary", { name: "Stages", exact: true });
  await expect(panel).toBeVisible();
  // The page keeps reading the run while it is in flight, and shows how it ended.
  await expect(panel.getByText("All chosen stages finished.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Generate speech", { exact: true })).toBeVisible();
  // A stage with nothing to do folds into one line, which says why when opened.
  await panel.getByText("1 skipped: Generate images", { exact: true }).click();
  await expect(
    panel.getByText("Generate images — No image is missing.", { exact: true }),
  ).toBeVisible();
  expect(reads).toBeGreaterThan(0);

  // One stage on its own is the same control.
  await stage.click();
  await page.getByRole("option", { name: "Generate images", exact: true }).click();
  await openPanel(page, "Stages");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ stage: "images" });
  expect(f.errors).toEqual([]);
});

test("hides reasoning in the run log and expands a long tool output", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const f = await fixture(page);
  await create(page);
  let started = false;
  const running = {
    pipelineId: "pipeline_1",
    projectId,
    activityId: "act_test",
    selection: "all",
    status: "running",
    steps: ["spec", "media", "speech", "images", "module"].map((step, index) => ({
      step,
      status: index === 0 ? "running" : "pending",
      detail: null,
      note: null,
      done: 0,
      total: 0,
      runIds: [],
    })),
    currentRunId: "run_spec",
    currentSessionId: "session_run",
    error: null,
    startedAt: "2026-09-23T12:00:00Z",
    finishedAt: null,
  };
  const at = (second) => `2026-09-23T12:00:${String(second).padStart(2, "0")}.000Z`;
  const modelMsg = (second, payload) => ({ timestamp: at(second), type: "model_msg", payload });
  const lines = (count, prefix) =>
    Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");
  // The long output is coloured, as a terminal program's often is; Copy takes the plain text.
  const longOutput = `\u001b[32m${lines(20, "row")}\u001b[0m`;
  const messages = [
    modelMsg(1, { type: "text", role: "user", text: "Write the spec.", stop_reason: "completed" }),
    modelMsg(2, {
      type: "thinking",
      role: "assistant",
      thinking: "Weighing which scenes come first.",
      stop_reason: "completed",
    }),
    modelMsg(3, {
      type: "tool_call",
      role: "assistant",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "ls" }),
      tool_call_id: "call_long",
      stop_reason: "completed",
    }),
    modelMsg(4, {
      type: "tool_call_output",
      role: "user",
      output: longOutput,
      tool_call_id: "call_long",
      stop_reason: "completed",
    }),
    modelMsg(5, {
      type: "tool_call",
      role: "assistant",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "pwd" }),
      tool_call_id: "call_short",
      stop_reason: "completed",
    }),
    modelMsg(6, {
      type: "tool_call_output",
      role: "user",
      output: lines(3, "short"),
      tool_call_id: "call_short",
      stop_reason: "completed",
    }),
    modelMsg(7, {
      type: "thinking",
      role: "assistant",
      thinking: "Checking the last scene.",
      stop_reason: "completed",
    }),
  ];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/pipeline`) {
      if (request.method() === "POST") {
        started = true;
        return json(running, 202);
      }
      return json({ pipeline: started ? running : null });
    }
    if (p === "/api/sessions/session_run/messages") return json({ messages });
    return route.fallback();
  });
  await page.reload();
  await openPanel(page, "Stages");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Stages", exact: true });
  const reasoning = panel.getByRole("switch", { name: "Show reasoning", exact: true });
  await expect(reasoning).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByText("Weighing which scenes come first.")).toHaveCount(0);
  await expect(panel.getByText("Thinking", { exact: true })).toHaveCount(2);

  // Off: only what the agent did remains, and the latest reasoning says it is still thinking.
  await reasoning.click();
  await expect(reasoning).toHaveAttribute("aria-checked", "false");
  await expect(panel.getByText("Thinking", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Thinking…", { exact: true })).toBeVisible();

  // The switch is remembered.
  await page.reload();
  const again = page.getByRole("complementary", { name: "Stages", exact: true });
  // The run is still going, so the page offers Stop once it has read it.
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  if (!(await again.isVisible()))
    await page.getByRole("button", { name: "Stages", exact: true }).click();
  await expect(again.getByRole("switch", { name: "Show reasoning", exact: true })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(again.getByText("Thinking", { exact: true })).toHaveCount(0);

  // A long output offers Copy and Show all; a short one only Copy.
  const tools = again.getByRole("button", { name: /^Done exec/ });
  await tools.first().click();
  const copy = again.getByRole("button", { name: "Copy output", exact: true });
  await expect(copy).toHaveCount(1);
  const showAll = again.getByRole("button", { name: "Show all", exact: true });
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  const output = again.locator("pre", { hasText: "row 20" });
  await expect(output).toHaveClass(/max-h-72/);
  await copy.click();
  // The system clipboard may hand line ends back as CRLF.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, "\n")).toBe(lines(20, "row"));
  await showAll.click();
  const showLess = again.getByRole("button", { name: "Show less", exact: true });
  await expect(showLess).toHaveAttribute("aria-expanded", "true");
  await expect(output).not.toHaveClass(/max-h-72/);
  // Flipping the switch leaves the opened card open and its output at full length.
  const againSwitch = again.getByRole("switch", { name: "Show reasoning", exact: true });
  for (const checked of ["true", "false"]) {
    await againSwitch.click();
    await expect(againSwitch).toHaveAttribute("aria-checked", checked);
    await expect(showLess).toHaveAttribute("aria-expanded", "true");
    await expect(output).not.toHaveClass(/max-h-72/);
  }
  await tools.nth(1).click();
  await expect(again.getByRole("button", { name: "Copy output", exact: true })).toHaveCount(2);
  await expect(again.getByRole("button", { name: /^Show (all|less)$/ })).toHaveCount(1);
  expect(f.errors).toEqual([]);
});

test("the storyboard shows every scene, and walks into its media scene by scene", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const withScenes = {
    ...spec,
    scenes: [
      {
        id: "intro",
        description: "An island appears.",
        media: { images: [{ key: "island", description: "An island" }] },
      },
      { id: "quiet", description: "A pause with no media." },
      {
        id: "rocks",
        description: "Find the letter d.",
        media: { images: [{ key: "rock", description: "A rock" }] },
      },
    ],
  };
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(withScenes));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  // This fixture plans media from a manifest the request carries, so plan this spec's.
  const asset = (key, sceneId) => ({
    key,
    type: "image",
    description: key,
    usages: [{ sceneId, sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: { "en-US": [asset("island", "intro"), asset("rock", "rocks")] },
        },
      }),
    }),
  );
  await openSection(page, "Scenes and media");
  await planMedia(page);

  // Scenes opens on the board: one frame per scene, in order, marked while media is missing.
  await page.getByRole("treeitem", { name: "Scenes", exact: true, level: 1 }).click();
  await expect(page.getByRole("heading", { name: "Storyboard", exact: true })).toBeVisible();
  await expect(page.getByText("3 scenes", { exact: true })).toBeVisible();
  const intro = page.getByRole("button", { name: "Scene 1, intro. 1 without media" });
  await expect(page.getByRole("button", { name: "Scene 2, quiet", exact: true })).toBeVisible();
  await intro.click();
  await expect(intro).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Scene 1, intro", exact: true })).toBeVisible();

  // Opening a scene opens its media, and the editor steps over the scene with none.
  await page.getByRole("button", { name: /^island/ }).click();
  await expect(page.getByRole("heading", { name: "island", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next scene: Scene 3, rocks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "rock", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page
    .getByRole("navigation", { name: "Storyboard" })
    .getByRole("button", {
      name: "Storyboard",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Scene 3, rocks. 1 without media" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(f.errors).toEqual([]);
});

test("the script saves itself after a pause, and waits while a run is in flight", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.clock.install();
  await openSection(page, "Description");
  const box = page.getByRole("textbox", { name: "Activity Script", exact: true });
  const saves = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`${base}/act_test/description`)) saves.push(request.postDataJSON());
  });
  await box.fill("Scene 1: Intro");
  await expect(page.getByText("Unsaved, saves in a moment", { exact: true })).toBeVisible();
  await page.clock.fastForward(5_500);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  expect(saves.map((body) => body.description)).toEqual(["Scene 1: Intro"]);

  // A run moves the draft, so the script holds its edits until the run ends.
  await generateSpecification(page);
  await box.fill("Scene 1: Welcome");
  await expect(
    page.getByText("Unsaved, saves when the running work ends", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(10_000);
  expect(saves).toHaveLength(1);
  await expect(box).toHaveText("Scene 1: Welcome");
  expect(f.errors).toEqual([]);
});

test("the player draws the module's behavior map and follows the phase it reports", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const machine = {
    version: "1.1",
    id: "letters",
    initial: "rocks",
    states: {
      rocks: {
        initial: "prompt",
        states: {
          prompt: { invoke: { src: "say", onDone: "waiting" } },
          waiting: { on: { CORRECT: "correct", WRONG: "retry" } },
          retry: { invoke: { src: "say", onDone: "waiting" } },
          correct: { invoke: { src: "chest", onDone: "#next" } },
        },
      },
    },
  };
  // A stand-in for the played module: it reports its state the way the real bridge does.
  const playerPage = `<!doctype html><body><script>
    setInterval(() => parent.postMessage({
      type: "penguin-sandbox:activity-state",
      detail: { index: 1, phase: "waiting", sceneId: "rocks", state: "rocks.waiting" },
      interactables: [],
    }, "*"), 100);
  </script></body>`;
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/sandbox/payload`)
      return json({ configuration: { stateMachine: machine } });
    if (p === `${base}/act_test/sandbox/play`)
      return route.fulfill({ contentType: "text/html", body: playerPage });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify({ ...spec, scenes: [{ id: "rocks", description: "Find d" }] }));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  // The preview plays as soon as it opens; there is nothing to press.
  const panel = await openPanel(page, "Preview");

  const map = panel.getByRole("group", { name: "Behavior of rocks", exact: true });
  await expect(map).toBeVisible();
  await expect(map.locator('[aria-current="step"]')).toContainText("waiting");
  await expect(panel.getByText("correct, on done, to next", { exact: true })).toBeVisible();

  // A phase opens in the inspector, and its neighbours can be followed from there.
  await map.getByRole("button", { name: "waiting, where the activity is now" }).click();
  const inspector = panel.getByRole("region", { name: "Phase waiting", exact: true });
  await expect(inspector).toContainText("on CORRECT, to correct");
  await expect(inspector).toContainText("prompt, on done");
  await inspector.getByRole("button", { name: "correct", exact: true }).click();
  const correct = panel.getByRole("region", { name: "Phase correct", exact: true });
  await expect(correct).toContainText("on done, leaves for next");
  await expect(correct).toContainText("chest");
  await correct.getByRole("button", { name: "Close", exact: true }).click();
  await expect(correct).toHaveCount(0);

  // Zooming widens the drawing past the panel; Fit brings it back.
  const drawing = map;
  const fitted = (await drawing.boundingBox()).width;
  await panel.getByRole("button", { name: "Zoom in", exact: true }).click();
  await panel.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(panel.getByText("150%", { exact: true })).toBeVisible();
  expect((await drawing.boundingBox()).width).toBeGreaterThan(fitted * 1.4);
  await panel.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(panel.getByText("100%", { exact: true })).toBeVisible();

  const toggle = panel.getByRole("button", { name: "Behavior map", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(map).toHaveCount(0);

  // Another screen changes only the preview: the player is laid out at its size.
  const resolution = panel.getByRole("button", { name: "Preview resolution", exact: true });
  await expect(resolution).toContainText("640×480 (the activity's own)");
  await expect(panel.locator("iframe")).toHaveCSS("width", "640px");
  await resolution.click();
  await page.getByRole("option", { name: "1920×1080 viewport", exact: true }).click();
  await expect(panel.locator("iframe")).toHaveCSS("width", "1920px");
  expect(f.errors).toEqual([]);
});

test("lists the live tap targets on the current state and keeps the map under the player", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  const f = await fixture(page);
  await create(page);
  const machine = {
    version: "1.1",
    id: "letters",
    initial: "rocks",
    states: {
      rocks: {
        initial: "prompt",
        states: {
          prompt: { invoke: { src: "say", onDone: "waiting" } },
          waiting: { on: { CORRECT: "correct", WRONG: "retry" } },
          retry: { invoke: { src: "say", onDone: "waiting" } },
          correct: { invoke: { src: "chest", onDone: "#next" } },
        },
      },
    },
  };
  // A stand-in for the played module: it reports five tap targets in "waiting" and keeps
  // every outline it is asked for, so the test can read what the App sent.
  const playerPage = `<!doctype html><body><script>
    window.seen = [];
    addEventListener("message", (event) => {
      if (event.data && event.data.type === "penguin-sandbox:highlight-interactable")
        window.seen.push(event.data.id);
    });
    setInterval(() => parent.postMessage({
      type: "penguin-sandbox:activity-state",
      detail: { index: 1, phase: "waiting", sceneId: "rocks", state: "rocks.waiting" },
      interactables: [
        { id: "rock-a", inputType: "CLICK", description: "First rock" },
        { id: "rock-b", inputType: "CLICK" },
        { id: "rock-c", inputType: "DRAG" },
        { id: "rock-d", inputType: "SELECT" },
        { id: "rock-e", inputType: "SELECT_CLICK" },
      ],
    }, "*"), 100);
  </script></body>`;
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/sandbox/payload`)
      return json({ configuration: { stateMachine: machine } });
    if (p === `${base}/act_test/sandbox/play`)
      return route.fulfill({ contentType: "text/html", body: playerPage });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify({ ...spec, scenes: [{ id: "rocks", description: "Find d" }] }));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  const play = () => openPanel(page, "Preview");
  await play();

  // The live phase names how many targets it has and lists the first three.
  const map = page.getByRole("group", { name: "Behavior of rocks", exact: true });
  await expect(map.locator('[aria-current="step"]')).toContainText("waiting");
  await expect(map.locator('[aria-current="step"]')).toContainText("5 live");
  const live = page.getByRole("group", { name: "What can be tapped in waiting", exact: true });
  await expect(live.getByRole("button")).toHaveCount(3);
  await expect(live).toContainText("+2 more");
  const first = live.getByRole("button", { name: "First rock", exact: true });
  await expect(first).toHaveAttribute("title", "rock-a, tap");

  // Pointing at one outlines it in the player; leaving clears the outline.
  const player = () => page.frames().find((frame) => frame.url().includes("/sandbox/play"));
  const seen = () => player().evaluate(() => window.seen);
  await first.hover();
  await expect.poll(async () => (await seen()).at(-1)).toBe("rock-a");
  await page.mouse.move(0, 0);
  await expect.poll(async () => (await seen()).at(-1)).toBe(null);

  // The player is a rail panel, too narrow for the map beside it: the map sits under the
  // player, with no divider between them.
  const divider = page.getByRole("separator", { name: "Resize the behavior map", exact: true });
  await expect(divider).toHaveCount(0);
  await expect(map).toBeVisible();

  // Hiding the map survives a reload.
  const toggle = page.getByRole("button", { name: "Behavior map", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveCount(0);
  await page.reload();
  await play();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("edits the module's configuration, saves it, and discards the edit", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const featureWrites = [];
  const documentWrites = [];
  // The server's state, mirrored: the module's own documents, an edit kept in the draft,
  // and the draft revision a write must name.
  const own = { maxRounds: 3 };
  let edit = null;
  let detail = null;
  let revision = null;
  const draftAt = (next) => ({ ...detail.draft, contentRevision: next });
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/implementation-features`) {
      const feature = (id, label) => ({
        id,
        label,
        description: `${label}, as its source module does it.`,
        category: "Interaction",
        sourceModule: "waf-module-r2phcs03L",
        sourcePaths: [],
        requiredSymbols: [],
        requiredSelectors: [],
        requiredStyleFragments: [],
      });
      const features = [
        feature("r2phcs03l-speaker-audio-choices", "Speaker audio choices"),
        feature("r2phcs03l-freight-conveyor", "Freight boxes and conveyor"),
      ];
      if (request.method() === "PUT") {
        featureWrites.push(request.postDataJSON());
        return json({ features, selectedIds: request.postDataJSON().selectedIds });
      }
      return json({ features, selectedIds: ["r2phcs03l-speaker-audio-choices"] });
    }
    if (p === `${base}/act_test/module-documents`)
      return json({
        source: "checkout",
        canonicalRefNum: 12,
        configuration: {
          file: "configurations/words-12.json",
          value: edit ?? own,
          edited: !!edit,
          stale: false,
          editable: true,
        },
        assessment: {
          file: "assessments/words-12.json",
          value: { items: [{ id: "q1" }, { id: "q2" }] },
          edited: false,
          stale: false,
          editable: true,
        },
      });
    if (p === `${base}/act_test/module-documents/configuration` && request.method() === "PUT") {
      const body = request.postDataJSON();
      documentWrites.push({ kind: "save", body });
      if (body.expectedRevision !== revision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      edit = body.value;
      revision = `${detail.draft.contentRevision}-edited`;
      return json(draftAt(revision));
    }
    if (p === `${base}/act_test/module-documents/configuration/discard`) {
      const body = request.postDataJSON();
      documentWrites.push({ kind: "discard", body });
      if (body.expectedRevision !== revision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      edit = null;
      revision = detail.draft.contentRevision;
      return json(draftAt(revision));
    }
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await page.reload();
  detail = await page.evaluate((url) => fetch(url).then((r) => r.json()), `${base}/act_test`);
  revision = detail.draft.contentRevision;

  await openSection(page, "Configuration Data");
  await expect(
    page.getByText("configurations/words-12.json, from the module in the WAF checkout."),
  ).toBeVisible();
  const field = page.getByRole("textbox", { name: /^Document JSON/ });
  // CodeMirror draws each line as its own element, so its text runs the lines together.
  const shown = (value) => JSON.stringify(value, null, 2).replaceAll("\n", "");
  await expect(field).toHaveText(shown(own));
  const save = page.getByRole("button", { name: "Save Configuration Data", exact: true });
  // Nothing to save until the document says something else.
  await expect(save).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard edit", exact: true })).toHaveCount(0);

  // Text that is not JSON cannot be saved, and says why.
  await field.fill("{ maxRounds: 5 }");
  await expect(page.getByText(/^This is not valid JSON: /)).toBeVisible();
  await expect(save).toBeDisabled();
  expect(documentWrites).toEqual([]);

  await field.fill('{ "maxRounds": 5 }');
  await save.click();
  await expect.poll(() => documentWrites.length).toBe(1);
  expect(documentWrites[0]).toEqual({
    kind: "save",
    body: { value: { maxRounds: 5 }, expectedRevision: detail.draft.contentRevision },
  });
  await expect(page.getByText("Saved the document.")).toBeVisible();
  await expect(
    page.getByText("Edited here: the preview and the next assembly use this version."),
  ).toBeVisible();
  await expect(field).toHaveText(shown({ maxRounds: 5 }));

  // Discarding asks first, then goes back to the module's own document.
  await page.getByRole("button", { name: "Discard edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Go back to the generated document? Your edit is removed."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Discard edit", exact: true }).click();
  await expect.poll(() => documentWrites.length).toBe(2);
  expect(documentWrites[1]).toEqual({
    kind: "discard",
    body: { expectedRevision: `${detail.draft.contentRevision}-edited` },
  });
  await expect(field).toHaveText(shown(own));
  await expect(
    page.getByText("Edited here: the preview and the next assembly use this version."),
  ).toHaveCount(0);

  // Unsaved text in one document does not carry into the other.
  await field.fill('{ "maxRounds": 9 }');
  await expect(save).toBeEnabled();
  await openSection(page, "Assessment Data");
  await expect(
    page.getByText("assessments/words-12.json, from the module in the WAF checkout. 2 items."),
  ).toBeVisible();
  await expect(field).toHaveText(shown({ items: [{ id: "q1" }, { id: "q2" }] }));
  await expect(page.getByRole("button", { name: "Save Assessment", exact: true })).toBeDisabled();
  expect(documentWrites).toHaveLength(2);
  // Loom's third document: the features the module assembly reproduces.
  await openSection(page, "Implementation Features");
  await expect(page.getByText("1 of 2 selected", { exact: true })).toBeVisible();
  const conveyor = page.getByRole("switch", { name: "Freight boxes and conveyor" });
  await expect(conveyor).toHaveAttribute("aria-checked", "false");
  await conveyor.click();
  await expect.poll(() => featureWrites.length).toBe(1);
  expect(featureWrites[0]).toEqual({
    selectedIds: ["r2phcs03l-speaker-audio-choices", "r2phcs03l-freight-conveyor"],
  });
  await expect(page.getByText("2 of 2 selected", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("shows the shared assessment read-only on a ref that is not canonical", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/module-documents`)
      return json({
        source: "run",
        canonicalRefNum: 3,
        configuration: null,
        assessment: {
          file: "assessments/words-3.json",
          value: { items: [{ title: "q1" }] },
          edited: true,
          stale: true,
          editable: false,
        },
      });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await page.reload();
  await openSection(page, "Assessment Data");
  await expect(page.getByText("Shared by every ref. Edit it on ref 3.")).toBeVisible();
  await expect(
    page.getByText(
      "The specification changed after this was edited. Check the questions still match.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Document JSON/ })).toHaveAttribute(
    "aria-readonly",
    "true",
  );
  await expect(page.getByRole("button", { name: "Save Assessment", exact: true })).toHaveCount(0);
  await openSection(page, "Configuration Data");
  await expect(page.getByText("The module has no configuration file for this ref.")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("generates an assessment, accepts it, and edits a question and its correct choice", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const choice = (id, text, isCorrect) => ({
    id,
    isCorrect,
    score: isCorrect ? 1 : 0,
    value: { text },
  });
  const item = (n, question, choices) => ({
    title: `words-12-${n}`,
    interactionKey: "SIMPLE_CHOICE",
    configuration: { shuffle: false, question: { text: question }, simpleChoice: choices },
  });
  const own = {
    title: "words-12",
    configuration: { maxItems: 1, nextItemsSize: 1 },
    behavior: "LINEAR",
    items: [item(1, "Which is cat?", [choice("a", "cat", true), choice("b", "cot", false)])],
  };
  const generated = {
    ...own,
    configuration: { maxItems: 2, nextItemsSize: 1 },
    items: [
      own.items[0],
      item(2, "Which is dog?", [choice("a", "dog", true), choice("b", "dig", false)]),
    ],
  };
  // The server's state, mirrored: the draft, its assessment edit, and the one run.
  let detail = null;
  let edit = null;
  let run = null;
  const starts = [];
  const accepts = [];
  const saves = [];
  const bump = () => {
    detail = {
      ...detail,
      draft: { ...detail.draft, contentRevision: `${detail.draft.contentRevision}+` },
    };
    return detail.draft;
  };
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    const conflict = () =>
      json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
    if (p === `${base}/act_test` && request.method() === "GET" && detail) return json(detail);
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: run ? [{ ...run, hasCandidate: run.status === "succeeded" }] : [] });
    if (p === `${base}/act_test/generate-assessment`) {
      const body = request.postDataJSON();
      starts.push(body);
      if (body.expectedRevision !== detail.draft.contentRevision) return conflict();
      if (run?.status === "running")
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      run = {
        runId: "run_assess",
        kind: "assessment",
        activityId: "act_test",
        projectId,
        draftId: detail.draft.draftId,
        inputRevision: body.expectedRevision,
        agentId: body.agentId,
        sessionId: "session_assess",
        status: "running",
        createdAt: "2026-09-25T10:00:00Z",
        finishedAt: null,
        error: null,
        candidate: null,
      };
      const started = { ...run };
      // The agent finishes by the next look at the history.
      run = { ...run, status: "succeeded", finishedAt: "2026-09-25T10:01:00Z" };
      return json(started, 202);
    }
    if (p === `${base}/act_test/runs/run_assess/candidate`)
      return json({ candidate: JSON.stringify(generated) });
    if (p === `${base}/act_test/runs/run_assess/accept-assessment`) {
      const body = request.postDataJSON();
      accepts.push(body);
      if (body.expectedRevision !== run.inputRevision) return conflict();
      edit = generated;
      return json(bump());
    }
    if (p === `${base}/act_test/module-documents` && request.method() === "GET")
      return json({
        source: "checkout",
        canonicalRefNum: 12,
        configuration: null,
        assessment: {
          file: "assessments/words-12.json",
          value: edit ?? own,
          edited: !!edit,
          stale: false,
          editable: true,
        },
      });
    if (p === `${base}/act_test/module-documents/assessment` && request.method() === "PUT") {
      const body = request.postDataJSON();
      saves.push(body);
      if (body.expectedRevision !== detail.draft.contentRevision) return conflict();
      edit = body.value;
      return json(bump());
    }
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify({ ...spec, runtime: { ...spec.runtime, usesAssessment: true } }));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await page.reload();
  detail = await page.evaluate((url) => fetch(url).then((r) => r.json()), `${base}/act_test`);
  const saved = detail.draft.contentRevision;

  await openSection(page, "Assessment Data");
  await expect(page.getByText("1 item.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Generate assessment", exact: true }).click();
  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0]).toEqual({ agentId: "default_agent", expectedRevision: saved });

  // The result waits beside the current assessment until the author uses it.
  const candidate = page.getByRole("region", { name: "Generated assessment", exact: true });
  await expect(candidate.getByText("Current: 1 item · Generated: 2 items")).toBeVisible();
  await candidate.getByRole("button", { name: "Use it", exact: true }).click();
  await expect.poll(() => accepts.length).toBe(1);
  expect(accepts[0]).toEqual({ expectedRevision: saved });
  await expect(candidate).toHaveCount(0);
  const second = page.getByRole("listitem", { name: "Item 2 · words-12-2", exact: true });
  await expect(second.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(
    "Which is dog?",
  );

  // Editing without JSON: the question, and which choice is right.
  const save = page.getByRole("button", { name: "Save items", exact: true });
  await expect(save).toBeDisabled();
  await second.getByRole("textbox", { name: "Question", exact: true }).fill("Which one is dig?");
  const correct = second.getByRole("radio", { name: "Choice 2 is correct", exact: true });
  await correct.check();
  await expect(
    second.getByRole("radio", { name: "Choice 1 is correct", exact: true }),
  ).not.toBeChecked();
  // Removing down to one choice is not offered.
  await expect(second.getByRole("button", { name: "Remove choice 1", exact: true })).toBeDisabled();
  // A blocker names the item and holds the save until it is fixed.
  await second.getByRole("textbox", { name: "Choice 1", exact: true }).fill("");
  await expect(
    page.getByRole("alert").getByText("Item 2 has a choice with no text."),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await second.getByRole("textbox", { name: "Choice 1", exact: true }).fill("dog");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].expectedRevision).toBe(`${saved}+`);
  expect(saves[0].value.title).toBe("words-12");
  expect(saves[0].value.items[1]).toEqual({
    title: "words-12-2",
    interactionKey: "SIMPLE_CHOICE",
    configuration: {
      shuffle: false,
      question: { text: "Which one is dig?" },
      simpleChoice: [choice("a", "dog", false), choice("b", "dig", true)],
    },
  });
  await expect(page.getByText("Saved the document.")).toBeVisible();
  await expect(save).toBeDisabled();

  // The header toggles between the items and the same document as JSON.
  const view = page.getByRole("group", { name: "Assessment view", exact: true });
  await expect(view.getByRole("button", { name: "Items", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Switching views moves neither the toggle nor the notes under the header.
  const origin = page.getByText(/^assessments\/words-12\.json, from /);
  const where = async () => ({
    toggle: await view.boundingBox(),
    notes: await origin.boundingBox(),
  });
  const before = await where();
  await view.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save Assessment", exact: true })).toBeVisible();
  expect(await where()).toEqual(before);
  // CodeMirror draws only the lines in view, so this checks the first item.
  await expect(page.getByRole("textbox", { name: /^Document JSON/ })).toContainText(
    '"text": "Which is cat?"',
  );
  await expect(save).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save Assessment", exact: true })).toBeDisabled();
  await view.getByRole("button", { name: "Items", exact: true }).click();
  await expect(save).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("speech coverage says what failed, filters the list, and tries one again", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const narration = (key, script) => ({
    key,
    type: "audio",
    description: key,
    script,
    usages: [{ sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [narration("hello", "Hello"), narration("bye", "Bye"), narration("quiet", "")],
          },
        },
      }),
    }),
  );
  const generated = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/act_test/generate-audio`) generated.push(request.postDataJSON());
    if (p !== `${base}/act_test/runs` || request.method() !== "GET") return route.fallback();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            kind: "audio",
            runId: "run_voice",
            activityId: "act_test",
            projectId,
            sessionId: "session_voice",
            status: "failed",
            error: "The voice timed out.",
            createdAt: "2026-09-23T10:00:00Z",
            inputRevision: "1",
            audio: { language: "en-US", assetKey: "hello", voice: "Kore" },
            hasCandidate: false,
          },
        ],
      }),
    });
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  // The history was read before the stub above; read it again.
  await page.reload();
  await openSection(page, "Speech coverage");

  const filters = page.getByRole("group", { name: "Show", exact: true });
  await expect(filters.getByRole("button")).toHaveText([
    "All 3",
    "Needs speech 2",
    "Failed 1",
    "Needs a script 1",
  ]);
  await filters.getByRole("button", { name: /^Failed/ }).click();
  const failed = page.getByRole("button", { name: /^hello/ });
  await expect(failed).toContainText("Failed");
  await expect(failed).toHaveAttribute("title", "The voice timed out.");
  await expect(page.getByRole("button", { name: /^bye/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => generated.length).toBe(1);
  expect(generated[0]).toMatchObject({ language: "en-US", assetKey: "hello" });
  expect(f.errors).toEqual([]);
});

test("applies a whole proposal at once, and discards one after asking", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  let proposal = {
    summary: "A warmer opening and a matching specification.",
    changes: [
      { target: "description", text: "Scene 1: Welcome" },
      { target: "spec", spec: { ...spec, title: "Warm words" } },
    ],
  };
  const applied = [];
  let discards = 0;
  // The draft as the fixture last served it, to answer the apply with.
  let served = null;
  page.on("response", async (response) => {
    if (
      new URL(response.url()).pathname === `${base}/act_test` &&
      response.request().method() === "GET"
    )
      served = await response.json().catch(() => served);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({
        runs: [
          {
            kind: "assist",
            runId: "run_assist",
            activityId: "act_test",
            projectId,
            sessionId: "session_assist",
            status: "succeeded",
            createdAt: "2026-09-23T11:00:00Z",
            inputRevision: "1",
            hasCandidate: false,
            error: null,
          },
        ],
      });
    if (p === `${base}/act_test/runs/run_assist/proposal`) return json({ proposal, error: null });
    if (p === `${base}/act_test/runs/run_assist/proposal/apply`) {
      applied.push(request.postDataJSON());
      return json({
        ...served.draft,
        description: "Scene 1: Welcome",
        contentRevision: "applied",
      });
    }
    if (p === `${base}/act_test/runs/run_assist/proposal/discard`) {
      discards++;
      proposal = null;
      return json({ proposal: null, error: null });
    }
    return route.fallback();
  });
  await page.reload();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Chat", exact: true });
  await panel.getByRole("button", { name: "Apply 2 changes", exact: true }).click();
  await expect.poll(() => applied.length).toBe(1);
  expect(applied[0]).toHaveProperty("expectedRevision");
  await openSection(page, "Description");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Scene 1: Welcome",
  );

  // A new proposal can be set aside instead; the author confirms first.
  proposal = { summary: "", changes: [{ target: "description", text: "Something else" }] };
  await page.reload();
  // The side panel is remembered across reloads, so it is still open.
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect.poll(() => discards).toBe(1);
  await expect(panel.getByRole("region", { name: "Proposed changes" })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("the conversation panel lists its threads and shows the open one's proposal", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const thread = (runId, createdAt, focus) => ({
    kind: "assist",
    runId,
    activityId: "act_test",
    projectId,
    sessionId: `session_${runId}`,
    status: "succeeded",
    createdAt,
    inputRevision: "1",
    hasCandidate: false,
    error: null,
    assist: { focus },
  });
  const summaries = { run_new: "Newest idea.", run_old: "An older idea." };
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/runs` && route.request().method() === "GET")
      return json({
        runs: [
          thread("run_old", "2026-09-20T10:00:00Z", { section: "scenes", sceneId: "intro" }),
          thread("run_new", "2026-09-22T10:00:00Z", null),
        ],
      });
    const match = p.match(/\/runs\/(run_new|run_old)\/proposal$/);
    if (match)
      return json({
        proposal: {
          summary: summaries[match[1]],
          changes: [{ target: "description", text: `${match[1]} script` }],
        },
        error: null,
      });
    return route.fallback();
  });
  await page.reload();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Chat", exact: true });
  await expect(panel.getByText("Newest idea.", { exact: true })).toBeVisible();
  const threads = panel.getByRole("button", { name: "Conversation", exact: true });
  await expect(threads).toContainText("About the whole activity");
  await threads.click();
  await page.getByRole("option", { name: /^About scene intro/ }).click();
  await expect(panel.getByText("An older idea.", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("a run's session transcript opens in place in the Sessions panel", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await generateSpecification(page);
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/sessions/session_test/messages")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      });
    return route.fallback();
  });
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Sessions", exact: true });
  // The accessible name carries which run this toggle is for, so two same-kind runs are
  // distinguishable to assistive tech even though the visible label is always "Show"/"Hide".
  const toggle = panel.getByRole("button", { name: /^Show: Specification,/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(panel.getByRole("link", { name: /Open full page/ })).toBeVisible();
  await expect(page).toHaveURL(/\/activities\//);
  await panel.getByRole("button", { name: /^Hide: Specification,/ }).click();
  await expect(panel.getByRole("link", { name: /Open full page/ })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

/** A mono 16-bit PCM WAV of a quiet tone, `seconds` long, for clips the browser can decode. */
function toneWav(seconds, rate = 8000) {
  const frames = Math.round(seconds * rate);
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1)
    bytes.writeInt16LE(Math.round(Math.sin(frame / 8) * 8000), 44 + frame * 2);
  return bytes;
}

test("trims a stretch out of a narration into a candidate, and Save binds the shorter clip", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const clip = toneWav(2);
  const stored = [];
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "hello",
                type: "audio",
                description: "Greeting",
                script: "Hello",
                path: "media/loom/words/words-1/uploads/hello-00000000.wav",
                usages: [
                  { sceneId: "intro", sourceKey: "hello", occurrence: 1, sceneOccurrenceCount: 1 },
                ],
              },
            ],
          },
        },
      }),
    }),
  );
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/act_test/media-upload`)
      return route.fulfill({ contentType: "audio/wav", body: clip });
    if (p === `${base}/act_test/media-uploads` && request.method() === "POST") {
      const input = request.postDataJSON();
      const record = {
        path: "media/loom/words/words-1/uploads/hello-trimmed-1234abcd.wav",
        name: input.name,
        kind: "audio",
        mimeType: "audio/wav",
        byteLength: Buffer.from(input.dataBase64, "base64").byteLength,
        sha256: "b".repeat(64),
        updatedAt: "2026-09-23T10:00:00.000Z",
      };
      stored.push(record);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(record),
      });
    }
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  // The card draws the clip it is working on straight away.
  const card = page.getByRole("region", { name: "English audio", exact: true });
  const wave = card.getByRole("slider", { name: /^Waveform: Current audio/ });
  await expect(wave).toBeVisible();
  await expect(page.getByText("Drag across the waveform", { exact: false })).toBeVisible();

  // Drag across the middle half of the clip.
  const box = await wave.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText(/ remains$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Play remaining", exact: true })).toBeVisible();

  // The same from the keyboard: Escape clears, Enter marks the start and then the end.
  await wave.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Remove selection" })).toHaveCount(0);
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Start marked at/)).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/ remains$/)).toBeVisible();
  await page.getByRole("button", { name: "Remove selection", exact: true }).click();
  await expect.poll(() => stored.length).toBe(1);
  // Half the clip is gone, at the clip's own rate: a second of an 8 kHz, 16-bit mono tone.
  expect(stored[0].byteLength).toBeGreaterThan(44 + 7000 * 2);
  expect(stored[0].byteLength).toBeLessThan(44 + 9000 * 2);
  // The shorter clip is a candidate: heard in place of the current one, bound only on Save.
  const trimmed = card.locator('audio[aria-label="Trimmed candidate"]');
  await expect(trimmed).toHaveAttribute(
    "src",
    `${base}/act_test/media-upload?path=${encodeURIComponent(stored[0].path)}`,
  );
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const path = card.getByRole("textbox", { name: /^Media path/ });
  await expect(path).toHaveValue("media/loom/words/words-1/uploads/hello-00000000.wav");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(path).toHaveValue("media/loom/words/words-1/uploads/hello-trimmed-1234abcd.wav");
  await expect(
    card.getByText("Generate or upload a candidate to compare before saving."),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("shows a narration's file details", async ({ page }) => {
  const f = await fixture(page);
  const clip = toneWav(2);
  const path = "media/audio/hello.wav";
  const uploadPath = "media/loom/words/words-1/uploads/clip-1234abcd.wav";
  // Stubbed before the activity opens, so its first upload listing holds the clip.
  let statsReads = 0;
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === `${base}/act_test/sandbox/media/audio/hello.wav`)
      return route.fulfill({ contentType: "audio/wav", body: clip });
    if (p === `${base}/act_test/sandbox/media/audio/lost.wav`)
      return route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
    if (p === `${base}/act_test/media-upload`)
      return route.fulfill({ contentType: "audio/wav", body: clip });
    if (p === `${base}/act_test/media-uploads` && route.request().method() === "GET")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          media: [
            {
              path: uploadPath,
              name: "clip.wav",
              kind: "audio",
              mimeType: "audio/wav",
              byteLength: clip.byteLength,
              sha256: "c".repeat(64),
              updatedAt: "2026-09-25T10:00:00.000Z",
            },
          ],
        }),
      });
    if (p !== `${base}/act_test/media-stats`) return route.fallback();
    statsReads += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        media: [
          {
            language: "en-US",
            key: "hello",
            type: "audio",
            bound: true,
            bytes: clip.byteLength,
            mimeType: "audio/wav",
          },
          {
            language: "en-US",
            key: "bye",
            type: "audio",
            bound: false,
            bytes: null,
            mimeType: null,
          },
          {
            language: "en-US",
            key: "lost",
            type: "audio",
            bound: true,
            bytes: null,
            mimeType: "audio/wav",
          },
          {
            language: "en-US",
            key: "clip",
            type: "audio",
            bound: true,
            bytes: null,
            mimeType: null,
          },
        ],
      }),
    });
  });
  await create(page);
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "hello",
                type: "audio",
                description: "Greeting",
                script: "Hello",
                path,
                usages: [
                  { sceneId: "intro", sourceKey: "hello", occurrence: 1, sceneOccurrenceCount: 1 },
                ],
              },
              {
                key: "bye",
                type: "audio",
                description: "Farewell",
                script: "Bye",
                usages: [
                  { sceneId: "intro", sourceKey: "bye", occurrence: 1, sceneOccurrenceCount: 1 },
                ],
              },
              {
                key: "lost",
                type: "audio",
                description: "Missing file",
                script: "Lost",
                path: "media/audio/lost.wav",
                usages: [
                  { sceneId: "intro", sourceKey: "lost", occurrence: 1, sceneOccurrenceCount: 1 },
                ],
              },
              {
                key: "clip",
                type: "audio",
                description: "Uploaded clip",
                script: "Clip",
                path: uploadPath,
                usages: [
                  { sceneId: "intro", sourceKey: "clip", occurrence: 1, sceneOccurrenceCount: 1 },
                ],
              },
            ],
          },
        },
      }),
    }),
  );
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  const details = page.getByRole("region", { name: "File details", exact: true });
  await expect(details.getByRole("term")).toHaveText(["Format", "Size", "Length", "Bitrate"]);
  await expect(details.getByRole("definition")).toHaveText(["WAV", "31 KB", "0:02.0", "128 kbps"]);
  expect(statsReads).toBe(1);

  // An unbound narration has no file, so no details.
  await page.getByRole("treeitem", { name: /bye/ }).first().click();
  await expect(page.getByRole("heading", { name: "bye", exact: true })).toBeVisible();
  await expect(details).toHaveCount(0);

  // A bound file that is missing shows dashes, not an error or an endless "Measuring…".
  await page.getByRole("treeitem", { name: /lost/ }).first().click();
  await expect(page.getByRole("heading", { name: "lost", exact: true })).toBeVisible();
  await expect(details.getByRole("definition")).toHaveText(["WAV", "—", "—", "—"]);

  // An upload's size and format come from the upload listing, and it plays from media-upload.
  await page.getByRole("treeitem", { name: /clip/ }).first().click();
  await expect(page.getByRole("heading", { name: "clip", exact: true })).toBeVisible();
  await expect(details.getByRole("definition")).toHaveText(["WAV", "31 KB", "0:02.0", "128 kbps"]);
  expect(f.errors).toEqual([]);
});

test("Activity Stats counts and weighs the media plan by type and language", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p !== `${base}/act_test/media-stats`) return route.fallback();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        media: [
          {
            language: "en-US",
            key: "cat",
            type: "image",
            bound: true,
            bytes: 2048,
            mimeType: "image/png",
          },
          {
            language: "en-US",
            key: "hi",
            type: "audio",
            bound: true,
            bytes: 1024,
            mimeType: "audio/wav",
          },
          {
            language: "es-MX",
            key: "hi",
            type: "audio",
            bound: true,
            bytes: null,
            mimeType: "audio/wav",
          },
        ],
      }),
    });
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openSection(page, "Activity Stats");
  const byType = page.getByRole("table").first();
  await expect(byType.getByRole("row")).toHaveText([
    "Asset typeAssetsBoundTotal size",
    /^Images112(\.0)? KB$/,
    /^Audio221(\.0)? KB$/,
    /^All assets333(\.0)? KB$/,
  ]);
  await expect(page.getByRole("table")).toHaveCount(2);
  await expect(page.getByText("1 bound file was not found", { exact: false })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("the header switches between a product's refs and names one, as Loom's Refs do", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const identities = [];
  // Only what the switcher reads; the page's own draft comes from the fixture.
  const ref = { productCode: "words", collectionId: "col_test", archived: false };
  let current = null;
  page.on("response", async (response) => {
    if (
      new URL(response.url()).pathname === `${base}/act_test` &&
      response.request().method() === "GET"
    )
      current = await response.json().catch(() => current);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === base && request.method() === "GET" && url.searchParams.get("collectionId"))
      return json({
        activities: [
          { ...ref, id: "act_test", refNum: 12, displayName: null, stable: false },
          { ...ref, id: "act_other", refNum: 13, displayName: "Round two", stable: true },
        ],
      });
    if (url.pathname === `${base}/act_test/identity`) {
      const body = request.postDataJSON();
      identities.push(body);
      return json({ ...current, displayName: body.displayName, stable: body.stable });
    }
    return route.fallback();
  });
  await page.reload();
  const refs = refMenu(page);
  await expect(refs).toContainText("Ref 12");
  await refs.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Ref 13 · Round two · stable" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await refAction(page, "Ref settings");
  const dialog = page.getByRole("dialog", { name: "words, ref 12" });
  await dialog.getByRole("textbox", { name: /^Display name/ }).fill("Round one");
  await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => identities.length).toBe(1);
  expect(identities[0]).toEqual({ displayName: "Round one", stable: true });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Stable", { exact: true }).first()).toBeVisible();

  await refs.click();
  await page.getByRole("menuitemradio", { name: "Ref 13 · Round two · stable" }).click();
  await expect(page).toHaveURL(/activities\/act_other$/);
  expect(f.errors).toEqual([]);
});

test("adds a language, translates a narration into it, and translates the rest at once", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const narration = (key, script) => ({
    key,
    type: "audio",
    description: key,
    ...(script ? { script } : {}),
    usages: [{ sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: { "en-US": [narration("hello", "Hello"), narration("bye", "Bye")] },
        },
      }),
    }),
  );
  const languages = [];
  const translations = [];
  const stages = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/language-setup`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          defaultLanguage: "en-US",
          languages: [
            { code: "en-US", label: "English" },
            { code: "es-MX", label: "Spanish" },
            { code: "ro-RO", label: "Romanian" },
          ],
        }),
      });
    if (p === `${base}/act_test/languages`) {
      languages.push(request.postDataJSON());
      // Answer as the server does: the fixture's own plan route stores the new group.
      return route.fallback({
        url: request.url().replace(/\/languages$/, "/media"),
        postData: JSON.stringify({
          expectedRevision: request.postDataJSON().expectedRevision,
          manifest: {
            productCode: "words",
            refNum: 12,
            assets: {
              "en-US": [narration("hello", "Hello"), narration("bye", "Bye")],
              "es-MX": [
                narration("hello"),
                { ...narration("bye", "Adiós"), translatedFrom: "Goodbye" },
              ],
            },
          },
        }),
      });
    }
    if (p === `${base}/act_test/generate-media-text`) translations.push(request.postDataJSON());
    if (p === `${base}/act_test/pipeline` && request.method() === "POST") {
      stages.push(request.postDataJSON());
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          pipelineId: "pipeline_1",
          projectId,
          activityId: "act_test",
          selection: "translations",
          status: "running",
          steps: [
            {
              step: "translations",
              status: "running",
              detail: null,
              done: 0,
              total: 2,
              runIds: [],
            },
          ],
          currentRunId: null,
          currentSessionId: null,
          error: null,
          startedAt: "2026-09-23T12:00:00Z",
          finishedAt: null,
        }),
      });
    }
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await page.reload();
  await openSection(page, "Speech coverage");

  await page.getByRole("button", { name: "Add a language", exact: true }).click();
  await expect(page.getByRole("option", { name: "English", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Spanish", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => languages.length).toBe(1);
  expect(languages[0]).toMatchObject({ language: "es-MX" });

  // Spanish is open now: one line never translated, one translated from an older English line.
  await expect(page.getByRole("button", { name: /^hello/ })).toContainText("Needs translation");
  await expect(page.getByRole("button", { name: /^bye/ })).toContainText("English changed");
  // A line with no script yet is translated and then spoken, in one go: every one in this
  // language through the narration stages...
  await page.getByRole("button", { name: "Translate and speak 2", exact: true }).click();
  await expect.poll(() => stages.length).toBe(1);
  expect(stages[0]).toMatchObject({ stage: "narration", language: "es-MX" });
  expect(stages[0].assetKey).toBeUndefined();
  // The Stages panel opens to follow that run; close it to get back to the list.
  await page.getByRole("button", { name: "Stages", exact: true }).click();
  // ...or one line on its own.
  await page.getByRole("button", { name: "Translate and speak", exact: true }).click();
  await expect.poll(() => stages.length).toBe(2);
  expect(stages[1]).toMatchObject({ stage: "narration", language: "es-MX", assetKey: "hello" });
  await page.getByRole("button", { name: "Stages", exact: true }).click();
  // A line that already has speech only needs its words brought up to date.
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect.poll(() => translations.length).toBe(1);
  expect(translations[0]).toMatchObject({ language: "es-MX", assetKey: "bye", translate: true });
  expect(f.errors).toEqual([]);
});

test("a narration shows a card for every language, the default first, and translates an empty one", async ({
  page,
}) => {
  const f = await fixture(page);
  const translations = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === `${base}/act_test/generate-media-text` &&
      request.method() === "POST"
    )
      translations.push(request.postDataJSON());
  });
  await create(page);
  const narration = (key, script, extra = {}) => ({
    key,
    type: "audio",
    description: key,
    ...(script ? { script } : {}),
    usages: [{ sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
    ...extra,
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              narration("hello", "Hello", {
                path: "media/loom/words/words-1/uploads/hello-1234abcd.wav",
              }),
            ],
            "es-MX": [narration("hello")],
          },
        },
      }),
    }),
  );
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  // One card per language, the default first, each named by the product's language label.
  const cards = page.getByRole("region", { name: /^(English|Spanish) audio$/ });
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAccessibleName("English audio");
  const english = page.getByRole("region", { name: "English audio", exact: true });
  const spanish = page.getByRole("region", { name: "Spanish audio", exact: true });
  await expect(english.getByRole("textbox", { name: /^English script/ })).toHaveValue("Hello");
  await expect(
    english.getByRole("button", { name: "Regenerate audio", exact: true }),
  ).toBeVisible();
  // Spanish has no script yet: it is translated from English before it can be spoken.
  await expect(spanish.getByRole("textbox", { name: /^Spanish script/ })).toHaveValue("");
  await expect(spanish.getByText("No audio yet for Spanish.", { exact: true })).toBeVisible();
  await expect(spanish.getByRole("button", { name: /^(Generate|Regenerate) audio$/ })).toHaveCount(
    0,
  );
  // The bound recording can be downloaded as the player would fetch it, from Advanced.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(
    english.getByRole("link", { name: "Download current", exact: true }),
  ).toHaveAttribute(
    "href",
    `${base}/act_test/sandbox/media/loom/words/words-1/uploads/hello-1234abcd.wav`,
  );
  // Spanish has no recording yet, so there is nothing to download.
  await expect(spanish.getByRole("link", { name: "Download current", exact: true })).toHaveCount(0);
  await spanish.getByRole("button", { name: "Translate from English", exact: true }).click();
  await expect.poll(() => translations.length).toBe(1);
  expect(translations[0]).toMatchObject({ language: "es-MX", assetKey: "hello", translate: true });
  expect(f.errors).toEqual([]);
});

test("the open section is in the address, so a link or a reload lands on it", async ({ page }) => {
  await fixture(page);
  await create(page);
  await expect(page).toHaveURL(/section=specification/);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Specification JSON", exact: true }),
  ).toBeVisible();
  await page.goto(`${origin}/activities/act_test?section=nonsense`);
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toBeVisible();
});

test("marks an audio asset as music or a sound effect, with how the module plays it", async ({
  page,
}) => {
  const f = await fixture(page);
  const saved = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `${base}/act_test/media` && request.method() === "PUT")
      saved.push(request.postDataJSON().manifest);
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          {
            key: "welcome",
            type: "audio",
            description: "Greeting",
            script: "Hello",
            usages: [{ sceneId: "intro" }],
          },
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  // Narration shows a voice; the audio type is chosen in the Advanced view.
  await expect(page.getByRole("button", { name: /^Voice: / })).toBeVisible();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();

  // Music loops quietly by default, and is not spoken.
  await page.getByRole("button", { name: "Audio type", exact: true }).click();
  await page.getByRole("option", { name: "Music", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Loop", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("slider", { name: "Volume", exact: true })).toHaveValue("0.4");
  await expect(page.getByRole("button", { name: /^Voice: / })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Generation prompt/ })).toBeVisible();
  await page.getByRole("switch", { name: "Loop", exact: true }).click();
  await page.getByRole("slider", { name: "Volume", exact: true }).fill("0.25");
  await expect(page.getByText("25%", { exact: true })).toBeVisible();

  // Each pause between these edits may save on its own; the last save carries all of them.
  await expect
    .poll(() => saved.at(-1)?.assets["en-US"][0])
    .toMatchObject({
      key: "welcome",
      kind: "music",
      channel: "music",
      loop: false,
      volume: 0.25,
    });

  // Back to narration drops all four together.
  await page.getByRole("button", { name: "Audio type", exact: true }).click();
  await page.getByRole("option", { name: "Narration", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Loop", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Voice: / })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("filters narration by instruction type, as main instructions or scaffolding", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  const narration = (key, script) => ({
    key,
    type: "audio",
    description: "",
    script,
    usages: [{ sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          narration("tap_rock", "Tap the rock"),
          narration("hint_1", "Try again"),
          narration("welcome", "Hello"),
          narration("retry_2", ""),
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();

  await openSection(page, "Speech coverage");
  const row = (key) => page.getByRole("button", { name: new RegExp(`^${key} · `) });
  const types = page.getByRole("group", { name: "Show by instruction type", exact: true });
  const states = page.getByRole("group", { name: "Show", exact: true });
  await expect(types.getByRole("button", { name: "All 4", exact: true })).toBeVisible();
  // Every line stays under All; each instruction names its type in text.
  await expect(row("welcome")).toBeVisible();
  await expect(row("tap_rock").getByText("Main instruction", { exact: true })).toBeVisible();
  await expect(row("hint_1").getByText("Scaffolding", { exact: true })).toBeVisible();
  await expect(row("welcome").getByText(/Main instruction|Scaffolding/)).toHaveCount(0);

  await types.getByRole("button", { name: "Scaffolding 2", exact: true }).click();
  await expect(row("hint_1")).toBeVisible();
  await expect(row("retry_2")).toBeVisible();
  await expect(row("tap_rock")).toHaveCount(0);
  await expect(row("welcome")).toHaveCount(0);
  // The state chips count within the chosen type.
  await expect(states.getByRole("button", { name: "All 2", exact: true })).toBeVisible();
  await expect(states.getByRole("button", { name: "Needs a script 1", exact: true })).toBeVisible();

  // Both filters narrow the list together, and the type chips count within the state.
  await states.getByRole("button", { name: "Needs a script 1", exact: true }).click();
  await expect(row("retry_2")).toBeVisible();
  await expect(row("hint_1")).toHaveCount(0);
  await expect(types.getByRole("button", { name: "All 1", exact: true })).toBeVisible();
  await expect(
    types.getByRole("button", { name: "Main instructions 0", exact: true }),
  ).toBeVisible();
  await expect(types.getByRole("button", { name: "Scaffolding 1", exact: true })).toBeVisible();

  // A chosen state chip stays while the type leaves it empty.
  await types.getByRole("button", { name: "Main instructions 0", exact: true }).click();
  await expect(row("retry_2")).toHaveCount(0);
  await expect(
    states.getByRole("button", { name: "Needs a script 0", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await states.getByRole("button", { name: "All 1", exact: true }).click();
  await expect(row("tap_rock")).toBeVisible();
  await expect(row("hint_1")).toHaveCount(0);
  await expect(row("welcome")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("opens an image full size and closes it with Escape", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await page.getByRole("textbox", { name: /^Media path/ }).fill("media/images/cat.png");
  await mediaAutosaved(page);
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  await expect(page.getByText("Select the image to see it full size.")).toBeVisible();
  const thumbnail = page.getByRole("button", { name: "A cat", exact: true });
  const source = await thumbnail.locator("img").getAttribute("src");
  expect(source).toMatch(/media-image\?/);

  await thumbnail.click();
  const dialog = page.getByRole("dialog", { name: "A cat", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: "A cat", exact: true })).toHaveAttribute(
    "src",
    source,
  );
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  // The page behind is still where it was: the preview and its dimensions stayed.
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();

  await thumbnail.click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await thumbnail.click();
  await expect(dialog).toBeVisible();
  // Clicking the full-size image keeps focus in the dialog, so Tab stays on its close button.
  await dialog.getByRole("img", { name: "A cat", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  // The new-tab link stays as a second way to open (and save) the image.
  await expect(page.getByRole("link", { name: "Open full-size image" })).toHaveAttribute(
    "href",
    source,
  );
  expect(f.errors).toEqual([]);
});

test("tags a product, filters the list by tag, and deletes an activity after confirming", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  // The list and the two routes this feature adds, with the server's rules: tags belong to
  // the product, and deleting archives the ref so it leaves every list.
  const record = (id, productCode, refNum, title, tags) => ({
    id,
    collectionId: "col_test",
    productId: `prd_${productCode}`,
    productCode,
    refNum,
    title,
    displayName: null,
    stable: false,
    activityType: "standard",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    archived: false,
    tags,
  });
  let wordTags = [];
  let deleted = false;
  let refuseDelete = true;
  const tagWrites = [];
  const deletes = [];
  const list = () =>
    [
      record("act_test", "words", 12, "Sight words", wordTags),
      record("act_letters", "letters", 1, "Letter hunt", ["math"]),
    ].filter((entry) => !(deleted && entry.id === "act_test"));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === base && request.method() === "GET") return json({ activities: list() });
    if (url.pathname === `${base}/act_test/identity`)
      return json({ ...list()[0], ...request.postDataJSON() });
    if (url.pathname === `${base}/act_test/tags` && request.method() === "PUT") {
      const body = request.postDataJSON();
      tagWrites.push(body);
      wordTags = body.tags;
      return json({ tags: wordTags });
    }
    if (url.pathname === `${base}/act_test` && request.method() === "DELETE") {
      deletes.push(url.pathname);
      // The first attempt meets a sibling that still builds on this ref's module.
      if (refuseDelete) {
        refuseDelete = false;
        return json(
          { error: { code: "canonical_has_refs", message: "Delete the other refs first." } },
          409,
        );
      }
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await page.reload();

  await refAction(page, "Ref settings");
  const settings = page.getByRole("dialog", { name: "words, ref 12" });
  const tagInput = settings.getByRole("textbox", { name: /^Tags/ });
  await tagInput.fill("Phonics");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await tagInput.fill("  grade   1 ");
  await tagInput.press("Enter");
  await tagInput.fill("phonics");
  await tagInput.press("Enter");
  await tagInput.fill("pilot");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await settings.getByRole("button", { name: "Remove tag pilot", exact: true }).click();
  await tagInput.fill("x".repeat(33));
  await tagInput.press("Enter");
  await expect(settings.getByText("A tag can be at most 32 characters.")).toBeVisible();
  await tagInput.fill("");
  await expect(settings.getByRole("list", { name: "Tags" }).getByRole("listitem")).toHaveText([
    "Phonics",
    "grade 1",
  ]);
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(tagWrites).toEqual([{ tags: ["Phonics", "grade 1"] }]);

  // Back through the app, not a page load: the list open behind the activity must show the
  // tags just saved.
  await page.getByRole("link", { name: "All activities" }).click();
  const filter = page.getByRole("group", { name: "Filter by tag" });
  await expect(filter.getByRole("button")).toHaveText([
    "All · 2",
    "grade 1 · 1",
    "math · 1",
    "Phonics · 1",
  ]);
  // Each product is its own group now, so cards and the ref link are found across the page.
  // The card itself no longer prints tags (the home page's ActivityCard is status-focused);
  // the tag filter above is what proves they saved. Excluded by text rather than by "has a
  // link" alone: a fixture with `hasPlan: true` would turn the group's own "+ New ref" item
  // into a link too, and it must never count as an activity card.
  const cards = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link") })
    .filter({ hasNotText: "New ref" });
  const sight = page.getByRole("link", { name: /Sight words/ });
  await expect(sight).toBeVisible();
  await filter.getByRole("button", { name: "math · 1", exact: true }).click();
  await expect(filter.getByRole("button", { name: "math · 1", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sight).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Letter hunt/ })).toBeVisible();
  // The tag and the search narrow together.
  await page.getByRole("textbox", { name: "Search activities", exact: true }).fill("sight");
  await expect(page.getByText("No activities match this search.")).toBeVisible();
  await filter.getByRole("button", { name: "Phonics · 1", exact: true }).click();
  await expect(sight).toBeVisible();
  await page.getByRole("textbox", { name: "Search activities", exact: true }).fill("");
  await filter.getByRole("button", { name: "All · 2", exact: true }).click();
  await expect(cards).toHaveCount(2);

  await sight.click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await refAction(page, "Ref settings");
  await settings.getByRole("button", { name: "Delete activity", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete activity" });
  await expect(confirm).toContainText('Delete "Sight words" (ref 12)?');
  await expect(confirm).toContainText("Its drafts and media stay on disk.");
  await confirm.getByRole("button", { name: "Delete activity", exact: true }).click();
  await expect(confirm.getByRole("alert")).toHaveText(
    "Other refs of this product build on this ref's module. Delete them first.",
  );
  await expect(page).toHaveURL(/activities\/act_test$/);
  await confirm.getByRole("button", { name: "Delete activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByText('Deleted "Sight words".')).toBeVisible();
  await expect(sight).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Letter hunt/ })).toBeVisible();
  expect(deletes).toHaveLength(2);
  expect(f.errors).toEqual([]);
});

test("the home page groups refs under their product code", async ({ page }) => {
  const f = await fixture(page);
  const record = (id, refNum, title) => ({
    id,
    collectionId: "col_test",
    productId: "prd_ants",
    productCode: "ants",
    refNum,
    title,
    displayName: null,
    stable: false,
    activityType: "standard",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    archived: false,
    tags: [],
  });
  const activities = [record("act_ants1", 1, "ants 1"), record("act_ants2", 2, "ants 2")];
  const summaries = Object.fromEntries(
    activities.map((entry, index) => [
      entry.id,
      {
        canonical: index === 0,
        hasPlan: false,
        done: 0,
        total: 3,
        status: { kind: "next", milestone: "spec" },
      },
    ]),
  );
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === base && request.method() === "GET")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          url.searchParams.get("summary") === "1" ? { activities, summaries } : { activities },
        ),
      });
    return route.fallback();
  });
  await page.goto(`${origin}/activities`);
  const group = page.getByRole("region", { name: /ants/ });
  const toggle = group.getByRole("button", { name: /ants/ });
  await expect(group.getByRole("link", { name: /ants 1/ })).toBeVisible();
  await expect(group.getByText("Specification next").first()).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(group.getByRole("link", { name: /ants 1/ })).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(f.errors).toEqual([]);
});

/** Files uploaded across the project, as `GET /media-library` reports them. */
function libraryFile(name, activityId, productCode, refNum, activityTitle, overrides = {}) {
  return {
    path: `media/loom/words/words-1/uploads/${name}`,
    name,
    kind: "image",
    mimeType: "image/png",
    byteLength: 2048,
    updatedAt: "2026-09-24T10:00:00.000Z",
    activityId,
    activityTitle,
    productCode,
    refNum,
    ...overrides,
  };
}

test("browses the project's media, switches to the table, and downloads two files as a zip", async ({
  page,
}) => {
  const f = await fixture(page);
  const files = [
    libraryFile("cat-1111222233334444.png", "act_words", "words", 1, "Sight words"),
    libraryFile("bell-5555666677778888.wav", "act_letters", "letters", 3, "Letter hunt", {
      kind: "audio",
      mimeType: "audio/wav",
      byteLength: 512,
    }),
    libraryFile("sun-9999aaaabbbbcccc.png", "act_letters", "letters", 3, "Letter hunt", {
      updatedAt: "2026-09-25T10:00:00.000Z",
    }),
  ];
  const bundles = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/media-library` && request.method() === "GET")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ files, truncated: false }),
      });
    if (p === `${base}/media-library/bundle` && request.method() === "POST") {
      bundles.push(request.postDataJSON());
      return route.fulfill({
        contentType: "application/zip",
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''media-library-selection.zip",
        },
        // An empty zip: the end-of-central-directory record alone.
        body: Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]),
      });
    }
    if (/\/act_(words|letters)\/media-upload$/.test(p))
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    return route.fallback();
  });
  await page.goto(`${origin}/activities`);
  await page.getByRole("button", { name: "Media library", exact: true }).click();
  await expect(page).toHaveURL(/\/activities\/media$/);
  await expect(page.getByRole("heading", { name: /^Project media library/ })).toBeVisible();

  // The old ?view=media URL still lands on the media library, redirected to its own route.
  await page.goto(`${origin}/activities?view=media`);
  await expect(page).toHaveURL(/\/activities\/media$/);

  // The grid shows every file; the type chips and the search narrow it.
  const list = page.getByRole("region", { name: "Files", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  const kinds = page.getByRole("group", { name: "Media type", exact: true });
  await kinds.getByRole("button", { name: "Audio", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("bell-5555666677778888.wav");
  await kinds.getByRole("button", { name: "All", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search files", exact: true });
  await search.fill("letter hunt");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await search.fill("zebra");
  await expect(page.getByText("No file matches these filters.")).toBeVisible();
  await search.fill("");

  // A file opens in the details beside the list.
  await list.getByRole("button", { name: /sun-9999aaaabbbbcccc\.png/ }).click();
  const details = page.getByRole("region", { name: "File details", exact: true });
  await expect(details).toContainText("letters / 3 · Letter hunt");
  await expect(details.getByRole("img", { name: "sun-9999aaaabbbbcccc.png" })).toBeVisible();

  // The table has the same files, one row each, linked to their activity.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(list.getByRole("row")).toHaveCount(4);
  await expect(list.getByRole("link", { name: "words / 1 · Sight words" })).toHaveAttribute(
    "href",
    "/activities/act_words",
  );

  // Two chosen files download as one zip, asked for by activity and path.
  await expect(page.getByRole("button", { name: "Download (0)", exact: true })).toBeDisabled();
  await list.getByRole("checkbox", { name: "Select cat-1111222233334444.png" }).check();
  // One file downloads as itself.
  await expect(page.getByRole("link", { name: "Download (1)", exact: true })).toHaveAttribute(
    "href",
    `${base}/act_words/media-upload?path=media%2Floom%2Fwords%2Fwords-1%2Fuploads%2Fcat-1111222233334444.png`,
  );
  await list.getByRole("checkbox", { name: "Select bell-5555666677778888.wav" }).check();
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download (2)", exact: true }).click();
  expect((await saved).suggestedFilename()).toBe("media-library-selection.zip");
  expect(bundles).toEqual([
    {
      items: [
        {
          activityId: "act_letters",
          path: "media/loom/words/words-1/uploads/bell-5555666677778888.wav",
        },
        {
          activityId: "act_words",
          path: "media/loom/words/words-1/uploads/cat-1111222233334444.png",
        },
      ],
    },
  ]);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.getByText("0 files selected")).toBeVisible();
  await page.getByRole("link", { name: "All activities", exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  expect(f.errors).toEqual([]);
});

test("picks a file uploaded to another activity", async ({ page }) => {
  const f = await fixture(page);
  const copies = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p === `${base}/media-library` && request.method() === "GET")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          files: [
            // This activity's own upload is not offered again from here.
            libraryFile("own-0000111122223333.png", "act_test", "words", 12, "Sight words"),
            libraryFile("sun-9999aaaabbbbcccc.png", "act_letters", "letters", 3, "Letter hunt"),
            libraryFile("bell-5555666677778888.wav", "act_letters", "letters", 3, "Letter hunt", {
              kind: "audio",
              mimeType: "audio/wav",
            }),
          ],
          truncated: false,
        }),
      });
    if (p === `${base}/act_test/media-uploads/copy` && request.method() === "POST") {
      copies.push(request.postDataJSON());
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          path: "media/loom/words/words-1/uploads/sun-9999aaaabbbbcccc.png",
          name: "sun-9999aaaabbbbcccc.png",
          kind: "image",
          mimeType: "image/png",
          byteLength: 2048,
          sha256: "b".repeat(64),
          updatedAt: "2026-09-25T10:00:00.000Z",
        }),
      });
    }
    if (p === `${base}/act_letters/media-upload`)
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  const binding = page.getByRole("textbox", { name: /^Media path/ });
  await expect(binding).toHaveValue("");

  await page.getByRole("button", { name: "Choose from media library", exact: true }).click();
  const scope = page.getByRole("group", { name: "Show files from", exact: true });
  await scope.getByRole("button", { name: "Other activities", exact: true }).click();
  // Only images, from other activities, with the activity each one comes from.
  const sun = page.getByRole("button", { name: /^sun-9999aaaabbbbcccc\.png/ });
  await expect(sun).toContainText("letters / 3 · Letter hunt");
  await expect(page.getByRole("button", { name: /^own-/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^bell-/ })).toHaveCount(0);
  await sun.click();
  await page.getByRole("button", { name: "Use this file", exact: true }).click();
  await expect(binding).toHaveValue("media/loom/words/words-1/uploads/sun-9999aaaabbbbcccc.png");
  await expect(page.getByText("Stored with this activity.")).toBeVisible();
  expect(copies).toEqual([
    {
      fromActivityId: "act_letters",
      path: "media/loom/words/words-1/uploads/sun-9999aaaabbbbcccc.png",
    },
  ]);
  expect(f.errors).toEqual([]);
});

test("renumbers a ref from the header, and refuses while it is stable", async ({ page }) => {
  const f = await fixture(page);
  // The fixture's activity as last served, so the stub can serve it under a new number.
  let current = null;
  page.on("response", async (response) => {
    if (
      new URL(response.url()).pathname === `${base}/act_test` &&
      response.request().method() === "GET"
    )
      current = await response.json().catch(() => current);
  });
  await create(page);
  const state = { refNum: 12, stable: true };
  const posts = [];
  let refuseOnce = true;
  const ref = { productCode: "words", collectionId: "col_test", archived: false };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === base && request.method() === "GET" && url.searchParams.get("collectionId"))
      return json({
        activities: [
          { ...ref, id: "act_test", refNum: state.refNum, displayName: null, stable: state.stable },
          { ...ref, id: "act_other", refNum: 13, displayName: null, stable: false },
        ],
      });
    if (url.pathname === `${base}/act_test` && request.method() === "GET" && current)
      return json({ ...current, refNum: state.refNum, stable: state.stable });
    if (url.pathname === `${base}/act_test/ref-number` && request.method() === "POST") {
      const body = request.postDataJSON();
      posts.push(body);
      // The server refuses a stable ref and a taken number as the dialog does.
      if (state.stable) return json({ error: { code: "ref_stable", message: "Stable." } }, 409);
      if (refuseOnce) {
        refuseOnce = false;
        return json({ error: { code: "activity_exists", message: "Taken." } }, 409);
      }
      state.refNum = body.refNum;
      return json({ ...current, refNum: state.refNum, stable: state.stable });
    }
    return route.fallback();
  });
  await page.reload();

  await refAction(page, "Change number");
  let dialog = page.getByRole("dialog", { name: "Change the number of words, ref 12" });
  await expect(dialog.getByText(/^This ref is marked stable/)).toBeVisible();
  await expect(dialog.getByRole("spinbutton", { name: /^New number/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Renumber", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  state.stable = false;
  await page.reload();
  await refAction(page, "Change number");
  dialog = page.getByRole("dialog", { name: "Change the number of words, ref 12" });
  const number = dialog.getByRole("spinbutton", { name: /^New number/ });
  await expect(number).toBeEnabled();
  // A number another listed ref uses is refused before anything is sent.
  await number.fill("13");
  await dialog.getByRole("button", { name: "Renumber", exact: true }).click();
  await expect(dialog.getByText("Ref 13 of this product already exists.")).toBeVisible();
  expect(posts).toEqual([]);

  // A refusal from the server is worded in the dialog, which stays open.
  await number.fill("14");
  await dialog.getByRole("button", { name: "Renumber", exact: true }).click();
  await expect(dialog.getByText(/files in its module already use that number/)).toBeVisible();
  expect(posts).toHaveLength(1);

  await dialog.getByRole("button", { name: "Renumber", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual({ refNum: 14, expectedRevision: current.draft.contentRevision });
  await expect(page.getByText("Ref 12 is now ref 14.")).toBeVisible();
  await expect(refMenu(page)).toContainText("Ref 14");
  expect(f.errors).toEqual([]);
});

test("makes a ref from the template, keeping one image and regenerating a narration", async ({
  page,
}) => {
  const f = await fixture(page);
  const usages = (key) => [
    { sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 },
  ];
  const run = `run_${"a".repeat(32)}`;
  const record = {
    id: "act_test",
    collectionId: "col_test",
    productId: "prd_test",
    productCode: "words",
    refNum: 12,
    title: "Sight words",
    displayName: null,
    stable: true,
    activityType: "standard",
    createdAt: "2026-09-19",
    updatedAt: "2026-09-19",
    archived: false,
    tags: [],
  };
  const template = {
    ...record,
    draft: {
      draftId: "draft_test",
      activityId: "act_test",
      baseVersionId: null,
      contentRevision: "rev_template",
      status: "valid",
      description: "Practice common sight words",
      spec,
      mediaPlan: {
        specRevision: "spec-revision",
        requirements: {},
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "cat",
                type: "image",
                description: "A cat",
                path: `media/generated/${run}.png`,
                generatedImage: { runId: run, sha256: "b".repeat(64) },
                usages: usages("cat"),
              },
              {
                key: "hello",
                type: "audio",
                description: "Greeting",
                script: "Hello",
                path: `media/generated/${run}.wav`,
                generatedAudio: { runId: run, sha256: "c".repeat(64) },
                usages: usages("hello"),
              },
            ],
          },
        },
      },
      updatedAt: "2026-09-19",
    },
  };
  const made = {
    ...template,
    id: "act_new",
    refNum: 13,
    stable: false,
    draft: { ...template.draft, draftId: "draft_new", activityId: "act_new" },
  };
  const creates = [];
  const pipelines = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === base && request.method() === "GET") return json({ activities: [record] });
    if (p === `${base}/act_test` && request.method() === "GET") return json(template);
    if (p === `${base}/act_test/refs/next-number`)
      return json({ refNum: 13, canonical: true, taken: [12] });
    if (p === `${base}/act_test/refs` && request.method() === "POST") {
      creates.push(request.postDataJSON());
      return json(made, 201);
    }
    if (p === `${base}/act_new` && request.method() === "GET") return json(made);
    if (p === `${base}/act_new/runs`) return json({ runs: [] });
    if (p === `${base}/act_new/pipeline` && request.method() === "POST") {
      pipelines.push(request.postDataJSON());
      // One running sequence per activity, as the server allows.
      if (pipelines.length > 1)
        return json({ error: { code: "pipeline_running", message: "Running." } }, 409);
      return json(
        {
          pipelineId: "pipe_new",
          projectId,
          activityId: "act_new",
          selection: "assets",
          scope: null,
          status: "running",
          steps: [],
          currentRunId: null,
          currentSessionId: null,
          error: null,
          startedAt: "2026-09-25T10:00:00Z",
          finishedAt: null,
        },
        202,
      );
    }
    if (p === `${base}/act_new/pipeline`) return json({ pipeline: null });
    return route.fallback();
  });
  await page.goto(`${origin}/activities/act_test`);

  await refAction(page, "New ref");
  await expect(page).toHaveURL(/section=newRef/);
  await expect(page.getByRole("heading", { name: /^New ref from this template/ })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: /^Ref number/ })).toHaveValue("13");
  // The image is kept, as every asset starts.
  await expect(
    page
      .getByRole("group", { name: "What to do with cat", exact: true })
      .getByRole("button", { name: "Keep", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // A taken number is refused before anything is sent.
  const number = page.getByRole("spinbutton", { name: /^Ref number/ });
  await number.fill("12");
  await expect(page.getByText("Ref 12 of this product already exists.")).toBeVisible();
  const createButton = page.getByRole("button", { name: "Create ref", exact: true });
  await expect(createButton).toBeDisabled();
  await number.fill("13");

  // One voice for all narration marks the narration to regenerate in it.
  await page.getByRole("button", { name: "Voice for all narration", exact: true }).click();
  await page.getByRole("option", { name: "Puck", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "What to do with hello", exact: true })
      .getByRole("button", { name: "Regenerate", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const script = page.getByRole("textbox", { name: "Script", exact: true });
  await script.fill("");
  await expect(page.getByText("Write a script for hello.")).toBeVisible();
  await expect(createButton).toBeDisabled();
  await script.fill("Hi there");
  await expect(createButton).toBeEnabled();
  await createButton.click();

  await expect(page).toHaveURL(/activities\/act_new\?section=scenes/);
  await expect(page.getByText("Ref 13 was made from the template.")).toBeVisible();
  expect(creates).toEqual([
    {
      refNum: 13,
      decisions: [
        {
          language: "en-US",
          assetKey: "hello",
          action: "clear",
          script: "Hi there",
          voice: "Puck",
        },
      ],
    },
  ]);
  expect(pipelines).toEqual([
    { agentId: "media_agent", stage: "assets", language: "en-US", voice: "Puck" },
  ]);
  expect(f.errors).toEqual([]);
});

test("the preview builds a module no one has built, plays it, and replays a saved draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  const f = await fixture(page);
  await create(page);
  let built = false;
  const builds = [];
  let plays = 0;
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json(
        built
          ? { state: "ready", playable: true, buildable: false, message: "Ready.", buildLog: null }
          : {
              state: "pending_scaffold",
              playable: false,
              buildable: true,
              message: "No module has been built for this activity yet.",
              buildLog: null,
            },
      );
    if (p === `${base}/act_test/sandbox/build`) {
      builds.push(request.postDataJSON());
      built = true;
      return json({ ok: true, joined: false, skipped: false, message: "Built.", log: "" });
    }
    if (p === `${base}/act_test/sandbox/payload`) return json({ configuration: {} });
    if (p === `${base}/act_test/sandbox/play`) {
      plays += 1;
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><p>module</p>" });
    }
    return route.fallback();
  });
  const panel = await openPanel(page, "Preview");
  const frame = panel.locator('iframe[title="Preview"]');
  await expect(frame).toBeVisible();
  expect(builds).toEqual([{ force: false }]);
  await expect.poll(() => plays).toBe(1);
  // None of the old captions: no status line for a module that plays.
  await expect(panel.getByText("Ready.", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);

  // Saving the draft plays the new module, without asking.
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await expect.poll(() => plays).toBe(2);
  expect(builds).toHaveLength(1);

  // Filling the workspace fits the whole screen of the module, height included.
  await panel.getByRole("button", { name: "Fill the workspace", exact: true }).click();
  // The frame refits after the panel has taken the workspace, so read it once it has.
  await expect
    .poll(async () => (await frame.locator("xpath=..").boundingBox()).width)
    .toBeGreaterThan(600);
  const box = await frame.locator("xpath=..").boundingBox();
  const shown = await panel.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(shown.y + shown.height);
  expect(f.errors).toEqual([]);
});

test("resizes the side panel by drag and keyboard, and lets it fill the workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1700, height: 1000 });
  const f = await fixture(page);
  await create(page);
  await page
    .getByRole("group", { name: "Activity panels" })
    .getByRole("button", { name: "Preview" })
    .click();
  const player = page.getByRole("complementary", { name: "Preview", exact: true });
  const divider = page.getByRole("separator", { name: "Panel width", exact: true });
  await expect(divider).toHaveAttribute("aria-valuenow", "480");

  // Dragging the divider left widens the panel, and the width outlives a reload.
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 100, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(await divider.getAttribute("aria-valuenow"));
  expect(dragged).toBeGreaterThan(740);
  expect(Math.round((await player.boundingBox()).width)).toBe(dragged);
  await page.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", String(dragged));

  // The keyboard moves it too; End takes as much as the editor can spare.
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", String(dragged - 16));
  await page.keyboard.press("End");
  const widest = Number(await divider.getAttribute("aria-valuenow"));
  expect(widest).toBeGreaterThan(dragged);
  expect(widest).toBeLessThan(1700);

  // Filling the workspace covers the work; putting it back restores the divider.
  await page.getByRole("button", { name: "Fill the workspace", exact: true }).click();
  await expect(divider).toHaveCount(0);
  const body = await player.boundingBox();
  expect(body.width).toBeGreaterThan(1600);
  await page
    .getByRole("button", { name: "Put the panel back beside the work", exact: true })
    .click();
  await expect(divider).toHaveAttribute("aria-valuenow", String(widest));
  expect(f.errors).toEqual([]);
});

test("switches the studio to the Reviewing layout and saves a layout of its own", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1700, height: 1000 });
  const f = await fixture(page);
  await create(page);
  const layoutMenu = page.getByRole("button", { name: "Layout", exact: true });
  const item = (name) => page.getByRole("menuitem", { name: new RegExp(`^${name}`) });

  // Reviewing collapses the rail, opens the player and the Scenes section.
  await layoutMenu.click();
  await item("Reviewing").click();
  await expect(page).toHaveURL(/section=scenes/);
  await expect(
    page.getByRole("button", { name: "Expand the activity rail", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Preview", exact: true })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Panel width", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "820",
  );
  await layoutMenu.click();
  await expect(item("Reviewing")).toContainText("Current");
  await expect(item("Writing")).not.toContainText("Current");

  // Writing brings the rail back at 300 beside the conversation.
  await item("Writing").click();
  await expect(page).toHaveURL(/section=description/);
  await expect(
    page.getByRole("separator", { name: "Activity rail width", exact: true }),
  ).toHaveAttribute("aria-valuenow", "300");
  await expect(page.getByRole("complementary", { name: "Chat", exact: true })).toBeVisible();

  // Save the arrangement under a name of the author's own; the same name twice is refused.
  await page.getByRole("button", { name: "Close the panel", exact: true }).click();
  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Save current as…", exact: true }).click();
  const nameBox = page
    .getByRole("dialog", { name: "Save the current layout", exact: true })
    .getByRole("textbox", { name: /^Name/ });
  await nameBox.fill("Audio pass");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved the layout Audio pass.", { exact: true })).toBeVisible();
  await layoutMenu.click();
  await expect(item("Audio pass")).toContainText("Current");
  await page.getByRole("menuitem", { name: "Save current as…", exact: true }).click();
  await nameBox.fill("audio PASS");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Another layout already has this name.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // After a reload it is still listed, and applying it brings the arrangement back.
  await page.reload();
  await layoutMenu.click();
  await item("Reviewing").click();
  await expect(page).toHaveURL(/section=scenes/);
  await layoutMenu.click();
  await item("Audio pass").click();
  await expect(page).toHaveURL(/section=description/);
  await expect(page.getByRole("complementary", { name: "Preview", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("separator", { name: "Activity rail width", exact: true }),
  ).toBeVisible();

  // Shortcuts are off until ticked: Alt+2 does nothing, then applies Reviewing, but not
  // while typing in a field.
  await page.keyboard.press("Alt+2");
  await expect(page).toHaveURL(/section=description/);
  await layoutMenu.click();
  await page.getByRole("menuitemcheckbox", { name: /^Keyboard shortcuts/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Activity Script", exact: true }).focus();
  await page.keyboard.press("Alt+2");
  await expect(page).toHaveURL(/section=description/);
  await page.getByRole("heading", { name: "Sight words", exact: true }).click();
  await page.keyboard.press("Alt+2");
  await expect(page).toHaveURL(/section=scenes/);

  // Built-ins cannot be renamed or deleted; a saved layout can be deleted after asking.
  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Manage…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Layouts", exact: true });
  await expect(dialog.getByRole("row", { name: /Writing/ })).toContainText("Built-in");
  await expect(dialog.getByRole("button", { name: "Delete Writing", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Delete Audio pass", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Deleted the layout Audio pass.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await layoutMenu.click();
  await expect(item("Audio pass")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("saves a named version and lists it", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  // The version routes, with the server's rules: saving without a change since the latest
  // version returns that version, and a changed script makes the next one.
  const versions = [];
  const saves = [];
  let changed = true;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === `${base}/act_test/description` && request.method() === "PATCH") {
      changed = true;
      for (const version of versions) version.current = false;
      return route.fallback();
    }
    if (url.pathname !== `${base}/act_test/versions`) return route.fallback();
    if (request.method() === "GET") return json({ versions: [...versions].reverse() });
    const body = request.postDataJSON();
    saves.push(body);
    if (!changed && versions.length) return json({ version: versions.at(-1), created: false });
    changed = false;
    for (const version of versions) version.current = false;
    const seq = versions.length + 1;
    versions.push({
      versionId: `ver_${seq}`,
      seq,
      label: body.label,
      kind: "manual",
      reason: null,
      createdAt: "2026-09-25T10:00:00.000Z",
      author: "author",
      mediaBytes: seq === 1 ? 0 : 2048,
      current: true,
      deployed: { qa: null, prod: null },
    });
    return json({ version: versions.at(-1), created: true }, 201);
  });
  await openSection(page, "Generation history");
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByText(/^No versions yet/)).toBeVisible();

  // Save one with a name.
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save a version", exact: true });
  await dialog.getByRole("textbox", { name: /^Name/ }).fill("  Before review  ");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved version v1.", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(saves).toEqual([{ label: "Before review" }]);
  const first = page.getByRole("row", { name: /^v1\b/ });
  await expect(first).toContainText("Before review");
  await expect(first).toContainText("Saved");
  await expect(first).toContainText("author");
  await expect(first).toContainText("None");
  await expect(first).toContainText("Current");

  // Saving again with nothing changed keeps v1 and says so.
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Nothing changed since v1, so no new version was saved.", { exact: true }),
  ).toBeVisible();
  expect(saves.at(-1)).toEqual({ label: null });
  await expect(page.getByRole("row", { name: /^v\d/ })).toHaveCount(1);

  // A changed script leaves v1 behind; the next save is v2 and is the current one.
  await openSection(page, "Description");
  await page
    .getByRole("textbox", { name: "Activity Script", exact: true })
    .fill("A changed script");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await openSection(page, "Generation history");
  await expect(page.getByRole("row", { name: /^v1\b/ })).not.toContainText("Current");
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved version v2.", { exact: true })).toBeVisible();
  const rows = page.getByRole("row", { name: /^v\d/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("v2");
  await expect(rows.first()).toContainText("Unnamed");
  await expect(rows.first()).toContainText("2.0 KB");
  await expect(rows.first()).toContainText("Current");
  expect(f.errors).toEqual([]);
});

test("compares a version with the current script and restores it", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const detail = await page.evaluate((url) => fetch(url).then((r) => r.json()), `${base}/act_test`);
  // The version routes, with the server's rules: a restore names the draft's revision, keeps
  // the draft as it was as an automatic version, then records a restore version.
  const version = (seq, extra = {}) => ({
    versionId: `ver_${seq}`,
    seq,
    label: null,
    kind: "manual",
    reason: null,
    createdAt: "2026-09-25T10:00:00.000Z",
    author: "author",
    mediaBytes: 2048,
    current: false,
    deployed: { qa: null, prod: null },
    ...extra,
  });
  const versions = [version(1, { label: "First take" })];
  const restores = [];
  let draft = detail.draft;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === `${base}/act_test` && request.method() === "GET" && restores.length)
      return json({ ...detail, draft });
    if (url.pathname === `${base}/act_test/versions` && request.method() === "GET")
      return json({ versions: [...versions].reverse() });
    if (url.pathname === `${base}/act_test/versions/ver_1/diff`) {
      expect(url.searchParams.get("against")).toBe("current");
      return json({
        files: [
          {
            name: "description",
            before: "Practice sight words",
            after: "Practice common sight words",
          },
        ],
        media: [
          {
            path: "audio/run_hello.wav",
            change: "changed",
            beforeBytes: 2048,
            afterBytes: 4096,
          },
        ],
      });
    }
    if (url.pathname === `${base}/act_test/versions/ver_1/restore`) {
      const body = request.postDataJSON();
      restores.push(body);
      if (body.expectedRevision !== draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      versions.push(version(2, { kind: "auto", reason: "before_restore" }));
      versions.push(version(3, { kind: "restore", current: true }));
      draft = { ...draft, description: "Practice sight words", contentRevision: "restored" };
      return json(draft);
    }
    return route.fallback();
  });
  await openSection(page, "Generation history");
  const first = page.getByRole("row", { name: /^v1\b/ });
  await expect(first).toContainText("First take");

  // Compare: the script's tab, its lines, and the narration file that changed.
  await first
    .getByRole("button", { name: "Compare v1 with the current draft", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "v1 compared with the current draft" });
  await expect(panel.getByRole("tab", { name: "Script", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const lines = panel.getByLabel("Differences in Script", { exact: true });
  await expect(lines).toContainText("Practice sight words");
  await expect(lines).toContainText("Practice common sight words");
  const media = panel.getByRole("row", { name: /audio\/run_hello\.wav/ });
  await expect(media).toContainText("Changed");
  await expect(media).toContainText("2.0 KB");
  await expect(media).toContainText("4.0 KB");

  // Restore, after confirming; the draft becomes v1's and a version of it is kept first.
  await first.getByRole("button", { name: "Restore v1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Restore v1", exact: true });
  await expect(dialog).toContainText("kept first as a version");
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByText("Restored v1. The draft as it was is kept as a version.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(restores).toEqual([{ expectedRevision: detail.draft.contentRevision }]);
  await expect(page.getByRole("row", { name: /^v3\b/ })).toContainText("Current");
  await expect(page.getByRole("row", { name: /^v2\b/ })).toContainText("Before a restore");
  // The restore version is the draft now: nothing to restore on it.
  await expect(
    page.getByRole("row", { name: /^v3\b/ }).getByRole("button", { name: "Restore v3" }),
  ).toHaveCount(0);
  await openSection(page, "Description");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Practice sight words",
  );
  expect(f.errors).toEqual([]);
});

test("an admin installs the test browser from System settings", async ({ page }) => {
  const f = await fixture(page);
  let browser = {
    available: true,
    installed: false,
    version: "149.0.7827.55",
    path: "/penguin/browsers",
    installing: false,
    error: null,
    log: null,
  };
  let installs = 0;
  let readsWhileInstalling = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === "/api/me")
      return json({
        user: { userId: "author", isAdmin: true, passwordIsInitial: false },
        previewIsolated: true,
        desktopMode: false,
        companyMode: false,
        sessionVia: "password",
        uploadLimits: {
          attachmentMaxMb: 100,
          attachmentTotalMb: 120,
          attachmentMaxCount: 20,
          imageMaxMb: 20,
          attachmentLimitMinMb: 1,
          attachmentLimitMaxMb: 200,
        },
      });
    if (p === "/api/admin/test-browser/install" && request.method() === "POST") {
      // The server allows one install at a time.
      if (browser.installing)
        return json({ error: { code: "test_browser_installing", message: "busy" } }, 409);
      installs++;
      browser = { ...browser, installing: true };
      return json({ browser }, 202);
    }
    if (p === "/api/admin/test-browser") {
      // The first read while it runs fails (a server blip): the page keeps asking, and the
      // install finishes after it has asked once more.
      if (browser.installing) {
        readsWhileInstalling++;
        if (readsWhileInstalling === 1)
          return json({ error: { code: "internal", message: "Temporary failure." } }, 503);
        if (readsWhileInstalling > 2) browser = { ...browser, installing: false, installed: true };
      }
      return json({ browser });
    }
    return route.fallback();
  });
  await page.goto(`${origin}/activities`);
  await page.locator('button[aria-haspopup="menu"]').filter({ hasText: "author" }).click();
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "System settings" });
  await dialog.getByRole("button", { name: "Test browser" }).click();
  const status = dialog.getByTestId("test-browser-status");
  await expect(status).toHaveText("Not installed");
  await dialog.getByRole("button", { name: "Install test browser", exact: true }).click();
  await expect(status).toHaveText("Installing the test browser. This can take several minutes.");
  await expect(
    dialog.getByRole("button", { name: "Install test browser", exact: true }),
  ).toBeDisabled();
  // Three reads two seconds apart, one of them failed.
  await expect(status).toHaveText("Installed, Chromium 149.0.7827.55", { timeout: 15_000 });
  expect(readsWhileInstalling).toBe(3);
  expect(installs).toBe(1);
  expect(f.errors).toEqual([]);
});

test("checks quality and lists what must be fixed", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const checkedAt = "2026-09-25T10:00:00.000Z";
  const reports = {
    runId: "run_quality",
    accessibility: {
      check: "accessibility",
      status: "failed",
      checkedAt,
      scenes: ["intro"],
      findings: [
        {
          id: "color-contrast@intro",
          severity: "must",
          blocking: true,
          target: "#choices > button",
          scene: "intro",
          code: "color-contrast",
          detail: "Elements must meet minimum color contrast ratio thresholds",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
          count: 2,
        },
        {
          id: "keyboard-focus-visible@intro",
          severity: "should",
          blocking: true,
          target: "#repeat",
          scene: "intro",
          code: "keyboard-focus-visible",
          detail: "repeat",
          count: 1,
        },
      ],
    },
    readability: {
      check: "readability",
      status: "passed_with_warnings",
      checkedAt,
      gradeBand: "k-2",
      readingGrade: 3.4,
      findings: [
        {
          id: "word_long:0",
          severity: "note",
          blocking: false,
          target: null,
          scene: "intro",
          code: "word_long",
          detail: "elephant",
          count: 8,
          limit: 8,
        },
      ],
    },
  };
  // The quality routes, with the server's rules: one run per activity at a time, and the
  // reports appear once the run has settled.
  let browserInstalled = false;
  let qualityRun = null;
  let quality = null;
  let starts = 0;
  let runReadsWhileRunning = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/quality` && request.method() === "POST") {
      if (!browserInstalled)
        return json({ error: { code: "test_browser_missing", message: "missing" } }, 409);
      if (qualityRun?.status === "running")
        return json({ error: { code: "generation_running", message: "busy" } }, 409);
      starts++;
      qualityRun = {
        kind: "quality",
        runId: "run_quality",
        activityId: "act_test",
        projectId,
        draftId: "draft_test",
        inputRevision: "1",
        agentId: "",
        sessionId: null,
        status: "running",
        createdAt: "2026-09-25T09:59:00.000Z",
        finishedAt: null,
        error: null,
        candidate: null,
      };
      return json(qualityRun, 202);
    }
    if (p === `${base}/act_test/quality`) return json({ quality, browserInstalled });
    if (p === `${base}/act_test/runs` && request.method() === "GET" && qualityRun) {
      if (qualityRun.status === "running" && ++runReadsWhileRunning > 1) {
        qualityRun = { ...qualityRun, status: "succeeded", finishedAt: checkedAt };
        quality = reports;
      }
      const { candidate, ...summary } = qualityRun;
      return json({ runs: [{ ...summary, hasCandidate: false }] });
    }
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();

  // Without the test browser, Check quality is not offered, and the page says why.
  await openPanel(page, "Quality");
  await expect(page.getByRole("heading", { name: /^Quality/, level: 3 })).toBeVisible();
  const check = page.getByRole("button", { name: "Check quality", exact: true });
  await expect(check).toBeDisabled();
  await expect(
    page.getByText(
      "The test browser is not installed. An admin installs it in System settings, under Test browser.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Not checked yet.", { exact: true }).first()).toBeVisible();

  // Installed, it checks; the reports appear once the run settles.
  browserInstalled = true;
  await reopenPanel(page, "Quality");
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByText("Checking quality…", { exact: true })).toBeVisible();
  await expect(check).toBeDisabled();
  await expect(page.getByText("Quality check finished.", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(starts).toBe(1);

  await expect(page.getByTestId("quality-accessibility-status")).toHaveText("Failed");
  const accessibility = page.getByRole("table", {
    name: "Easy for everyone to use: findings",
    exact: true,
  });
  const contrast = accessibility.getByRole("row", { name: /color-contrast/ });
  await expect(contrast).toContainText("Must fix");
  await expect(contrast).toContainText("Scene intro · #choices > button");
  await expect(
    contrast.getByRole("link", { name: "Learn more about color-contrast", exact: true }),
  ).toHaveAttribute("href", "https://dequeuniversity.com/rules/axe/4.13/color-contrast");
  const focus = accessibility.getByRole("row", { name: /keyboard-focus-visible/ });
  await expect(focus).toContainText("Should fix");
  await expect(focus).toContainText("Shows no focus when reached with the keyboard.");

  await expect(page.getByTestId("quality-readability-status")).toHaveText("Passed with warnings");
  await expect(
    page.getByText("Grade band k-2 · Flesch-Kincaid grade 3.4, for information", { exact: true }),
  ).toBeVisible();
  const word = page
    .getByRole("table", { name: "Right reading level: findings", exact: true })
    .getByRole("row", { name: /elephant/ });
  await expect(word).toContainText("Note");
  await expect(word).toContainText("Long word");
  await expect(word).toContainText("8 letters; up to 8 suit this grade band.");
  await expect(page.getByText(/^Last checked /)).toBeVisible();
  await expect(check).toBeEnabled();
  expect(f.errors).toEqual([]);
});

test("runs the tests and lists each criterion's result", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const checkedAt = "2026-09-25T10:00:00.000Z";
  const criteria = ["Tapping the cat plays its name.", "The end screen says well done."];
  const report = {
    overallStatus: "failed",
    checkedAt,
    specRevision: "rev",
    reused: false,
    results: [
      {
        criterion: criteria[0],
        testName: "tap the cat",
        status: "passed",
        durationMs: 1540,
        error: null,
      },
      {
        criterion: criteria[1],
        testName: "",
        status: "failed",
        durationMs: 0,
        error: null,
        code: "not_run",
      },
    ],
  };
  // The test routes, with the server's rules: one run per activity at a time, a test browser
  // for criteria to be tested, and the report once the run has settled.
  let browserInstalled = false;
  let testRun = null;
  let current = null;
  let starts = 0;
  let body = null;
  let runReadsWhileRunning = 0;
  let stale = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/test` && request.method() === "POST") {
      if (!browserInstalled)
        return json({ error: { code: "test_browser_missing", message: "missing" } }, 409);
      if (testRun?.status === "running")
        return json({ error: { code: "generation_running", message: "busy" } }, 409);
      starts++;
      body = request.postDataJSON();
      testRun = {
        kind: "test",
        runId: "run_tests",
        activityId: "act_test",
        projectId,
        draftId: "draft_test",
        inputRevision: "1",
        agentId: body.agentId ?? "",
        sessionId: "session_tests",
        status: "running",
        createdAt: "2026-09-25T09:59:00.000Z",
        finishedAt: null,
        error: null,
        candidate: null,
      };
      return json(testRun, 202);
    }
    if (p === `${base}/act_test/test-report`)
      return json({
        report: current,
        runId: current ? "run_tests" : null,
        criteria: criteria.length,
        stale,
        browserInstalled,
      });
    if (p === `${base}/act_test/runs` && request.method() === "GET" && testRun) {
      if (testRun.status === "running" && ++runReadsWhileRunning > 1) {
        testRun = { ...testRun, status: "succeeded", finishedAt: checkedAt };
        current = report;
      }
      const { candidate, ...summary } = testRun;
      return json({ runs: [{ ...summary, hasCandidate: false }] });
    }
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify({ ...spec, acceptance_criterias: criteria }));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();

  // Without the test browser, Run tests is not offered, and the page says why.
  await openPanel(page, "Tests");
  await expect(page.getByRole("heading", { name: /^Test results/ })).toBeVisible();
  const runTests = page.getByRole("button", { name: "Run tests", exact: true });
  await expect(runTests).toBeDisabled();
  await expect(
    page
      .getByText(
        "The test browser is not installed. An admin installs it in System settings, under Test browser.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText("No tests have run yet.", { exact: true })).toBeVisible();

  // Installed, it runs; the results appear once the run settles.
  browserInstalled = true;
  await reopenPanel(page, "Tests");
  await expect(runTests).toBeEnabled();
  await runTests.click();
  await expect(page.getByText("Running tests…", { exact: true })).toBeVisible();
  await expect(runTests).toBeDisabled();
  await expect(page.getByText("Acceptance tests finished.", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(starts).toBe(1);
  expect(body.expectedRevision).toBeTruthy();

  await expect(page.getByTestId("tests-status")).toHaveText("Failed · 1 of 2 criteria passed");
  const table = page.getByRole("table", { name: "Acceptance criteria results", exact: true });
  const passed = table.getByRole("row", { name: /Tapping the cat/ });
  await expect(passed).toContainText("tap the cat");
  await expect(passed).toContainText("Passed");
  await expect(passed).toContainText("1.5 s");
  const missing = table.getByRole("row", { name: /The end screen/ });
  await expect(missing).toContainText("Failed");
  await expect(missing).toContainText("No check ran for this criterion.");
  await expect(page.getByText(/^Last run /)).toBeVisible();
  await expect(runTests).toBeEnabled();
  await expect(page.getByTestId("tests-stale")).toHaveCount(0);

  // Once the specification changes, the old results are marked out of date.
  stale = true;
  await reopenPanel(page, "Tests");
  await expect(page.getByTestId("tests-stale")).toHaveText(
    "Out of date: the specification changed since these tests ran. Run tests again to check it.",
  );
  expect(f.errors).toEqual([]);
});

/** Silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz): a playable MP3 of `frames` x 26 ms. */
function silentMp3(frames = 40) {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

test("writes a prompt for a sound effect, generates it, and keeps the new clip", async ({
  page,
}) => {
  const f = await fixture(page);
  const clip = silentMp3();
  let keyed = false;
  const generated = [];
  const soundRuns = [];
  const savedManifests = [];
  // The draft as the fixture last served it; acceptance binds the clip on top of it.
  let draft = null;
  let accepted = null;
  page.on("response", async (response) => {
    const p = new URL(response.url()).pathname;
    if ([`${base}/act_test/plan-media`, `${base}/act_test/media`].includes(p) && response.ok())
      draft = await response.json().catch(() => draft);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `${base}/act_test/media` && request.method() === "PUT")
      savedManifests.push(request.postDataJSON().manifest);
  });
  const usage = { sceneId: "intro", sourceKey: "door", occurrence: 1, sceneOccurrenceCount: 1 };
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "door",
                type: "audio",
                description: "A door opens",
                script: '<audio kind="sfx">a door</audio>',
                kind: "sfx",
                channel: "sfx",
                loop: false,
                volume: 1,
                path: "media/loom/words/words-1/uploads/door-00000000.mp3",
                usages: [usage],
              },
            ],
          },
        },
      }),
    }),
  );
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/sound-setup`)
      return json({
        providers: [
          {
            id: "elevenlabs",
            kinds: ["music", "sfx"],
            credential: "ELEVENLABS_API_KEY",
            models: { music: "music_v1", sfx: "sound-generation" },
            available: keyed,
            ...(keyed ? {} : { problem: "credential_missing" }),
          },
        ],
      });
    if (p === `${base}/act_test/media-upload` || /\/runs\/[^/]+\/audio$/.test(p))
      return route.fulfill({ contentType: "audio/mpeg", body: clip });
    if (p === `${base}/act_test/generate-sound`) {
      const body = request.postDataJSON();
      // One generation at a time, as the server allows.
      if (soundRuns.some((run) => run.status === "running"))
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      generated.push(body);
      const asset = draft.mediaPlan.manifest.assets[body.language][0];
      soundRuns.unshift({
        kind: "audio",
        audio: {
          language: body.language,
          assetKey: body.assetKey,
          script: asset.script,
          model: "sound-generation",
          sound: {
            provider: body.provider,
            model: "sound-generation",
            kind: "sfx",
            prompt: "a heavy wooden door creaks open",
            targetDurationMs: asset.targetDurationMs,
          },
        },
        runId: `run_sound_${soundRuns.length + 1}`,
        inputRevision: body.expectedRevision,
        activityId: "act_test",
        projectId,
        sessionId: "session_sound",
        status: "running",
        createdAt: "2026-09-25T10:00:00Z",
        hasCandidate: false,
        error: null,
      });
      return json(soundRuns[0], 202);
    }
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: soundRuns });
    if (/\/runs\/run_sound_\d+\/accept-audio$/.test(p)) {
      const run = soundRuns.find((entry) => p.includes(`/${entry.runId}/`));
      const manifest = structuredClone(draft.mediaPlan.manifest);
      const asset = manifest.assets["en-US"][0];
      asset.path = `media/generated/${run.runId}.mp3`;
      asset.generatedAudio = { runId: run.runId, sha256: "c".repeat(64), format: "mp3" };
      accepted = {
        ...draft,
        contentRevision: `${draft.contentRevision}-sound`,
        mediaPlan: { ...draft.mediaPlan, manifest },
      };
      return json(accepted);
    }
    return route.fallback();
  });
  // The editor asks which providers the agent can use as it opens, so the stubs come first.
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  // Without the key, the card names the Vault key to add and will not generate.
  const card = page.getByRole("region", { name: "English audio", exact: true });
  const prompt = card.getByRole("textbox", { name: /^Generation prompt/ });
  await expect(prompt).toHaveValue("a door");
  await expect(
    card.getByText("Add ELEVENLABS_API_KEY to the Media Agent's Vault.", { exact: true }),
  ).toBeVisible();
  const generate = card.getByRole("button", { name: /^(Generate|Regenerate) audio$/ });
  await expect(generate).toBeDisabled();
  // Uploading and the library stay available.
  await expect(card.getByText("Upload audio", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Choose from media library", exact: true }),
  ).toBeVisible();

  keyed = true;
  await page.reload();
  await openSection(page, "Scenes and media");
  // The length is asked for in the Advanced view.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await prompt.fill("a heavy wooden door creaks open");
  await card.getByRole("spinbutton", { name: /^Length/ }).fill("3");
  await expect(generate).toBeDisabled();
  // The two edits save themselves, perhaps one at a time; the last save carries both.
  await expect
    .poll(() => savedManifests.at(-1)?.assets["en-US"][0])
    .toMatchObject({
      script: '<audio kind="sfx">a heavy wooden door creaks open</audio>',
      targetDurationMs: 3000,
      kind: "sfx",
    });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect.poll(() => generated.length).toBe(1);
  expect(generated[0]).toMatchObject({
    agentId: "media_agent",
    language: "en-US",
    assetKey: "door",
    provider: "elevenlabs",
  });
  await expect(card.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled();

  soundRuns[0] = { ...soundRuns[0], status: "succeeded", hasCandidate: true };
  // The take plays beside the current file, and replaces it only on Save.
  const candidate = card.locator('audio[aria-label="Generated candidate"]');
  await expect(candidate).toHaveAttribute("src", `${base}/act_test/runs/run_sound_1/audio`, {
    timeout: 15_000,
  });
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => accepted?.mediaPlan.manifest.assets["en-US"][0].path)
    .toBe("media/generated/run_sound_1.mp3");
  await expect(card.locator('audio[aria-label="Current audio"]')).toHaveAttribute(
    "src",
    `${base}/act_test/runs/run_sound_1/audio`,
  );
  await expect(card.getByRole("textbox", { name: /^Media path/ })).toHaveValue(
    "media/generated/run_sound_1.mp3",
  );
  expect(f.errors).toEqual([]);
});

test("lists the model hub as a sound provider, disabled until it offers a model", async ({
  page,
}) => {
  const f = await fixture(page);
  // What the model hub offers: nothing in this version, then two music models.
  let hubModels = [];
  const generated = [];
  const soundRuns = [];
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "tune",
                type: "audio",
                description: "A tune",
                script: '<audio kind="music">a playful marimba loop</audio>',
                kind: "music",
                channel: "music",
                loop: true,
                volume: 1,
                usages: [
                  { sceneId: "intro", sourceKey: "tune", occurrence: 1, sceneOccurrenceCount: 1 },
                ],
              },
            ],
          },
        },
      }),
    }),
  );
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/sound-setup`)
      return json({
        providers: [
          {
            id: "elevenlabs",
            kinds: ["music", "sfx"],
            credential: "ELEVENLABS_API_KEY",
            models: { music: "music_v1", sfx: "sound-generation" },
            available: true,
          },
          {
            id: "agenthub",
            kinds: ["music", "sfx"],
            credential: hubModels.length ? "GEMINI_API_KEY" : "",
            models: hubModels.length ? { music: hubModels[0].id } : {},
            available: hubModels.length > 0,
            ...(hubModels.length ? {} : { problem: "no_model" }),
            modelChoices: hubModels,
          },
        ],
      });
    if (p === `${base}/act_test/generate-sound`) {
      const body = request.postDataJSON();
      if (soundRuns.some((run) => run.status === "running"))
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      generated.push(body);
      soundRuns.unshift({
        kind: "audio",
        audio: {
          language: body.language,
          assetKey: body.assetKey,
          script: '<audio kind="music">a playful marimba loop</audio>',
          model: body.model,
          sound: {
            provider: body.provider,
            model: body.model,
            kind: "music",
            prompt: "a playful marimba loop",
            credential: "GEMINI_API_KEY",
            format: "wav",
          },
        },
        runId: "run_hub_1",
        inputRevision: body.expectedRevision,
        activityId: "act_test",
        projectId,
        sessionId: "session_hub",
        status: "running",
        createdAt: "2026-09-25T10:00:00Z",
        hasCandidate: false,
        error: null,
      });
      return json(soundRuns[0], 202);
    }
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: soundRuns });
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  // The provider and model are chosen in the Advanced view.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();

  // Shown, never hidden: the option is there, disabled, with the reason in its name.
  const provider = page.getByRole("button", { name: "Provider", exact: true });
  await expect(provider).toHaveText("ElevenLabs");
  await provider.click();
  await expect(
    page.getByRole("option", {
      name: "Model: No music or sound model is available through the model hub in this version.",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  const model = page.getByRole("button", { name: "Model", exact: true });
  await expect(model).toHaveCount(0);

  // A release with sound models: choosing the hub offers its models.
  hubModels = [
    { id: "tune-lite", kinds: ["music"], credential: "GEMINI_API_KEY", available: true },
    { id: "tune-pro", kinds: ["music", "sfx"], credential: "GEMINI_API_KEY", available: true },
  ];
  const setupLoaded = page.waitForResponse((response) =>
    response.url().includes(`${base}/sound-setup`),
  );
  await page.reload();
  await setupLoaded;
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  // Centred first: scrolling to reach a menu row would move the trigger and close the menu.
  await provider.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await provider.click();
  await page.getByRole("option", { name: "Model", exact: true }).click();
  await expect(provider).toHaveText("Model");
  await expect(model).toHaveText("tune-lite");
  await model.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await model.click();
  await page.getByRole("option", { name: "tune-pro", exact: true }).click();
  await expect(model).toHaveText("tune-pro");
  await page.getByRole("button", { name: /^(Generate|Regenerate) audio$/ }).click();
  await expect.poll(() => generated.length).toBe(1);
  expect(generated[0]).toMatchObject({
    agentId: "media_agent",
    language: "en-US",
    assetKey: "tune",
    provider: "agenthub",
    model: "tune-pro",
  });
  await expect(page.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled();
  expect(f.errors).toEqual([]);
});

test("generates the missing sounds from Audios", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const usage = (key) => [
    { sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 },
  ];
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "hello",
                type: "audio",
                description: "Greeting",
                script: "Hello",
                usages: usage("hello"),
              },
              {
                key: "chime",
                type: "audio",
                description: "Correct answer",
                script: "bright chime",
                kind: "sfx",
                path: "media/loom/words/words-1/uploads/chime-00000000.mp3",
                usages: usage("chime"),
              },
              {
                key: "whoosh",
                type: "audio",
                description: "Page turn",
                script: '<audio kind="sfx">soft paper whoosh</audio>',
                kind: "sfx",
                usages: usage("whoosh"),
              },
            ],
          },
        },
      }),
    }),
  );
  // The sequence the server answers with while the sounds stage runs.
  const running = () => ({
    pipelineId: "pipeline_1",
    projectId,
    activityId: "act_test",
    selection: "sounds",
    scope: { language: "en-US" },
    status: "running",
    steps: [
      {
        step: "sounds",
        status: "running",
        detail: "whoosh",
        note: null,
        done: 0,
        total: 1,
        runIds: [],
      },
    ],
    currentRunId: null,
    currentSessionId: null,
    error: null,
    startedAt: "2026-09-25T12:00:00Z",
    finishedAt: null,
  });
  const stages = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/sound-setup`)
      return json({
        providers: [
          {
            id: "elevenlabs",
            kinds: ["music", "sfx"],
            credential: "ELEVENLABS_API_KEY",
            models: { music: "music_v1", sfx: "sound-generation" },
            available: true,
          },
          {
            id: "agenthub",
            kinds: ["music", "sfx"],
            credential: "",
            models: {},
            available: false,
            problem: "no_model",
            modelChoices: [],
          },
        ],
      });
    if (p === `${base}/act_test/pipeline` && request.method() === "POST") {
      // One sequence at a time, as the server allows.
      if (stages.length)
        return json({ error: { code: "pipeline_running", message: "Running." } }, 409);
      stages.push(request.postDataJSON());
      return json(running(), 202);
    }
    // Following the sequence, as the panel does after starting it.
    if (p === `${base}/act_test/pipeline`)
      return json({ pipeline: stages.length ? running() : null });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await page.reload();
  await openSection(page, "Speech coverage");

  const sounds = page.getByRole("region", { name: "Sounds", exact: true });
  await expect(sounds).toContainText("1 of 2 sounds bound");
  await expect(sounds.getByRole("button", { name: /^chime/ })).toContainText("Bound");
  await expect(sounds.getByRole("button", { name: /^whoosh/ })).toContainText("Missing");
  // Narration is still counted on its own, unchanged.
  await expect(page.getByText("0 of 1 narrations bound")).toBeVisible();

  await sounds.getByRole("button", { name: "Generate missing sounds (1)", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // Asking first, because every sound is a paid request to the provider.
  await expect(dialog).toContainText("paid request to ElevenLabs");
  await dialog.getByRole("button", { name: "Generate missing sounds (1)", exact: true }).click();
  await expect.poll(() => stages.length).toBe(1);
  expect(stages[0]).toMatchObject({
    stage: "sounds",
    language: "en-US",
    soundProvider: "elevenlabs",
  });
  expect(stages[0].assetKey).toBeUndefined();
  // The Stages panel follows the run.
  const panel = page.getByRole("complementary", { name: "Stages" });
  await expect(panel.getByText("Generate sounds", { exact: true })).toBeVisible();
  await expect(panel).toContainText("whoosh");
  expect(f.errors).toEqual([]);
});

test("speaks a narration with ElevenLabs and keeps its word timings", async ({ page }) => {
  const f = await fixture(page);
  const clip = silentMp3(40);
  const generated = [];
  const speechRuns = [];
  const savedManifests = [];
  const setupQueries = [];
  let draft = null;
  let accepted = null;
  const timings = [
    { word: "Hello", startMs: 0, endMs: 300 },
    { word: "big", startMs: 350, endMs: 500 },
    { word: "cat", startMs: 600, endMs: 900 },
  ];
  page.on("response", async (response) => {
    const p = new URL(response.url()).pathname;
    if ([`${base}/act_test/plan-media`, `${base}/act_test/media`].includes(p) && response.ok())
      draft = await response.json().catch(() => draft);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `${base}/act_test/media` && request.method() === "PUT")
      savedManifests.push(request.postDataJSON().manifest);
  });
  const usage = { sceneId: "intro", sourceKey: "hello", occurrence: 1, sceneOccurrenceCount: 1 };
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "hello",
                type: "audio",
                description: "Greeting",
                script: "Hello, big cat!",
                // Written for Gemini, which this agent has no key for.
                speechProvider: "gemini",
                usages: [usage],
              },
            ],
          },
        },
      }),
    }),
  );
  const gemini = (id) => ({
    id,
    label: id,
    provider: "Gemini",
    providerId: "gemini",
    model: "gemini-3.1-flash-tts-preview",
    languages: [],
    previewUrl: null,
  });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/elevenlabs-voices`)
      // The Media Agent's library: the default named after the voice it stands for, then the rest.
      return json({
        voices: [
          {
            id: "elevenlabs-default",
            label: "ElevenLabs default",
            voiceName: "Sarah",
            provider: "ElevenLabs",
            providerId: "elevenlabs",
            model: "eleven_v3",
            languages: ["en-US"],
            previewUrl: null,
          },
          {
            id: "AbCdEfGhIj0123456789",
            label: "Aaron",
            provider: "ElevenLabs",
            providerId: "elevenlabs",
            model: "eleven_v3",
            languages: ["en-US"],
            previewUrl: null,
            description: "american · middle aged · male",
          },
        ],
      });
    if (p === `${base}/speech-setup`) {
      // The Media Agent answers, whoever runs the stages: the App names no agent.
      setupQueries.push(url.search);
      return json({
        provider: "Gemini",
        model: "gemini-3.1-flash-tts-preview",
        voices: ["Kore", "Puck"],
        catalogue: [
          gemini("Kore"),
          gemini("Puck"),
          {
            id: "elevenlabs-default",
            label: "ElevenLabs default",
            provider: "ElevenLabs",
            providerId: "elevenlabs",
            model: "eleven_v3",
            languages: [],
            previewUrl: null,
          },
        ],
        vaultKey: "GEMINI_API_KEY",
        providers: [
          {
            id: "gemini",
            credential: "GEMINI_API_KEY",
            available: false,
            problem: "credential_missing",
            timings: false,
          },
          {
            id: "elevenlabs",
            credential: "ELEVENLABS_API_KEY",
            available: true,
            timings: true,
          },
        ],
      });
    }
    if (/\/runs\/[^/]+\/audio$/.test(p)) {
      // Served with byte ranges, as a real file is, so the player can seek in it.
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers()["range"] ?? "");
      if (!range)
        return route.fulfill({
          contentType: "audio/mpeg",
          headers: { "accept-ranges": "bytes" },
          body: clip,
        });
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
      return route.fulfill({
        status: 206,
        contentType: "audio/mpeg",
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${clip.length}`,
        },
        body: clip.subarray(start, end + 1),
      });
    }
    if (p === `${base}/act_test/generate-audio`) {
      const body = request.postDataJSON();
      // One generation at a time, as the server allows.
      if (speechRuns.some((run) => run.status === "running"))
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      generated.push(body);
      speechRuns.unshift({
        kind: "audio",
        audio: {
          language: body.language,
          assetKey: body.assetKey,
          script: "Hello, big cat!",
          voice: body.voice,
          provider: body.provider,
          model: "eleven_v3",
        },
        runId: `run_speech_${speechRuns.length + 1}`,
        inputRevision: body.expectedRevision,
        activityId: "act_test",
        projectId,
        sessionId: "session_speech",
        status: "running",
        createdAt: "2026-09-25T10:00:00Z",
        hasCandidate: false,
        error: null,
      });
      return json(speechRuns[0], 202);
    }
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: speechRuns });
    if (/\/runs\/run_speech_\d+\/accept-audio$/.test(p)) {
      const run = speechRuns.find((entry) => p.includes(`/${entry.runId}/`));
      const manifest = structuredClone(draft.mediaPlan.manifest);
      const asset = manifest.assets["en-US"][0];
      // What the server records from ElevenLabs' timestamps: the words and the clip's length.
      asset.path = `media/generated/${run.runId}.mp3`;
      asset.generatedAudio = { runId: run.runId, sha256: "d".repeat(64), format: "mp3" };
      asset.wordTimings = timings;
      asset.durationMs = 1045;
      accepted = {
        ...draft,
        contentRevision: `${draft.contentRevision}-speech`,
        mediaPlan: { ...draft.mediaPlan, manifest },
      };
      return json(accepted);
    }
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  // The editor asks which providers the Media Agent can use, naming no agent.
  await expect.poll(() => setupQueries.includes("")).toBe(true);

  // The provider and model are chosen in the Advanced view.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const card = page.getByRole("region", { name: "English audio", exact: true });
  const provider = card.getByRole("button", { name: "Provider", exact: true });
  await expect(provider).toContainText("Gemini (needs GEMINI_API_KEY)");
  const generate = card.getByRole("button", { name: /^(Generate|Regenerate) audio$/ });
  await expect(generate).toBeDisabled();
  // Only ElevenLabs offers a choice of model.
  const model = card.getByRole("button", { name: "Model", exact: true });
  await expect(model).toHaveCount(0);
  // Bring the picker into view first: a scroll while its menu is open closes the menu.
  await provider.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await provider.click();
  await page.getByRole("option", { name: "ElevenLabs", exact: true }).click();
  await expect(provider).toContainText("ElevenLabs");
  await expect(model).toHaveText("Eleven v3");
  // The voice picker offers the Media Agent's ElevenLabs library, and its default is the one
  // used, named after the voice it stands for.
  const voicePicker = card.getByRole("button", { name: /^Voice/ }).first();
  await expect(voicePicker).toContainText("ElevenLabs · Default voice (Sarah)");
  await voicePicker.click();
  await expect(
    page.getByRole("option", { name: /^Aaron · american · middle aged · male/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button", { name: "Reload voices", exact: true })).toBeVisible();
  await expect(card.getByRole("textbox", { name: /^ElevenLabs voice ID/ })).toBeVisible();
  // Choosing the provider saved it, without the save button.
  await expect.poll(() => savedManifests.length).toBe(1);
  expect(savedManifests[0].assets["en-US"][0]).toMatchObject({
    key: "hello",
    speechProvider: "elevenlabs",
  });
  expect(savedManifests[0].assets["en-US"][0]).not.toHaveProperty("speechModel");
  // Another model is saved with the narration too; the server speaks with it.
  await model.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await model.click();
  await page.getByRole("option", { name: "Eleven v4", exact: true }).click();
  await expect(model).toHaveText("Eleven v4");
  await expect.poll(() => savedManifests.at(-1).assets["en-US"][0].speechModel).toBe("eleven_v4");
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect.poll(() => generated.length).toBe(1);
  expect(generated[0]).toMatchObject({
    agentId: "media_agent",
    language: "en-US",
    assetKey: "hello",
    provider: "elevenlabs",
    voice: "elevenlabs-default",
  });

  speechRuns[0] = { ...speechRuns[0], status: "succeeded", hasCandidate: true };
  await expect(card.locator('audio[aria-label="Generated candidate"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => accepted?.mediaPlan.manifest.assets["en-US"][0].path)
    .toBe("media/generated/run_speech_1.mp3");

  // The current recording lists its words, marking the one spoken where the player is.
  const words = page.getByRole("list", {
    name: "Words, highlighted as the recording plays",
    exact: true,
  });
  await expect(words.getByRole("listitem")).toHaveText(["Hello", "big", "cat"]);
  const player = card.locator('audio[aria-label="Current audio"]');
  await expect(player).toHaveAttribute("src", `${base}/act_test/runs/run_speech_1/audio`);
  const seekedTo = await player.evaluate(
    (audio) =>
      new Promise((resolve) => {
        const seek = () => {
          audio.addEventListener("seeked", () => resolve(audio.currentTime), { once: true });
          audio.currentTime = 0.4;
        };
        if (audio.readyState >= 1) seek();
        else {
          // The player loads nothing until asked.
          audio.addEventListener("loadedmetadata", seek, { once: true });
          audio.preload = "metadata";
          audio.load();
        }
      }),
  );
  expect(seekedTo).toBeCloseTo(0.4, 1);
  await expect(words.getByRole("listitem", { name: "big, at 0.35 s" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(f.errors).toEqual([]);
});

test("refreshes a decodable book's words and corrects one word's sounds", async ({ page }) => {
  const f = await fixture(page);
  const usage = (sceneId, sourceKey) => ({
    sceneId,
    sourceKey,
    occurrence: 1,
    sceneOccurrenceCount: 1,
  });
  const bookSpec = {
    ...spec,
    scenes: [
      {
        id: "page-1",
        role: "story",
        description: "Story page 1",
        media: { images: [{ key: "page-1-art", description: "A cat" }] },
        audio: {
          tracks: [{ key: "narration-1", description: "Narration", script: "The cat sat." }],
        },
      },
      {
        id: "page-2",
        role: "story",
        description: "Story page 2",
        media: { images: [{ key: "page-2-art", description: "A cat running" }] },
        audio: {
          tracks: [{ key: "narration-2", description: "Narration", script: "The cat ran." }],
        },
      },
    ],
  };
  const narration = (key, sceneId, script) => ({
    key,
    type: "audio",
    description: "Narration",
    script,
    usages: [usage(sceneId, key)],
  });
  const word = (text, keyHash, usages, sounds) => ({
    key: `book-word-${text}-${keyHash}`,
    type: "audio",
    role: "bookWord",
    description: `Pronunciation of “${text}”.`,
    word: text,
    normalizedWord: text,
    ...(sounds ? { phonemes: sounds, phonemeSource: "espeak" } : {}),
    usages,
  });
  const bothPages = [usage("page-1", "narration-1"), usage("page-2", "narration-2")];
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              narration("narration-1", "page-1", "The cat sat."),
              narration("narration-2", "page-2", "The cat ran."),
            ],
          },
        },
      }),
    }),
  );
  // The draft as the server holds it, followed through the responses that change it.
  let record = null;
  let draft = null;
  let mine = false;
  page.on("response", async (response) => {
    const request = response.request();
    const p = new URL(response.url()).pathname;
    if (!response.ok()) return;
    if (p === base && request.method() === "POST")
      record = await response.json().catch(() => record);
    if (
      !mine &&
      [`${base}/act_test/apply-generated-spec`, `${base}/act_test/plan-media`].includes(p)
    )
      draft = await response.json().catch(() => draft);
  });
  const refreshes = [];
  const soundSaves = [];
  const asked = [];
  const accepts = [];
  const phonemeRuns = [];
  let changes = 0;
  const next = (change) => {
    const manifest = structuredClone(draft.mediaPlan.manifest);
    change(manifest.assets["en-US"]);
    draft = {
      ...draft,
      contentRevision: `${draft.contentRevision}-w${++changes}`,
      mediaPlan: { ...draft.mediaPlan, manifest },
    };
    mine = true;
    return draft;
  };
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/book-words`)
      return json({ bookMode: "decodable", espeak: { available: true, version: "1.51" } });
    if (p === `${base}/act_test` && request.method() === "GET" && mine)
      return json({ ...record, draft });
    if (p === `${base}/act_test/book-words/refresh`) {
      const body = request.postDataJSON();
      refreshes.push(body);
      if (body.expectedRevision !== draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      // espeak-ng sounds out three of the four words; "ran" is left for a model.
      const updated = next((group) =>
        group.push(
          word("the", "b9776d7ddf", bothPages, ["ð", "ə"]),
          word("cat", "77af778b51", bothPages, ["k", "æ", "t"]),
          word("sat", "339efeab70", [usage("page-1", "narration-1")], ["s", "æ", "t"]),
          word("ran", "c8fc6bf296", [usage("page-2", "narration-2")]),
        ),
      );
      return json({ draft: updated, missing: ["ran"] });
    }
    if (p === `${base}/act_test/generate-phonemes`) {
      const body = request.postDataJSON();
      // One generation at a time, as the server allows.
      if (phonemeRuns.some((run) => run.status === "running"))
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      asked.push(body);
      phonemeRuns.unshift({
        kind: "phonemes",
        phonemes: { language: body.language, words: body.words },
        runId: "run_phonemes_1",
        inputRevision: body.expectedRevision,
        activityId: "act_test",
        projectId,
        sessionId: "session_phonemes",
        status: "running",
        createdAt: "2026-09-25T12:00:00Z",
        finishedAt: null,
        hasCandidate: false,
        error: null,
      });
      return json(phonemeRuns[0], 202);
    }
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: phonemeRuns });
    if (p === `${base}/act_test/runs/run_phonemes_1/candidate`)
      return json({
        candidate: JSON.stringify({ language: "en-US", phonemes: { ran: ["r", "æ", "n"] } }),
      });
    if (p === `${base}/act_test/runs/run_phonemes_1/accept-phonemes`) {
      const body = request.postDataJSON();
      accepts.push(body);
      if (body.expectedRevision !== draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      return json(
        next((group) =>
          Object.assign(
            group.find((asset) => asset.normalizedWord === "ran"),
            { phonemes: ["r", "æ", "n"], phonemeSource: "model" },
          ),
        ),
      );
    }
    if (/\/book-words\/[^/]+\/phonemes$/.test(p) && request.method() === "PUT") {
      const body = request.postDataJSON();
      soundSaves.push({ key: decodeURIComponent(p.split("/").at(-2)), ...body });
      if (body.expectedRevision !== draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      return json(
        next((group) =>
          Object.assign(
            group.find((asset) => asset.key === "book-word-cat-77af778b51"),
            { phonemes: body.phonemes, phonemeSource: "author", customized: true },
          ),
        ),
      );
    }
    return route.fallback();
  });

  await create(page, { activityType: "book" });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(bookSpec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openSection(page, "Speech coverage");

  const panel = page.getByRole("region", { name: "Word pronunciations", exact: true });
  await expect(panel).toContainText("0 words");
  await panel.getByRole("button", { name: "Refresh words", exact: true }).click();
  await expect(panel).toContainText("4 words · 1 word has no sounds yet.");
  // The product records the reading mode, so the page sends none of its own.
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0]).toMatchObject({ language: "en-US" });
  expect(refreshes[0].bookMode).toBeUndefined();
  // The words are the book's, not narration: the narration count is unchanged.
  await expect(page.getByText("0 of 2 narrations bound")).toBeVisible();

  await panel.getByRole("button", { name: "Ask a model for the rest", exact: true }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatchObject({ agentId: "default_agent", language: "en-US", words: ["ran"] });
  phonemeRuns[0] = { ...phonemeRuns[0], status: "succeeded", hasCandidate: true };
  const proposal = panel.getByRole("region", { name: "Proposed sounds", exact: true });
  await expect(proposal).toContainText("ran: r æ n", { timeout: 15_000 });
  await proposal.getByRole("button", { name: "Use these sounds", exact: true }).click();
  await expect(panel).toContainText("4 words · Every word has its sounds.");
  expect(accepts).toHaveLength(1);

  // The words are listed under each scene that shows them, in a group of their own.
  const scene = page.getByRole("treeitem", { name: "page-1", exact: true });
  if ((await scene.getAttribute("aria-expanded")) !== "true") await scene.click();
  const group = page.getByRole("treeitem", { name: "Word pronunciations", exact: true }).first();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await page.getByRole("treeitem", { name: "cat", exact: true }).first().click();

  const editor = page.getByRole("region", { name: "Word pronunciations", exact: true });
  await expect(editor.getByRole("textbox", { name: "Word", exact: true })).toHaveValue("cat");
  await expect(editor).toContainText("From espeak-ng");
  const second = editor.getByRole("textbox", { name: "Sound 2", exact: true });
  await expect(second).toHaveValue("æ");
  const save = editor.getByRole("button", { name: "Save sounds", exact: true });
  await expect(save).toBeDisabled();
  await second.fill("a");
  await save.click();
  await expect.poll(() => soundSaves.length).toBe(1);
  expect(soundSaves[0]).toMatchObject({
    key: "book-word-cat-77af778b51",
    language: "en-US",
    phonemes: ["k", "a", "t"],
  });
  await expect(editor).toContainText("Yours");
  expect(f.errors).toEqual([]);
});

test("records a decodable book's words and shows each word's sounds in time", async ({ page }) => {
  const f = await fixture(page);
  const clip = silentMp3(40);
  const usage = (sceneId, sourceKey) => ({
    sceneId,
    sourceKey,
    occurrence: 1,
    sceneOccurrenceCount: 1,
  });
  const bookSpec = {
    ...spec,
    scenes: [
      {
        id: "page-1",
        role: "story",
        description: "Story page 1",
        media: { images: [{ key: "page-1-art", description: "A cat" }] },
        audio: { tracks: [{ key: "narration-1", description: "Narration", script: "The cat." }] },
      },
    ],
  };
  const drawnOut = '[very slowly] [drawn out] "/kæːːːt/" [short pause] cat.';
  const word = (text, sounds, extra = {}) => ({
    key: `book-word-${text}`,
    type: "audio",
    role: "bookWord",
    description: `Pronunciation of “${text}”.`,
    word: text,
    normalizedWord: text,
    phonemes: sounds,
    phonemeSource: "espeak",
    usages: [usage("page-1", "narration-1")],
    ...extra,
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "narration-1",
                type: "audio",
                description: "Narration",
                script: "The cat.",
                usages: [usage("page-1", "narration-1")],
              },
              word("the", ["ð", "ə"], {
                script:
                  "Say the word 'the' very slowly, stretching each sound: ð ə, then say it normally.",
              }),
              word("cat", ["k", "æ", "t"], { script: drawnOut, speechProvider: "elevenlabs" }),
            ],
          },
        },
      }),
    }),
  );
  let record = null;
  let draft = null;
  let recorded = false;
  page.on("response", async (response) => {
    const request = response.request();
    const p = new URL(response.url()).pathname;
    if (!response.ok()) return;
    if (p === base && request.method() === "POST")
      record = await response.json().catch(() => record);
    if (
      !recorded &&
      [`${base}/act_test/apply-generated-spec`, `${base}/act_test/plan-media`].includes(p)
    )
      draft = await response.json().catch(() => draft);
  });
  // What the server holds once the words stage has recorded and accepted both words: "cat" by
  // ElevenLabs, timed sound by sound, and "the" by Gemini, untimed.
  const afterRecording = () => {
    const manifest = structuredClone(draft.mediaPlan.manifest);
    const group = manifest.assets["en-US"];
    Object.assign(
      group.find((asset) => asset.key === "book-word-cat"),
      {
        path: "media/generated/run_word_1.mp3",
        generatedAudio: { runId: "run_word_1", sha256: "d".repeat(64), format: "mp3" },
        wordTimings: [
          { word: "kæːːːt", startMs: 0, endMs: 600 },
          { word: "cat", startMs: 700, endMs: 1000 },
        ],
        durationMs: 1045,
        phonemeTimings: [
          { phoneme: "k", startMs: 0, endMs: 200 },
          { phoneme: "æ", startMs: 200, endMs: 400 },
          { phoneme: "t", startMs: 400, endMs: 600 },
        ],
        wholeWordTiming: { startMs: 700, endMs: 1000 },
      },
    );
    Object.assign(
      group.find((asset) => asset.key === "book-word-the"),
      {
        path: "media/generated/run_word_2.wav",
        generatedAudio: { runId: "run_word_2", sha256: "e".repeat(64) },
      },
    );
    return {
      ...draft,
      contentRevision: `${draft.contentRevision}-words`,
      mediaPlan: { ...draft.mediaPlan, manifest },
    };
  };
  const state = (status) => ({
    pipelineId: "pipeline_words",
    projectId,
    activityId: "act_test",
    selection: "words",
    scope: { language: "en-US" },
    status,
    steps: [
      {
        step: "words",
        status,
        detail: status === "running" ? "book-word-cat" : null,
        note: null,
        done: status === "running" ? 0 : 2,
        total: 2,
        runIds: [],
      },
    ],
    currentRunId: null,
    currentSessionId: null,
    error: null,
    startedAt: "2026-09-25T12:00:00Z",
    finishedAt: status === "running" ? null : "2026-09-25T12:01:00Z",
  });
  const stages = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/book-words`)
      return json({ bookMode: "decodable", espeak: { available: true, version: "1.51" } });
    if (p === `${base}/act_test` && request.method() === "GET" && recorded)
      return json({ ...record, draft: afterRecording() });
    if (p === `${base}/act_test/pipeline` && request.method() === "POST") {
      // One sequence at a time, as the server allows.
      if (stages.length)
        return json({ error: { code: "pipeline_running", message: "Running." } }, 409);
      stages.push(request.postDataJSON());
      return json(state("running"), 202);
    }
    if (p === `${base}/act_test/pipeline`)
      return json({ pipeline: stages.length ? state(recorded ? "succeeded" : "running") : null });
    if (/\/runs\/run_word_\d+\/audio$/.test(p)) {
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers()["range"] ?? "");
      if (!range)
        return route.fulfill({
          contentType: "audio/mpeg",
          headers: { "accept-ranges": "bytes" },
          body: clip,
        });
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
      return route.fulfill({
        status: 206,
        contentType: "audio/mpeg",
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${clip.length}`,
        },
        body: clip.subarray(start, end + 1),
      });
    }
    return route.fallback();
  });

  await create(page, { activityType: "book" });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(bookSpec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openSection(page, "Speech coverage");

  const panel = page.getByRole("region", { name: "Word pronunciations", exact: true });
  await expect(panel).toContainText("2 words are ready to record.");
  await panel.getByRole("button", { name: "Record words (2)", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // Asked first, because every recording is a paid request.
  await expect(dialog).toContainText("Record 2 words in en-US?");
  await dialog.getByRole("button", { name: "Record words (2)", exact: true }).click();
  await expect.poll(() => stages.length).toBe(1);
  expect(stages[0]).toMatchObject({ stage: "words", language: "en-US", agentId: "default_agent" });
  const stagesPanel = page.getByRole("complementary", { name: "Stages" });
  await expect(stagesPanel.getByText("Record words", { exact: true })).toBeVisible();

  // The stage records and accepts both words; the page shows the book as the server holds it.
  recorded = true;
  await page.reload();
  await openSection(page, "Speech coverage");
  await expect(panel).toContainText(
    "1 recorded word has no sound timings, so it is not highlighted.",
  );
  await expect(panel.getByRole("button", { name: "Record words (0)", exact: true })).toBeDisabled();

  const scene = page.getByRole("treeitem", { name: "page-1", exact: true });
  if ((await scene.getAttribute("aria-expanded")) !== "true") await scene.click();
  const group = page.getByRole("treeitem", { name: "Word pronunciations", exact: true }).first();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await page.getByRole("treeitem", { name: "cat", exact: true }).first().click();

  // The script is made from the sounds, and read-only until the author writes their own.
  const script = page.getByRole("textbox", { name: /^Recording script/ });
  await expect(script).toHaveValue(drawnOut);
  await expect(script).toHaveAttribute("readonly", "");
  const sounds = page.getByRole("list", {
    name: "Sounds, highlighted as the recording plays",
    exact: true,
  });
  await expect(sounds.getByRole("listitem")).toHaveText(["k", "æ", "t", "cat"]);
  const player = page.locator('audio[aria-label="Recording"]');
  await expect(player).toHaveAttribute("src", `${base}/act_test/runs/run_word_1/audio`);
  const seekedTo = await player.evaluate(
    (audio) =>
      new Promise((resolve) => {
        const seek = () => {
          audio.addEventListener("seeked", () => resolve(audio.currentTime), { once: true });
          audio.currentTime = 0.3;
        };
        if (audio.readyState >= 1) seek();
        else {
          audio.addEventListener("loadedmetadata", seek, { once: true });
          audio.preload = "metadata";
          audio.load();
        }
      }),
  );
  expect(seekedTo).toBeCloseTo(0.3, 1);
  await expect(sounds.getByRole("listitem", { name: "Sound æ, at 0.20 s" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // "the" was recorded by Gemini: it plays, and says it has no sound timings.
  await page.getByRole("treeitem", { name: "the", exact: true }).first().click();
  await expect(
    page.getByText(
      "This recording has no sound timings, so the book does not highlight its sounds.",
    ),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("shows what a deploy still needs", async ({ page }) => {
  const f = await fixture(page);
  const absent = { present: false, branch: null, clean: null, ahead: null, remoteUrlMatches: null };
  const clean = { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true };
  // The deploy routes, with the server's rules: the context is read-only, Prepare clones makes
  // the missing clones and nothing else, and the remote is asked only on Check remote.
  let cloned = false;
  let prepares = 0;
  let remoteChecks = 0;
  const context = (remoteChecked) => {
    const problems = [{ code: "settings_missing", field: "qa.jenkinsUrl" }];
    if (!cloned)
      for (const repo of ["module", "activityData", "media"])
        problems.push({ code: "clone_missing", repo });
    return {
      ready: false,
      problems,
      remoteChecked,
      module: {
        folder: "waf-module-words",
        remote: "git@github.com:org/waf-module-words.git",
        clone: cloned ? clean : absent,
      },
      activityData: { clone: cloned ? clean : absent },
      media: { clone: cloned ? clean : absent },
      branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
      branchState: {
        deploy: cloned
          ? { local: false, remote: remoteChecked ? true : null }
          : { local: null, remote: null },
        activityData: cloned
          ? { local: true, remote: remoteChecked ? false : null }
          : { local: null, remote: null },
      },
    };
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "GET") {
      const blocker = { code: "settings_missing", field: "qa.jenkinsUrl" };
      return json({
        context: context(false),
        run: null,
        stages: [
          "verify_module",
          "prepare_deploy",
          "trigger_module_build",
          "await_module_build",
        ].map((stage) => ({ stage, status: "pending", finishedAt: null, metadata: {}, blocker })),
      });
    }
    if (url.pathname === `${base}/act_test/deploy/context` && request.method() === "GET") {
      const checkRemote = url.searchParams.get("checkRemote") === "1";
      if (checkRemote) remoteChecks++;
      return json({ context: context(checkRemote) });
    }
    if (url.pathname === `${base}/act_test/deploy/clones` && request.method() === "POST") {
      prepares++;
      cloned = true;
      return json({ context: context(false) });
    }
    return route.fallback();
  });
  // Registered before the activity opens, so the studio reads the module as there from the start.
  await create(page);
  await openSection(page, "Deploy");
  await expect(page.getByRole("heading", { name: /^Deploy More info/, level: 3 })).toBeVisible();
  const status = page.getByTestId("deploy-readiness");
  await expect(status).toHaveText("Not ready to deploy: 4 things are missing.");
  await page.locator("summary").filter({ hasText: "What is missing" }).click();
  const problems = page.getByRole("region", { name: "What is missing" });
  await expect(problems.getByText("QA Jenkins address is empty.", { exact: true })).toBeVisible();
  await expect(
    problems.getByText(
      "The Media clone is not on this server yet. Prepare clones makes the module's; an admin prepares the others in Settings, under WAF workspace.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("An admin fills in the deploy settings under System settings, Deploy.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Repository & branch details", { exact: true }).click();
  const checks = page.getByRole("table", { name: "Deploy checks" });
  await expect(checks.getByRole("row", { name: /^Media clone/ })).toContainText("Not cloned yet");
  await expect(checks.getByRole("row", { name: /^Ref/ })).toContainText("The canonical ref");

  // Prepare clones makes the three clones; only the settings are left.
  await page.getByRole("button", { name: "Prepare clones", exact: true }).click();
  await expect(status).toHaveText("Not ready to deploy: 1 thing is missing.");
  await expect(page.getByText("The clones are ready.", { exact: true })).toBeVisible();
  await expect(checks.getByRole("row", { name: /^Media clone/ })).toContainText(
    "Cloned, on main, clean",
  );
  await expect(page.getByRole("button", { name: "Prepare clones", exact: true })).toBeDisabled();
  expect(prepares).toBe(1);
  await expect(checks.getByRole("row", { name: /^Branch loom\/words-deploy/ })).toContainText(
    "remote not checked",
  );

  // Check remote asks the remote once and says where each branch is.
  expect(remoteChecks).toBe(0);
  await page.getByRole("button", { name: "Check remote", exact: true }).click();
  await expect(checks.getByRole("row", { name: /^Branch loom\/words-deploy/ })).toContainText(
    "Not made yet; the deploy makes it · on the remote",
  );
  await expect(
    checks.getByRole("row", { name: /^Branch loom\/words-activity-data/ }),
  ).toContainText("Here · not on the remote yet");
  expect(remoteChecks).toBe(1);
  expect(f.errors).toEqual([]);
});

test("an admin opens the deploy settings from what a deploy still needs", async ({ page }) => {
  const f = await fixture(page);
  const absent = { present: false, branch: null, clean: null, ahead: null, remoteUrlMatches: null };
  const context = {
    ready: false,
    problems: [{ code: "settings_missing", field: "qa.jenkinsUrl" }],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: absent,
    },
    activityData: { clone: absent },
    media: { clone: absent },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: null, remote: null },
      activityData: { local: null, remote: null },
    },
  };
  const settings = {
    qa: {
      jenkinsUrl: "",
      username: "",
      token: { set: false },
      tier: "qa",
      environment: "loom",
      frameworkVersion: "",
      activityBaseUrl: "",
    },
    prod: {
      jenkinsUrl: "",
      username: "",
      token: { set: false },
      tier: "prod",
      environment: "DEFAULT",
      frameworkVersion: "",
    },
    jobs: { moduleBuild: "Build WAF Modules", activityDeploy: "WAF Activity Deploy" },
    repos: { mediaPublicBase: "{{MEDIA}}/" },
    git: { userName: "", userEmail: "" },
    timeouts: { buildMinutes: 30, deployMinutes: 30 },
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/me")
      return json({
        user: { userId: "author", isAdmin: true, passwordIsInitial: false },
        previewIsolated: true,
        desktopMode: false,
        companyMode: false,
        sessionVia: "password",
        uploadLimits: {
          attachmentMaxMb: 100,
          attachmentTotalMb: 120,
          attachmentMaxCount: 20,
          imageMaxMb: 20,
          attachmentLimitMinMb: 1,
          attachmentLimitMaxMb: 200,
        },
      });
    if (url.pathname === "/api/admin/activity-deploy/settings") return json({ settings });
    if (url.pathname === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "GET") {
      const blocker = { code: "settings_missing", field: "qa.jenkinsUrl" };
      return json({
        context,
        run: null,
        stages: [
          "verify_module",
          "prepare_deploy",
          "trigger_module_build",
          "await_module_build",
        ].map((stage) => ({ stage, status: "pending", finishedAt: null, metadata: {}, blocker })),
      });
    }
    if (url.pathname === `${base}/act_test/deploy/context` && request.method() === "GET")
      return json({ context });
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Deploy");
  await page.locator("summary").filter({ hasText: "What is missing" }).click();
  const problems = page.getByRole("region", { name: "What is missing" });
  await expect(problems.getByText("QA Jenkins address is empty.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open deploy settings", exact: true }).click();
  // Exactly one settings dialog, and it opens on the Deploy page.
  const dialogs = page.getByRole("dialog", { name: "System settings" });
  await expect(dialogs).toHaveCount(1);
  const qa = dialogs.getByRole("group", { name: "QA" });
  await expect(qa.getByRole("textbox", { name: "Tier" })).toHaveValue("qa");
  await expect(qa.getByRole("textbox", { name: "Jenkins address" })).toBeVisible();
  await expect(dialogs).toHaveCount(1);
  expect(f.errors).toEqual([]);
});

test("on a phone, System settings from the drawer's account menu opens one dialog", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin}/activities`);
  // The drawer's sidebar and the hidden desktop pane are both mounted now, each with an
  // account menu; the dialog they open is the layout's one.
  await page
    .getByRole("button", { name: /^Sessions/ })
    .first()
    .click();
  // Only the drawer's user row is on screen; the desktop pane's is hidden at this width.
  await page.getByRole("button", { name: "author", exact: true }).click();
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "System settings" })).toHaveCount(1);
  expect(f.errors).toEqual([]);
});

test("an admin fills in the deploy settings and tests the QA connection", async ({ page }) => {
  const f = await fixture(page);
  let settings = {
    qa: {
      jenkinsUrl: "",
      username: "",
      token: { set: false },
      tier: "qa",
      environment: "loom",
      frameworkVersion: "",
      activityBaseUrl: "",
    },
    prod: {
      jenkinsUrl: "",
      username: "",
      token: { set: false },
      tier: "prod",
      environment: "DEFAULT",
      frameworkVersion: "",
    },
    jobs: { moduleBuild: "Build WAF Modules", activityDeploy: "WAF Activity Deploy" },
    repos: { mediaPublicBase: "{{MEDIA}}/" },
    git: { userName: "", userEmail: "" },
    timeouts: { buildMinutes: 30, deployMinutes: 30 },
  };
  const puts = [];
  const tests = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === "/api/me")
      return json({
        user: { userId: "author", isAdmin: true, passwordIsInitial: false },
        previewIsolated: true,
        desktopMode: false,
        companyMode: false,
        sessionVia: "password",
        uploadLimits: {
          attachmentMaxMb: 100,
          attachmentTotalMb: 120,
          attachmentMaxCount: 20,
          imageMaxMb: 20,
          attachmentLimitMinMb: 1,
          attachmentLimitMaxMb: 200,
        },
      });
    if (p === "/api/admin/activity-deploy/settings" && request.method() === "PUT") {
      const body = request.postDataJSON();
      puts.push(body);
      // The server's rule: plain http only on this machine; a refused field writes nothing.
      if (body.qa?.jenkinsUrl?.startsWith("http://"))
        return json(
          {
            error: {
              code: "invalid_deploy_setting",
              message: "qa.jenkinsUrl: must start with https://",
              detail: { field: "qa.jenkinsUrl", reason: "https_required" },
            },
          },
          400,
        );
      const { token, ...qa } = body.qa ?? {};
      settings = {
        ...settings,
        qa: { ...settings.qa, ...qa, token: { set: settings.qa.token.set || Boolean(token) } },
      };
      return json({ settings });
    }
    if (p === "/api/admin/activity-deploy/settings") return json({ settings });
    if (p === "/api/admin/activity-deploy/settings/test/qa") {
      tests.push(p);
      return json({ test: { ok: true, status: 200 } });
    }
    return route.fallback();
  });
  await page.goto(`${origin}/activities`);
  await page.locator('button[aria-haspopup="menu"]').filter({ hasText: "author" }).click();
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "System settings" });
  await dialog.getByRole("button", { name: "Deploy" }).click();
  const qa = dialog.getByRole("group", { name: "QA" });
  await expect(qa.getByRole("textbox", { name: "Tier" })).toHaveValue("qa");
  await expect(qa.getByRole("button", { name: "Test QA connection", exact: true })).toBeDisabled();

  // A plain http address is refused and marked under its field.
  await qa.getByRole("textbox", { name: "Jenkins address" }).fill("http://jenkins.example.org");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    qa.getByText("Use https:// (http:// only on localhost).", { exact: true }),
  ).toBeVisible();

  await qa.getByRole("textbox", { name: "Jenkins address" }).fill("https://jenkins.example.org");
  await qa.getByLabel("Jenkins token").fill("secret-token");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(qa.getByText("Saved. Leave empty to keep the saved token.")).toBeVisible();
  expect(puts.at(-1)).toEqual({
    qa: { jenkinsUrl: "https://jenkins.example.org", token: "secret-token" },
  });
  await expect(qa.getByLabel("Jenkins token")).toHaveValue("");

  await qa.getByRole("button", { name: "Test QA connection", exact: true }).click();
  await expect(dialog.getByTestId("deploy-test-qa")).toHaveText("Jenkins answered (200).");
  expect(tests).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("releases the module and follows the log", async ({ page }) => {
  const f = await fixture(page);
  const clean = { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true };
  const context = {
    ready: true,
    problems: [],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: clean,
    },
    activityData: { clone: clean },
    media: { clone: clean },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: true, remote: null },
      activityData: { local: true, remote: null },
    },
  };
  const order = ["verify_module", "prepare_deploy", "trigger_module_build", "await_module_build"];
  // The server's rules: one run at a time, stages in order, the log numbered from 1 and handed
  // out after a cursor, growing a few lines per poll while the run goes.
  const script = [
    ["verify_module", "== verify_module"],
    ["verify_module", "$ npm ci"],
    ["verify_module", "$ npm run lint"],
    ["prepare_deploy", "== prepare_deploy"],
    ["prepare_deploy", "$ git checkout -B loom/words-deploy main"],
    ["trigger_module_build", "== trigger_module_build"],
    ["trigger_module_build", 'Starting Jenkins job "Build WAF Modules".'],
    ["await_module_build", "== await_module_build"],
    ["await_module_build", "Jenkins: building (#12)."],
    ["await_module_build", "Released as 1.5.0."],
  ];
  let run = null;
  let starts = [];
  let shown = 0;
  let polls = 0;
  const lines = () =>
    script.slice(0, shown).map(([, text], index) => ({ seq: index + 1, at: "now", text }));
  const advance = () => {
    shown = Math.min(script.length, shown + 3);
    const current = shown ? script[shown - 1][0] : order[0];
    const finished = shown === script.length;
    run = {
      ...run,
      status: finished ? "succeeded" : "running",
      finishedAt: finished ? "2026-09-28T00:05:00.000Z" : null,
      stages: order.map((stage) => ({
        stage,
        status:
          finished || order.indexOf(stage) < order.indexOf(current)
            ? "done"
            : stage === current
              ? "running"
              : "pending",
        error: null,
      })),
      metadata: finished
        ? {
            moduleVersion: "1.5.0",
            preBuildTag: "1.4.0",
            resolvedModuleVersion: "1.5.0",
            moduleBuildUrl: "https://jenkins.example.org/job/Build%20WAF%20Modules/12/",
          }
        : { moduleVersion: "1.5.0" },
    };
  };
  const stages = () =>
    order.map((stage, index) => ({
      stage,
      status: run?.status === "succeeded" ? "done" : "pending",
      finishedAt: null,
      metadata: {},
      blocker:
        run?.status === "running"
          ? { code: "run_active" }
          : index > 0 && run?.status !== "succeeded"
            ? { code: "previous_stage", stage: order[index - 1] }
            : null,
    }));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "GET")
      return json({ context, run, stages: stages() });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "POST") {
      starts.push(request.postDataJSON());
      if (run?.status === "running")
        return json({ error: { code: "deploy_running", message: "A deploy is running." } }, 409);
      run = {
        runId: "dep_1",
        activityId: "act_test",
        target: "qa",
        selection: "release",
        status: "running",
        stages: order.map((stage) => ({ stage, status: "pending", error: null })),
        metadata: {},
        startedAt: "2026-09-28T00:00:00.000Z",
        finishedAt: null,
      };
      return json({ run }, 202);
    }
    if (url.pathname === `${base}/act_test/deploy/runs/dep_1/log`) {
      polls++;
      advance();
      const after = Number(url.searchParams.get("after") ?? "0");
      const all = lines();
      const page = all.filter((line) => line.seq > after);
      return json({
        log: {
          lines: page,
          next: page.length ? page[page.length - 1].seq : after,
          done: run.status !== "running",
        },
        run,
      });
    }
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Deploy");
  const table = page.getByRole("list", { name: "Deployment stages" });
  await page.getByRole("button", { name: "Run one stage", exact: true }).click();
  await expect(table.getByRole("listitem", { name: /^Verify the module/ })).toContainText(
    "Not run",
  );
  await expect(table.getByRole("listitem", { name: /^Wait for the release tag/ })).toContainText(
    "Waits for Push and start the build to finish.",
  );

  await page.getByRole("button", { name: "Release module", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Release the module" });
  await expect(
    dialog.getByText(
      "This pushes the branch loom/words-deploy to the module's repository and starts a Jenkins build of it. The build makes a new release tag.",
    ),
  ).toBeVisible();
  const version = dialog.getByLabel("Module version");
  await version.fill("v1.5");
  await expect(dialog.getByText("Write the version as three numbers, like 1.2.3.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Release", exact: true })).toBeDisabled();
  await version.fill("1.5.0");
  await dialog.getByRole("button", { name: "Release", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(starts).toEqual([{ stage: "release", moduleVersion: "1.5.0" }]);

  // While it runs: Stop is offered, and the log grows.
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  const log = page.getByTestId("deploy-log");
  await expect(log).toContainText("$ git checkout -B loom/words-deploy main");

  // It ends: every line once, in order, the version and the build link, every stage done.
  await expect(page.getByTestId("deploy-run-status")).toHaveText("The last release finished.");
  await expect(log).toHaveText(script.map(([, text]) => text).join("\n"));
  await expect(page.getByText("Released as 1.5.0.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the Jenkins build" })).toHaveAttribute(
    "href",
    "https://jenkins.example.org/job/Build%20WAF%20Modules/12/",
  );
  for (const name of [
    /^Verify the module/,
    /^Prepare the deploy branch/,
    /^Wait for the release tag/,
  ])
    await expect(table.getByRole("listitem", { name })).toContainText("Done");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  const settledPolls = polls;
  await page.waitForTimeout(1500);
  // Once the run has ended the log is no longer asked for.
  expect(polls).toBe(settledPolls);
  expect(starts).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("deploys to QA and links to the activity there", async ({ page }) => {
  const f = await fixture(page);
  const clean = { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true };
  const context = {
    ready: true,
    problems: [],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: clean,
    },
    activityData: { clone: clean },
    media: { clone: clean },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: true, remote: null },
      activityData: { local: true, remote: null },
    },
  };
  const order = [
    "verify_module",
    "prepare_deploy",
    "trigger_module_build",
    "await_module_build",
    "export_activity_data",
    "verify_activity_data",
    "verify_media_assets",
    "publish_activity_data",
    "trigger_activity_deploy",
    "await_activity_deploy",
  ];
  const qaUrl = "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1";
  // The server's rules: one run at a time, the ten stages in order, each done before the next
  // starts, and the log handed out after a cursor, two stages per poll.
  let run = null;
  const starts = [];
  let reached = 0;
  const log = () =>
    order
      .slice(0, reached)
      .map((stage, index) => ({ seq: index + 1, at: "now", text: `== ${stage}` }));
  const advance = () => {
    reached = Math.min(order.length, reached + 2);
    const finished = reached === order.length;
    run = {
      ...run,
      status: finished ? "succeeded" : "running",
      finishedAt: finished ? "2026-09-28T01:00:00.000Z" : null,
      stages: order.map((stage, index) => ({
        stage,
        status:
          finished || index < reached - 1 ? "done" : index === reached - 1 ? "running" : "pending",
        error: null,
      })),
      metadata: finished
        ? { resolvedModuleVersion: "1.5.0", qaActivityUrl: qaUrl, deployedRefNums: [1] }
        : {},
    };
  };
  const stages = () =>
    order.map((stage, index) => {
      const done = run?.status === "succeeded";
      return {
        stage,
        status: done ? "done" : "pending",
        finishedAt: null,
        metadata: !done
          ? {}
          : stage === "export_activity_data"
            ? { resolvedModuleVersion: "1.5.0" }
            : stage === "await_activity_deploy"
              ? { qaActivityUrl: qaUrl, qaDeployedAt: "2026-09-28T01:00:00.000Z" }
              : {},
        blocker:
          run?.status === "running"
            ? { code: "run_active" }
            : index > 0 && !done
              ? { code: "previous_stage", stage: order[index - 1] }
              : null,
      };
    });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "GET")
      return json({ context, run, stages: stages() });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "POST") {
      starts.push(request.postDataJSON());
      if (run?.status === "running")
        return json({ error: { code: "deploy_running", message: "A deploy is running." } }, 409);
      run = {
        runId: "dep_qa",
        activityId: "act_test",
        target: "qa",
        selection: "qa",
        status: "running",
        stages: order.map((stage) => ({ stage, status: "pending", error: null })),
        metadata: {},
        startedAt: "2026-09-28T00:00:00.000Z",
        finishedAt: null,
      };
      return json({ run }, 202);
    }
    if (url.pathname === `${base}/act_test/deploy/runs/dep_qa/log`) {
      advance();
      const after = Number(url.searchParams.get("after") ?? "0");
      const lines = log().filter((line) => line.seq > after);
      return json({
        log: {
          lines,
          next: lines.length ? lines[lines.length - 1].seq : after,
          done: run.status !== "running",
        },
        run,
      });
    }
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Deploy");
  const table = page.getByRole("list", { name: "Deployment stages" });
  await page.getByRole("button", { name: "Run one stage", exact: true }).click();
  await expect(table.getByRole("listitem", { name: /^Export the activity data/ })).toContainText(
    "Waits for Wait for the release tag to finish.",
  );
  await expect(table.getByRole("listitem", { name: /^Wait for the QA deploy/ })).toContainText(
    "Not run",
  );
  await expect(page.getByTestId("deploy-qa-result")).toHaveCount(0);

  await page.getByRole("button", { name: "Deploy to QA", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Deploy to QA" });
  await expect(dialog.getByText("This deploys words to QA. It:")).toBeVisible();
  await expect(
    dialog.getByText("pushes the activity data to the branch loom/words-activity-data"),
  ).toBeVisible();
  await expect(dialog.getByText("starts the Jenkins activity deploy to QA")).toBeVisible();
  await dialog.getByRole("button", { name: "Deploy", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(starts).toEqual([{ stage: "qa" }]);

  await expect(page.getByTestId("deploy-run-status")).toHaveText("The last QA deploy finished.");
  await expect(page.getByTestId("deploy-log")).toHaveText(
    order.map((stage) => `== ${stage}`).join("\n"),
  );
  await expect(page.getByRole("link", { name: "Open on QA" })).toHaveAttribute("href", qaUrl);
  await expect(page.getByTestId("deploy-qa-result")).toContainText("On QA with module 1.5.0.");
  for (const name of [/^Export the activity data/, /^Publish the media/, /^Wait for the QA deploy/])
    await expect(table.getByRole("listitem", { name })).toContainText("Done");
  expect(starts).toHaveLength(1);
  await page.getByRole("button", { name: "Run one stage", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "QA deployment" })).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.screenshot({ path: test.info().outputPath("deploy-light.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: test.info().outputPath("deploy-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("deploy-mobile.png"), fullPage: true });
  expect(f.errors).toEqual([]);
});

test("deploys to PROD only after typing the product code", async ({ page }) => {
  const f = await fixture(page);
  const clean = { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true };
  const context = {
    ready: true,
    problems: [],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: clean,
    },
    activityData: { clone: clean },
    media: { clone: clean },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: true, remote: null },
      activityData: { local: true, remote: null },
    },
  };
  const qaOrder = [
    "verify_module",
    "prepare_deploy",
    "trigger_module_build",
    "await_module_build",
    "export_activity_data",
    "verify_activity_data",
    "verify_media_assets",
    "publish_activity_data",
    "trigger_activity_deploy",
    "await_activity_deploy",
  ];
  const prodOrder = ["trigger_production_deploy", "await_production_deploy"];
  const jenkinsUrl = "https://jenkins-prod.example.org/job/WAF%20Activity%20Deploy/9/";
  // The server's rules: QA is current, so PROD may start; the product code must be typed; one
  // run at a time; the log is handed out after a cursor, one stage per poll.
  let run = null;
  const starts = [];
  let reached = 0;
  const log = () =>
    prodOrder
      .slice(0, reached)
      .map((stage, index) => ({ seq: index + 1, at: "now", text: `== ${stage}` }));
  const advance = () => {
    reached = Math.min(prodOrder.length, reached + 1);
    const finished = reached === prodOrder.length;
    run = {
      ...run,
      status: finished ? "succeeded" : "running",
      finishedAt: finished ? "2026-09-28T02:00:00.000Z" : null,
      stages: prodOrder.map((stage, index) => ({
        stage,
        status:
          finished || index < reached - 1 ? "done" : index === reached - 1 ? "running" : "pending",
        error: null,
      })),
      metadata: finished
        ? {
            prodDeployedAt: "2026-09-28T02:00:00.000Z",
            prodFrameworkVersion: "4.1.0",
            productionDeployUrl: jenkinsUrl,
            contentRevision: "rev_1",
          }
        : {},
    };
  };
  const state = () => {
    const done = run?.status === "succeeded";
    const running = run?.status === "running";
    return {
      context,
      run,
      stages: qaOrder.map((stage) => ({
        stage,
        status: "done",
        finishedAt: "2026-09-28T01:00:00.000Z",
        metadata: {},
        blocker: running ? { code: "run_active" } : null,
      })),
      production: {
        stages: prodOrder.map((stage) => ({
          stage,
          status: done ? "done" : "pending",
          finishedAt: done ? "2026-09-28T02:00:00.000Z" : null,
          metadata: {},
          blocker: running ? { code: "run_active" } : null,
        })),
        blocker: running ? { code: "run_active" } : null,
        last: done
          ? {
              runId: "dep_prod",
              deployedAt: "2026-09-28T02:00:00.000Z",
              contentRevision: "rev_1",
              frameworkVersion: "4.1.0",
              url: jenkinsUrl,
            }
          : null,
      },
    };
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    // PROD is an admin's who owns the project.
    if (url.pathname === "/api/me")
      return json({
        user: { userId: "author", isAdmin: true, passwordIsInitial: false },
        previewIsolated: true,
        desktopMode: false,
        companyMode: false,
        sessionVia: "password",
        uploadLimits: {
          attachmentMaxMb: 100,
          attachmentTotalMb: 120,
          attachmentMaxCount: 20,
          imageMaxMb: 20,
          attachmentLimitMinMb: 1,
          attachmentLimitMaxMb: 200,
        },
      });
    if (url.pathname === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "GET")
      return json(state());
    if (url.pathname === `${base}/act_test/deploy` && request.method() === "POST") {
      const body = request.postDataJSON();
      starts.push(body);
      if (run?.status === "running")
        return json({ error: { code: "deploy_running", message: "A deploy is running." } }, 409);
      if (body.stage !== "prod" || body.confirm !== "words")
        return json(
          { error: { code: "confirmation_mismatch", message: "Type the product code." } },
          400,
        );
      run = {
        runId: "dep_prod",
        activityId: "act_test",
        target: "prod",
        selection: "prod",
        status: "running",
        stages: prodOrder.map((stage) => ({ stage, status: "pending", error: null })),
        metadata: {},
        startedAt: "2026-09-28T01:30:00.000Z",
        finishedAt: null,
      };
      return json({ run }, 202);
    }
    if (url.pathname === `${base}/act_test/deploy/runs/dep_prod/log`) {
      advance();
      const after = Number(url.searchParams.get("after") ?? "0");
      const lines = log().filter((line) => line.seq > after);
      return json({
        log: {
          lines,
          next: lines.length ? lines[lines.length - 1].seq : after,
          done: run.status !== "running",
        },
        run,
      });
    }
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Deploy");
  await expect(page.getByRole("heading", { name: /^PROD More info/, level: 4 })).toBeVisible();
  await expect(page.getByTestId("deploy-prod-last")).toHaveText("Not deployed to PROD yet.");
  await expect(page.getByTestId("deploy-prod-blocker")).toHaveText(
    "Ready to deploy what QA has to PROD.",
  );
  const table = page.getByRole("table", { name: "PROD deploy stages" });
  await expect(table.getByRole("row", { name: /^Start the PROD deploy/ })).toContainText("Not run");

  await page.getByRole("button", { name: "Deploy to PROD", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Deploy to PROD" });
  await expect(dialog.getByText("This deploys words to production. It:")).toBeVisible();
  await expect(
    dialog.getByText("deploys the activity data QA has, from the branch loom/words-activity-data"),
  ).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Deploy to PROD", exact: true });
  const typed = dialog.getByLabel("Type words to confirm");
  await expect(confirm).toBeDisabled();
  await typed.fill("Words");
  await expect(confirm).toBeDisabled();
  await typed.fill("word");
  await expect(confirm).toBeDisabled();
  await typed.fill(" words ");
  await expect(confirm).toBeDisabled();
  expect(starts).toEqual([]);
  await typed.fill("words");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(starts).toEqual([{ stage: "prod", target: "prod", confirm: "words" }]);

  await expect(page.getByTestId("deploy-prod-status")).toHaveText("The last PROD deploy finished.");
  await expect(page.getByTestId("deploy-log")).toHaveText(
    prodOrder.map((stage) => `== ${stage}`).join("\n"),
  );
  await expect(page.getByTestId("deploy-prod-last")).toContainText("Last deployed to PROD on");
  await expect(page.getByTestId("deploy-prod-last")).toContainText("with framework 4.1.0.");
  await expect(page.getByRole("link", { name: "Open the PROD deploy" })).toHaveAttribute(
    "href",
    jenkinsUrl,
  );
  for (const name of [/^Start the PROD deploy/, /^Wait for the PROD deploy/])
    await expect(table.getByRole("row", { name })).toContainText("Done");
  // The release section keeps its own line: a PROD run is not a release.
  await expect(page.getByTestId("deploy-run-status")).toHaveCount(0);
  expect(starts).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("marks the deployed version and says the activity changed since", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  // The version routes, with the server's rules: v1 went to QA, and the status compares the
  // QA version with the draft, which a script edit changes.
  let changed = false;
  const v1 = {
    versionId: "ver_1",
    seq: 1,
    label: "Release",
    kind: "deploy",
    reason: null,
    createdAt: "2026-09-28T10:00:00.000Z",
    author: null,
    mediaBytes: 0,
    current: true,
    deployed: { qa: "2026-09-28T10:05:00.000Z", prod: null },
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === `${base}/act_test/description` && request.method() === "PATCH") {
      changed = true;
      return route.fallback();
    }
    if (url.pathname === `${base}/act_test/versions` && request.method() === "GET")
      return json({ versions: [{ ...v1, current: !changed }] });
    if (url.pathname === `${base}/act_test/versions/status`)
      return json({
        qa: changed ? "changed" : "in_sync",
        prod: "never",
        qaVersion: { versionId: "ver_1", seq: 1, deployedAt: "2026-09-28T10:05:00.000Z" },
        prodVersion: null,
      });
    return route.fallback();
  });
  await openSection(page, "Generation history");
  const status = page.getByRole("list", { name: "Deploys", exact: true });
  await expect(status).toContainText("In sync with QA");
  await expect(status).toContainText("v1, ");
  await expect(status).toContainText("Never deployed to PROD");
  const row = page.getByRole("row", { name: /^v1\b/ });
  await expect(row.getByRole("img", { name: /^Went to QA on / })).toHaveText("QA");
  await expect(row.getByRole("img", { name: /^Went to PROD on / })).toHaveCount(0);

  // Editing the script leaves QA behind.
  await openSection(page, "Description");
  await page
    .getByRole("textbox", { name: "Activity Script", exact: true })
    .fill("A script QA has not seen");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await openSection(page, "Generation history");
  await expect(status).toContainText("Changed since the QA deploy");
  await expect(row).not.toContainText("Current");
  await expect(row.getByRole("img", { name: /^Went to QA on / })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("plays an older module build", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const detail = await page.evaluate((url) => fetch(url).then((r) => r.json()), `${base}/act_test`);
  const older = `run_${"a".repeat(32)}`;
  const newer = `run_${"b".repeat(32)}`;
  const moduleRun = (runId, createdAt) => ({
    kind: "module",
    runId,
    activityId: "act_test",
    projectId,
    sessionId: null,
    status: "succeeded",
    createdAt,
    finishedAt: createdAt,
    inputRevision: detail.draft.contentRevision,
    hasCandidate: false,
    error: null,
  });
  // The module-build routes, with the server's rules: a pin names the draft's revision and
  // leaves it as it was, and the pinned build plays until it is unpinned.
  let draft = detail.draft;
  const pins = [];
  const diffs = [];
  const builds = () => ({
    builds: [
      {
        runId: newer,
        createdAt: "2026-09-27T10:00:00.000Z",
        finishedAt: null,
        files: 7,
        newest: true,
      },
      {
        runId: older,
        createdAt: "2026-09-26T10:00:00.000Z",
        finishedAt: null,
        files: 6,
        newest: false,
      },
    ],
    pinnedRunId: draft.pinnedModuleRunId ?? null,
    playingRunId: draft.pinnedModuleRunId ?? newer,
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test` && request.method() === "GET") return json({ ...detail, draft });
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({
        runs: [
          moduleRun(newer, "2026-09-27T10:00:00.000Z"),
          moduleRun(older, "2026-09-26T10:00:00.000Z"),
        ],
      });
    if (p === `${base}/act_test/module-builds`) return json(builds());
    if (p === `${base}/act_test/module-builds/diff`) {
      diffs.push([url.searchParams.get("from"), url.searchParams.get("to")]);
      return json({
        from: older,
        to: newer,
        unchanged: 4,
        files: [
          {
            path: "src/index.ts",
            change: "changed",
            beforeBytes: 20,
            afterBytes: 21,
            text: "shown",
            before: "export const n = 1;\n",
            after: "export const n = 22;\n",
          },
          {
            path: "res/logo.png",
            change: "added",
            beforeBytes: null,
            afterBytes: 2048,
            text: "binary",
            before: null,
            after: null,
          },
        ],
      });
    }
    const pin = p.match(/\/act_test\/module-builds\/(run_[a-f0-9]{32})\/pin$/);
    if (pin || p === `${base}/act_test/module-builds/unpin`) {
      const body = request.postDataJSON();
      pins.push(pin ? { pin: pin[1], ...body } : { unpin: true, ...body });
      if (body.expectedRevision !== draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      const { pinnedModuleRunId: _pinned, ...rest } = draft;
      draft = pin ? { ...rest, pinnedModuleRunId: pin[1] } : rest;
      return json(draft);
    }
    return route.fallback();
  });
  // The runs were read when the activity opened; read them again with the builds in them.
  await page.reload();
  await openSection(page, "Generation history");
  const section = page.getByRole("region", { name: /^Module builds/ });
  const newest = section.getByRole("row").filter({ hasText: "Build bbbbbb" });
  const old = section.getByRole("row").filter({ hasText: "Build aaaaaa" });
  await expect(newest).toContainText("Newest");
  await expect(newest).toContainText("Playing");
  await expect(old).toContainText("6 files");

  // Compare the two: the older one reads first, whichever was ticked first.
  const compare = section.getByRole("button", { name: "Compare", exact: true });
  await expect(compare).toBeDisabled();
  await newest.getByRole("checkbox", { name: "Select Build bbbbbb to compare" }).check();
  await old.getByRole("checkbox", { name: "Select Build aaaaaa to compare" }).check();
  await compare.click();
  const panel = page.getByRole("region", { name: /^Build aaaaaa compared with Build bbbbbb/ });
  await expect(panel.getByRole("row", { name: /res\/logo\.png/ })).toContainText(
    "Not shown: not a text file.",
  );
  expect(diffs).toEqual([[older, newer]]);
  const lines = panel.getByLabel("Differences in src/index.ts", { exact: true });
  await expect(lines).toContainText("export const n = 1;");
  await expect(lines).toContainText("export const n = 22;");
  await expect(panel).toContainText("4 other files are the same.");

  // Play the older build: the preview stays on it, with a notice, until it is unpinned.
  await old.getByRole("button", { name: "Play Build aaaaaa in the preview", exact: true }).click();
  await expect(page.getByText("The preview plays Build aaaaaa.", { exact: true })).toBeVisible();
  const notice = section
    .getByRole("status")
    .filter({ hasText: "The preview plays an older build." });
  await expect(notice).toBeVisible();
  await expect(old).toContainText("Playing");
  await expect(newest).not.toContainText("Playing");
  await notice.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(
    page.getByText("The preview plays the newest build again.", { exact: true }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(newest).toContainText("Playing");
  expect(pins).toEqual([
    { pin: older, expectedRevision: detail.draft.contentRevision },
    { unpin: true, expectedRevision: detail.draft.contentRevision },
  ]);
  expect(f.errors).toEqual([]);
});

test("composes a scene from its storyboard when the experiment is on", async ({ page }) => {
  const f = await fixture(page);
  const composeRequests = [];
  const compositionRuns = [];
  let refuseCompose = false;
  const usage = (key) => ({
    sceneId: "intro",
    sourceKey: key,
    occurrence: 1,
    sceneOccurrenceCount: 1,
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "intro-video",
                type: "video",
                description: "The sky slowly brightens",
                usages: [usage("intro-video")],
              },
              {
                key: "sky",
                type: "image",
                description: "A blue sky",
                path: "media/loom/words/words-1/uploads/sky-00000000.png",
                usages: [usage("sky")],
              },
            ],
          },
        },
      }),
    }),
  );
  // Stands in for the page the preview origin would serve: it reports its state the way
  // Penguin's bridge script does and answers the studio's play and pause messages.
  const composition = `<!doctype html><html><body style="margin:0;background:#fff"><div id="stage">Dawn</div><script>
    const tell = (state) => parent.postMessage({ source: "penguin-composition", state, duration: 6 }, "*");
    addEventListener("message", (event) => {
      if (event.data && event.data.source === "penguin-studio")
        tell(event.data.action === "pause" ? "paused" : "playing");
    });
    addEventListener("load", () => tell("ready"));
  </script></body></html>`;
  await page.route("**/*", (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/video-setup`) return json({ enabled: true });
    if (p === `${base}/act_test/media-upload` || p === `${base}/act_test/media-image`)
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    if (p === `${base}/act_test/compose-video`) {
      const body = request.postDataJSON();
      if (refuseCompose)
        return json(
          { error: { code: "composition_no_images", message: "Server sentence, not shown." } },
          409,
        );
      // One run at a time, as the server allows.
      if (compositionRuns.some((run) => run.status === "running"))
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      composeRequests.push(body);
      compositionRuns.unshift({
        kind: "composition",
        composition: {
          language: body.language,
          assetKey: body.assetKey,
          sceneId: "intro",
          width: 640,
          height: 480,
          images: [{ key: "sky", file: "images/sky.png", sha256: "a".repeat(64) }],
        },
        runId: `run_comp_${compositionRuns.length + 1}`,
        inputRevision: body.expectedRevision,
        activityId: "act_test",
        projectId,
        agentId: "default_agent",
        sessionId: "session_comp",
        status: "running",
        createdAt: `2026-09-28T10:0${compositionRuns.length}:00Z`,
        finishedAt: null,
        hasCandidate: false,
        error: null,
      });
      return json(compositionRuns[0], 202);
    }
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: compositionRuns });
    if (/\/runs\/run_comp_\d+\/candidate$/.test(p))
      return json({
        candidate: JSON.stringify({
          frames: [
            { id: "frame-1", description: "The sky fades in", seconds: 3 },
            { id: "frame-2", description: "The sun rises", seconds: 3 },
          ],
          seconds: 6,
          sha256: "b".repeat(64),
          bytes: 900,
        }),
      });
    if (/\/runs\/run_comp_\d+\/composition-link$/.test(p))
      return route.fulfill({ contentType: "text/html", body: composition });
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  // Videos is a closed group of the scene until it is opened.
  await page.getByRole("treeitem", { name: "Videos", exact: true, level: 3 }).click();
  await page
    .getByRole("treeitem", { name: /intro-video/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "intro-video", exact: true })).toBeVisible();

  const section = page.getByRole("region", { name: "Scene video", exact: true });
  await expect(section.getByText("Experimental", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Compose from storyboard", exact: true }).click();
  await expect.poll(() => composeRequests.length).toBe(1);
  expect(composeRequests[0]).toMatchObject({
    agentId: "default_agent",
    language: "en-US",
    assetKey: "intro-video",
  });
  await expect(section.getByRole("button", { name: "Composing…", exact: true })).toBeDisabled();

  compositionRuns[0] = { ...compositionRuns[0], status: "succeeded", hasCandidate: true };
  const preview = section.getByTitle("Scene composition preview", { exact: true });
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview).toHaveAttribute("sandbox", "allow-scripts");
  await expect(preview).toHaveAttribute("src", `${base}/act_test/runs/run_comp_1/composition-link`);
  await expect(section.getByText("Ready to play · 6 s", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Play", exact: true }).click();
  await expect(section.getByText("Playing · 6 s", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(section.getByText("Paused · 6 s", { exact: true })).toBeVisible();
  const frames = section.getByRole("region", { name: "Frames", exact: true });
  await expect(frames.getByRole("listitem")).toHaveText([
    "Frame 1 · 3 s The sky fades in",
    "Frame 2 · 3 s The sun rises",
  ]);

  // Ask again: a check that failed is worded, and the kept composition stays on screen.
  await section.getByRole("button", { name: "Compose again", exact: true }).click();
  await expect.poll(() => composeRequests.length).toBe(2);
  compositionRuns[0] = {
    ...compositionRuns[0],
    status: "failed",
    error: "composition.html reaches the network (https://cdn.example.com/gsap.js)",
    composition: { ...compositionRuns[0].composition, problem: "composition_network" },
  };
  await expect(
    section.getByText(
      "The composition tried to load something from the network. Compose again; it may use only the scene's images.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(preview).toHaveAttribute("src", `${base}/act_test/runs/run_comp_1/composition-link`);

  // A refusal the server reports by code is worded by the App, not by the server.
  refuseCompose = true;
  await section.getByRole("button", { name: "Compose again", exact: true }).click();
  await expect(
    page.getByText(
      "Bind an image to this scene first: the composition is made from the scene's images.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Server sentence, not shown.")).toHaveCount(0);
  // The fixture's init script runs in every frame, the sandboxed preview too, where reading
  // localStorage is refused by design; only that exact refusal is the sandbox working.
  expect(
    f.errors.filter(
      (error) =>
        !error.includes(
          "Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.",
        ),
    ),
  ).toEqual([]);
});

test("shows nothing of scene videos while the experiment is off", async ({ page }) => {
  const f = await fixture(page);
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "intro-video",
                type: "video",
                description: "The sky slowly brightens",
                usages: [
                  {
                    sceneId: "intro",
                    sourceKey: "intro-video",
                    occurrence: 1,
                    sceneOccurrenceCount: 1,
                  },
                ],
              },
            ],
          },
        },
      }),
    }),
  );
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).pathname === `${base}/video-setup`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ enabled: false }),
      });
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await expect(page.getByRole("heading", { name: "intro-video", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Scene video", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compose from storyboard" })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("records a composed scene and keeps it as the scene's video", async ({ page }) => {
  const f = await fixture(page);
  const renderRequests = [];
  const recordings = [];
  let refuseRender = true;
  // The draft as the fixture last served it; keeping the recording binds it on top of it.
  let draft = null;
  let accepted = null;
  page.on("response", async (response) => {
    const p = new URL(response.url()).pathname;
    if ([`${base}/act_test/plan-media`, `${base}/act_test/media`].includes(p) && response.ok())
      draft = await response.json().catch(() => draft);
  });
  const usage = (key) => ({
    sceneId: "intro",
    sourceKey: key,
    occurrence: 1,
    sceneOccurrenceCount: 1,
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: {
            "en-US": [
              {
                key: "intro-video",
                type: "video",
                description: "The sky slowly brightens",
                path: "media/loom/words/words-1/uploads/intro-00000000.webm",
                usages: [usage("intro-video")],
              },
              {
                key: "sky",
                type: "image",
                description: "A blue sky",
                path: "media/loom/words/words-1/uploads/sky-00000000.png",
                usages: [usage("sky")],
              },
            ],
          },
        },
      }),
    }),
  );
  const composition = {
    kind: "composition",
    composition: {
      language: "en-US",
      assetKey: "intro-video",
      sceneId: "intro",
      width: 640,
      height: 480,
      images: [{ key: "sky", file: "images/sky.png", sha256: "a".repeat(64) }],
    },
    runId: "run_comp_1",
    inputRevision: "an-earlier-revision",
    activityId: "act_test",
    projectId,
    agentId: "default_agent",
    sessionId: "session_comp",
    status: "succeeded",
    createdAt: "2026-09-28T10:00:00Z",
    finishedAt: "2026-09-28T10:01:00Z",
    hasCandidate: true,
    error: null,
  };
  // A WebM header is all the studio needs: the players fetch nothing until asked.
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77]);
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/video-setup`) return json({ enabled: true });
    if (p === `${base}/act_test/media-upload` && url.searchParams.get("path")?.endsWith(".webm"))
      return route.fulfill({ contentType: "video/webm", body: webm });
    if (p === `${base}/act_test/media-upload` || p === `${base}/act_test/media-image`)
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    if (p === `${base}/act_test/runs` && request.method() === "GET")
      return json({ runs: [...recordings, composition] });
    if (p === `${base}/act_test/runs/run_comp_1/candidate`)
      return json({
        candidate: JSON.stringify({
          frames: [
            { id: "frame-1", description: "The sky fades in", seconds: 3 },
            { id: "frame-2", description: "The sun rises", seconds: 3 },
          ],
          seconds: 6,
          sha256: "b".repeat(64),
          bytes: 900,
        }),
      });
    if (p === `${base}/act_test/runs/run_comp_1/composition-link`)
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><p>Dawn</p>" });
    if (p === `${base}/act_test/render-video`) {
      const body = request.postDataJSON();
      if (refuseRender) {
        refuseRender = false;
        return json(
          { error: { code: "test_browser_missing", message: "Server sentence, not shown." } },
          409,
        );
      }
      // One run at a time, as the server allows.
      if (recordings.some((run) => run.status === "running"))
        return json({ error: { code: "generation_running", message: "Running." } }, 409);
      renderRequests.push(body);
      recordings.unshift({
        kind: "video",
        video: {
          language: "en-US",
          assetKey: "intro-video",
          compositionRunId: body.compositionRunId,
          width: 640,
          height: 480,
          seconds: 6,
        },
        runId: `run_video_${recordings.length + 1}`,
        inputRevision: body.expectedRevision,
        activityId: "act_test",
        projectId,
        agentId: "",
        sessionId: null,
        status: "running",
        createdAt: `2026-09-28T11:0${recordings.length}:00Z`,
        finishedAt: null,
        hasCandidate: false,
        error: null,
      });
      return json(recordings[0], 202);
    }
    if (/\/runs\/run_video_\d+\/video$/.test(p))
      return route.fulfill({ contentType: "video/webm", body: webm });
    if (/\/runs\/run_video_\d+\/accept-video$/.test(p)) {
      const run = recordings.find((entry) => p.includes(`/${entry.runId}/`));
      if (!run || run.status !== "succeeded")
        return json({ error: { code: "video_changed", message: "Not kept." } }, 409);
      const manifest = structuredClone(draft.mediaPlan.manifest);
      const asset = manifest.assets["en-US"].find((entry) => entry.key === "intro-video");
      asset.path = `media/generated/${run.runId}.webm`;
      asset.generatedVideo = { runId: run.runId, sha256: "c".repeat(64) };
      accepted = {
        ...draft,
        contentRevision: `${draft.contentRevision}-video`,
        mediaPlan: { ...draft.mediaPlan, manifest },
      };
      return json(accepted);
    }
    return route.fallback();
  });
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Save Spec", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await page.getByRole("treeitem", { name: "Videos", exact: true, level: 3 }).click();
  await page
    .getByRole("treeitem", { name: /intro-video/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "intro-video", exact: true })).toBeVisible();

  const section = page.getByRole("region", { name: "Scene video", exact: true });
  const record = section.getByRole("button", { name: "Record video", exact: true });
  await expect(record).toBeEnabled();
  await expect(
    section.getByText(
      "A recording opens with a short blank moment while the page loads, before the animation starts. It is not trimmed.",
      { exact: true },
    ),
  ).toBeVisible();

  // A refusal the server reports by code is worded by the App.
  await record.click();
  await expect(
    page.getByText("The test browser is not installed. An admin installs it in System settings.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Server sentence, not shown.")).toHaveCount(0);
  expect(renderRequests).toEqual([]);

  await record.click();
  await expect.poll(() => renderRequests.length).toBe(1);
  expect(renderRequests[0]).toMatchObject({ compositionRunId: "run_comp_1" });
  expect(renderRequests[0].expectedRevision).toBe(draft.contentRevision);
  await expect(section.getByRole("button", { name: "Recording…", exact: true })).toBeDisabled();

  // The recording plays beside the current video, and replaces it only on request.
  recordings[0] = {
    ...recordings[0],
    status: "succeeded",
    hasCandidate: true,
    finishedAt: "2026-09-28T11:00:09Z",
  };
  const comparison = section.getByRole("region", { name: "Current and new", exact: true });
  await expect(comparison).toBeVisible({ timeout: 15_000 });
  await expect(
    comparison.getByRole("figure", { name: "Current", exact: true }).locator("video"),
  ).toHaveAttribute(
    "src",
    `${base}/act_test/media-upload?path=media%2Floom%2Fwords%2Fwords-1%2Fuploads%2Fintro-00000000.webm`,
  );
  await expect(
    comparison.getByRole("figure", { name: "New", exact: true }).locator("video"),
  ).toHaveAttribute("src", `${base}/act_test/runs/run_video_1/video`);
  await comparison.getByRole("button", { name: "Use new", exact: true }).click();
  await expect
    .poll(() => accepted?.mediaPlan.manifest.assets["en-US"][0].path)
    .toBe("media/generated/run_video_1.webm");
  // Kept: the scene's video is the recording, and the comparison is gone.
  await expect(
    page.locator('video[aria-label="Play bound media: Recorded video"]'),
  ).toHaveAttribute("src", `${base}/act_test/runs/run_video_1/video`);
  await expect(comparison).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Record again", exact: true })).toBeVisible();
  // The fixture's init script runs in every frame, the sandboxed preview too, where reading
  // localStorage is refused by design; only that exact refusal is the sandbox working.
  expect(
    f.errors.filter(
      (error) =>
        !error.includes(
          "Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.",
        ),
    ),
  ).toEqual([]);
});

test("opens a product that is in the modules into the project", async ({ page }) => {
  const f = await fixture(page);
  const claims = [];
  const products = [
    {
      moduleFolder: "waf-module-r2pt01",
      productCode: "r2pt01",
      title: "Decodable Books",
      activityType: "book",
      refNums: [150, 151],
    },
  ];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/module-products` && request.method() === "GET") return json({ products });
    if (p === `${base}/module-products/claim` && request.method() === "POST") {
      claims.push(request.postDataJSON());
      return json({
        collectionId: "col_modules",
        activityIds: ["act_150", "act_151"],
        message: "Opening r2pt01 with 2 refs, ref 150 canonical. Nothing was dropped.",
        problems: [],
      });
    }
    return route.fallback();
  });
  await page.goto(`${origin}/activities`);
  await page.getByRole("button", { name: "Open from modules", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Open from modules" });
  await expect(dialog.getByText("Decodable Books", { exact: true })).toBeVisible();
  await expect(dialog.getByText("r2pt01 · waf-module-r2pt01 · 2 refs")).toBeVisible();
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dialog.getByText(/Nothing was dropped\./)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Opened", exact: true })).toBeDisabled();
  expect(claims).toEqual([{ moduleFolder: "waf-module-r2pt01", productCode: "r2pt01" }]);
  expect(f.errors).toEqual([]);
});
