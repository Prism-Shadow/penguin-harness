/**
 * "Run all stages": one click that takes an activity
 * from its script to an assembled module, or one stage re-run on its own.
 *
 * It is a sequencer over the runs that exist, not a second way of running anything. Each
 * step starts the same run an author could start by hand, through `ActivityGeneration`,
 * waits for it the way the history panel does, and accepts what it produced through the
 * same accept the author would press. Every run it starts is an ordinary run in the
 * activity's history, with its own Session.
 *
 * Steps, in the order each needs the one before:
 *   spec    generate the specification from the script (applied when it completes)
 *   media   plan media from the specification (kept when already current)
 *   translations  translate and accept every narration another language lacks, or whose
 *           default-language line changed since it was translated
 *   speech  generate and accept every unbound narration with a usable script
 *   words   a decodable book only: record and accept every word pronunciation with sounds
 *           and no recording, said slowly sound by sound and then normally (pronunciation.ts)
 *   sounds  generate and accept every music and sound effect with a prompt and no file,
 *           with the chosen sound provider (ElevenLabs unless the sequence names another)
 *   images  generate and accept every unbound image with a description
 *   assessment  write and accept the assessment, when the specification uses one and this
 *           is the canonical ref that owns it
 *   module  assemble the WAF module (scaffold, configuration and behavior in one run)
 *   test    run the acceptance tests against the assembled module, when the specification
 *           has acceptance criteria and the test browser is installed
 *
 * State lives in memory only: a sequence belongs to the server that runs it, and its runs
 * outlive it in the history either way. A step that fails stops the sequence; nothing is
 * rolled back, and nothing after it runs.
 */
import { isBookWord } from "./book-words.js";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import type { ActivityAcceptance } from "./acceptance-service.js";
import { acceptanceCriteria } from "./acceptance-collect.js";
import {
  ELEVENLABS_DEFAULT_VOICE,
  SPEECH_VOICES,
  isSpeechVoice,
  isVoiceOf,
} from "./voice-catalogue.js";
import { DEFAULT_LANGUAGE_CODE } from "./languages.js";
import { contentRevision, type ActivityRun } from "./domain.js";
import type { AssetManifest } from "./media.js";
import { soundPromptOf } from "./playback.js";
import { SOUND_PROMPT_MAX } from "./sound.js";
import type { SoundProviderId } from "./sound-types.js";
import { servesSoundKind } from "./audio-providers.js";
import {
  unrecordedWithSounds,
  unrecordedWithoutSounds,
  wordRecordingTargets,
} from "./pronunciation.js";
import type { SpeechProviderId } from "./speech-types.js";
import {
  PIPELINE_STEPS,
  type PipelineInput,
  type PipelineScope,
  type PipelineSelection,
  type PipelineState,
  type PipelineStep,
  type PipelineStepState,
} from "./pipeline-types.js";

export {
  PIPELINE_STEPS,
  type PipelineInput,
  type PipelineScope,
  type PipelineSelection,
  type PipelineState,
  type PipelineStep,
  type PipelineStepState,
  type PipelineStepStatus,
  type PipelineNote,
} from "./pipeline-types.js";

export function parseSelection(value: unknown): PipelineSelection {
  if (value === undefined || value === "all") return "all";
  if (value === "narration") return "narration";
  if (value === "assets") return "assets";
  if (typeof value === "string" && (PIPELINE_STEPS as readonly string[]).includes(value))
    return value as PipelineStep;
  throw new HttpError(
    400,
    "invalid_request",
    "stage must be all, narration, assets, or one of the pipeline steps.",
  );
}

export function stepsFor(selection: PipelineSelection): PipelineStep[] {
  if (selection === "all") return [...PIPELINE_STEPS];
  if (selection === "narration") return ["translations", "speech"];
  if (selection === "assets") return ["speech", "images"];
  return [selection];
}

/** The targets a scoped sequence may touch: one language, and one asset when it names one. */
export function inScope<T extends { language: string; assetKey: string }>(
  targets: readonly T[],
  scope: PipelineScope | undefined,
): T[] {
  if (!scope) return [...targets];
  return targets.filter(
    (target) =>
      target.language === scope.language &&
      (scope.assetKey === undefined || target.assetKey === scope.assetKey),
  );
}

type MediaAsset = AssetManifest["assets"][string][number];
const TEXT_MAX = 5000;
const usable = (text: string | undefined) => !!text?.trim() && text.length <= TEXT_MAX;

/**
 * Unbound narration with a script the speech run accepts, in every language, in manifest order.
 * A book's word pronunciations are recorded with the words, not as narration.
 */
export function speechTargets(manifest: AssetManifest): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter(
        (asset: MediaAsset) =>
          asset.type === "audio" &&
          !asset.kind &&
          !isBookWord(asset) &&
          !asset.path &&
          usable(asset.script),
      )
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/**
 * Unbound music and sound effects with a prompt a sound run accepts (1 to 2 000 characters),
 * in every language, in manifest order.
 */
export function soundTargets(manifest: AssetManifest): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter((asset: MediaAsset) => {
        if (asset.type !== "audio" || !asset.kind || asset.path) return false;
        const prompt = soundPromptOf(asset.script);
        return !!prompt && prompt.length <= SOUND_PROMPT_MAX;
      })
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/**
 * Narrations to translate, in every language but the default: those with no script yet,
 * and those translated from a default-language line that has since been rewritten. A
 * script with no recorded source was written by someone, not translated, and is left be.
 */
export function translationTargets(
  manifest: AssetManifest,
): { language: string; assetKey: string }[] {
  const sources = new Map(
    (manifest.assets[DEFAULT_LANGUAGE_CODE] ?? [])
      .filter((asset) => asset.type === "audio" && usable(asset.script))
      .map((asset) => [asset.key, asset.script!]),
  );
  return Object.entries(manifest.assets)
    .filter(([language]) => language !== DEFAULT_LANGUAGE_CODE)
    .flatMap(([language, assets]) =>
      assets
        .filter((asset: MediaAsset) => {
          const source = sources.get(asset.key);
          // Music and effects are not spoken, so there is nothing to translate.
          if (asset.type !== "audio" || asset.kind || isBookWord(asset) || source === undefined)
            return false;
          return (
            !asset.script?.trim() ||
            (asset.translatedFrom !== undefined && asset.translatedFrom !== source)
          );
        })
        .map((asset) => ({ language, assetKey: asset.key })),
    );
}

/** Unbound images with a description the image run accepts, in every language. */
export function imageTargets(manifest: AssetManifest): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter(
        (asset: MediaAsset) => asset.type === "image" && !asset.path && usable(asset.description),
      )
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/**
 * The voice a narration or word is spoken in: its own saved voice when its provider speaks with
 * it, else the sequence's choice when that provider does, else the provider's default (the
 * Vault's ElevenLabs voice, or Gemini's first).
 */
export function voiceFor(
  provider: SpeechProviderId,
  saved: string | undefined,
  chosen: string | undefined,
): string {
  if (provider === "elevenlabs")
    return isVoiceOf("elevenlabs", saved)
      ? saved!
      : isVoiceOf("elevenlabs", chosen)
        ? chosen!
        : ELEVENLABS_DEFAULT_VOICE;
  if (isSpeechVoice(saved)) return saved;
  return isSpeechVoice(chosen) ? chosen : SPEECH_VOICES[0];
}

const TERMINAL = new Set<ActivityRun["status"]>([
  "succeeded",
  "failed",
  "conflict",
  "cancelled",
  "interrupted",
]);

/** Thrown inside a step once the author has asked the sequence to stop. */
class Stopped extends Error {}

export interface PipelineDeps {
  generation: ActivityGeneration;
  activities: ActivityAuthoring;
  /** The assessment in effect for a ref, which an assessment run updates; none when absent. */
  currentAssessment?: (
    projectId: string,
    activityId: string,
  ) => Promise<Record<string, unknown> | null>;
  /** Starts an acceptance test run; the step fails without one. */
  startTest?: (
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    runtime?: { codingAgentId?: string },
  ) => Promise<ActivityRun>;
  /** Whether the test browser is installed; the test step is skipped without it. */
  testBrowserInstalled?: () => Promise<boolean>;
  /** How long to wait between looks at a run; injected so tests do not wait. */
  pause?: (ms: number) => Promise<void>;
  now?: () => string;
  newId?: () => string;
}

const POLL_MS = 1000;

export class PipelineRunner {
  private readonly states = new Map<string, PipelineState>();
  private readonly stopping = new Set<string>();
  private readonly pause: (ms: number) => Promise<void>;
  private readonly now: () => string;
  private readonly newId: () => string;
  private counter = 0;
  private disposed = false;

  constructor(private readonly deps: PipelineDeps) {
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? (() => `pipeline_${Date.now().toString(36)}_${++this.counter}`);
  }

  /**
   * Stop stepping: the component is going away (a restart or a hot replacement). The run in
   * flight is left alone, an ordinary run its history still shows; nothing after it starts.
   */
  dispose(): void {
    this.disposed = true;
  }

  /** The activity's latest sequence, running or finished, or null when it has had none. */
  status(activityId: string): PipelineState | null {
    return this.states.get(activityId) ?? null;
  }

  /**
   * Start a sequence. It returns at once with the plan; the steps run after. Resolves the
   * returned promise's `done` when the sequence has settled, which only tests wait for.
   */
  start(
    projectId: string,
    activityId: string,
    input: PipelineInput,
  ): { state: PipelineState; done: Promise<void> } {
    if (this.states.get(activityId)?.status === "running")
      throw new HttpError(
        409,
        "pipeline_running",
        "This activity is already running its stages. Stop it before starting again.",
      );
    const state: PipelineState = {
      pipelineId: this.newId(),
      projectId,
      activityId,
      selection: input.selection,
      scope: input.scope ?? null,
      status: "running",
      steps: stepsFor(input.selection).map((step) => ({
        step,
        status: "pending",
        detail: null,
        note: null,
        done: 0,
        total: 0,
        runIds: [],
      })),
      currentRunId: null,
      currentSessionId: null,
      error: null,
      startedAt: this.now(),
      finishedAt: null,
    };
    this.states.set(activityId, state);
    this.stopping.delete(activityId);
    return { state: structuredClone(state), done: this.drive(state, input) };
  }

  /** Ask the running sequence to stop: the run in flight is cancelled, and nothing after it runs. */
  async stop(activityId: string): Promise<PipelineState | null> {
    const state = this.states.get(activityId);
    if (!state || state.status !== "running") return state ?? null;
    this.stopping.add(activityId);
    if (state.currentRunId)
      await this.deps.generation
        .cancel(state.projectId, activityId, state.currentRunId)
        .catch(() => undefined);
    return state;
  }

  private async drive(state: PipelineState, input: PipelineInput): Promise<void> {
    for (const step of state.steps) {
      if (this.stopping.has(state.activityId) || this.disposed) break;
      step.status = "running";
      try {
        await this.runStep(state, step, input);
        if (step.status === "running") step.status = "succeeded";
      } catch (error) {
        const stopped = error instanceof Stopped || this.stopping.has(state.activityId);
        step.status = stopped ? "cancelled" : "failed";
        step.detail = stopped ? null : error instanceof Error ? error.message : String(error);
        if (!stopped) state.error = step.detail;
        break;
      } finally {
        state.currentRunId = null;
        state.currentSessionId = null;
      }
    }
    const failed = state.steps.some((step) => step.status === "failed");
    // Stopped by the author, or cut short because the server is going away: either way,
    // not every chosen stage ran.
    state.status = failed
      ? "failed"
      : this.stopping.has(state.activityId) || this.disposed
        ? "cancelled"
        : "succeeded";
    for (const step of state.steps)
      if (step.status === "pending" && state.status !== "succeeded") step.status = "cancelled";
    this.stopping.delete(state.activityId);
    state.finishedAt = this.now();
  }

  private async runStep(
    state: PipelineState,
    step: PipelineStepState,
    input: PipelineInput,
  ): Promise<void> {
    const { projectId, activityId } = state;
    const { activities, generation } = this.deps;
    const runtime = input.codingAgentId ? { codingAgentId: input.codingAgentId } : undefined;
    const current = () => activities.getActivity(projectId, activityId);

    if (step.step === "spec") {
      const activity = await current();
      if (!activity.draft.description.trim())
        throw new Error("Write the activity script before generating the specification.");
      await this.follow(
        state,
        step,
        await generation.start(
          projectId,
          activityId,
          input.agentId,
          activity.draft.contentRevision,
          undefined,
          runtime,
        ),
      );
      return;
    }

    if (step.step === "media") {
      const activity = await current();
      if (!activity.draft.spec || activity.draft.status !== "valid")
        throw new Error("Save a valid specification before planning media.");
      const plan = activity.draft.mediaPlan;
      if (plan && plan.specRevision === contentRevision(activity.draft.spec)) {
        step.status = "skipped";
        step.note = "planCurrent";
        return;
      }
      await activities.planMedia(projectId, activityId, activity.draft.contentRevision);
      return;
    }

    if (step.step === "translations") {
      const activity = await current();
      const manifest = activity.draft.mediaPlan?.manifest;
      if (!manifest) throw new Error("Plan media before translating it.");
      const targets = inScope(translationTargets(manifest), input.scope);
      step.total = targets.length;
      if (!targets.length) {
        step.status = "skipped";
        step.note = "allTranslated";
        return;
      }
      for (const target of targets) {
        step.detail = `${target.assetKey} (${target.language})`;
        const before = await current();
        const run = await generation.start(
          projectId,
          activityId,
          input.agentId,
          before.draft.contentRevision,
          { mediaText: { ...target, translate: true } },
          runtime,
        );
        await this.follow(state, step, run);
        const after = await current();
        await generation.acceptMediaText(
          projectId,
          activityId,
          run.runId,
          after.draft.contentRevision,
        );
        step.done += 1;
      }
      step.detail = null;
      return;
    }

    if (step.step === "speech" || step.step === "images") {
      // Media is generated by a Penguin agent's model; a coding agent writes code.
      if (input.codingAgentId || !input.agentId) {
        step.status = "skipped";
        step.note = "needsPenguinAgent";
        return;
      }
      const activity = await current();
      const manifest = activity.draft.mediaPlan?.manifest;
      if (!manifest) throw new Error("Plan media before generating it.");
      const targets = inScope(
        step.step === "speech" ? speechTargets(manifest) : imageTargets(manifest),
        input.scope,
      );
      step.total = targets.length;
      if (!targets.length) {
        step.status = "skipped";
        step.note = step.step === "speech" ? "noNarration" : "noImages";
        return;
      }
      for (const target of targets) {
        const narration = manifest.assets[target.language]?.find(
          (item) => item.key === target.assetKey,
        );
        const voice = voiceFor(
          narration?.speechProvider ?? "gemini",
          narration?.voice,
          input.voice,
        );
        step.detail = target.assetKey;
        const before = await current();
        const run = await generation.start(
          projectId,
          activityId,
          input.agentId,
          before.draft.contentRevision,
          step.step === "speech" ? { audio: { ...target, voice } } : { image: target },
        );
        await this.follow(state, step, run);
        const after = await current();
        if (step.step === "speech")
          await generation.acceptAudio(
            projectId,
            activityId,
            run.runId,
            after.draft.contentRevision,
          );
        else
          await generation.acceptImage(
            projectId,
            activityId,
            run.runId,
            after.draft.contentRevision,
          );
        step.done += 1;
      }
      step.detail = null;
      return;
    }

    if (step.step === "words") {
      await this.recordWords(state, step, input);
      return;
    }

    if (step.step === "sounds") {
      // Music and effects are made by a Penguin agent's helper; a coding agent writes code.
      if (input.codingAgentId || !input.agentId) {
        step.status = "skipped";
        step.note = "needsPenguinAgent";
        return;
      }
      const activity = await current();
      const manifest = activity.draft.mediaPlan?.manifest;
      if (!manifest) throw new Error("Plan media before generating it.");
      const targets = inScope(soundTargets(manifest), input.scope);
      step.total = targets.length;
      if (!targets.length) {
        step.status = "skipped";
        step.note = "noSounds";
        return;
      }
      const provider: SoundProviderId = input.soundProvider ?? "elevenlabs";
      // Asked once: a missing key or model is the same for every sound of a kind, and is not a
      // failure of the sequence, only of this provider for this agent. A sound whose kind the
      // provider cannot make now is left for another provider rather than failing the stages.
      const status = (await generation.soundSetup(projectId, input.agentId)).providers.find(
        (entry) => entry.id === provider,
      );
      const served = status
        ? targets.filter((target) => {
            const kind = manifest.assets[target.language]?.find(
              (item) => item.key === target.assetKey,
            )?.kind;
            return !!kind && servesSoundKind(status, kind);
          })
        : [];
      step.total = served.length;
      if (!served.length) {
        step.status = "skipped";
        step.note = "soundProviderUnavailable";
        return;
      }
      for (const target of served) {
        step.detail = target.assetKey;
        const before = await current();
        const run = await generation.start(
          projectId,
          activityId,
          input.agentId,
          before.draft.contentRevision,
          { sound: { ...target, provider } },
        );
        await this.follow(state, step, run);
        const after = await current();
        await generation.acceptAudio(projectId, activityId, run.runId, after.draft.contentRevision);
        step.done += 1;
      }
      step.detail = null;
      return;
    }

    if (step.step === "assessment") {
      const activity = await current();
      if (!activity.draft.spec || activity.draft.status !== "valid")
        throw new Error("Save a valid specification before generating the assessment.");
      const specRuntime = activity.draft.spec.runtime as { usesAssessment?: unknown } | undefined;
      if (specRuntime?.usesAssessment !== true) {
        step.status = "skipped";
        step.note = "noAssessment";
        return;
      }
      if (!activities.isCanonicalRef(activity)) {
        step.status = "skipped";
        step.note = "notCanonical";
        return;
      }
      const assessment = {
        current: (await this.deps.currentAssessment?.(projectId, activityId)) ?? null,
      };
      const run = await generation.start(
        projectId,
        activityId,
        input.agentId,
        activity.draft.contentRevision,
        { assessment },
        runtime,
      );
      await this.follow(state, step, run);
      const after = await current();
      await generation.acceptAssessment(
        projectId,
        activityId,
        run.runId,
        after.draft.contentRevision,
      );
      return;
    }

    if (step.step === "test") {
      const activity = await current();
      if (!acceptanceCriteria(activity.draft.spec).length) {
        step.status = "skipped";
        step.note = "noCriteria";
        return;
      }
      if (!(await this.deps.testBrowserInstalled?.())) {
        step.status = "skipped";
        step.note = "noBrowser";
        return;
      }
      if (!this.deps.startTest) throw new Error("Acceptance tests are not available.");
      await this.follow(
        state,
        step,
        await this.deps.startTest(
          projectId,
          activityId,
          input.agentId,
          activity.draft.contentRevision,
          runtime,
        ),
      );
      return;
    }

    const activity = await current();
    await this.follow(
      state,
      step,
      await generation.start(
        projectId,
        activityId,
        input.agentId,
        activity.draft.contentRevision,
        {
          ...(input.bookMode ? { bookMode: input.bookMode } : {}),
        },
        runtime,
      ),
    );
  }

  /**
   * The words step: a decodable book's word pronunciations with sounds and no recording, each
   * recorded by the ordinary speech run with its own provider and voice and accepted. A word
   * that names no provider is spoken by ElevenLabs when the agent can use it, else by Gemini,
   * and keeps that choice; its script is made for the provider before anything is recorded.
   */
  private async recordWords(state: PipelineState, step: PipelineStepState, input: PipelineInput) {
    const { projectId, activityId } = state;
    const { activities, generation } = this.deps;
    const current = () => activities.getActivity(projectId, activityId);
    const activity = await current();
    const manifest = activity.draft.mediaPlan?.manifest;
    const hasWords =
      !!manifest && Object.values(manifest.assets).some((group) => group.some(isBookWord));
    const recorded =
      activity.activityType === "book"
        ? ((await activities.bookWordsState(projectId, activityId)).bookMode ?? null)
        : null;
    // The product's reading mode decides; where it records none, the sequence's choice, and a
    // book that already has word pronunciations was refreshed as decodable.
    const mode = recorded ?? input.bookMode ?? (hasWords ? "decodable" : null);
    if (activity.activityType !== "book" || mode !== "decodable") {
      step.status = "skipped";
      step.note = "notDecodable";
      return;
    }
    if (input.codingAgentId || !input.agentId) {
      step.status = "skipped";
      step.note = "needsPenguinAgent";
      return;
    }
    if (!manifest) throw new Error("Plan media before recording the book's words.");
    const waiting = inScope(unrecordedWithSounds(manifest), input.scope);
    if (!waiting.length) {
      step.status = "skipped";
      step.note = inScope(unrecordedWithoutSounds(manifest), input.scope).length
        ? "wordsMissingSounds"
        : "noWords";
      return;
    }
    const speech = await generation.speechSetup(projectId, input.agentId);
    const fallback: SpeechProviderId = speech.providers?.some(
      (entry) => entry.id === "elevenlabs" && entry.available,
    )
      ? "elevenlabs"
      : "gemini";
    const prepared = await activities.prepareWordRecordings(
      projectId,
      activityId,
      fallback,
      activity.draft.contentRevision,
      input.scope?.language,
    );
    const ready = prepared.mediaPlan!.manifest;
    const targets = inScope(wordRecordingTargets(ready), input.scope);
    step.total = targets.length;
    for (const target of targets) {
      const word = ready.assets[target.language]?.find((item) => item.key === target.assetKey);
      const provider = word?.speechProvider ?? "gemini";
      step.detail = target.assetKey;
      const before = await current();
      const run = await generation.start(
        projectId,
        activityId,
        input.agentId,
        before.draft.contentRevision,
        { audio: { ...target, voice: voiceFor(provider, word?.voice, input.voice), provider } },
      );
      await this.follow(state, step, run);
      const after = await current();
      await generation.acceptAudio(projectId, activityId, run.runId, after.draft.contentRevision);
      step.done += 1;
    }
    step.detail = null;
  }

  /** Wait for one run to settle; anything but success ends the step with the run's own reason. */
  private async follow(state: PipelineState, step: PipelineStepState, run: ActivityRun) {
    step.runIds.push(run.runId);
    state.currentRunId = run.runId;
    state.currentSessionId = run.sessionId;
    for (;;) {
      const latest = (await this.deps.generation.list(state.projectId, state.activityId)).find(
        (entry) => entry.runId === run.runId,
      );
      if (!latest) throw new Error(`Run ${run.runId} is no longer in the history.`);
      state.currentSessionId = latest.sessionId;
      if (this.disposed) throw new Stopped();
      if (TERMINAL.has(latest.status)) {
        if (latest.status === "succeeded") return;
        if (latest.status === "cancelled" && this.stopping.has(state.activityId))
          throw new Stopped();
        throw new Error(latest.error ?? `The ${latest.kind} run ended as ${latest.status}.`);
      }
      await this.pause(POLL_MS);
    }
  }
}

/** "Run all stages" for one activity at a time, kept by the server that runs it. */
export abstract class ActivityPipelines extends Interface<{
  start(projectId: string, activityId: string, input: PipelineInput): Promise<PipelineState>;
  /** The activity's latest sequence in this project, or null when it has had none here. */
  status(projectId: string, activityId: string): Promise<PipelineState | null>;
  stop(projectId: string, activityId: string): Promise<PipelineState | null>;
}>() {}

@Component()
export class ActivityPipelineService implements ActivityPipelines {
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly acceptance!: ActivityAcceptance;
  private runner: PipelineRunner | null = null;

  setup({ effect }: ClassCtx) {
    const runner = new PipelineRunner({
      generation: this.generation,
      activities: this.activities,
      currentAssessment: async (projectId, activityId) => {
        const value = (await this.sandbox.moduleDocuments(projectId, activityId)).assessment?.value;
        return value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      },
      startTest: (projectId, activityId, agentId, expectedRevision, runtime) =>
        this.acceptance.start(projectId, activityId, agentId, expectedRevision, runtime),
      testBrowserInstalled: () => this.acceptance.browserInstalled(),
    });
    this.runner = runner;
    effect(() => runner.dispose());
  }

  private active(): PipelineRunner {
    if (!this.runner) throw new HttpError(503, "pipeline_unavailable", "Stages are not ready yet.");
    return this.runner;
  }

  async start(projectId: string, activityId: string, input: PipelineInput) {
    // An unknown activity is refused here rather than as the first step's failure.
    await this.activities.getActivity(projectId, activityId);
    return this.active().start(projectId, activityId, input).state;
  }

  // A sequence is keyed by activity; answering only inside its own project keeps one
  // project from reading or stopping another's, whatever id it names.
  async status(projectId: string, activityId: string) {
    const state = this.active().status(activityId);
    return state && state.projectId === projectId ? state : null;
  }

  async stop(projectId: string, activityId: string) {
    if (!(await this.status(projectId, activityId))) return null;
    return this.active().stop(activityId);
  }
}
