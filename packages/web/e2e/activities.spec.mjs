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
    if (p === base && request.method() === "GET")
      return json({ activities: activity ? [activity] : [] });
    if (p === `${base}/module-setup`) return json({ wafRoot: "C:/WAF checkout" });
    if (p === `${base}/speech-setup`) return json({ voices: ["Kore", "Puck"] });
    if (p === `${base}/act_test/media-uploads`) {
      if (request.method() === "POST") {
        const input = request.postDataJSON();
        const stored = {
          path: `media/uploads/${input.name
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
    if (p === `${base}/act_test/generate-spec` || p === `${base}/act_test/assemble-module`) {
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
      const asset = activity.draft.mediaPlan.manifest.assets["en-US"][0];
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
    if (p === `${base}/act_test/readiness`) return json({ checks: [] });
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
  "Module preview": "Module Definition",
  "Generation history": "Generation History",
};

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
  if (opened) await expand.click();
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
  await openSection(page, "Specification");
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

async function create(page, { activityType = "standard" } = {}) {
  await page.goto(`${origin}/activities`);
  // Creation lives behind the landing's action, not inline on the page.
  await page.getByRole("button", { name: "New activity", exact: true }).click();
  await page.getByRole("textbox", { name: "Product code", exact: true }).fill("words");
  await page.getByRole("spinbutton", { name: "Reference number", exact: true }).fill("12");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Sight words");
  if (activityType === "book") {
    await page.getByRole("button", { name: "Activity type", exact: true }).click();
    await page.getByRole("option", { name: "Book", exact: true }).click();
  }
  await page.getByRole("button", { name: "Create activity", exact: true }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page
    .getByRole("textbox", { name: "Activity Script", exact: true })
    .fill("Practice common sight words");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toBeEnabled();
  await openSection(page, "Specification");
  await page.getByText("Advanced: specification JSON", { exact: true }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await plan.click();
  await openManifest(page);
  const editor = page.getByRole("textbox", { name: /^Asset manifest/ });
  await expect(editor).toBeVisible();
  await expect(page.getByText(/1 assets, 0 paths assigned, 1 unbound/)).toBeVisible();
  const manifest = JSON.parse(await editor.inputValue());
  manifest.assets["en-US"][0].path = "media/images/cat.png";
  await editor.fill(JSON.stringify(manifest));
  await openSection(page, "Module preview");
  await expect(
    page.getByRole("button", { name: "Assemble WAF module", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await openSection(page, "Specification");
  await expect(editor).toHaveValue(JSON.stringify(manifest));
  const request = page.waitForRequest(
    (request) => request.url().endsWith("/media") && request.method() === "PUT",
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  expect((await request).postDataJSON().manifest).toEqual(manifest);
  await openSection(page, "Module preview");
  await expect(
    page.getByRole("button", { name: "Assemble WAF module", exact: true }),
  ).toBeEnabled();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();

  // Nothing edited yet, so there is nothing to review.
  const show = page.getByRole("button", { name: "Show changes", exact: true });
  await expect(show).toBeDisabled();

  const edited = {
    ...spec,
    title: "Sight words, revised",
    scenes: [
      { id: "intro", description: "Choose a different word" },
      { id: "quiz", description: "Answer" },
    ],
  };
  await editor.fill(JSON.stringify(edited, null, 2));
  await show.click();

  // The scenes that moved are named, and both layouts render the same change.
  await expect(page.getByRole("button", { name: /^intro · changed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^quiz · added/ })).toBeVisible();
  await expect(page.getByText("Choose a different word", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  const diff = page.getByLabel("Changes since the last save", { exact: true });
  await expect(diff.getByText("Saved specification", { exact: true })).toBeVisible();
  await expect(diff.getByText("Your edit", { exact: true })).toBeVisible();

  // Reverting is confirmed, and puts the saved specification back in the box.
  await page.getByRole("button", { name: "Revert all changes", exact: true }).click();
  await expect(page.getByText(/Discard every edit/)).toBeVisible();
  await page.getByRole("button", { name: "Revert all changes", exact: true }).last().click();
  await expect(editor).toHaveValue(JSON.stringify(spec, null, 2));
  await expect(page.getByText("No changes since the last save.")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("reports speech coverage and generates every missing narration at once", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  // Three narrations: one already bound, one ready to generate, one still without a script.
  const narration = (key, extra) => ({
    key,
    type: "audio",
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

test("uploads media into the activity workspace and binds it from the library", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await expect(binding).toHaveValue(/^media\/uploads\/cat-[a-f0-9]{8}\.png$/);
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
  await expect(binding).toHaveValue(/^media\/uploads\/dog-[a-f0-9]{8}\.png$/);

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
  await expect(binding).toHaveValue(/^media\/uploads\/cat-[a-f0-9]{8}\.png$/);
  await expect(page.getByText("Stored with this activity.")).toBeVisible();

  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await openSection(page, "Specification");
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

test("previews only saved images and resets previews across edits, checkout changes and failures", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await expect(page.getByText("Assign and save a media path to preview this image.")).toBeVisible();
  const binding = page.getByRole("textbox", { name: /^Media path/ });
  await binding.fill("media/images/cat.png");
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toHaveCount(0);
  expect(f.imageRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByRole("img", { name: "A cat", exact: true })).toBeVisible();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  expect(f.imageRequests[0]).toMatchObject({
    language: "en-US",
    assetKey: "cat",
    wafRoot: "C:/WAF checkout",
  });
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
  await openSection(page, "Module preview");
  await page.getByRole("textbox", { name: /^WAF checkout/ }).fill("C:/Other WAF");
  f.setImageFailure(true);
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByText(/^Image unavailable\./)).toBeVisible();
  f.setImageFailure(false);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  expect(f.imageRequests.at(-1).wafRoot).toBe("C:/Other WAF");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  f.member();
  await page.reload();
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("assembles a saved spec and links to the Harness-isolated WAF preview", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const assemble = page.getByRole("button", { name: "Assemble WAF module", exact: true });
  // Nothing to assemble from yet, so the Build stage is not open to choose.
  await expect(
    page.getByRole("treeitem", { name: "Module Definition", exact: true, level: 1 }),
  ).toHaveAttribute("aria-disabled", "true");
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Module preview");
  await expect(assemble).toBeEnabled();
  await expect(page.getByRole("textbox", { name: /^WAF checkout/ })).toHaveValue("C:/WAF checkout");
  const sent = page.waitForRequest((request) => request.url().endsWith("/assemble-module"));
  await assemble.click();
  const payload = (await sent).postDataJSON();
  expect(payload).toMatchObject({
    wafRoot: "C:/WAF checkout",
    agentId: "default_agent",
  });
  expect(payload).not.toHaveProperty("bookMode");
  await openSection(page, "Generation history");
  await expect(page.getByText("Module assembly", { exact: true })).toBeVisible();
  f.complete();
  await page.reload();
  await openSection(page, "Module preview");
  await expect(
    page.getByRole("link", { name: "Open WAF preview", exact: true }).first(),
  ).toHaveAttribute(
    "href",
    "/api/sessions/session_test/files/preview-redirect?path=preview%2Findex.html",
  );
  await openSection(page, "Generation history");
  await page.getByText("View candidate JSON", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copy candidate into editor", exact: true }),
  ).toHaveCount(0);
  await openSection(page, "Description");
  await page.getByRole("textbox", { name: "Activity Script", exact: true }).fill("A new revision");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  // The runs list and the embedded preview both carry the staleness notice.
  await openSection(page, "Module preview");
  await expect(
    page.getByText("Built from an earlier draft", { exact: true }).first(),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("requires an explicit reading mode for book assembly and sends it per run", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page, { activityType: "book" });
  await openSection(page, "Specification");
  await page.getByRole("textbox", { name: "Specification JSON", exact: true }).fill(
    JSON.stringify({
      ...spec,
      scenes: [
        {
          id: "story",
          role: "story",
          description: "A penguin story",
          media: { images: [{ key: "cover", description: "A penguin walking" }] },
        },
      ],
    }),
  );
  await openSection(page, "Specification");
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  const assemble = page.getByRole("button", { name: "Assemble WAF module", exact: true });
  await openSection(page, "Module preview");
  await expect(assemble).toBeDisabled();
  const readingMode = page.getByRole("button", { name: "Reading mode", exact: true });
  await expect(readingMode).toHaveText("Choose a reading mode");
  await readingMode.scrollIntoViewIfNeeded();
  await readingMode.click();
  await page.getByRole("option", { name: "Read-along", exact: true }).click();
  await expect(assemble).toBeDisabled();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openSection(page, "Module preview");
  await expect(assemble).toBeEnabled();
  await expect(page.getByText("Validated", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  const sent = page.waitForRequest(
    (request) => request.url().endsWith("/assemble-module") && request.method() === "POST",
  );
  await assemble.click();
  expect((await sent).postDataJSON()).toMatchObject({
    agentId: "default_agent",
    bookMode: "readAlong",
  });
  expect(f.assembleRequests).toEqual([expect.objectContaining({ bookMode: "readAlong" })]);
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("textbox", { name: /^Speech script/ }).fill("Hello there");
  await expect(page.getByRole("button", { name: "Generate speech", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Speech script/ })).toHaveValue("Hello there");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("button", { name: "Generate speech", exact: true }).click();
  f.completeAudio();
  // The run settles while the page watches, and says so wherever the author is.
  await expect(page.getByText("Speech · welcome finished.", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(page.locator('audio[aria-label="Accepted audio"]')).toHaveCount(0);
  await expect(page.locator('audio[aria-label="Speech candidate"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Accept this audio", exact: true }).click();
  const accepted = page.locator('audio[aria-label="Accepted audio"]');
  const source = await accepted.getAttribute("src");
  await page.getByRole("button", { name: "Regenerate speech", exact: true }).click();
  await expect(accepted).toHaveAttribute("src", source);
  f.completeAudio();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(accepted).toHaveAttribute("src", source);
  await expect(page.locator('audio[aria-label="Speech candidate"]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Accept this audio", exact: true })).toBeEnabled();
  // The new take is heard beside the accepted one, and replaces it only on request.
  const comparison = page.getByRole("region", { name: "Current and new", exact: true });
  await expect(comparison.locator('audio[aria-label="Current"]')).toHaveAttribute("src", source);
  await expect(comparison.locator('audio[aria-label="New"]')).toHaveCount(1);
  await comparison.getByRole("button", { name: "Keep current", exact: true }).click();
  await expect(comparison).toHaveCount(0);
  await expect(accepted).toHaveAttribute("src", source);
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await openSection(page, "Scenes and media");
  await expect(page.getByRole("button", { name: "Generate image", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await openSection(page, "Scenes and media");
  await expect(description).toHaveValue("A friendly orange cat wearing a blue scarf");
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const generated = page.waitForRequest(
    (request) => request.url().endsWith("/generate-image") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  expect((await generated).postDataJSON()).toMatchObject({
    agentId: "default_agent",
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await openSection(page, "Scenes and media");
  await expect(improve).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await openSection(page, "Scenes and media");
  await expect(description).toHaveValue("Unsaved prompt");
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await expect(page.getByRole("textbox", { name: /^Speech script/ })).toHaveValue(
    "Hello there, sight word friends.",
  );
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await openSection(page, "Generation history");
  await expect(page.getByRole("link", { name: "Open Session / approvals" })).toHaveAttribute(
    "href",
    "/chat/session_test",
  );
  await page.reload();
  await openSection(page, "Generation history");
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  f.complete();
  await openSection(page, "Specification");
  await page.getByText("Advanced: specification JSON", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Specification JSON", exact: true })).toHaveValue(
    JSON.stringify(spec, null, 2),
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
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
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
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Changed in another tab",
  );
  await openSection(page, "Generation history");
  await page.getByText("View candidate JSON", { exact: true }).click();
  await page.getByRole("button", { name: "Copy candidate into editor" }).click();
  await openSection(page, "Specification");
  await page.getByRole("button", { name: "Validate and save" }).click();
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

test("dirty drafts block sidebar, Session, browser back, and project switches", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep this edit");
  let prompts = 0;
  const decline = (dialog) => {
    prompts++;
    return dialog.dismiss();
  };
  page.on("dialog", decline);
  await openSection(page, "Generation history");
  await page.getByRole("link", { name: "Open Session / approvals" }).click();
  await expect(page).toHaveURL(/activities\/act_test(\?section=\w+)?$/);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page).toHaveURL(/activities\/act_test(\?section=\w+)?$/);
  await page.goBack();
  await expect(page).toHaveURL(/activities\/act_test(\?section=\w+)?$/);
  await openSection(page, "Description");
  await expect(description).toHaveText("Keep this edit");
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activities test", exact: true })).toBeVisible();
  await expect(description).toHaveText("Keep this edit");
  expect(await page.evaluate(() => localStorage.getItem("penguin.lastProjectId"))).not.toBe(
    "second-project",
  );
  expect(f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project")).toBe(false);
  expect(prompts).toBe(4);
  page.off("dialog", decline);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/activities$/);
  await page
    .getByRole("region", { name: "All activities" })
    .getByRole("link", { name: /Sight words/ })
    .click();
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Another edit");
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
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
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
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

test("collapsed rail keeps Activities reachable through the page manifest", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const activities = page.getByRole("link", { name: "Activities", exact: true });
  await expect(activities).toBeVisible();
  await activities.click();
  await expect(page).toHaveURL(/\/activities$/);
  expect(f.errors).toEqual([]);
});

async function projectSettings(page) {
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
  const settings = await projectSettings(page);
  await settings.getByRole("button", { name: "Delete", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("dialog", { name: "Delete Project", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Delete Project", exact: true })).toHaveCount(0);
  expect(f.deletedProjects).toBe(0);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(description).toHaveText("Keep before deletion");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
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
  const settings = await projectSettings(page);
  await settings.getByRole("textbox").fill("Refresh the project list");
  f.removeProject();
  page.once("dialog", (dialog) => dialog.dismiss());
  await settings.getByRole("button", { name: "Save", exact: true }).click();
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
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(description).toHaveText("Copy this before leaving");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  await page.getByRole("button", { name: "Select a Project", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Second project", exact: true })).toBeVisible();
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
  const scenes = page.getByRole("button", { name: "Scenes", exact: true });
  await scenes.click();
  await expect(box).not.toContainText("An island.");
  await expect(box).toContainText("Scene 2: Rocks");
  await scenes.click();
  await expect(box).toContainText("An island.");

  // An edit reads against the last save, names its scene, and reverts where it stands.
  await box.fill(script.replace("Find d.", "Find lowercase d."));
  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.getByRole("option", { name: "Diff: Since last save", exact: true }).click();
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
  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.getByRole("option", { name: "Diff: Agent proposal", exact: true }).click();
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

test("runs every stage from the hierarchy and follows the run in its panel", async ({ page }) => {
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
  const stage = page.getByRole("button", { name: "Stage", exact: true });
  await expect(stage).toContainText("All stages");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ stage: "all", agentId: "default_agent" });
  const panel = page.getByRole("complementary", { name: "Stages", exact: true });
  await expect(panel).toBeVisible();
  // The page keeps reading the run while it is in flight, and shows how it ended.
  await expect(panel.getByText("All chosen stages finished.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Generate speech", { exact: true })).toBeVisible();
  await expect(panel.getByText("No image is missing.", { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(0);

  // One stage on its own is the same control.
  await stage.click();
  await page.getByRole("option", { name: "Generate images", exact: true }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.getByRole("button", { name: "Player", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Player", exact: true });
  await panel.getByRole("button", { name: "Play", exact: true }).click();

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

test("lists the live tap targets on the current state and resizes the map", async ({ page }) => {
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  const play = async () => {
    await openSection(page, "Module preview");
    await page.getByRole("button", { name: "Play", exact: true }).click();
  };
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

  // Wide enough: the map sits beside the player behind a divider.
  const divider = page.getByRole("separator", { name: "Resize the behavior map", exact: true });
  await expect(divider).toHaveAttribute("aria-valuenow", "360");
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "380");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "340");
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "440");
  // Dragging far past the end holds the map at its maximum.
  const moved = await divider.boundingBox();
  await page.mouse.move(moved.x + moved.width / 2, moved.y + 40);
  await page.mouse.down();
  await page.mouse.move(0, moved.y + 40, { steps: 5 });
  await page.mouse.up();
  const widest = Number(await divider.getAttribute("aria-valuenow"));
  expect(widest).toBeLessThanOrEqual(880);
  expect(widest).toBe(Number(await divider.getAttribute("aria-valuemax")));
  const frameBox = await page.locator('iframe[title="Player"]').boundingBox();
  expect(frameBox.width).toBeGreaterThanOrEqual(320);

  // The width survives a reload.
  await page.reload();
  await play();
  await expect(divider).toHaveAttribute("aria-valuenow", String(widest));

  // Hiding the map survives a reload too, and a hidden map needs no divider.
  const toggle = page.getByRole("button", { name: "Behavior map", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(divider).toHaveCount(0);
  await page.reload();
  await play();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveCount(0);

  // Narrower than side by side allows: the map goes back under the player.
  await toggle.click();
  await expect(divider).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect(divider).toHaveCount(0);
  await expect(map).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("the Build stage lists what stands between the draft and a module", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const asked = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== `${base}/act_test/readiness`) return route.fallback();
    asked.push(url.searchParams.get("wafRoot"));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        checks: [
          { id: "spec", level: "ok" },
          { id: "plan", level: "fail", state: "stale" },
          { id: "speech", level: "warn", language: "en-US", bound: 3, total: 5 },
          { id: "coverage", level: "warn", language: "es-MX", covered: 4, total: 5 },
          { id: "checkout", level: "ok", found: true },
        ],
      }),
    });
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Module preview");
  const checks = page.getByRole("list", { name: "Build", exact: true });
  await expect(
    checks.getByText("The media plan is older than the specification. Rebuild it in Scenes."),
  ).toBeVisible();
  await expect(checks.getByText("Speech in en-US: 3 of 5 bound.")).toBeVisible();
  await expect(
    checks.getByText("es-MX has 4 of 5 narrations of the default language."),
  ).toBeVisible();
  await expect(checks.getByRole("img", { name: "Blocks assembly" })).toHaveCount(1);
  // Assembly would be refused on a stale plan, so it is not offered.
  await expect(
    page.getByRole("button", { name: "Assemble WAF module", exact: true }),
  ).toBeDisabled();
  await expect(checks.getByText("No unsaved edits.")).toBeVisible();
  await expect(page.getByText("This activity has not been assembled yet.")).toBeVisible();
  // The checkout an author types is the one checked.
  await page.getByRole("textbox", { name: /^WAF checkout/ }).fill("D:/waf");
  await expect.poll(() => asked.at(-1)).toBe("D:/waf");
  expect(f.errors).toEqual([]);
});

test("shows the module's configuration and assessment, read-only, as Loom's documents", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const featureWrites = [];
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
      if (route.request().method() === "PUT") {
        featureWrites.push(route.request().postDataJSON());
        return json({ features, selectedIds: route.request().postDataJSON().selectedIds });
      }
      return json({ features, selectedIds: ["r2phcs03l-speaker-audio-choices"] });
    }
    if (p === `${base}/act_test/module-documents`)
      return json({
        source: "checkout",
        configuration: { file: "configurations/words-12.json", value: { maxRounds: 3 } },
        assessment: {
          file: "assessments/words-12.json",
          value: { items: [{ id: "q1" }, { id: "q2" }] },
        },
      });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.reload();
  await openSection(page, "Configuration Data");
  await expect(
    page.getByText("configurations/words-12.json, from the module in the WAF checkout."),
  ).toBeVisible();
  await expect(page.getByText('"maxRounds": 3')).toBeVisible();
  await openSection(page, "Assessment Data");
  await expect(
    page.getByText("assessments/words-12.json, from the module in the WAF checkout. 2 items."),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Conversation", exact: true });
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
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Conversation", exact: true });
  await expect(panel.getByText("Newest idea.", { exact: true })).toBeVisible();
  const threads = panel.getByRole("button", { name: "Conversation", exact: true });
  await expect(threads).toContainText("About the whole activity");
  await threads.click();
  await page.getByRole("option", { name: /^About scene intro/ }).click();
  await expect(panel.getByText("An older idea.", { exact: true })).toBeVisible();
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

test("trims a stretch out of a narration and binds the shorter clip", async ({ page }) => {
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
                path: "media/uploads/hello-00000000.wav",
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
        path: "media/uploads/hello-trimmed-1234abcd.wav",
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await page.getByRole("button", { name: "Show waveform", exact: true }).click();
  const wave = page.getByRole("slider", { name: /^Waveform: hello/ });
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
  await expect(page.getByRole("textbox", { name: /^Media path/ })).toHaveValue(
    "media/uploads/hello-trimmed-1234abcd.wav",
  );
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
          { language: "en-US", key: "cat", type: "image", bound: true, bytes: 2048 },
          { language: "en-US", key: "hi", type: "audio", bound: true, bytes: 1024 },
          { language: "es-MX", key: "hi", type: "audio", bound: true, bytes: null },
        ],
      }),
    });
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  const refs = page.getByRole("button", { name: "Ref", exact: true });
  await expect(refs).toContainText("Ref 12");
  await refs.click();
  await expect(page.getByRole("option", { name: "Ref 13 · Round two · stable" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Ref settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "words, ref 12" });
  await dialog.getByRole("textbox", { name: /^Display name/ }).fill("Round one");
  await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => identities.length).toBe(1);
  expect(identities[0]).toEqual({ displayName: "Round one", stable: true });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Stable", { exact: true }).first()).toBeVisible();

  await refs.click();
  await page.getByRole("option", { name: "Ref 13 · Round two · stable" }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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

test("a narration shows every language's script, and opens another language from there", async ({
  page,
}) => {
  const f = await fixture(page);
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
            "en-US": [narration("hello", "Hello", { path: "media/uploads/hello-1234abcd.wav" })],
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  const languages = page.getByRole("region", { name: "In every language" });
  await expect(languages.getByRole("listitem")).toHaveText([
    /^en-USHelloBound$/,
    /^es-MXNeeds translationNeeds speechOpen$/,
  ]);
  // The bound recording can be downloaded as the player would fetch it.
  await expect(page.getByRole("link", { name: "Download current", exact: true })).toHaveAttribute(
    "href",
    `${base}/act_test/sandbox/media/uploads/hello-1234abcd.wav`,
  );
  await languages.getByRole("button", { name: "Open", exact: true }).click();
  // Spanish has no recording yet, so there is nothing to download.
  await expect(page.getByRole("link", { name: "Download current", exact: true })).toHaveCount(0);
  // Spanish is open now: its row has nothing to open, and English's has.
  await expect(languages.getByRole("listitem")).toHaveText([
    /^en-USHelloBoundOpen$/,
    /^es-MXNeeds translationNeeds speech$/,
  ]);
  expect(f.errors).toEqual([]);
});

test("the open section is in the address, so a link or a reload lands on it", async ({ page }) => {
  await fixture(page);
  await create(page);
  await expect(page).toHaveURL(/section=specification/);
  await page.reload();
  await expect(page.getByText("Advanced: specification JSON", { exact: true })).toBeVisible();
  await page.goto(`${origin}/activities/act_test?section=nonsense`);
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toBeVisible();
});

test("marks an audio asset as music or a sound effect, with how the module plays it", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Generate speech", exact: true })).toBeVisible();

  // Music loops quietly by default, and is not spoken.
  await page.getByRole("button", { name: "Audio type", exact: true }).click();
  await page.getByRole("option", { name: "Music", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Loop", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("slider", { name: "Volume", exact: true })).toHaveValue("0.4");
  await expect(page.getByRole("button", { name: "Generate speech", exact: true })).toHaveCount(0);
  await expect(page.getByText(/not spoken/)).toBeVisible();
  await page.getByRole("switch", { name: "Loop", exact: true }).click();
  await page.getByRole("slider", { name: "Volume", exact: true }).fill("0.25");
  await expect(page.getByText("25%", { exact: true })).toBeVisible();

  const saved = page.waitForRequest(
    (request) => request.url().endsWith("/media") && request.method() === "PUT",
  );
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  expect((await saved).postDataJSON().manifest.assets["en-US"][0]).toMatchObject({
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
  await expect(page.getByRole("button", { name: "Generate speech", exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
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
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await page.getByRole("textbox", { name: /^Media path/ }).fill("media/images/cat.png");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
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

  await page.getByRole("button", { name: "Ref settings", exact: true }).click();
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
  // The activity just opened also sits under Recently opened; the full list is its own region.
  const all = page.getByRole("region", { name: "All activities" });
  const cards = all.getByRole("listitem").filter({ has: page.getByRole("link") });
  const sight = all.getByRole("link", { name: /Sight words/ });
  await expect(sight).toContainText("Phonics");
  await expect(sight).toContainText("grade 1");
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
  await page.getByRole("button", { name: "Ref settings", exact: true }).click();
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

test("shows the activity just opened under Recently opened", async ({ page }) => {
  const f = await fixture(page);
  const record = (id, productCode, refNum, title) => ({
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
    tags: [],
  });
  const list = () => [
    record("act_test", "words", 12, "Sight words"),
    record("act_letters", "letters", 1, "Letter hunt"),
    record("act_count", "count", 3, "Counting"),
  ];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === base && request.method() === "GET")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ activities: list() }),
      });
    return route.fallback();
  });
  // Opened earlier in this browser: Letter hunt, then one since deleted, and one in another
  // project.
  await page.goto(`${origin}/activities`);
  await page.evaluate(
    ([key, projectId]) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          [projectId]: [
            { id: "act_gone", at: "2026-09-25T09:00:00.000Z" },
            { id: "act_letters", at: "2026-09-25T08:00:00.000Z" },
          ],
          other: [{ id: "act_count", at: "2026-09-25T09:30:00.000Z" }],
        }),
      ),
    ["penguin.activities.recent", projectId],
  );
  await create(page);
  await page.getByRole("link", { name: "All activities", exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  const recent = page.getByRole("region", { name: "Recently opened" });
  await expect(recent.getByRole("link")).toHaveCount(2);
  await expect(recent.getByRole("link").nth(0)).toContainText("Sight words");
  await expect(recent.getByRole("link").nth(1)).toContainText("Letter hunt");
  await expect(page.getByRole("region", { name: "All activities" }).getByRole("link")).toHaveCount(
    3,
  );

  // Searching is looking for something else, so the row steps aside.
  const search = page.getByRole("textbox", { name: "Search activities", exact: true });
  await search.fill("count");
  await expect(recent).toHaveCount(0);
  await search.fill("");
  await expect(recent.getByRole("link")).toHaveCount(2);

  // Opening it again from the row keeps it once, first.
  await recent.getByRole("link", { name: /Sight words/ }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page.getByRole("link", { name: "All activities", exact: true }).click();
  await expect(recent.getByRole("link")).toHaveCount(2);
  await expect(recent.getByRole("link").nth(0)).toContainText("Sight words");

  // What this browser stored is unreadable: no row, no error.
  await page.evaluate((key) => localStorage.setItem(key, "{not json"), "penguin.activities.recent");
  await page.reload();
  await expect(page.getByRole("region", { name: "All activities" }).getByRole("link")).toHaveCount(
    3,
  );
  await expect(recent).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "All activities" })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
