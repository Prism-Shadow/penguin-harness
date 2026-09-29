/**
 * Check quality, over HTTP: a quality run opens each scene of the played activity in the test
 * browser, writes both reports into its workspace, and GET returns them.
 *
 * No browser starts: the launcher is a fake whose page answers with canned axe and probe
 * results, and the test browser's "executable" is a file this test writes.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserLauncher } from "../src/activities/browser-session.js";
import type { ActivityRun, ActivityRunSummary } from "../src/activities/domain.js";
import { PAGE_PROBE, PLAYER_READY } from "../src/activities/quality-accessibility.js";
import type {
  QualitySettingsResponse,
  QualityStateResponse,
} from "../src/activities/quality-types.js";
import { INSTALL_MARKER } from "../src/activities/test-browser.js";
import type { ActivityGeneration } from "../src/mechanisms/activities.js";
import { activitySpec, createCheckoutActivity } from "./activity-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout with one finished Loom module of two scenes, for grade band k-2. */
async function checkout(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "waf-quality-"));
  await write(path.join(root, "framework", "package.json"), { version: "9.9.9" });
  await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
  await fs.mkdir(path.join(root, "media", "loom"), { recursive: true });
  const spec = {
    ...activitySpec,
    audience: { gradeBand: "k-2" },
    scenes: [
      { id: "intro", description: "Choose a word" },
      { id: "end", description: "Well done" },
    ],
  };
  const product = path.join(root, "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    title: "Sight Words",
    canonicalRefNum: 1,
    activityType: "standard",
    moduleFolder: FOLDER,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  await write(path.join(ref, "activity_metadata.json"), { refNum: 1, title: "Sight Words 1" });
  await write(path.join(ref, "activity_spec.json"), spec);
  await write(path.join(ref, "asset_manifest.json"), { assets: { "en-US": [] } });
  await write(path.join(ref, "activity_description.txt"), "Ref 1");
  const module = path.join(root, "modules", FOLDER);
  await write(path.join(module, "definition.json"), {
    id: "sightWords",
    require: {
      entry: { type: "javascript", url: "entry.js" },
      layout: { type: "html", url: "layout.html" },
    },
  });
  await write(path.join(module, "package.json"), { version: "1.0.0" });
  await write(path.join(module, "configurations", `${CODE}-1.json`), { sightWords: {} });
  return root;
}

const executableIn = (dir: string) => path.join(dir, "chromium-0000", "chrome");

/** What the fake page answers, per scene. */
const AXE = {
  violations: [
    {
      id: "color-contrast",
      impact: "serious",
      help: "Elements must meet minimum color contrast ratio thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
      nodes: [{ target: ["#choices > button"] }],
    },
    { id: "region", impact: "minor", help: "Content in landmarks", nodes: [{ target: ["#x"] }] },
  ],
};
const LONG =
  "the big red dog and the little blue cat can run and jump and play all day in the green park with you and me";

/** A launcher whose pages answer axe and the probe with canned results, and a record of it. */
function fakeBrowser(options: { hold?: Promise<void>; failOn?: string } = {}) {
  const calls = {
    urls: [] as string[],
    viewports: [] as unknown[],
    scripts: [] as string[],
    closed: 0,
  };
  const launcher = (async () => ({
    newContext: async ({ viewport }: { viewport: unknown }) => {
      calls.viewports.push(viewport);
      return {
        newPage: async () => {
          let url = "";
          return {
            setDefaultTimeout: () => {},
            goto: async (target: string) => {
              url = target;
              calls.urls.push(target);
              await options.hold;
              if (options.failOn && target.includes(options.failOn))
                throw new Error("net::ERR_ABORTED");
            },
            waitForFunction: async (expression: string) => {
              expect(expression).toBe(PLAYER_READY);
            },
            waitForTimeout: async () => {},
            addScriptTag: async ({ content }: { content: string }) => {
              calls.scripts.push(content);
            },
            evaluate: async (script: string) => {
              if (script === PAGE_PROBE)
                return {
                  controls: [
                    {
                      id: "repeat",
                      tag: "div",
                      role: "",
                      focusable: false,
                      focusVisible: false,
                      keyActivable: false,
                    },
                  ],
                  text: [url.includes("scene=intro") ? LONG : "Well done"],
                };
              expect(script).toContain("window.axe.run");
              return AXE;
            },
          };
        },
      };
    },
    close: async () => {
      calls.closed += 1;
    },
  })) as unknown as BrowserLauncher;
  return { launcher, calls };
}

describe("quality run", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(
    options: { installed?: boolean; browser?: ReturnType<typeof fakeBrowser> } = {},
  ) {
    const root = await checkout();
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = root;
    const browser = options.browser ?? fakeBrowser();
    const t = await createTestApp({
      testBrowserPorts: { locateExecutable: async (dir) => executableIn(dir) },
      qualityCheckPorts: { launcher: browser.launcher, axeSource: "/* axe */" },
    });
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    });
    if (options.installed !== false) {
      const home = path.join(t.root, "browsers");
      await write(executableIn(home), "fake browser");
      await write(path.join(home, "chromium-0000", INSTALL_MARKER), "");
    }
    const owner = await provisionUser(t.app, "quality_owner");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "quality_owner-quality";
    await client.post("/api/projects", { projectId, name: "Quality" });
    const activityId = await createCheckoutActivity(client, projectId, root, CODE);
    const endpoint = `/api/projects/${projectId}/activities/${activityId}`;
    const state = async () => {
      const res = await client.get(`${endpoint}/quality`);
      expect(res.status).toBe(200);
      return (await res.json()) as QualityStateResponse;
    };
    const runs = async () =>
      ((await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] })
        .runs;
    return { t, client, endpoint, state, runs, browser, projectId };
  }

  it("writes both reports, and GET returns them", async () => {
    const { t, client, endpoint, state, runs, browser } = await setup();
    expect(await state()).toEqual({ quality: null, browserInstalled: true });

    const started = await client.post(`${endpoint}/quality`);
    expect(started.status).toBe(202);
    const run = (await started.json()) as ActivityRun;
    expect(run).toMatchObject({ kind: "quality", status: "running", sessionId: null });

    await vi.waitFor(async () => expect((await state()).quality).not.toBeNull());
    const { quality } = await state();
    expect(quality!.runId).toBe(run.runId);
    expect((await runs()).find((entry) => entry.runId === run.runId)?.status).toBe("succeeded");

    // Each scene opened on its own, at the specification's resolution, with axe injected.
    expect(browser.calls.urls.map((url) => new URL(url).searchParams.get("scene"))).toEqual([
      "intro",
      "end",
    ]);
    expect(browser.calls.viewports).toEqual([
      { width: 640, height: 480 },
      { width: 640, height: 480 },
    ]);
    expect(browser.calls.scripts).toEqual(["/* axe */", "/* axe */"]);
    expect(browser.calls.closed).toBe(2);

    const accessibility = quality!.accessibility;
    expect(accessibility.status).toBe("failed");
    expect(accessibility.scenes).toEqual(["intro", "end"]);
    expect(
      accessibility.findings.map((finding) => [finding.code, finding.scene, finding.severity]),
    ).toEqual([
      ["color-contrast", "end", "must"],
      ["keyboard-focusable", "end", "must"],
      ["color-contrast", "intro", "must"],
      ["keyboard-focusable", "intro", "must"],
      ["region", "end", "minor"],
      ["region", "intro", "minor"],
    ]);

    const readability = quality!.readability;
    expect(readability).toMatchObject({ status: "passed_with_warnings", gradeBand: "k-2" });
    expect(readability.findings).toEqual([
      expect.objectContaining({ code: "sentence_long", scene: "intro", count: 25, limit: 10 }),
    ]);

    // Both reports are the run's artefacts.
    const reports = path.join(t.root, "activity-runs", run.runId, "reports");
    expect(JSON.parse(await fs.readFile(path.join(reports, "accessibility.json"), "utf8"))).toEqual(
      accessibility,
    );
    expect(JSON.parse(await fs.readFile(path.join(reports, "readability.json"), "utf8"))).toEqual(
      readability,
    );
  });

  it("refuses without the test browser, and says so", async () => {
    const { client, endpoint, state } = await setup({ installed: false });
    expect(await state()).toEqual({ quality: null, browserInstalled: false });
    const refused = await client.post(`${endpoint}/quality`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "test_browser_missing" } });
  });

  it("runs one at a time, and lets a VPAT exception through", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const { t, client, endpoint, state } = await setup({ browser: fakeBrowser({ hold }) });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const set = await admin.put("/api/admin/activity-quality", {
      vpatExceptions: [" Color-Contrast ", "keyboard-focusable"],
    });
    expect(set.status).toBe(200);
    expect((await set.json()) as QualitySettingsResponse).toEqual({
      vpatExceptions: ["color-contrast", "keyboard-focusable"],
    });

    expect((await client.post(`${endpoint}/quality`)).status).toBe(202);
    const again = await client.post(`${endpoint}/quality`);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "generation_running" } });
    release();

    await vi.waitFor(async () => expect((await state()).quality).not.toBeNull());
    const { accessibility } = (await state()).quality!;
    expect(accessibility.status).toBe("passed_with_warnings");
    expect(accessibility.findings.filter((finding) => finding.waived === "vpat")).toHaveLength(4);
  });

  it("records a check that could not open a scene as failed, with no reports", async () => {
    const { client, endpoint, state, runs } = await setup({
      browser: fakeBrowser({ failOn: "scene=end" }),
    });
    const run = (await (await client.post(`${endpoint}/quality`)).json()) as ActivityRun;
    await vi.waitFor(async () =>
      expect((await runs()).find((entry) => entry.runId === run.runId)?.status).toBe("failed"),
    );
    const failed = (await runs()).find((entry) => entry.runId === run.runId)!;
    expect(failed.error).toContain("ERR_ABORTED");
    expect((await state()).quality).toBeNull();
  });

  it("stops a cancelled check at the next scene, writes nothing, and lets the next one start", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const browser = fakeBrowser({ hold });
    const { t, client, endpoint, state, runs } = await setup({ browser });
    const run = (await (await client.post(`${endpoint}/quality`)).json()) as ActivityRun;
    await vi.waitFor(() => expect(browser.calls.urls).toHaveLength(1));

    const cancelled = await client.post(`${endpoint}/runs/${run.runId}/cancel`);
    expect(cancelled.status).toBe(200);
    // The cancelled check is still in the browser: a new one waits its turn.
    const early = await client.post(`${endpoint}/quality`);
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "generation_running" } });

    release();
    await vi.waitFor(async () =>
      expect((await client.post(`${endpoint}/quality`)).status).toBe(202),
    );
    await vi.waitFor(async () => expect((await state()).quality).not.toBeNull());

    // The cancelled check opened only the scene it was in, and left no reports.
    expect(browser.calls.urls).toHaveLength(3);
    await expect(
      fs.stat(path.join(t.root, "activity-runs", run.runId, "reports")),
    ).rejects.toThrow();
    expect((await runs()).find((entry) => entry.runId === run.runId)?.status).toBe("cancelled");
    expect((await state()).quality!.runId).not.toBe(run.runId);
  });

  it("finds the latest reports however many other runs came after them", async () => {
    const { t, client, endpoint, state, projectId } = await setup();
    const run = (await (await client.post(`${endpoint}/quality`)).json()) as ActivityRun;
    await vi.waitFor(async () => expect((await state()).quality?.runId).toBe(run.runId));
    const activityId = endpoint.split("/").pop()!;
    const later = t.deps.tree.api<ActivityGeneration>("ActivitiesModule", "ActivityGeneration");
    for (let index = 0; index < 60; index += 1) {
      const other = await later.openDeterministic(projectId, activityId, "quality");
      await later.settleDeterministic(projectId, activityId, other.runId, "failed", "stub");
    }
    expect((await state()).quality?.runId).toBe(run.runId);
  });

  it("keeps the VPAT exceptions an admin's", async () => {
    const { t, client } = await setup();
    expect((await client.get("/api/admin/activity-quality")).status).toBe(403);
    expect((await client.put("/api/admin/activity-quality", { vpatExceptions: [] })).status).toBe(
      403,
    );
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(await (await admin.get("/api/admin/activity-quality")).json()).toEqual({
      vpatExceptions: [],
    });
    const bad = await admin.put("/api/admin/activity-quality", { vpatExceptions: ["not a rule"] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_vpat_exceptions" } });
  });
});
