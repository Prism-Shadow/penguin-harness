/**
 * Run tests: check each acceptance criterion of the specification against the played activity.
 *
 * This service decides whether a test run can start and prepares it; the run itself is an
 * ordinary agent run (`ActivityGeneration.start` with `test`), a traced Session with
 * approvals, in which the agent writes `acceptance.test.mjs` against Penguin's harness API and
 * runs it in the test browser. The generation service collects `acceptance-results.json` into
 * the run's report, `reports/test.json`; the latest finished test run's report is the
 * activity's.
 *
 * A specification without acceptance criteria has nothing to test: that run finishes at once
 * with a skipped report and starts no Session. Without the test browser, or without an
 * assembled module to play, a run is refused. When the latest finished test run tested the
 * same criteria of the same specification with the same harness, its test file is copied into
 * the new run and the agent only runs it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import { readArtifactBytes } from "./artifact.js";
import {
  acceptanceCriteria,
  readAcceptanceReport,
  sameCriteria,
  skippedReport,
  specSceneIds,
} from "./acceptance-collect.js";
import {
  ACCEPTANCE_REPORT_DIR,
  ACCEPTANCE_REPORT_FILE,
  ACCEPTANCE_TEST_FILE,
  HARNESS_VERSION,
  TEST_FILE_MAX_BYTES,
} from "./acceptance-harness.js";
import type { AcceptanceReport, AcceptanceStateResponse } from "./acceptance-types.js";
import { contentRevision, type ActivityRun } from "./domain.js";
import { viewportOf } from "./quality-check.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import { atomicJson } from "./service.js";
import { playwrightCoreDir, type TestBrowser } from "./test-browser.js";

export type { AcceptanceReport, AcceptanceStateResponse } from "./acceptance-types.js";

/** The `playwright-core` version this server drives, which a test run installs too. */
export async function playwrightVersion(coreDir: string | null): Promise<string | null> {
  if (!coreDir) return null;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(coreDir, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" && /^\d+\.\d+\.\d+/.test(manifest.version)
      ? manifest.version
      : null;
  } catch {
    return null;
  }
}

/** The parts of a test run that depend on the host; a test stands in its own. */
export abstract class AcceptancePorts extends Interface<{
  /** The `playwright-core` version a run installs; the server's own by default. */
  playwrightVersion?: string | null;
}>() {}

@Component()
export class DefaultAcceptancePorts implements AcceptancePorts {}

export abstract class ActivityAcceptance extends Interface<{
  /**
   * Starts a test run and answers at once with it. With no acceptance criteria it has already
   * finished, skipped. 409 `test_browser_missing` without the test browser, 409
   * `preview_not_built` when there is no module to play, 409 `generation_running` while
   * another run is going, 409 `draft_conflict` on a stale revision.
   */
  start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    runtime?: { codingAgentId?: string },
  ): Promise<ActivityRun>;
  /** The latest finished test run's report, with the criteria count and the browser's presence. */
  state(projectId: string, activityId: string): Promise<AcceptanceStateResponse>;
  /** Whether the test browser is installed, for Run all stages to skip the step without it. */
  browserInstalled(): Promise<boolean>;
}>() {}

@Component()
export class ActivityAcceptanceService implements ActivityAcceptance {
  @Use() private readonly config!: Config;
  @Use() private readonly browser!: TestBrowser;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly ports!: AcceptancePorts;
  @Use() private readonly log!: Log;

  private stopped = false;

  setup({ effect }: ClassCtx) {
    effect(() => {
      this.stopped = true;
    });
  }

  private workspace(runId: string): string {
    return path.join(this.config.root, "activity-runs", runId);
  }

  async browserInstalled(): Promise<boolean> {
    return (await this.browser.executablePath()) !== null;
  }

  async start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    runtime?: { codingAgentId?: string },
  ): Promise<ActivityRun> {
    if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
    const activity = await this.activities.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(
        409,
        "draft_conflict",
        "Save or reload the draft before running the tests.",
      );
    const spec = activity.draft.spec;
    if (!spec || activity.draft.status !== "valid")
      throw new HttpError(
        400,
        "test_spec_required",
        "Save a valid specification before running the acceptance tests.",
      );
    const specRevision = contentRevision(spec);
    const criteria = acceptanceCriteria(spec);
    if (!criteria.length) return this.skip(projectId, activityId, specRevision);

    const executable = await this.browser.executablePath();
    if (!executable)
      throw new HttpError(
        409,
        "test_browser_missing",
        "The test browser is not installed. An admin installs it in System settings.",
      );
    const version =
      this.ports.playwrightVersion !== undefined
        ? this.ports.playwrightVersion
        : await playwrightVersion(playwrightCoreDir());
    if (!version)
      throw new HttpError(
        503,
        "test_browser_unavailable",
        "This copy of Penguin does not include Playwright, so it cannot run the tests.",
      );
    const sandbox = await this.sandbox.status(projectId, activityId);
    if (!sandbox.playable) throw new HttpError(409, "preview_not_built", sandbox.message);

    const playUrl = await this.browser.playUrl(projectId, activityId);
    const cachedTest = await this.reusableTest(projectId, activityId, criteria, specRevision);
    return this.generation.start(
      projectId,
      activityId,
      agentId,
      expectedRevision,
      {
        test: {
          input: {
            playUrl,
            viewport: viewportOf(spec),
            criteria,
            browserPath: executable,
            scenes: specSceneIds(spec),
            specRevision,
          },
          cachedTest,
          playwrightVersion: version,
        },
      },
      runtime,
    );
  }

  /** Nothing to test: a finished run with a skipped report, and no Session. */
  private async skip(
    projectId: string,
    activityId: string,
    specRevision: string,
  ): Promise<ActivityRun> {
    const run = await this.generation.openDeterministic(projectId, activityId, "test");
    try {
      const reports = path.join(this.workspace(run.runId), ACCEPTANCE_REPORT_DIR);
      await fs.mkdir(reports, { recursive: true });
      await atomicJson(
        path.join(reports, ACCEPTANCE_REPORT_FILE),
        skippedReport(new Date().toISOString(), specRevision),
      );
      await this.generation.settleDeterministic(
        projectId,
        activityId,
        run.runId,
        "succeeded",
        null,
      );
      return { ...run, status: "succeeded", finishedAt: new Date().toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.line(`[activities] Test run ${run.runId} could not record its report: ${message}`);
      await this.generation
        .settleDeterministic(projectId, activityId, run.runId, "failed", message.slice(0, 500))
        .catch(() => {});
      return { ...run, status: "failed", error: message.slice(0, 500) };
    }
  }

  /**
   * The test file of the latest finished test run, when it tested these same criteria of this
   * same specification with this harness; null otherwise.
   */
  private async reusableTest(
    projectId: string,
    activityId: string,
    criteria: readonly string[],
    specRevision: string,
  ): Promise<string | null> {
    const latest = await this.generation.latestRun(projectId, activityId, "test", "succeeded");
    const record = latest?.test;
    if (
      !latest ||
      !record ||
      record.specRevision !== specRevision ||
      record.harnessVersion !== HARNESS_VERSION ||
      !sameCriteria(record.criteria, criteria)
    )
      return null;
    try {
      const bytes = await readArtifactBytes(
        path.join(this.workspace(latest.runId), ACCEPTANCE_TEST_FILE),
        TEST_FILE_MAX_BYTES,
      );
      const text = bytes.toString("utf8");
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  }

  async state(projectId: string, activityId: string): Promise<AcceptanceStateResponse> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const latest = await this.generation.latestRun(projectId, activityId, "test", "succeeded");
    const report = latest ? await this.readReport(latest.runId) : null;
    const spec = activity.draft.spec;
    const specRevision = spec ? contentRevision(spec) : null;
    return {
      report,
      runId: report && latest ? latest.runId : null,
      criteria: acceptanceCriteria(spec).length,
      stale: report !== null && report.specRevision !== specRevision,
      browserInstalled: await this.browserInstalled(),
    };
  }

  private async readReport(runId: string): Promise<AcceptanceReport | null> {
    try {
      const text = await fs.readFile(
        path.join(this.workspace(runId), ACCEPTANCE_REPORT_DIR, ACCEPTANCE_REPORT_FILE),
        "utf8",
      );
      return readAcceptanceReport(JSON.parse(text));
    } catch {
      return null;
    }
  }
}
