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
  const prefsWrites = [];
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
        ],
      });
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
      return json({
        runs: runs.map(({ candidate, ...run }) => ({ ...run, hasCandidate: candidate !== null })),
      });
    }
    if (p.startsWith(`${base}/act_test/runs/`) && p.endsWith("/candidate")) {
      candidateReads++;
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
    if (p === `${base}/act_test/generate-spec`) {
      runs.unshift({
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
    errors,
    prefsWrites,
    get historyReads() {
      return historyReads;
    },
    get candidateReads() {
      return candidateReads;
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

async function create(page) {
  await page.goto(`${origin}/activities`);
  await page.getByRole("textbox", { name: "Product code", exact: true }).fill("words");
  await page.getByRole("spinbutton", { name: "Reference number", exact: true }).fill("12");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Sight words");
  await page.getByRole("button", { name: "Create activity", exact: true }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Practice common sight words");
  await page.getByRole("button", { name: "Save description", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toBeEnabled();
}

test("create, save, generate, leave and reopen a completed specification", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open Session / approvals" })).toHaveAttribute(
    "href",
    "/chat/session_test",
  );
  await page.reload();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  f.complete();
  await expect(page.getByRole("textbox", { name: "Specification JSON", exact: true })).toHaveValue(
    JSON.stringify(spec, null, 2),
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "Practice common sight words",
  );
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("polling preserves unsaved edits and exposes conflicting output for review", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel generation" })).toBeVisible();
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("My unsaved edit");
  f.conflict();
  await expect(
    page.getByText("Draft changed — candidate preserved", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "My unsaved edit",
  );
  await page.getByRole("button", { name: "Save description", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "My unsaved edit",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "Changed in another tab",
  );
  await page.getByText("View candidate JSON", { exact: true }).click();
  await page.getByRole("button", { name: "Copy candidate into editor" }).click();
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
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(f.errors).toEqual([]);
});

test("dirty drafts block sidebar, Session, browser back, and project switches", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  const description = page.getByRole("textbox", { name: "Description", exact: true });
  await description.fill("Keep this edit");
  let prompts = 0;
  const decline = (dialog) => {
    prompts++;
    return dialog.dismiss();
  };
  page.on("dialog", decline);
  await page.getByRole("link", { name: "Open Session / approvals" }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page.goBack();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await expect(description).toHaveValue("Keep this edit");
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activities test", exact: true })).toBeVisible();
  await expect(description).toHaveValue("Keep this edit");
  expect(await page.evaluate(() => localStorage.getItem("penguin.lastProjectId"))).not.toBe(
    "second-project",
  );
  expect(f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project")).toBe(false);
  expect(prompts).toBe(4);
  page.off("dialog", decline);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/activities$/);
  await page.getByRole("link", { name: "words / 12 Sight words" }).click();
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
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await expect.poll(() => f.historyReads).toBeGreaterThan(reads);
  f.complete();
  f.secondCandidate();
  await expect(page.getByText("Applied", { exact: true })).toHaveCount(2);
  expect(f.candidateReads).toBe(0);
  const candidates = page.getByText("View candidate JSON", { exact: true });
  const release = f.holdFirstCandidate();
  f.failSecondCandidate();
  await candidates.nth(0).click();
  await candidates.nth(1).click();
  await expect(page.getByRole("alert")).toContainText("Candidate temporarily unavailable.");
  await page.locator("details").nth(1).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("details").nth(1).locator("pre")).toContainText(
    '"title":"Second candidate"',
  );
  await expect(page.locator("details").nth(0).locator("pre")).toContainText("Loading");
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
