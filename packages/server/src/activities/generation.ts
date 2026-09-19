import fs from "node:fs/promises";
import path from "node:path";
import { validateBookSpec } from "./book.js";

import { userText, libraryPlugin } from "@prismshadow/penguin-core";
import { Component, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Db, Channels, Log } from "../hmr/capabilities.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { ProjectActivityWork } from "../mechanisms/projects.js";
import type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import { HttpError } from "../http/errors.js";
import { ActivityLocks, atomicJson } from "./service.js";
import { AUDIO_MAX_BYTES, audioTarget, audioPrompt, type AudioResult } from "./audio.js";
import { readArtifactBytes } from "./artifact.js";
import {
  GENERATED_IMAGE_MAX_BYTES,
  imageTarget,
  imagePrompt,
  type ImageResult,
} from "./generated-image.js";
import {
  findWafRoot,
  prepareModule,
  collectModule,
  modulePrompt,
  verifyMediaArtifacts,
} from "./waf-module.js";
import { mediaTextPrompt, mediaTextTarget, parseMediaTextCandidate } from "./media-text.js";
import {
  newId,
  validateActivitySpec,
  type ActivityRun,
  type ActivityRunSummary,
} from "./domain.js";

const MAX_CANDIDATE_BYTES = 2 * 1024 * 1024;
interface Observer {
  unsubscribe: () => void;
  completed: boolean;
  error: string | null;
}

@Component()
export class ActivityGenerationService implements ActivityGeneration {
  @Use() private readonly projectWork!: ProjectActivityWork;
  @Use() private readonly config!: Config;
  @Use() private readonly db!: Db;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly agents!: AgentConfig;
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly channels!: Channels;
  @Use() private readonly log!: Log;
  private readonly locks = new ActivityLocks();
  private readonly observers = new Map<string, Observer>();
  private readonly operations = new Set<Promise<unknown>>();
  private stopped = false;
  private drained: Promise<void> | null = null;
  private tick: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  setup({ effect }: ClassCtx) {
    // A restart or hot replacement cannot prove an old task finished. Preserve its
    // workspace and record the uncertainty; retry always creates a new attempt.
    for (const run of this.running())
      this.finish(run, "interrupted", "Server restarted. Review the session and retry explicitly.");
    this.timer = setInterval(() => {
      if (!this.tick && !this.stopped) {
        this.tick = this.reconcile()
          .catch((error: unknown) => {
            this.log.line(`[activities] Generation reconciliation failed: ${String(error)}`);
          })
          .finally(() => {
            this.tick = null;
          });
      }
    }, 1000);
    this.timer.unref();
    effect(() => this.stop());
  }

  private stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const observer of this.observers.values()) observer.unsubscribe();
    this.observers.clear();
    // Effects seal admissions synchronously. The App awaits shutdown's drain before
    // closing the DB or booting a successor, so an entered publication can commit its
    // matching terminal record before the remaining attempts become interrupted.
    const finishRemaining = () => {
      for (const run of this.running())
        this.finish(run, "interrupted", "Server stopped before the result was published.");
    };
    if (this.operations.size) {
      this.drained = Promise.allSettled([...this.operations]).then(finishRemaining);
    } else {
      finishRemaining();
      this.drained = Promise.resolve();
    }
  }
  async shutdown(): Promise<void> {
    this.stop();
    await this.drained;
  }

  private workspace(run: ActivityRun): string {
    return path.join(this.config.root, "activity-runs", run.runId);
  }
  private kind(runId: string): ActivityRun["kind"] {
    if (this.db.prepare("SELECT 1 FROM activity_media_text_runs WHERE run_id = ?").get(runId))
      return "media-text";
    if (this.db.prepare("SELECT 1 FROM activity_image_runs WHERE run_id = ?").get(runId))
      return "image";
    if (this.db.prepare("SELECT 1 FROM activity_audio_runs WHERE run_id = ?").get(runId))
      return "audio";
    return this.db.prepare("SELECT 1 FROM activity_module_runs WHERE run_id = ?").get(runId)
      ? "module"
      : "spec";
  }
  private save(run: ActivityRun) {
    const { candidate, kind: _kind, ...metadata } = run;
    this.db.exec("BEGIN");
    try {
      const hasCandidate =
        candidate !== null ||
        !!this.db.prepare("SELECT 1 FROM activity_run_candidates WHERE run_id = ?").get(run.runId);
      const result = this.db
        .prepare("UPDATE activity_runs SET status = ?, record_json = ? WHERE run_id = ?")
        .run(run.status, JSON.stringify({ ...metadata, hasCandidate }), run.runId);
      if (result.changes && candidate !== null)
        this.db
          .prepare(
            "INSERT INTO activity_run_candidates (run_id, candidate) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET candidate = excluded.candidate",
          )
          .run(run.runId, candidate);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private running(): ActivityRun[] {
    return (
      this.db.prepare("SELECT record_json FROM activity_runs WHERE status = 'running'").all() as {
        record_json: string;
      }[]
    ).map((row) => {
      const metadata = JSON.parse(row.record_json) as ActivityRunSummary;
      return { ...metadata, kind: this.kind(metadata.runId), candidate: null };
    });
  }
  private finish(run: ActivityRun, status: ActivityRun["status"], error: string | null = null) {
    run.status = status;
    run.error = error;
    run.finishedAt = new Date().toISOString();
    this.save(run);
    this.observers.get(run.runId)?.unsubscribe();
    this.observers.delete(run.runId);
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }

  async list(projectId: string, activityId: string): Promise<ActivityRunSummary[]> {
    await this.activities.getActivity(projectId, activityId);
    return (
      this.db
        .prepare(
          "SELECT record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? ORDER BY created_at DESC, run_id DESC LIMIT 50",
        )
        .all(projectId, activityId) as { record_json: string }[]
    ).map((row) => {
      const metadata = JSON.parse(row.record_json) as ActivityRunSummary;
      return { ...metadata, kind: this.kind(metadata.runId) };
    });
  }

  private async getRun(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    await this.activities.getActivity(projectId, activityId);
    const row = this.db
      .prepare(
        "SELECT record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? AND run_id = ?",
      )
      .get(projectId, activityId, runId) as { record_json: string } | undefined;
    if (!row) throw new HttpError(404, "run_not_found", "Generation not found.");
    const payload = this.db
      .prepare("SELECT candidate FROM activity_run_candidates WHERE run_id = ?")
      .get(runId) as { candidate: string } | undefined;
    const { hasCandidate: _, ...metadata } = JSON.parse(row.record_json) as ActivityRunSummary;
    return { ...metadata, kind: this.kind(runId), candidate: payload?.candidate ?? null };
  }

  async candidate(projectId: string, activityId: string, runId: string): Promise<string | null> {
    return (await this.getRun(projectId, activityId, runId)).candidate;
  }

  start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    module?: {
      wafRoot?: string;
      audio?: { language: string; assetKey: string; voice: string };
      image?: { language: string; assetKey: string };
      mediaText?: { language: string; assetKey: string };
    },
  ): Promise<ActivityRun> {
    return this.track(
      this.projectWork.run(projectId, () =>
        this.locks.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          const activity = await this.activities.getActivity(projectId, activityId);
          if (activity.draft.contentRevision !== expectedRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "Save or reload the draft before generating.",
            );
          if (!activity.draft.description.trim())
            throw new HttpError(
              400,
              "description_required",
              "Add a description before generating.",
            );
          let wafRoot: string | null = null;
          if (module && [module.audio, module.image, module.mediaText].filter(Boolean).length > 1)
            throw new HttpError(400, "generation_invalid", "Choose one media generation type.");
          const audio = module?.audio ? audioTarget(activity, module.audio) : undefined;
          const image = module?.image ? imageTarget(activity, module.image) : undefined;
          const mediaText = module?.mediaText
            ? mediaTextTarget(activity, module.mediaText)
            : undefined;
          if (module && !audio && !image && !mediaText) {
            if (!activity.draft.spec || activity.draft.status !== "valid")
              throw new HttpError(
                400,
                "module_spec_required",
                "Save a valid specification before assembling a module.",
              );
            if (activity.activityType === "book") {
              try {
                validateBookSpec(validateActivitySpec(activity.draft.spec));
              } catch (error) {
                throw new HttpError(422, "spec_invalid", (error as Error).message);
              }
            }
            wafRoot = await findWafRoot(process.cwd(), module.wafRoot ?? process.env.WAF_ROOT_DIR);
            if (!wafRoot)
              throw new HttpError(
                400,
                "waf_checkout_missing",
                "WAF checkout not found. Select a root containing framework, modules and media.",
              );
          }
          await this.agents.requireExists(projectId, agentId);
          if (
            (audio || image) &&
            !(await this.agents.getVault(projectId, agentId)).entries.some(
              (entry) => entry.key === "GEMINI_API_KEY",
            )
          )
            throw new HttpError(
              400,
              image ? "image_credential_missing" : "speech_credential_missing",
              `Add GEMINI_API_KEY to the selected Agent's Vault before generating ${image ? "an image" : "speech"}.`,
            );
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          if (this.running().some((run) => run.activityId === activityId))
            throw new HttpError(
              409,
              "generation_running",
              "This activity already has a running generation.",
            );
          const run: ActivityRun = {
            kind: mediaText
              ? "media-text"
              : image
                ? "image"
                : audio
                  ? "audio"
                  : module
                    ? "module"
                    : "spec",
            ...(audio ? { audio } : {}),
            ...(image ? { image } : {}),
            ...(mediaText ? { mediaText } : {}),
            runId: newId("run"),
            activityId,
            projectId,
            draftId: activity.draft.draftId,
            inputRevision: activity.draft.contentRevision,
            agentId,
            sessionId: null,
            status: "running",
            createdAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
            candidate: null,
          };
          const { candidate: _candidate, kind: _kind, ...metadata } = run;
          this.db.exec("BEGIN");
          try {
            this.db
              .prepare(
                "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
              )
              .run(
                run.runId,
                projectId,
                activityId,
                run.status,
                run.createdAt,
                JSON.stringify({ ...metadata, hasCandidate: false }),
              );
            if (mediaText)
              this.db
                .prepare("INSERT INTO activity_media_text_runs (run_id) VALUES (?)")
                .run(run.runId);
            else if (image)
              this.db.prepare("INSERT INTO activity_image_runs (run_id) VALUES (?)").run(run.runId);
            else if (audio)
              this.db.prepare("INSERT INTO activity_audio_runs (run_id) VALUES (?)").run(run.runId);
            else if (module)
              this.db
                .prepare("INSERT INTO activity_module_runs (run_id) VALUES (?)")
                .run(run.runId);
            this.db.exec("COMMIT");
          } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
          }
          try {
            const workspace = this.workspace(run);
            await fs.mkdir(workspace, { recursive: true });
            // Requirement hashes track editorial changes, not media file bytes. They belong
            // to draft reconciliation; exposing them to a generator invites false checksum claims.
            const input = {
              ...activity,
              draft: {
                ...activity.draft,
                ...(activity.draft.mediaPlan
                  ? { mediaPlan: { manifest: activity.draft.mediaPlan.manifest } }
                  : {}),
              },
            };
            await atomicJson(path.join(workspace, "input.json"), input);
            await fs.writeFile(
              path.join(workspace, "description.md"),
              activity.draft.description,
              "utf8",
            );
            if (wafRoot) {
              await this.activities.prepareAudioMedia(
                projectId,
                activityId,
                workspace,
                expectedRevision,
              );
              await this.activities.prepareImageMedia(
                projectId,
                activityId,
                workspace,
                expectedRevision,
              );
              await prepareModule(workspace, activity, wafRoot);
            }
            if (audio || image) {
              const helperName = image ? "generate-image.mjs" : "generate-speech.mjs";
              const helper = libraryPlugin("agent-development")?.skills.find(
                (skill) => skill.name === "unified-llm-api",
              )?.files?.[`scripts/${helperName}`];
              if (!helper)
                throw new HttpError(
                  500,
                  image ? "image_helper_missing" : "speech_helper_missing",
                  "The installed media helper is missing. Rebuild the bundled plugins.",
                );
              await atomicJson(
                path.join(workspace, image ? "image-input.json" : "speech-input.json"),
                image ?? audio,
              );
              await atomicJson(path.join(workspace, "package.json"), {
                private: true,
                type: "module",
                dependencies: { "@prismshadow/agenthub": "0.4.15" },
              });
              await fs.writeFile(path.join(workspace, helperName), helper, {
                flag: "wx",
              });
            }
            if (mediaText)
              await atomicJson(path.join(workspace, "media-text-input.json"), mediaText);
            if (this.stopped) {
              this.finish(run, "interrupted", "Server stopped before generation started.");
              return run;
            }
            const session = await this.sessionService.createSession({
              projectId,
              agentId,
              workspace,
              approvalMode: "always-ask",
            });
            run.sessionId = session.sessionId;
            this.save(run);
            if (this.stopped) {
              this.finish(run, "interrupted", "Server stopped before generation started.");
              return run;
            }
            const observer: Observer = { unsubscribe: () => {}, completed: false, error: null };
            observer.unsubscribe = this.channels.get(session.sessionId).subscribe((event) => {
              if (event.event) return;
              const msg = JSON.parse(event.data) as {
                origin?: unknown[];
                payload?: { type?: string; status?: string; error_message?: string };
              };
              if (msg.origin?.length) return;
              const payload = msg.payload;
              if (payload?.type === "request_begin") observer.completed = false;
              if (payload?.type === "request_end") {
                observer.completed = payload.status === "completed";
                observer.error = observer.completed
                  ? null
                  : (payload.error_message ?? "The model request did not complete.");
              }
              if (payload?.type === "abort") {
                observer.completed = false;
                observer.error = "Session was stopped.";
              }
            });
            this.observers.set(run.runId, observer);
            await this.sessions.startTask(
              session.sessionId,
              [
                userText(
                  mediaText
                    ? mediaTextPrompt(mediaText)
                    : image
                      ? imagePrompt
                      : audio
                        ? audioPrompt
                        : module
                          ? modulePrompt
                          : generationPrompt,
                ),
              ],
              {
                queueIfBusy: false,
              },
            );
          } catch (error) {
            this.finish(
              run,
              this.stopped ? "interrupted" : "failed",
              error instanceof HttpError
                ? error.message
                : "Could not start generation. Check the agent and model configuration.",
            );
          }
          return run;
        }),
      ),
    );
  }

  cancel(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    return this.track(
      this.locks.run(activityId, async () => {
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        const run = await this.getRun(projectId, activityId, runId);
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        if (run.status === "running") {
          this.finish(run, "cancelled", "Generation cancelled.");
          if (run.sessionId) this.sessions.abortTask(run.sessionId);
        }
        return run;
      }),
    );
  }

  async audioContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "audio" || !run.candidate || !["succeeded", "conflict"].includes(run.status))
      throw new HttpError(404, "run_not_found", "Speech candidate not available.");
    const result = JSON.parse(run.candidate) as AudioResult;
    return this.activities.readAudio(projectId, activityId, runId, result.sha256);
  }
  async imageCandidateContent(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<Uint8Array> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "image" || !run.candidate || !["succeeded", "conflict"].includes(run.status))
      throw new HttpError(404, "run_not_found", "Image candidate not available.");
    const result = JSON.parse(run.candidate) as ImageResult;
    if (result.runId !== runId)
      throw new HttpError(409, "image_changed", "Image candidate metadata changed.");
    return this.activities.readImage(projectId, activityId, runId, result.sha256);
  }
  acceptImage(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.track(
      this.projectWork.run(projectId, () =>
        this.locks.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          const run = await this.getRun(projectId, activityId, runId);
          if (run.kind !== "image" || run.status !== "succeeded" || !run.image || !run.candidate)
            throw new HttpError(
              409,
              "image_changed",
              "Only a successful image candidate can be accepted.",
            );
          if (run.inputRevision !== expectedRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "The draft changed since image generation. Generate a new candidate.",
            );
          const result = JSON.parse(run.candidate) as ImageResult;
          if (result.runId !== runId)
            throw new HttpError(409, "image_changed", "Image candidate metadata changed.");
          return this.activities.applyImage(
            projectId,
            activityId,
            run.image,
            result,
            expectedRevision,
          );
        }),
      ),
    );
  }
  acceptMediaText(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.track(
      this.projectWork.run(projectId, () =>
        this.locks.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          const run = await this.getRun(projectId, activityId, runId);
          if (
            run.kind !== "media-text" ||
            run.status !== "succeeded" ||
            !run.mediaText ||
            !run.candidate
          )
            throw new HttpError(
              409,
              "media_text_changed",
              "Only a successful media text candidate can be accepted.",
            );
          if (run.inputRevision !== expectedRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "The draft changed since media text generation. Generate a new candidate.",
            );
          let text: string;
          try {
            text = parseMediaTextCandidate(run.candidate, run.mediaText);
          } catch {
            throw new HttpError(
              409,
              "media_text_changed",
              "The media text candidate is invalid. Generate a new candidate.",
            );
          }
          return this.activities.applyMediaText(
            projectId,
            activityId,
            run.mediaText,
            text,
            expectedRevision,
          );
        }),
      ),
    );
  }

  acceptAudio(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.track(
      this.projectWork.run(projectId, () =>
        this.locks.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          const run = await this.getRun(projectId, activityId, runId);
          if (run.kind !== "audio" || run.status !== "succeeded" || !run.audio || !run.candidate)
            throw new HttpError(
              409,
              "audio_changed",
              "Only a successful speech candidate can be accepted.",
            );
          if (run.inputRevision !== expectedRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "The draft changed since speech generation. Generate a new candidate.",
            );
          return this.activities.applyAudio(
            projectId,
            activityId,
            run.audio,
            JSON.parse(run.candidate) as AudioResult,
            expectedRevision,
          );
        }),
      ),
    );
  }

  /** Deterministic reconciliation entry used by the timer and lifecycle tests. */
  reconcile(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.track(this.collect());
  }

  private async collect(): Promise<void> {
    if (this.stopped) return;
    const active = this.running();
    const liveIds = new Set(active.map((run) => run.runId));
    for (const [runId, observer] of this.observers) {
      if (!liveIds.has(runId)) {
        observer.unsubscribe();
        this.observers.delete(runId);
      }
    }
    for (const initial of active) {
      await this.locks.run(initial.activityId, async () => {
        if (this.stopped) return;
        const run = this.running().find((item) => item.runId === initial.runId);
        if (
          !run ||
          !run.sessionId ||
          this.stopped ||
          this.sessions.statusOf(run.sessionId) !== "idle"
        )
          return;
        try {
          await this.sessions.atIdleBoundary(run.sessionId, async () => {
            const file = path.join(
              this.workspace(run),
              run.kind === "module"
                ? "module-result.json"
                : run.kind === "media-text"
                  ? "media-text.json"
                  : "activity-spec.json",
            );
            try {
              if (run.kind === "image") {
                const observer = this.observers.get(run.runId);
                if (!observer?.completed)
                  throw new Error(observer?.error ?? "Image Session did not complete.");
                const bytes = await readArtifactBytes(
                  path.join(this.workspace(run), "image.png"),
                  GENERATED_IMAGE_MAX_BYTES,
                );
                const result = await this.activities.storeImage(
                  run.projectId,
                  run.activityId,
                  run.runId,
                  bytes,
                );
                run.candidate = JSON.stringify(result);
                this.save(run);
                if (this.stopped) return;
                await this.projectWork.run(run.projectId, async () => {
                  const current = await this.activities.getActivity(run.projectId, run.activityId);
                  if (current.draft.contentRevision !== run.inputRevision)
                    throw new HttpError(
                      409,
                      "draft_conflict",
                      "The draft changed during image generation.",
                    );
                  this.finish(run, "succeeded");
                });
                return;
              }
              if (run.kind === "audio") {
                const observer = this.observers.get(run.runId);
                if (!observer?.completed)
                  throw new Error(observer?.error ?? "Speech Session did not complete.");
                const bytes = await readArtifactBytes(
                  path.join(this.workspace(run), "speech.wav"),
                  AUDIO_MAX_BYTES,
                );
                const result = await this.activities.storeAudio(
                  run.projectId,
                  run.activityId,
                  run.runId,
                  bytes,
                );
                run.candidate = JSON.stringify(result);
                this.save(run);
                await this.projectWork.run(run.projectId, async () => {
                  const current = await this.activities.getActivity(run.projectId, run.activityId);
                  if (current.draft.contentRevision !== run.inputRevision)
                    throw new HttpError(
                      409,
                      "draft_conflict",
                      "The draft changed during speech generation.",
                    );
                  this.finish(run, "succeeded");
                });
                return;
              }
              if (run.kind === "media-text") {
                const observer = this.observers.get(run.runId);
                if (!observer?.completed)
                  throw new Error(observer?.error ?? "Media text Session did not complete.");
                if (!run.mediaText) throw new Error("Media text target is missing.");
                const text = parseMediaTextCandidate(
                  await readCandidate(file, 64 * 1024),
                  run.mediaText,
                );
                run.candidate = JSON.stringify({ ...run.mediaText, text });
                this.save(run);
                if (this.stopped) return;
                await this.projectWork.run(run.projectId, async () => {
                  const current = await this.activities.getActivity(run.projectId, run.activityId);
                  if (current.draft.contentRevision !== run.inputRevision)
                    throw new HttpError(
                      409,
                      "draft_conflict",
                      "The draft changed during media text generation.",
                    );
                  this.finish(run, "succeeded");
                });
                return;
              }
              run.candidate = await readCandidate(file);
              this.save(run);
              if (this.stopped) return;
              const observer = this.observers.get(run.runId);
              if (!observer?.completed)
                throw new Error(
                  observer?.error ?? "The session ended without a confirmed completed request.",
                );
              if (run.kind === "module") {
                const input = await this.activities.getActivity(run.projectId, run.activityId);
                const requiredMediaFiles =
                  input.draft.mediaPlan && input.draft.contentRevision === run.inputRevision
                    ? [
                        `module/generated/${input.productCode}/refs/${input.productCode}-${input.refNum}/spec/asset_manifest.json`,
                        `module/configurations/${input.productCode}-${input.refNum}.json`,
                      ]
                    : [];
                const result = await collectModule(
                  this.workspace(run),
                  readCandidate,
                  requiredMediaFiles,
                );
                run.candidate = JSON.stringify(result);
                this.save(run);
                if (this.stopped) return;
                await this.projectWork.run(run.projectId, async () => {
                  if (input.draft.contentRevision === run.inputRevision)
                    await verifyMediaArtifacts(this.workspace(run), input, readCandidate);
                  const current = await this.activities.getActivity(run.projectId, run.activityId);
                  if (current.draft.contentRevision !== run.inputRevision)
                    throw new HttpError(
                      409,
                      "draft_conflict",
                      "The specification changed during assembly.",
                    );
                  this.finish(run, "succeeded");
                });
                return;
              }
              const spec = validateActivitySpec(JSON.parse(run.candidate));
              // Cancellation and completion share the activity lock. The authoring
              // service separately serializes this comparison against draft edits.
              if (this.stopped) return;
              await this.activities.applySpec(
                run.projectId,
                run.activityId,
                spec,
                run.inputRevision,
              );
              this.finish(run, "succeeded");
            } catch (error) {
              if (this.stopped && run.candidate === null) return;
              const conflict = error instanceof HttpError && error.code === "draft_conflict";
              const message =
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? `The session ended without ${
                      run.kind === "image"
                        ? "image.png"
                        : run.kind === "audio"
                          ? "speech.wav"
                          : run.kind === "module"
                            ? "module-result.json or a required artifact"
                            : run.kind === "media-text"
                              ? "media-text.json"
                              : "activity-spec.json"
                    }.`
                  : error instanceof Error
                    ? error.message
                    : "Could not collect generation output.";
              this.finish(run, conflict ? "conflict" : "failed", message);
            }
          });
        } catch {
          // A user may have resumed this session between the idle probe and its lock.
          // Leave the run active for the next tick.
        }
      });
    }
  }
}

/** Validate and read the same opened file; never reopen a task-controlled path to read it. */
export async function readCandidate(file: string, maxBytes = MAX_CANDIDATE_BYTES): Promise<string> {
  return (await readArtifactBytes(file, maxBytes)).toString("utf8");
}

const generationPrompt = `Generate a WAF HTML activity specification from description.md and input.json.
Work in this workspace. Write activity-spec.json as a JSON object, without Markdown fences.
Do not edit the input files or any activity collection. Do not delegate this task.
The specification contract:
- id: safe letters/numbers/dots/underscores/hyphens, starting and ending with a letter or number.
- title: non-empty string; activityDescription: string.
- moduleFolder, if present: waf-module- followed by a safe id.
- runtime: { "engine": "html", "layout": "mainOnly", "theme": "park", "resolution": "640x480", "usesAssessment": false }. Choose layout, theme and resolution appropriate to the description.
- scenes: a non-empty array of objects with string id and description.
- Optional scene media: images, video and animations arrays of { key, description, targetPath? } with string values.
- Optional scene audio: tracks array of { key, description, script?, targetPath?, interruptible? }; interruptible is boolean.
- Optional acceptance_criterias: string array; audience: null or { gradeBand: string or null }.
If input.json declares activityType book, scene order is page order. Give every page an explicit role: cover, title, or story. Cover is optional and first; title is optional and follows cover or is first; all remaining pages are story pages. Use unique scene IDs, exactly one image per page with a meaningful description, and no scene videos or animations. Each audio track must have a globally unique non-empty key. The first audio cue on a story page is its visible narration text and must contain words; later cues are hidden follow-up prompts. Cover/title lettering is baked into the image; story images contain no story text. Preserve authored narration order and wording.
Describe the actual learning flow, interactions, feedback and media needs. Preserve useful existing draft details in input.json.
Use Harness's normal approval flow for tool actions. Finish only after writing valid JSON.`;
