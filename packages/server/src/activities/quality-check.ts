/**
 * Check quality: open the played activity in the test browser, scene by scene, and report
 * whether it is easy for everyone to use and whether its words suit its grade band.
 *
 * A deterministic run, like a build: no Session and no agent, recorded in the activity's run
 * history as kind `quality` under the one-run-per-activity rule. For each scene the check
 * opens the player on that scene (`TestBrowser.playUrl`), waits for the player to start (its
 * inspection bridge appears, or five seconds pass), injects axe-core — used as it ships —
 * runs it for WCAG 2.2 AA, and runs the keyboard probe, which also collects the text on the
 * page. The two reports go into the run's workspace as `reports/accessibility.json` and
 * `reports/readability.json`; the latest finished run's reports are the activity's.
 *
 * Nothing blocks on the result yet: a failed accessibility check is a status, not a refusal to
 * assemble. The browser launcher and the axe source are ports, so a test drives canned
 * results and never starts a browser.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { Settings } from "../mechanisms/settings.js";
import { openPage, type BrowserLauncher, type Viewport } from "./browser-session.js";
import type { ActivityRun } from "./domain.js";
import {
  PAGE_PROBE,
  PLAYER_READY,
  WCAG_TAGS,
  accessibilityReport,
  axeRunScript,
  keyboardFindings,
  normalizeViolations,
  readProbe,
} from "./quality-accessibility.js";
import {
  activityLanguage,
  narrationPassages,
  readabilityReport,
  type Passage,
} from "./quality-readability.js";
import type {
  QualityFinding,
  QualityReport,
  QualityResults,
  QualityStateResponse,
} from "./quality-types.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import { atomicJson } from "./service.js";
import type { TestBrowser } from "./test-browser.js";

export type {
  QualityFinding,
  QualityReport,
  QualityResults,
  QualityStateResponse,
} from "./quality-types.js";

/** Where a run keeps its reports, inside its workspace. */
export const REPORTS_DIR = "reports";
export const ACCESSIBILITY_REPORT = "accessibility.json";
export const READABILITY_REPORT = "readability.json";

/** The admin setting that lists VPAT exceptions: a JSON array of axe rule ids. */
export const VPAT_SETTING = "activityQuality.vpatExceptions";
/** How many VPAT exceptions may be listed, and how long each may be. */
export const VPAT_MAX = 100;
export const VPAT_RULE_MAX = 100;

/** How long the browser may take to start and the page to load, and each page action. */
export const PAGE_TIMEOUT_MS = 30_000;
/** How long to wait for the player's inspection bridge before scanning what is there. */
export const READY_TIMEOUT_MS = 5_000;
/** A moment for the first frame to settle after the player has started. */
const SETTLE_MS = 250;
/** The most scenes one check opens. */
export const MAX_SCENES = 100;

/** The viewport when the specification names no resolution. */
const DEFAULT_VIEWPORT: Viewport = { width: 1024, height: 768 };

/** The page a specification's `runtime.resolution` asks for ("640x480"), or the default. */
export function viewportOf(spec: Record<string, unknown> | null): Viewport {
  const runtime = spec?.runtime as { resolution?: unknown } | undefined;
  const match =
    typeof runtime?.resolution === "string"
      ? /^(\d{2,4})x(\d{2,4})$/.exec(runtime.resolution)
      : null;
  if (!match) return DEFAULT_VIEWPORT;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The scenes a check opens, in order; one visit to the activity's start when there are none. */
export function scenesOf(spec: Record<string, unknown> | null): (string | null)[] {
  const scenes = Array.isArray(spec?.scenes) ? (spec!.scenes as unknown[]) : [];
  const ids = scenes
    .map((scene) => (scene && typeof scene === "object" ? (scene as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string" && id.trim() !== "");
  const unique = [...new Set(ids)].slice(0, MAX_SCENES);
  return unique.length ? unique : [null];
}

/** The VPAT exceptions an admin stored, read leniently: anything malformed counts as none. */
export function readVpatExceptions(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value)
      ? value.filter((rule): rule is string => typeof rule === "string" && rule.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

/** Validates an admin's list of VPAT exceptions: axe rule ids, trimmed, lower case, unique. */
export function parseVpatExceptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > VPAT_MAX)
    throw new HttpError(
      400,
      "invalid_vpat_exceptions",
      `vpatExceptions must be a list of at most ${VPAT_MAX} rule ids.`,
    );
  const rules = new Set<string>();
  for (const entry of value) {
    const rule = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (!rule || rule.length > VPAT_RULE_MAX || !/^[a-z0-9][a-z0-9-]*$/.test(rule))
      throw new HttpError(
        400,
        "invalid_vpat_exceptions",
        "Each VPAT exception must be an axe rule id, such as video-caption.",
      );
    rules.add(rule);
  }
  return [...rules];
}

/** axe-core's browser build, as it ships. */
async function shippedAxeSource(): Promise<string> {
  const file = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
  return fs.readFile(file, "utf8");
}

/**
 * The parts of a check that touch the outside world. Absent, the real ones are used; a test
 * stands in fakes so no browser starts.
 */
export abstract class QualityCheckPorts extends Interface<{
  /** Starts the browser; `playwright-core`'s Chromium by default. */
  launcher?: BrowserLauncher;
  /** The axe-core script injected into each page; the installed package's by default. */
  axeSource?: string;
}>() {}

@Component()
export class DefaultQualityCheckPorts implements QualityCheckPorts {}

export abstract class ActivityQuality extends Interface<{
  /**
   * Starts a quality run and answers at once with it; the checks run after. 409
   * `test_browser_missing` without the test browser, 409 `quality_not_playable` when there is
   * no module to play, 409 `generation_running` while another run is going.
   */
  start(projectId: string, activityId: string): Promise<ActivityRun>;
  /** The latest finished quality run's reports, and whether the test browser is installed. */
  state(projectId: string, activityId: string): Promise<QualityStateResponse>;
  /** The server-wide VPAT exceptions. */
  vpatExceptions(): string[];
  /** Replaces them (admin only; the route checks). */
  setVpatExceptions(rules: string[]): string[];
}>() {}

@Component()
export class ActivityQualityService implements ActivityQuality {
  @Use() private readonly config!: Config;
  @Use() private readonly settings!: Settings;
  @Use() private readonly browser!: TestBrowser;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly ports!: QualityCheckPorts;
  @Use() private readonly log!: Log;

  private stopped = false;
  /**
   * Activities whose check is still driving the browser. A cancelled run releases the
   * one-run rule at once, but its check stops only at the next scene; until then a new check
   * of the same activity waits its turn.
   */
  private readonly checking = new Set<string>();

  setup({ effect }: ClassCtx) {
    effect(() => {
      this.stopped = true;
    });
  }

  vpatExceptions(): string[] {
    return readVpatExceptions(this.settings.get(VPAT_SETTING));
  }

  setVpatExceptions(rules: string[]): string[] {
    const parsed = parseVpatExceptions(rules);
    this.settings.set(VPAT_SETTING, JSON.stringify(parsed));
    return parsed;
  }

  async start(projectId: string, activityId: string): Promise<ActivityRun> {
    if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
    await this.activities.getActivity(projectId, activityId);
    const executable = await this.browser.executablePath();
    if (!executable)
      throw new HttpError(
        409,
        "test_browser_missing",
        "The test browser is not installed. An admin installs it in System settings.",
      );
    const sandbox = await this.sandbox.status(projectId, activityId);
    if (!sandbox.playable) throw new HttpError(409, "quality_not_playable", sandbox.message);
    if (this.checking.has(activityId))
      throw new HttpError(
        409,
        "generation_running",
        "This activity already has a running generation.",
      );
    const run = await this.generation.openDeterministic(projectId, activityId, "quality");
    this.checking.add(activityId);
    // Answered at once; the run settles itself, and its history shows it running meanwhile.
    void this.check(run, executable).finally(() => this.checking.delete(activityId));
    return run;
  }

  private workspace(runId: string): string {
    return path.join(this.config.root, "activity-runs", runId);
  }

  private async check(run: ActivityRun, executable: string): Promise<void> {
    const { projectId, activityId, runId } = run;
    try {
      const activity = await this.activities.getActivity(projectId, activityId);
      const spec = activity.draft.spec;
      const manifest = activity.draft.mediaPlan?.manifest ?? null;
      const axeSource = this.ports.axeSource ?? (await shippedAxeSource());
      const viewport = viewportOf(spec);
      const scenes = scenesOf(spec);
      const found: QualityFinding[] = [];
      const shown: Passage[] = [];
      const scanned: string[] = [];
      // Cancelled by the author, or interrupted: stop before opening anything more.
      const ended = async () => !(await this.generation.isRunning(projectId, activityId, runId));
      for (const scene of scenes) {
        if (this.stopped) throw new Error("The server stopped before the check finished.");
        if (await ended()) return;
        const url = await this.browser.playUrl(projectId, activityId, scene ? { scene } : {});
        const session = await openPage(executable, url, viewport, {
          timeoutMs: PAGE_TIMEOUT_MS,
          ...(this.ports.launcher ? { launcher: this.ports.launcher } : {}),
        });
        try {
          const { page } = session;
          // A player that never says it has started is scanned as it is.
          await page
            .waitForFunction(PLAYER_READY, undefined, { timeout: READY_TIMEOUT_MS })
            .catch(() => {});
          await page.waitForTimeout(SETTLE_MS);
          await page.addScriptTag({ content: axeSource });
          const results: unknown = await page.evaluate(axeRunScript(WCAG_TAGS));
          const probe = readProbe(await page.evaluate(PAGE_PROBE));
          found.push(
            ...normalizeViolations(results, scene),
            ...keyboardFindings(probe.controls, scene),
          );
          for (const text of probe.text) shown.push({ text, scene });
        } finally {
          await session.close();
        }
        if (scene) scanned.push(scene);
      }
      if (await ended()) return;
      const checkedAt = new Date().toISOString();
      const language = activityLanguage(manifest);
      const accessibility = accessibilityReport({
        findings: found,
        scenes: scanned,
        exceptions: this.vpatExceptions(),
        checkedAt,
      });
      const readability = readabilityReport({
        spec,
        language,
        passages: [...narrationPassages(spec, manifest, language), ...shown],
        checkedAt,
      });
      const reports = path.join(this.workspace(runId), REPORTS_DIR);
      await fs.mkdir(reports, { recursive: true });
      await atomicJson(path.join(reports, ACCESSIBILITY_REPORT), accessibility);
      await atomicJson(path.join(reports, READABILITY_REPORT), readability);
      await this.generation.settleDeterministic(projectId, activityId, runId, "succeeded", null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.line(`[activities] Quality check ${runId} failed: ${message}`);
      await this.generation
        .settleDeterministic(
          projectId,
          activityId,
          runId,
          "failed",
          // The App words the lead-in; the run keeps only the cause.
          message.slice(0, 500),
        )
        .catch(() => {});
    }
  }

  async state(projectId: string, activityId: string): Promise<QualityStateResponse> {
    const latest = await this.generation.latestRun(projectId, activityId, "quality", "succeeded");
    const browserInstalled = (await this.browser.executablePath()) !== null;
    const quality = latest ? await this.readReports(latest.runId) : null;
    return { quality, browserInstalled };
  }

  private async readReports(runId: string): Promise<QualityResults | null> {
    const dir = path.join(this.workspace(runId), REPORTS_DIR);
    const read = async (name: string) =>
      JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as QualityReport;
    try {
      return {
        runId,
        accessibility: await read(ACCESSIBILITY_REPORT),
        readability: await read(READABILITY_REPORT),
      };
    } catch {
      return null;
    }
  }
}
