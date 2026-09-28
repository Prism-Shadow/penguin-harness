/**
 * Record video (experimental, behind `activityVideoExperiment`): a kept scene composition is
 * played once in the test browser and recorded to a WebM (see video-render.ts), which the
 * author may then bind to the video or animation asset it was composed for.
 *
 * A deterministic run, like a quality check: no Session and no agent, recorded in the
 * activity's run history as kind `video` under the one-run-per-activity rule. The browser
 * opens the composition on this server's loopback address through a signed composition link
 * (see composition-service.ts), the way a quality check opens the player. The recording is
 * checked (a WebM, 100 MB at most) and kept in the draft workspace as the run's candidate;
 * nothing is bound until the author accepts it (`ActivityGeneration.acceptVideo`).
 *
 * The browser launcher is a port, so a test drives a fake and never starts a browser.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import { hostOnly } from "../services/preview-token.js";
import type { BrowserLauncher } from "./browser-session.js";
import { COMPOSITION_FILE } from "./composition.js";
import { compositionBase, type ActivityCompositions } from "./composition-service.js";
import type { CompositionCandidate } from "./composition-types.js";
import type { ActivityRun } from "./domain.js";
import { loopbackAuthority, type TestBrowser } from "./test-browser.js";
import { RenderError, WebmError, readVideoFile, renderComposition } from "./video-render.js";
import type { VideoProblemCode, VideoTarget } from "./video-types.js";

/** Where a run's recorder writes, inside its workspace; removed once the recording is kept. */
export const RECORDING_DIR = "recording";

/**
 * The parts of a recording that touch the outside world. Absent, the real ones are used; a
 * test stands in a fake launcher so no browser starts.
 */
export abstract class VideoRenderPorts extends Interface<{
  /** Starts the browser; `playwright-core`'s Chromium by default. */
  launcher?: BrowserLauncher;
  /** How long each page step may take; 30 s by default. A test shortens it. */
  pageTimeoutMs?: number;
}>() {}

/** The code a failed recording is worded by, for the causes Penguin knows; null otherwise. */
function problemOf(error: unknown): VideoProblemCode | null {
  if (error instanceof RenderError || error instanceof WebmError) return error.code;
  if (error instanceof HttpError && error.code === "video_invalid") return "video_invalid";
  return null;
}

class RecordingStopped extends Error {}

@Component()
export class DefaultVideoRenderPorts implements VideoRenderPorts {}

export abstract class ActivityVideoRenders extends Interface<{
  /**
   * Starts recording a kept composition and answers at once with the run; the recording
   * happens after. 403 `experiment_off` while the experiment is off; 409
   * `video_composition_missing` when the composition run kept nothing to record; 409
   * `video_asset_changed` when its asset is gone; 409 `test_browser_missing` without the test
   * browser; 409 `generation_running` while another run is going.
   */
  start(
    projectId: string,
    activityId: string,
    input: { compositionRunId: string; expectedRevision: string },
  ): Promise<ActivityRun>;
}>() {}

@Component()
export class ActivityVideoRenderService implements ActivityVideoRenders {
  @Use() private readonly config!: Config;
  @Use() private readonly browser!: TestBrowser;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly compositions!: ActivityCompositions;
  @Use() private readonly ports!: VideoRenderPorts;
  @Use() private readonly log!: Log;

  private stopped = false;
  /**
   * Activities whose recording is still driving the browser. A cancelled run releases the
   * one-run rule at once, but its browser plays on to the end; until then a new recording of
   * the same activity waits its turn.
   */
  private readonly recording = new Set<string>();

  setup({ effect }: ClassCtx) {
    effect(() => {
      this.stopped = true;
    });
  }

  async start(
    projectId: string,
    activityId: string,
    input: { compositionRunId: string; expectedRevision: string },
  ): Promise<ActivityRun> {
    if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
    // Refused first, whatever else is wrong, so an author always learns the experiment is off.
    if (!this.generation.videoExperiment())
      throw new HttpError(
        403,
        "experiment_off",
        "Scene videos are an experiment an admin has not turned on.",
      );
    const activity = await this.activities.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== input.expectedRevision)
      throw new HttpError(
        409,
        "draft_conflict",
        "The draft changed. Reload it before recording a video.",
      );
    const missing = () =>
      new HttpError(
        409,
        "video_composition_missing",
        "Record a video from a composed scene: compose the scene first.",
      );
    const composition = await this.generation
      .run(projectId, activityId, input.compositionRunId)
      .catch((error: unknown) => {
        if (error instanceof HttpError && error.code === "run_not_found") throw missing();
        throw error;
      });
    if (
      composition.kind !== "composition" ||
      composition.status !== "succeeded" ||
      !composition.composition ||
      !composition.candidate
    )
      throw missing();
    const kept = JSON.parse(composition.candidate) as CompositionCandidate;
    const { language, assetKey, width, height } = composition.composition;
    const asset = activity.draft.mediaPlan?.manifest.assets[language]?.find(
      (entry) => entry.key === assetKey,
    );
    if (!asset || (asset.type !== "video" && asset.type !== "animation"))
      throw new HttpError(
        409,
        "video_asset_changed",
        "The video or animation this scene was composed for is no longer in the media plan.",
      );
    const executable = await this.browser.executablePath();
    if (!executable)
      throw new HttpError(
        409,
        "test_browser_missing",
        "The test browser is not installed. An admin installs it in System settings.",
      );
    if (this.config.port === 0)
      throw new HttpError(503, "server_not_listening", "The server has not started listening yet.");
    if (this.recording.has(activityId))
      throw new HttpError(
        409,
        "generation_running",
        "This activity already has a running generation.",
      );
    // A link for the browser on this machine, which holds no App session: not sandboxed, as
    // a quality check's play link is not.
    const authority = loopbackAuthority(this.config);
    const { token } = await this.compositions.link(
      projectId,
      activityId,
      input.compositionRunId,
      hostOnly(authority),
      false,
    );
    const target: VideoTarget = {
      language,
      assetKey,
      compositionRunId: input.compositionRunId,
      width,
      height,
      seconds: kept.seconds,
    };
    const run = await this.generation.openDeterministic(projectId, activityId, "video", {
      video: target,
    });
    this.recording.add(activityId);
    const url = `http://${authority}${compositionBase(token)}${COMPOSITION_FILE}`;
    void this.record(run, executable, url, target).finally(() => this.recording.delete(activityId));
    return run;
  }

  private async record(
    run: ActivityRun,
    executable: string,
    url: string,
    target: VideoTarget,
  ): Promise<void> {
    const { projectId, activityId, runId } = run;
    const dir = path.join(this.config.root, "activity-runs", runId, RECORDING_DIR);
    try {
      const file = await renderComposition({
        executablePath: executable,
        compositionUrl: url,
        width: target.width,
        height: target.height,
        seconds: target.seconds,
        dir,
        ...(this.ports.launcher ? { launcher: this.ports.launcher } : {}),
        ...(this.ports.pageTimeoutMs ? { pageTimeoutMs: this.ports.pageTimeoutMs } : {}),
      });
      if (this.stopped)
        throw new RecordingStopped("The server stopped before the recording finished.");
      // Cancelled by the author while it played: nothing is kept.
      if (!(await this.generation.isRunning(projectId, activityId, runId))) return;
      const result = await this.activities.storeVideo(
        projectId,
        activityId,
        runId,
        await readVideoFile(file),
      );
      const settled = await this.generation.settleDeterministic(
        projectId,
        activityId,
        runId,
        "succeeded",
        null,
        JSON.stringify(result),
      );
      // Cancelled, or the server stopped, while it was being kept: the run does not own it.
      if (!settled)
        await this.activities.discardVideo(projectId, activityId, runId).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.line(`[activities] Video recording ${runId} failed: ${message}`);
      const problem = error instanceof RecordingStopped ? "video_stopped" : problemOf(error);
      await this.generation
        .settleDeterministic(
          projectId,
          activityId,
          runId,
          "failed",
          message.slice(0, 500),
          undefined,
          problem ?? undefined,
        )
        .catch(() => {});
    } finally {
      // The recording was copied into the draft, or is not wanted.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
