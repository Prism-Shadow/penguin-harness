import fs from "node:fs/promises";
import {
  RUN_FEATURES_FILE,
  featureClause,
  type ImplementationFeature,
} from "./implementation-features.js";
import path from "node:path";
import { validateBookSpec } from "./book.js";
import { compileBookConfiguration, type BookMode } from "./book-configuration.js";

import { userText, libraryPlugin } from "@prismshadow/penguin-core";
import { Component, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Db, Channels, Log } from "../hmr/capabilities.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import { CODING_AGENT_PROVIDER } from "../coding-agents/session-runtime.js";
import type { ProjectActivityWork } from "../mechanisms/projects.js";
import type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import { HttpError } from "../http/errors.js";
import { ActivityLocks, atomicJson } from "./service.js";
import {
  AUDIO_MAX_BYTES,
  SPEECH_OUTPUT_FILES,
  SPEECH_TIMINGS_FILE,
  audioTarget,
  speechPrompt,
  speechProviderOf,
  type AudioResult,
  type AudioTarget,
} from "./audio.js";
import { SOUND_OUTPUT_FILES, soundPrompt, soundTarget } from "./sound.js";
import { AGENTHUB_VERSION, SoundModelPorts } from "./sound-models.js";
import { soundProviderFor, soundSetup, speechProviderFor, speechSetup } from "./audio-providers.js";
import type { SoundFormat, SoundSetup } from "./sound-types.js";
import type { SpeechSetup } from "./speech-types.js";
import {
  ELEVENLABS_DEFAULT_VOICE,
  ELEVENLABS_VOICE_KEY,
  SPEECH_MODEL,
  SPEECH_VOICES,
  speechCatalogue,
} from "./voice-catalogue.js";
import { alignmentProblems, normalizeAlignment } from "./word-timings.js";
import { readArtifactBytes } from "./artifact.js";
import { soundPromptOf } from "./playback.js";
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
import {
  DISCARDED_PROPOSAL_FILE,
  PROPOSAL_FILE,
  PROPOSAL_MAX_BYTES,
  assistPrompt,
  parseAssistProposal,
  type AssistFocus,
  type AssistProposal,
} from "./assist.js";
import { mediaTextPrompt, mediaTextTarget, parseMediaTextCandidate } from "./media-text.js";
import { coverageProblem } from "./assessment-hints.js";
import { normalizeAssessment, parseHints, writtenItems } from "./assessment-document.js";
import { validateAssessment } from "./module-overrides.js";
import {
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_REPORT_DIR,
  ACCEPTANCE_REPORT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  HARNESS_VERSION,
  TEST_FILE_MAX_BYTES,
  acceptancePrompt,
  acceptanceReusePrompt,
  activityHarnessSource,
  runAcceptanceSource,
} from "./acceptance-harness.js";
import {
  RESULTS_MAX_BYTES,
  acceptanceReport,
  parseAcceptanceResults,
  testFileHash,
} from "./acceptance-collect.js";
import type { AcceptanceStage } from "./acceptance-types.js";
import {
  newId,
  contentRevision,
  validateActivitySpec,
  type ActivityRun,
  type ActivityRunSummary,
  type DeterministicRunKind,
} from "./domain.js";

const MAX_CANDIDATE_BYTES = 2 * 1024 * 1024;

/**
 * Whether a test run left the test file it was handed as it was: only then did it reuse the
 * earlier checks. False when it was handed none, or the file is gone or changed.
 */
async function testFileUnchanged(workspace: string, hash: string | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    const bytes = await readArtifactBytes(
      path.join(workspace, ACCEPTANCE_TEST_FILE),
      TEST_FILE_MAX_BYTES,
    );
    return testFileHash(bytes) === hash;
  } catch {
    return false;
  }
}

/**
 * The file a sound run must collect: the format its request named (a hub model's catalogued
 * format), else MP3, the only format ElevenLabs' helper writes. The other file being present
 * fails the run, so audio the helper did not write is never bound as the provider's
 * candidate. Its name only picks the check; the bytes must still pass it.
 */
async function soundOutputFormat(workspace: string, expected: SoundFormat): Promise<SoundFormat> {
  const other: SoundFormat = expected === "mp3" ? "wav" : "mp3";
  const stray = await fs
    .lstat(path.join(workspace, SOUND_OUTPUT_FILES[other]))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (stray)
    throw new Error(
      `The sound run wrote ${SOUND_OUTPUT_FILES[other]}, but its model returns ${SOUND_OUTPUT_FILES[expected]}.`,
    );
  return expected;
}
/**
 * The clip a speech run must collect: its provider's file. The other provider's file being
 * present fails the run, as for sounds, so a clip the chosen provider did not make is never
 * bound as its recording.
 */
async function speechOutputFile(workspace: string, target: AudioTarget): Promise<string> {
  const provider = speechProviderOf(target);
  const other = SPEECH_OUTPUT_FILES[provider === "gemini" ? "elevenlabs" : "gemini"];
  const stray = await fs
    .lstat(path.join(workspace, other))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (stray)
    throw new Error(
      `The speech run wrote ${other}, but its provider returns ${SPEECH_OUTPUT_FILES[provider]}.`,
    );
  return SPEECH_OUTPUT_FILES[provider];
}

/** Word timings are small; a sidecar past this is not one. */
const SPEECH_TIMINGS_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The word timings a speech helper wrote beside its clip, checked against the script it
 * spoke, or undefined when it wrote none (a provider without timestamps). Timings that do
 * not fit the script fail the run rather than bind a read-along that highlights the wrong
 * words.
 */
async function speechTimings(workspace: string, script: string) {
  let text: string;
  try {
    text = (
      await readArtifactBytes(path.join(workspace, SPEECH_TIMINGS_FILE), SPEECH_TIMINGS_MAX_BYTES)
    ).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${SPEECH_TIMINGS_FILE} is not JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${SPEECH_TIMINGS_FILE} must be a list of timings.`);
  const timings = normalizeAlignment(script, parsed);
  if (!timings)
    throw new Error(
      `The provider's word timings do not fit the script: ${alignmentProblems(script, parsed)[0]}`,
    );
  return timings;
}

interface Observer {
  unsubscribe: () => void;
  completed: boolean;
  error: string | null;
}

/** The shared WAF checkout, as an assembly may read it but never change it. */
function checkoutRoot(wafRoot: string) {
  return { root: wafRoot, label: "the shared WAF checkout" };
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
  @Use() private readonly soundModels!: SoundModelPorts;
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
      this.db
        .prepare("SELECT kind, record_json FROM activity_runs WHERE status = 'running'")
        .all() as {
        kind: ActivityRun["kind"];
        record_json: string;
      }[]
    ).map((row) => {
      const metadata = JSON.parse(row.record_json) as ActivityRunSummary;
      return { ...metadata, kind: row.kind, candidate: null };
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
          "SELECT kind, record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? ORDER BY created_at DESC, run_id DESC LIMIT 50",
        )
        .all(projectId, activityId) as { kind: ActivityRun["kind"]; record_json: string }[]
    ).map((row) => {
      const metadata = JSON.parse(row.record_json) as ActivityRunSummary;
      return { ...metadata, kind: row.kind };
    });
  }

  private async getRun(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    await this.activities.getActivity(projectId, activityId);
    const row = this.db
      .prepare(
        "SELECT kind, record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? AND run_id = ?",
      )
      .get(projectId, activityId, runId) as
      { kind: ActivityRun["kind"]; record_json: string } | undefined;
    if (!row) throw new HttpError(404, "run_not_found", "Generation not found.");
    const payload = this.db
      .prepare("SELECT candidate FROM activity_run_candidates WHERE run_id = ?")
      .get(runId) as { candidate: string } | undefined;
    const { hasCandidate: _, ...metadata } = JSON.parse(row.record_json) as ActivityRunSummary;
    return { ...metadata, kind: row.kind, candidate: payload?.candidate ?? null };
  }

  /**
   * What an assist run's agent last proposed, read fresh each time: the Session goes on
   * after the run finishes, and each reply may replace the proposal. Null with no error
   * when there is none yet; an error, and no proposal, when the file is not one the studio
   * could apply.
   */
  async proposal(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<{ proposal: AssistProposal | null; error: string | null }> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "assist")
      throw new HttpError(404, "run_not_found", "That run is not a conversation.");
    let raw: string;
    try {
      raw = await readCandidate(path.join(this.workspace(run), PROPOSAL_FILE), PROPOSAL_MAX_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { proposal: null, error: null };
      return { proposal: null, error: (error as Error).message };
    }
    try {
      return { proposal: parseAssistProposal(raw), error: null };
    } catch (error) {
      return { proposal: null, error: (error as Error).message };
    }
  }

  async discardProposal(projectId: string, activityId: string, runId: string): Promise<void> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "assist")
      throw new HttpError(404, "run_not_found", "That run is not a conversation.");
    const workspace = this.workspace(run);
    // Renamed, not deleted: what the agent proposed stays with the rest of its run.
    await fs
      .rename(path.join(workspace, PROPOSAL_FILE), path.join(workspace, DISCARDED_PROPOSAL_FILE))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }

  /** Which sound providers the agent can use now, judged by the keys its Vault holds. */
  async soundSetup(projectId: string, agentId: string): Promise<SoundSetup> {
    await this.agents.requireExists(projectId, agentId);
    const keys = (await this.agents.getVault(projectId, agentId)).entries.map((entry) => entry.key);
    return { providers: soundSetup(keys, this.soundModels.agenthubModels) };
  }

  /**
   * The voices and speech providers the picker offers. With an agent, which providers its
   * Vault has keys for and whether it names a default ElevenLabs voice: key names only, a
   * value is never read.
   */
  async speechSetup(projectId: string, agentId?: string): Promise<SpeechSetup> {
    const base = {
      provider: "Gemini",
      model: SPEECH_MODEL,
      voices: SPEECH_VOICES,
      vaultKey: "GEMINI_API_KEY",
    };
    if (!agentId) return { ...base, catalogue: speechCatalogue(null) };
    await this.agents.requireExists(projectId, agentId);
    const keys = (await this.agents.getVault(projectId, agentId)).entries.map((entry) => entry.key);
    return { ...base, catalogue: speechCatalogue(keys), providers: speechSetup(keys) };
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
      bookMode?: string;
      audio?: {
        language: string;
        assetKey: string;
        voice: string;
        provider?: string;
        model?: string;
      };
      sound?: { language: string; assetKey: string; provider: string; model?: string };
      image?: { language: string; assetKey: string };
      mediaText?: { language: string; assetKey: string };
      assist?: { message: string; focus: AssistFocus | null };
      /** An assessment run, given the assessment in effect now (null when there is none). */
      assessment?: { current: Record<string, unknown> | null };
      /** An acceptance test run, as the acceptance service prepared it. */
      test?: AcceptanceStage;
    },
    runtime?: { codingAgentId?: string },
  ): Promise<ActivityRun> {
    const codingAgentId = runtime?.codingAgentId;
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
          const assist = module?.assist;
          const assessment = module?.assessment;
          const test = module?.test;
          // An author may ask for help writing the script, so an empty one is no reason
          // to refuse a conversation; an assessment is written from the specification, and
          // tests from its acceptance criteria.
          if (!assist && !assessment && !test && !activity.draft.description.trim())
            throw new HttpError(
              400,
              "description_required",
              "Add a description before generating.",
            );
          let wafRoot: string | null = null;
          let bookMode: BookMode | undefined;
          if (
            module &&
            [
              module.audio,
              module.sound,
              module.image,
              module.mediaText,
              module.assist,
              module.assessment,
              module.test,
            ].filter(Boolean).length > 1
          )
            throw new HttpError(400, "generation_invalid", "Choose one media generation type.");
          const audio = module?.audio ? audioTarget(activity, module.audio) : undefined;
          const sound = module?.sound
            ? soundTarget(activity, module.sound, this.soundModels.agenthubModels)
            : undefined;
          const image = module?.image ? imageTarget(activity, module.image) : undefined;
          const mediaText = module?.mediaText
            ? mediaTextTarget(activity, module.mediaText)
            : undefined;
          if (assessment) {
            if (!activity.draft.spec || activity.draft.status !== "valid")
              throw new HttpError(
                400,
                "assessment_spec_required",
                "Save a valid specification before generating the assessment.",
              );
            const runtime = activity.draft.spec.runtime as { usesAssessment?: unknown } | undefined;
            if (runtime?.usesAssessment !== true)
              throw new HttpError(
                409,
                "assessment_unused",
                "The specification says this activity has no assessment.",
              );
            // Every ref of the product shares one assessment, and only the canonical ref owns it.
            if (!this.activities.isCanonicalRef(activity))
              throw new HttpError(
                409,
                "not_canonical",
                "The assessment is shared by every ref of this product. Generate it on the canonical ref.",
              );
          }
          if (test && (!activity.draft.spec || activity.draft.status !== "valid"))
            throw new HttpError(
              400,
              "test_spec_required",
              "Save a valid specification before running the acceptance tests.",
            );
          if (
            module &&
            !audio &&
            !sound &&
            !image &&
            !mediaText &&
            !assist &&
            !assessment &&
            !test
          ) {
            if (!activity.draft.spec || activity.draft.status !== "valid")
              throw new HttpError(
                400,
                "module_spec_required",
                "Save a valid specification before assembling a module.",
              );
            if (activity.activityType === "book") {
              try {
                validateBookSpec(validateActivitySpec(activity.draft.spec));
                if (module.bookMode !== "readAlong" && module.bookMode !== "decodable")
                  throw new Error("Choose Read-along or Decodable before assembling a book.");
                bookMode = module.bookMode;
                if (
                  !activity.draft.mediaPlan ||
                  activity.draft.mediaPlan.specRevision !== contentRevision(activity.draft.spec)
                )
                  throw new Error("Rebuild the media plan before assembling a book.");
                compileBookConfiguration(activity, bookMode, activity.draft.mediaPlan.manifest);
              } catch (error) {
                throw new HttpError(422, "spec_invalid", (error as Error).message);
              }
            }
            if (activity.activityType !== "book" && module.bookMode !== undefined)
              throw new HttpError(400, "book_mode_invalid", "Reading mode only applies to books.");
            // Module code belongs to the product, and only its canonical ref may change it.
            // A non-canonical ref is configuration on top of a module someone else owns, so
            // assembling from it would quietly rewrite that shared module.
            if (!this.activities.isCanonicalRef(activity)) {
              const product = this.activities.productOf(activity);
              throw new HttpError(
                409,
                "ref_not_canonical",
                `This activity shares its module with ref ${product?.canonicalRefNum}, which owns the module code. Assemble from that ref instead.`,
              );
            }
            wafRoot = await findWafRoot(process.cwd(), module.wafRoot ?? process.env.WAF_ROOT_DIR);
            if (!wafRoot)
              throw new HttpError(
                400,
                "waf_checkout_missing",
                "WAF checkout not found. Select a root containing framework, modules and media.",
              );
          }
          if (codingAgentId && (audio || image || sound))
            // Each calls its provider through a helper that reads the key from a Penguin
            // agent's Vault, which an external agent's process never sees.
            throw new HttpError(
              400,
              "runtime_unsupported",
              `${image ? "Image" : sound ? "Sound" : "Speech"} generation runs on a Penguin agent. Choose one instead of a coding agent.`,
            );
          // A coding agent's run is still a Session, filed under a Penguin Agent: the one
          // named, or the Project's default Agent when only the coding agent was.
          const owner = agentId || (codingAgentId ? "default_agent" : agentId);
          await this.agents.requireExists(projectId, owner);
          if (
            !codingAgentId &&
            image &&
            !(await this.agents.getVault(projectId, agentId)).entries.some(
              (entry) => entry.key === "GEMINI_API_KEY",
            )
          )
            throw new HttpError(
              400,
              "image_credential_missing",
              "Add GEMINI_API_KEY to the selected Agent's Vault before generating an image.",
            );
          if (audio) {
            const keys = (await this.agents.getVault(projectId, agentId)).entries.map(
              (entry) => entry.key,
            );
            // The provider the run names is honoured strictly: without its key the run is
            // refused, naming the key, and never spoken by another provider instead.
            const choice = speechProviderFor({ speechProvider: speechProviderOf(audio) }, keys);
            if ("problem" in choice) {
              const credential = "credential" in choice ? choice.credential : undefined;
              // The key travels as data too, so the App names it in its own words.
              throw new HttpError(
                400,
                "speech_credential_missing",
                `Add ${credential ?? "the provider's key"} to the selected Agent's Vault before generating speech.`,
                undefined,
                credential ? { credential } : undefined,
              );
            }
            if (audio.voice === ELEVENLABS_DEFAULT_VOICE && !keys.includes(ELEVENLABS_VOICE_KEY))
              throw new HttpError(
                400,
                "speech_voice_missing",
                `Add ${ELEVENLABS_VOICE_KEY} to the selected Agent's Vault, or type an ElevenLabs voice id, before generating speech.`,
              );
          }
          if (sound) {
            const keys = (await this.agents.getVault(projectId, agentId)).entries.map(
              (entry) => entry.key,
            );
            // The model the author named, or, with none named, the first the Vault has a key
            // for, as setup reports it. The target's model was chosen before the keys were
            // known, so the choice made here replaces it.
            const choice = soundProviderFor(
              sound.sound.kind,
              sound.sound.provider,
              keys,
              module?.sound?.model,
              this.soundModels.agenthubModels,
            );
            if ("problem" in choice)
              throw new HttpError(
                400,
                "sound_credential_missing",
                `Add ${choice.credential ?? "the provider's key"} to the selected Agent's Vault before generating a sound.`,
              );
            sound.model = choice.model;
            sound.sound.model = choice.model;
            delete sound.sound.credential;
            delete sound.sound.format;
            if (choice.format) {
              sound.sound.credential = choice.credential;
              sound.sound.format = choice.format;
            }
          }
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          if (this.running().some((run) => run.activityId === activityId))
            throw new HttpError(
              409,
              "generation_running",
              "This activity already has a running generation.",
            );
          const run: ActivityRun = {
            kind: test
              ? "test"
              : assist
                ? "assist"
                : assessment
                  ? "assessment"
                  : mediaText
                    ? "media-text"
                    : image
                      ? "image"
                      : audio || sound
                        ? "audio"
                        : module
                          ? "module"
                          : "spec",
            ...(audio ? { audio } : sound ? { audio: sound } : {}),
            ...(image ? { image } : {}),
            ...(mediaText ? { mediaText } : {}),
            ...(assist ? { assist: { focus: assist.focus } } : {}),
            ...(test
              ? {
                  test: {
                    criteria: test.input.criteria,
                    specRevision: test.input.specRevision,
                    harnessVersion: HARNESS_VERSION,
                    reused: test.cachedTest !== null,
                    ...(test.cachedTest !== null
                      ? { cachedTestHash: testFileHash(test.cachedTest) }
                      : {}),
                  },
                }
              : {}),
            ...(bookMode ? { bookMode } : {}),
            runId: newId("run"),
            activityId,
            projectId,
            draftId: activity.draft.draftId,
            inputRevision: activity.draft.contentRevision,
            agentId: owner,
            ...(codingAgentId ? { codingAgentId } : {}),
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
                "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                run.runId,
                projectId,
                activityId,
                run.status,
                run.createdAt,
                run.kind,
                JSON.stringify({ ...metadata, hasCandidate: false }),
              );
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
              ...(bookMode ? { bookMode } : {}),
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
              await this.activities.prepareUploadedMedia(
                projectId,
                activityId,
                workspace,
                expectedRevision,
              );
              await prepareModule(workspace, activity, wafRoot, bookMode);
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
              // ElevenLabs is called with Node's own fetch, so nothing is installed for it;
              // images and Gemini speech go through agenthub.
              await atomicJson(path.join(workspace, "package.json"), {
                private: true,
                type: "module",
                ...(audio && speechProviderOf(audio) === "elevenlabs"
                  ? {}
                  : { dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION } }),
              });
              await fs.writeFile(path.join(workspace, helperName), helper, {
                flag: "wx",
              });
            }
            if (sound) {
              const helper = libraryPlugin("agent-development")?.skills.find(
                (skill) => skill.name === "unified-llm-api",
              )?.files?.["scripts/generate-sound.mjs"];
              if (!helper)
                throw new HttpError(
                  500,
                  "sound_helper_missing",
                  "The installed media helper is missing. Rebuild the bundled plugins.",
                );
              await atomicJson(path.join(workspace, "sound-input.json"), sound.sound);
              // ElevenLabs is called with Node's own fetch, so nothing is installed for it; a
              // hub model needs agenthub, and only that branch loads it.
              await atomicJson(path.join(workspace, "package.json"), {
                private: true,
                type: "module",
                ...(sound.sound.provider === "agenthub"
                  ? { dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION } }
                  : {}),
              });
              await fs.writeFile(path.join(workspace, "generate-sound.mjs"), helper, {
                flag: "wx",
              });
            }
            if (mediaText)
              await atomicJson(path.join(workspace, "media-text-input.json"), mediaText);
            if (assessment) {
              const skill = libraryPlugin("waf-authoring")?.skills.find(
                (entry) => entry.name === ASSESSMENT_SKILL,
              )?.content;
              if (!skill)
                throw new HttpError(
                  500,
                  "assessment_skill_missing",
                  "The installed assessment skill is missing. Rebuild the bundled plugins.",
                );
              await atomicJson(path.join(workspace, "activity-spec.json"), activity.draft.spec);
              if (assessment.current)
                await atomicJson(
                  path.join(workspace, "current-assessment.json"),
                  assessment.current,
                );
              await fs.writeFile(path.join(workspace, ASSESSMENT_SKILL_FILE), skill, {
                flag: "wx",
              });
            }
            if (test) {
              await atomicJson(path.join(workspace, "activity-spec.json"), activity.draft.spec);
              await atomicJson(path.join(workspace, ACCEPTANCE_INPUT_FILE), test.input);
              await atomicJson(path.join(workspace, "package.json"), {
                private: true,
                type: "module",
                dependencies: { "playwright-core": test.playwrightVersion },
              });
              await fs.writeFile(
                path.join(workspace, ACCEPTANCE_HARNESS_FILE),
                activityHarnessSource,
                {
                  flag: "wx",
                },
              );
              await fs.writeFile(
                path.join(workspace, ACCEPTANCE_RUNNER_FILE),
                runAcceptanceSource,
                {
                  flag: "wx",
                },
              );
              // The same criteria as a run that already wrote their tests: reuse them as they are.
              if (test.cachedTest !== null)
                await fs.writeFile(path.join(workspace, ACCEPTANCE_TEST_FILE), test.cachedTest, {
                  flag: "wx",
                });
            }
            // An assembly is handed the implementation features its ref selected.
            let features: ImplementationFeature[] = [];
            if (
              module &&
              !audio &&
              !sound &&
              !image &&
              !mediaText &&
              !assist &&
              !assessment &&
              !test
            ) {
              const chosen = await this.activities.implementationFeatures(projectId, activityId);
              features = chosen.features.filter((feature) =>
                chosen.selectedIds.includes(feature.id),
              );
              if (features.length)
                await atomicJson(path.join(workspace, RUN_FEATURES_FILE), features);
            }
            if (this.stopped) {
              this.finish(run, "interrupted", "Server stopped before generation started.");
              return run;
            }
            const prompt = test
              ? test.cachedTest !== null
                ? acceptanceReusePrompt
                : acceptancePrompt
              : assist
                ? assistPrompt(assist.message, assist.focus)
                : assessment
                  ? assessmentPrompt
                  : mediaText
                    ? mediaTextPrompt(mediaText)
                    : image
                      ? imagePrompt
                      : audio
                        ? speechPrompt(audio)
                        : sound
                          ? soundPrompt
                          : module
                            ? modulePrompt + featureClause(features)
                            : generationPrompt;
            const session = await this.sessionService.createSession({
              projectId,
              agentId: owner,
              // A coding agent runs the stage as an ordinary Session of its own model: the
              // same Trace, approvals, completion signal and collection as a Penguin agent's.
              ...(codingAgentId ? { provider: CODING_AGENT_PROVIDER, modelId: codingAgentId } : {}),
              workspace,
              // The shared checkout is the module's source of truth and belongs to whoever
              // cloned it. An assembly Session reads the framework, navbar and media out of
              // it and must leave it exactly as it found it — a refusal rather than an
              // instruction, because an instruction is not a permission system and the
              // people approving these Sessions are not all engineers.
              ...(wafRoot ? { protectedRoots: [checkoutRoot(wafRoot)] } : {}),
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
            await this.sessions.startTask(session.sessionId, [userText(prompt)], {
              queueIfBusy: false,
            });
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

  openDeterministic(
    projectId: string,
    activityId: string,
    kind: DeterministicRunKind,
  ): Promise<ActivityRun> {
    return this.track(
      this.locks.run(activityId, async () => {
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        const activity = await this.activities.getActivity(projectId, activityId);
        if (this.running().some((run) => run.activityId === activityId))
          throw new HttpError(
            409,
            "generation_running",
            "This activity already has a running generation.",
          );
        const run: ActivityRun = {
          kind,
          runId: newId("run"),
          activityId,
          projectId,
          draftId: activity.draft.draftId,
          inputRevision: activity.draft.contentRevision,
          // Nobody's agent does this work; the server does.
          agentId: "",
          sessionId: null,
          status: "running",
          createdAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          candidate: null,
        };
        const { candidate: _candidate, kind: _kind, ...metadata } = run;
        this.db
          .prepare(
            "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            run.runId,
            projectId,
            activityId,
            run.status,
            run.createdAt,
            run.kind,
            JSON.stringify({ ...metadata, hasCandidate: false }),
          );
        await fs.mkdir(this.workspace(run), { recursive: true });
        return run;
      }),
    );
  }

  settleDeterministic(
    projectId: string,
    activityId: string,
    runId: string,
    status: "succeeded" | "failed",
    error: string | null,
  ): Promise<boolean> {
    return this.track(
      this.locks.run(activityId, async () => {
        if (this.stopped) return false;
        const run = await this.getRun(projectId, activityId, runId);
        if (run.status !== "running" || run.sessionId) return false;
        this.finish(run, status, error);
        return true;
      }),
    );
  }

  async isRunning(projectId: string, activityId: string, runId: string): Promise<boolean> {
    const row = this.db
      .prepare(
        "SELECT status FROM activity_runs WHERE project_id = ? AND activity_id = ? AND run_id = ?",
      )
      .get(projectId, activityId, runId) as { status: string } | undefined;
    return row?.status === "running";
  }

  async latestRun(
    projectId: string,
    activityId: string,
    kind: ActivityRun["kind"],
    status: ActivityRun["status"],
  ): Promise<ActivityRunSummary | null> {
    await this.activities.getActivity(projectId, activityId);
    const row = this.db
      .prepare(
        "SELECT kind, record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? AND kind = ? AND status = ? ORDER BY created_at DESC, run_id DESC LIMIT 1",
      )
      .get(projectId, activityId, kind, status) as
      { kind: ActivityRun["kind"]; record_json: string } | undefined;
    if (!row) return null;
    const metadata = JSON.parse(row.record_json) as ActivityRunSummary;
    return { ...metadata, kind: row.kind };
  }

  async audioContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array> {
    const run = await this.getRun(projectId, activityId, runId).catch((error: unknown) => {
      if (error instanceof HttpError && error.code === "run_not_found") return null;
      throw error;
    });
    if (!run) {
      // A ref made from its template keeps the template's accepted clips, but not the runs
      // that made them; a clip this draft binds is still this ref's to play.
      const activity = await this.activities.getActivity(projectId, activityId);
      const bound = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
        .flat()
        .find((asset) => asset.generatedAudio?.runId === runId)?.generatedAudio;
      if (!bound) throw new HttpError(404, "run_not_found", "Speech candidate not available.");
      return this.activities.readAudio(projectId, activityId, runId, bound.sha256, bound.format);
    }
    if (run.kind !== "audio" || !run.candidate || !["succeeded", "conflict"].includes(run.status))
      throw new HttpError(404, "run_not_found", "Speech candidate not available.");
    const result = JSON.parse(run.candidate) as AudioResult;
    return this.activities.readAudio(projectId, activityId, runId, result.sha256, result.format);
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

  /**
   * Keep a generated assessment as the product's assessment edit, the way an author's own
   * save keeps one: only a successful run, and only on the draft it was generated from.
   */
  acceptAssessment(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.track(
      this.projectWork.run(projectId, () =>
        this.locks.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          const run = await this.getRun(projectId, activityId, runId);
          if (run.kind !== "assessment" || run.status !== "succeeded" || !run.candidate)
            throw new HttpError(
              409,
              "assessment_changed",
              "Only a successful assessment candidate can be accepted.",
            );
          if (run.inputRevision !== expectedRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "The draft changed since the assessment was generated. Generate a new one.",
            );
          return this.activities.setModuleDocument(
            projectId,
            activityId,
            "assessment",
            JSON.parse(run.candidate) as unknown,
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
          if (run.inputRevision !== expectedRevision) {
            // A sound whose prompt was edited is not this take, whatever else changed.
            if (run.audio.sound) {
              const current = await this.activities.getActivity(projectId, activityId);
              const asset = current.draft.mediaPlan?.manifest.assets[run.audio.language]?.find(
                (entry) => entry.key === run.audio!.assetKey,
              );
              if (!asset || soundPromptOf(asset.script) !== run.audio.sound.prompt)
                throw new HttpError(
                  409,
                  "audio_changed",
                  "The sound's prompt changed. Generate a new candidate.",
                );
            }
            throw new HttpError(
              409,
              "draft_conflict",
              run.audio.sound
                ? "The draft changed since the sound was generated. Generate a new candidate."
                : "The draft changed since speech generation. Generate a new candidate.",
            );
          }
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
            // A coding agent that stopped short said why (its request_end carries the reason);
            // that beats naming the file it never wrote.
            const stoppedShort = run.codingAgentId ? this.observers.get(run.runId) : undefined;
            if (stoppedShort && !stoppedShort.completed) {
              this.finish(run, "failed", stoppedShort.error ?? "The coding agent did not finish.");
              return;
            }
            if (run.kind === "assist") {
              // A conversation has no artifact to collect: the reply is the result, and it
              // is in the Session.
              const observer = this.observers.get(run.runId);
              if (observer?.completed) this.finish(run, "succeeded");
              else this.finish(run, "failed", observer?.error ?? "The agent did not reply.");
              return;
            }
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
                const sound = !!run.audio?.sound;
                const observer = this.observers.get(run.runId);
                if (!observer?.completed)
                  throw new Error(
                    observer?.error ?? `${sound ? "Sound" : "Speech"} Session did not complete.`,
                  );
                if (!run.audio) throw new Error("Audio target is missing.");
                const soundFormat = run.audio.sound
                  ? await soundOutputFormat(this.workspace(run), run.audio.sound.format ?? "mp3")
                  : undefined;
                const file = soundFormat
                  ? SOUND_OUTPUT_FILES[soundFormat]
                  : await speechOutputFile(this.workspace(run), run.audio);
                const format =
                  soundFormat ?? (speechProviderOf(run.audio) === "elevenlabs" ? "mp3" : undefined);
                // Checked before the clip is kept, so a mismatch leaves nothing stored. Only a
                // provider that returns timings is read; a timings file on any other run is
                // not its provider's and is ignored.
                const speech = run.audio.sound
                  ? undefined
                  : speechProviderFor({ speechProvider: speechProviderOf(run.audio) }, null);
                const timings =
                  speech && "provider" in speech && speech.timings
                    ? await speechTimings(this.workspace(run), run.audio.script)
                    : undefined;
                const bytes = await readArtifactBytes(
                  path.join(this.workspace(run), file),
                  AUDIO_MAX_BYTES,
                );
                const result = await this.activities.storeAudio(
                  run.projectId,
                  run.activityId,
                  run.runId,
                  bytes,
                  format,
                );
                run.candidate = JSON.stringify(
                  timings?.length ? { ...result, wordTimings: timings } : result,
                );
                this.save(run);
                await this.projectWork.run(run.projectId, async () => {
                  const current = await this.activities.getActivity(run.projectId, run.activityId);
                  if (current.draft.contentRevision !== run.inputRevision)
                    throw new HttpError(
                      409,
                      "draft_conflict",
                      sound
                        ? "The draft changed while the sound was being generated."
                        : "The draft changed during speech generation.",
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
                // The candidate's own four fields, not the target: a translation's target
                // also carries its source, which a candidate does not.
                run.candidate = JSON.stringify({
                  language: run.mediaText.language,
                  assetKey: run.mediaText.assetKey,
                  type: run.mediaText.type,
                  text,
                });
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
              if (run.kind === "test") {
                const observer = this.observers.get(run.runId);
                if (!observer?.completed)
                  throw new Error(observer?.error ?? "Test Session did not complete.");
                if (!run.test) throw new Error("The test run has no criteria recorded.");
                const workspace = this.workspace(run);
                const reported = parseAcceptanceResults(
                  await readCandidate(
                    path.join(workspace, ACCEPTANCE_RESULTS_FILE),
                    RESULTS_MAX_BYTES,
                  ),
                );
                const report = acceptanceReport(run.test.criteria, reported, {
                  checkedAt: new Date().toISOString(),
                  specRevision: run.test.specRevision,
                  reused: await testFileUnchanged(workspace, run.test.cachedTestHash),
                });
                const reports = path.join(workspace, ACCEPTANCE_REPORT_DIR);
                await fs.mkdir(reports, { recursive: true });
                await atomicJson(path.join(reports, ACCEPTANCE_REPORT_FILE), report);
                if (this.stopped) return;
                this.finish(run, "succeeded");
                return;
              }
              if (run.kind === "assessment") {
                const observer = this.observers.get(run.runId);
                if (!observer?.completed)
                  throw new Error(observer?.error ?? "Assessment Session did not complete.");
                const workspace = this.workspace(run);
                const parse = (text: string, name: string): unknown => {
                  try {
                    return JSON.parse(text);
                  } catch {
                    throw new Error(`${name} is not valid JSON.`);
                  }
                };
                const hints = parseHints(
                  parse(
                    await readCandidate(path.join(workspace, ASSESSMENT_HINTS_FILE), 256 * 1024),
                    ASSESSMENT_HINTS_FILE,
                  ),
                );
                const input = await this.activities.getActivity(run.projectId, run.activityId);
                const data = normalizeAssessment(
                  parse(
                    await readCandidate(path.join(workspace, ASSESSMENT_FILE)),
                    ASSESSMENT_FILE,
                  ),
                  input.productCode,
                  this.activities.productOf(input)?.canonicalRefNum ?? input.refNum,
                );
                validateAssessment(data);
                const missing = coverageProblem(writtenItems(data), hints);
                if (missing) throw new Error(missing);
                run.candidate = JSON.stringify(data);
                this.save(run);
                if (this.stopped) return;
                await this.projectWork.run(run.projectId, async () => {
                  const current = await this.activities.getActivity(run.projectId, run.activityId);
                  if (current.draft.contentRevision !== run.inputRevision)
                    throw new HttpError(
                      409,
                      "draft_conflict",
                      "The draft changed during assessment generation.",
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
                if (run.bookMode)
                  requiredMediaFiles.push(
                    "module/src/book-reader/model.ts",
                    "module/src/book-reader/controller.ts",
                  );
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
                    await verifyMediaArtifacts(
                      this.workspace(run),
                      input,
                      readCandidate,
                      run.bookMode,
                    );
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
                          ? run.audio?.sound
                            ? SOUND_OUTPUT_FILES[run.audio.sound.format ?? "mp3"]
                            : SPEECH_OUTPUT_FILES[speechProviderOf(run.audio ?? {})]
                          : run.kind === "module"
                            ? "module-result.json or a required artifact"
                            : run.kind === "media-text"
                              ? "media-text.json"
                              : run.kind === "assessment"
                                ? `${ASSESSMENT_FILE} or ${ASSESSMENT_HINTS_FILE}`
                                : run.kind === "test"
                                  ? ACCEPTANCE_RESULTS_FILE
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

/** The assessment skill a run follows, staged into its workspace under a file name of its own. */
const ASSESSMENT_SKILL = "waf-assessment-patterns";
const ASSESSMENT_SKILL_FILE = "assessment-skill.md";
const ASSESSMENT_FILE = "assessment.json";
const ASSESSMENT_HINTS_FILE = "assessment-hints.json";

/**
 * One run writes both the questions the screens imply and the assessment. The collector
 * checks the second covers the first.
 */
export const assessmentPrompt = `Write the WAF assessment for this activity. Work in this workspace.
Read and follow the WAF assessment skill in ${ASSESSMENT_SKILL_FILE}. The activity is described by description.md, input.json and activity-spec.json. If current-assessment.json exists, it is the assessment in use now: update it to match the specification rather than replacing it, and keep what still fits.
Write two files, each a JSON object without Markdown fences:
1. ${ASSESSMENT_HINTS_FILE}: {"items": [{"sceneId": "scene id", "source": "loading|speaker|selection", "question": "what the learner answers", "choices": ["exact on-screen choice", "..."], "correct": "the correct choice text"}]}. List every learner answer or selection screen, in the order the screens appear, including intermediate loading screens, speaker or choice screens and final answer screens. Skip screens marked instructional-only and screens that never ask the learner to choose. Use the exact on-screen text for each choice and for correct; leave correct out when the screen does not settle it. If description.md contains <items><item>...</item></items> blocks, each non-empty <item> block is one question, in order.
2. ${ASSESSMENT_FILE}: {"items": [...]} with one item per entry of ${ASSESSMENT_HINTS_FILE}, in the same order, each keeping that entry's choices and correct answer. An item is {"interactionKey": "SIMPLE_CHOICE" or "MULTIPLE_RESPONSE_CHOICE", "configuration": {"shuffle": boolean, "question": {"text": "..."}, "simpleChoice" or "multipleResponseChoice": [{"id": "string id", "isCorrect": boolean, "value": {"text": "..."}}]}}. Use only those two interactions. Every item needs non-empty question text and at least two choices with unique non-empty string ids and non-empty text; a SIMPLE_CHOICE item has exactly one correct choice, a MULTIPLE_RESPONSE_CHOICE item at least one. Do not copy <items> or <item> tags into the assessment. Do not include qa_, prod_ or dev_ keys. Titles, scores and the assessment's configuration are derived; you may leave them out.
Do not edit the input files. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing both files as valid JSON.`;

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
