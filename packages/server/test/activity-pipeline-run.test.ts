import { describe, expect, it, vi } from "vitest";
import {
  PipelineRunner,
  ActivityPipelineService,
  validateSpeechLanguages,
  imageTargets,
  inScope,
  parseSelection,
  soundTargets,
  speechTargets,
  stepsFor,
  translationTargets,
} from "../src/activities/pipeline-run.js";
import { contentRevision, type ActivityRun } from "../src/activities/domain.js";
import type { AssetManifest, MediaAsset } from "../src/activities/media.js";
import { drawnOutScript, geminiScript, syncWordScripts } from "../src/activities/pronunciation.js";
import type { SpeechProviderId } from "../src/activities/speech-types.js";
import { ELEVENLABS_DEFAULT_VOICE } from "../src/activities/voice-catalogue.js";
import type { ActivityAuthoring, ActivityGeneration } from "../src/mechanisms/activities.js";

const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];

function manifest(withRomanian = false): AssetManifest {
  return {
    productCode: "words",
    refNum: 1,
    assets: {
      "en-US": [
        { key: "hello", type: "audio", description: "Greeting", script: "Hello", usages: usage },
        {
          key: "bound",
          type: "audio",
          description: "Done",
          script: "Hi",
          path: "a.wav",
          usages: usage,
        },
        { key: "silent", type: "audio", description: "No script", usages: usage },
        { key: "cat", type: "image", description: "A cat", usages: usage },
        { key: "clip", type: "video", description: "A clip", usages: usage },
      ],
      "es-MX": [
        { key: "hello", type: "audio", description: "Saludo", script: "Hola", usages: usage },
      ],
      ...(withRomanian
        ? { "ro-RO": [{ key: "hello", type: "audio", description: "Salut", usages: usage }] }
        : {}),
    },
  };
}

describe("choosing the work", () => {
  it("also preflights unrecorded book words, respecting the selected asset", () => {
    const media = manifest();
    media.assets["es-MX"]!.push({
      key: "word",
      type: "audio",
      role: "bookWord",
      description: "Word",
      phonemes: ["a"],
      speechProvider: "kokoro",
      usages: [],
    });
    expect(() => validateSpeechLanguages(media, { selection: "words", agentId: "agent" })).toThrow(
      "Kokoro does not support es-MX (word)",
    );
    expect(() =>
      validateSpeechLanguages(media, {
        selection: "words",
        agentId: "agent",
        scope: { language: "es-MX", assetKey: "hello" },
      }),
    ).not.toThrow();
  });
  it.each(["es-MX", "ro-RO"])(
    "refuses saved Kokoro for %s before starting a pipeline",
    async (language) => {
      const media = manifest(true);
      media.assets[language]![0]!.speechProvider = "kokoro";
      const start = vi.fn();
      const pipelines = new ActivityPipelineService();
      Object.assign(pipelines, {
        activities: { getActivity: async () => ({ draft: { mediaPlan: { manifest: media } } }) },
        runner: { start },
      });
      await expect(
        pipelines.start("proj", "act", { selection: "narration", agentId: "agent" }),
      ).rejects.toThrow(`Kokoro does not support ${language}`);
      expect(start).not.toHaveBeenCalled();
      expect(() =>
        validateSpeechLanguages(media, {
          selection: "narration",
          agentId: "agent",
          scope: { language: "en-US" },
        }),
      ).not.toThrow();
      expect(() =>
        validateSpeechLanguages(media, { selection: "images", agentId: "agent" }),
      ).not.toThrow();
      media.assets[language]![0]!.path = "recorded.wav";
      expect(() =>
        validateSpeechLanguages(media, { selection: "narration", agentId: "agent" }),
      ).not.toThrow();
    },
  );
  it("finds unbound narration with a script and unbound described images, in every language", () => {
    expect(speechTargets(manifest())).toEqual([
      { language: "en-US", assetKey: "hello" },
      { language: "es-MX", assetKey: "hello" },
    ]);
    expect(imageTargets(manifest())).toEqual([{ language: "en-US", assetKey: "cat" }]);
  });

  it("runs every step for all, one step on its own, and refuses an unknown one", () => {
    expect(stepsFor(parseSelection(undefined))).toEqual([
      "spec",
      "media",
      "translations",
      "speech",
      "words",
      "sounds",
      "images",
      "assessment",
      "module",
      "test",
    ]);
    expect(stepsFor(parseSelection("speech"))).toEqual(["speech"]);
    expect(stepsFor(parseSelection("words"))).toEqual(["words"]);
    expect(stepsFor(parseSelection("test"))).toEqual(["test"]);
    expect(stepsFor(parseSelection("narration"))).toEqual(["translations", "speech"]);
    // A ref made from its template speaks and draws what it cleared, and nothing else.
    expect(stepsFor(parseSelection("assets"))).toEqual(["speech", "images"]);
    expect(() => parseSelection("deploy")).toThrow(/stage must be/);
  });
});

/** An activity and the two services, faked closely enough to show what the sequence does. */
function world(
  options: {
    fail?: ActivityRun["kind"];
    description?: string;
    romanian?: boolean;
    usesAssessment?: boolean;
    canonical?: boolean;
    /** The specification's acceptance criteria. */
    criteria?: string[];
    /** Whether the test browser is installed. */
    browser?: boolean;
    /** Add two sound effects to the plan: one bound, one with a prompt and no file. */
    sounds?: boolean;
    /** Whether the chosen agent can use each sound provider (all can when absent). */
    soundProviders?: Partial<Record<"elevenlabs" | "agenthub", boolean>>;
    /** The model hub's sound models, as its setup lists them (none when absent). */
    hubModels?: {
      id: string;
      kinds: ("music" | "sfx")[];
      credential: string;
      available: boolean;
    }[];
    /** Add an unbound music asset with a prompt to the plan, next to the sound effects. */
    music?: boolean;
  } = {},
) {
  let revision = 1;
  const spec = {
    id: "words",
    title: "Words",
    activityDescription: "d",
    scenes: [],
    ...(options.criteria ? { acceptance_criterias: options.criteria } : {}),
    ...(options.usesAssessment !== undefined
      ? { runtime: { usesAssessment: options.usesAssessment } }
      : {}),
  };
  const accepted: string[] = [];
  const assessmentInputs: unknown[] = [];
  const activity = {
    id: "act",
    productCode: "words",
    refNum: 1,
    draft: {
      contentRevision: "r1",
      description: options.description ?? "Scene 1: Intro",
      status: "draft" as string,
      spec: null as Record<string, unknown> | null,
      mediaPlan: undefined as
        | { specRevision: string; requirements: Record<string, string>; manifest: AssetManifest }
        | undefined,
    },
  };
  const bump = () => (activity.draft.contentRevision = `r${++revision}`);
  const runs: ActivityRun[] = [];
  const started: string[] = [];
  const cancelled: string[] = [];
  const soundSetups: string[] = [];
  const asset = (language: string, key: string) =>
    activity.draft.mediaPlan!.manifest.assets[language]!.find((item) => item.key === key)!;

  const generation = {
    async start(
      _p: string,
      _a: string,
      agentId: string,
      expected: string,
      module?: any,
      runtime?: any,
    ) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      if (module?.assessment) assessmentInputs.push(module.assessment);
      const kind: ActivityRun["kind"] = module?.assessment
        ? "assessment"
        : module?.audio || module?.sound
          ? "audio"
          : module?.image
            ? "image"
            : module?.mediaText
              ? "media-text"
              : module
                ? "module"
                : "spec";
      const run = {
        kind,
        runId: `run_${runs.length + 1}`,
        sessionId: `session_${runs.length + 1}`,
        status: "running",
        error: null,
        agentId,
        codingAgentId: runtime?.codingAgentId,
        // A sound run keeps its target as the run's audio, as the real service does.
        audio: module?.audio ?? module?.sound,
        image: module?.image,
        mediaText: module?.mediaText,
      } as unknown as ActivityRun;
      runs.push(run);
      if (module?.sound)
        started.push(
          `sound:${module.sound.provider}:${module.sound.language}:${module.sound.assetKey}`,
        );
      else
        started.push(
          kind === "audio" || kind === "image" || kind === "media-text"
            ? `${kind}:${(module.audio ?? module.image ?? module.mediaText).language}:${(module.audio ?? module.image ?? module.mediaText).assetKey}`
            : kind,
        );
      return run;
    },
    async list() {
      // Each look settles whatever is running, as a finished Session would.
      for (const run of runs.filter((item) => item.status === "running")) {
        if (options.fail === run.kind) {
          run.status = "failed";
          run.error = `${run.kind} broke`;
          continue;
        }
        run.status = "succeeded";
        if (run.kind === "spec") {
          activity.draft.spec = spec;
          activity.draft.status = "valid";
          bump();
        }
      }
      return runs.map((run) => ({ ...run, hasCandidate: false }));
    },
    async soundSetup(_p: string, agentId: string) {
      soundSetups.push(agentId);
      return {
        providers: (["elevenlabs", "agenthub"] as const).map((id) => ({
          id,
          kinds: ["music", "sfx"],
          available: options.soundProviders?.[id] ?? true,
          ...(id === "agenthub"
            ? {
                modelChoices: options.hubModels ?? [
                  {
                    id: "hub-sound",
                    kinds: ["music", "sfx"],
                    credential: "HUB_KEY",
                    available: options.soundProviders?.agenthub ?? true,
                  },
                ],
              }
            : {}),
        })),
      };
    },
    async acceptAudio(_p: string, _a: string, runId: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      const run = runs.find((item) => item.runId === runId)!;
      asset(run.audio!.language, run.audio!.assetKey).path = (run.audio as { provider?: string })
        .provider
        ? `${runId}.mp3`
        : `${runId}.wav`;
      bump();
    },
    async acceptImage(_p: string, _a: string, runId: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      const run = runs.find((item) => item.runId === runId)!;
      asset(run.image!.language, run.image!.assetKey).path = `${runId}.png`;
      bump();
    },
    async acceptAssessment(_p: string, _a: string, runId: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      accepted.push(runId);
      bump();
    },
    async acceptMediaText(_p: string, _a: string, runId: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      const run = runs.find((item) => item.runId === runId)! as ActivityRun & {
        mediaText: { language: string; assetKey: string };
      };
      const target = asset(run.mediaText.language, run.mediaText.assetKey);
      const source = asset("en-US", run.mediaText.assetKey);
      target.script = `translated ${source.script}`;
      target.translatedFrom = source.script;
      bump();
    },
    async cancel(_p: string, _a: string, runId: string) {
      cancelled.push(runId);
      const run = runs.find((item) => item.runId === runId)!;
      run.status = "cancelled";
      return run;
    },
  } as unknown as ActivityGeneration;

  let plans = 0;
  const activities = {
    async getActivity() {
      return structuredClone(activity);
    },
    isCanonicalRef() {
      return options.canonical ?? true;
    },
    async planMedia(_p: string, _a: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      plans++;
      activity.draft.mediaPlan = {
        specRevision: contentRevision(activity.draft.spec),
        requirements: {},
        manifest: manifest(options.romanian),
      };
      if (options.sounds)
        activity.draft.mediaPlan.manifest.assets["en-US"]!.push(
          {
            key: "chime",
            type: "audio",
            kind: "sfx",
            description: "Correct answer",
            script: "bright chime",
            path: "media/chime.mp3",
            usages: usage,
          },
          {
            key: "whoosh",
            type: "audio",
            kind: "sfx",
            description: "Page turn",
            script: '<audio kind="sfx" duration="2">soft paper whoosh</audio>',
            usages: usage,
          },
        );
      if (options.music)
        activity.draft.mediaPlan.manifest.assets["en-US"]!.push({
          key: "tune",
          type: "audio",
          kind: "music",
          description: "Background",
          script: "gentle marimba loop",
          usages: usage,
        });
      bump();
    },
  } as unknown as ActivityAuthoring;

  const runner = new PipelineRunner({
    generation,
    activities,
    currentAssessment: async () => ({ items: ["current"] }),
    startTest: async (_p, _a, agentId, expected, runtime) => {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      const run = {
        kind: "test",
        runId: `run_${runs.length + 1}`,
        sessionId: `session_${runs.length + 1}`,
        status: "running",
        error: null,
        agentId,
        codingAgentId: runtime?.codingAgentId,
      } as unknown as ActivityRun;
      runs.push(run);
      started.push("test");
      return run;
    },
    testBrowserInstalled: async () => options.browser ?? true,
    // Yield to the timer queue, as a real wait does, so a held run cannot starve the test.
    pause: () => new Promise((resolve) => setImmediate(resolve)),
    now: () => "2026-09-23T12:00:00Z",
    newId: () => "pipeline_1",
  });
  return {
    runner,
    activity,
    runs,
    started,
    cancelled,
    plans: () => plans,
    generation,
    asset,
    accepted,
    assessmentInputs,
    soundSetups,
  };
}

describe("running the stages", () => {
  it("validates every speech target before recording the first one", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    w.asset("es-MX", "hello").speechProvider = "kokoro";
    w.started.length = 0;
    await w.runner.start("proj", "act", { selection: "speech", agentId: "agent" }).done;
    expect(w.runner.status("act")!.error).toContain("Kokoro does not support es-MX");
    expect(w.started).toEqual([]);
  });
  it("takes an activity from its script to an assembled module, accepting media on the way", async () => {
    const w = world();
    const { state, done } = w.runner.start("proj", "act", { selection: "all", agentId: "agent" });
    expect(state.steps.map((step) => step.status)).toEqual(Array(10).fill("pending"));
    await done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.map((step) => [step.step, step.status])).toEqual([
      ["spec", "succeeded"],
      ["media", "succeeded"],
      ["translations", "skipped"],
      ["speech", "succeeded"],
      // Not a book, so no words to record.
      ["words", "skipped"],
      ["sounds", "skipped"],
      ["images", "succeeded"],
      ["assessment", "skipped"],
      ["module", "succeeded"],
      ["test", "skipped"],
    ]);
    expect(final.steps.at(-1)!.note).toBe("noCriteria");
    expect(w.started).toEqual([
      "spec",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "image:en-US:cat",
      "module",
    ]);
    expect(final.steps[3]).toMatchObject({ done: 2, total: 2 });
    expect(w.activity.draft.mediaPlan!.manifest.assets["es-MX"]![0]!.path).toBe("run_3.wav");
    expect(final.currentRunId).toBeNull();
    expect(final.finishedAt).toBe("2026-09-23T12:00:00Z");
  });

  it("keeps a current media plan instead of rebuilding it", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    expect(w.plans()).toBe(1);
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "planCurrent",
    });
  });

  it("stops at the first failure with the run's own reason, and runs nothing after it", async () => {
    const w = world({ fail: "audio" });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("failed");
    expect(final.error).toBe("audio broke");
    expect(final.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
      "skipped",
      "failed",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(w.started).toEqual(["spec", "audio:en-US:hello"]);
  });

  it("refuses to start without a script, and says so", async () => {
    const w = world({ description: "  " });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(w.runner.status("act")!.error).toBe(
      "Write the activity script before generating the specification.",
    );
    expect(w.started).toEqual([]);
  });

  it("skips media with a coding agent and says why, still assembling with it", async () => {
    const w = world();
    await w.runner.start("proj", "act", {
      selection: "all",
      agentId: "",
      codingAgentId: "codex",
    }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps[3]).toMatchObject({
      status: "skipped",
      note: "needsPenguinAgent",
    });
    expect(w.started).toEqual(["spec", "module"]);
    expect(w.runs.map((run) => run.codingAgentId)).toEqual(["codex", "codex"]);
  });

  it("refuses a second sequence while one runs, and stops the run in flight on request", async () => {
    const w = world();
    // Hold every run open until the test lets go.
    const list = w.generation.list.bind(w.generation);
    let release = false;
    (w.generation as { list: typeof list }).list = async (p, a) =>
      release ? list(p, a) : w.runs.map((run) => ({ ...run, hasCandidate: false }));
    const { done } = w.runner.start("proj", "act", { selection: "all", agentId: "agent" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => w.runner.start("proj", "act", { selection: "all", agentId: "agent" })).toThrow(
      /already running/,
    );
    expect(w.runner.status("act")!.currentRunId).toBe("run_1");
    await w.runner.stop("act");
    release = true;
    await done;
    const final = w.runner.status("act")!;
    expect(w.cancelled).toEqual(["run_1"]);
    expect(final.status).toBe("cancelled");
    expect(final.error).toBeNull();
    expect(final.steps.map((step) => step.status)).toEqual(Array(10).fill("cancelled"));
  });

  it("stops stepping when its component goes away, leaving the run in flight alone", async () => {
    const w = world();
    const list = w.generation.list.bind(w.generation);
    let release = false;
    (w.generation as { list: typeof list }).list = async (p, a) =>
      release ? list(p, a) : w.runs.map((run) => ({ ...run, hasCandidate: false }));
    const { done } = w.runner.start("proj", "act", { selection: "all", agentId: "agent" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    w.runner.dispose();
    release = true;
    await done;
    expect(w.started).toEqual(["spec"]);
    expect(w.cancelled).toEqual([]);
    expect(w.runner.status("act")!.status).toBe("cancelled");
  });

  it("translates what a language lacks before speaking it, and leaves hand-written lines be", async () => {
    const w = world({ romanian: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    // es-MX "Hola" has no recorded source, so it was written, not translated: left alone.
    expect(w.started).toEqual([
      "spec",
      "media-text:ro-RO:hello",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "audio:ro-RO:hello",
      "image:en-US:cat",
      "module",
    ]);
    const ro = w.activity.draft.mediaPlan!.manifest.assets["ro-RO"]![0]!;
    expect(ro).toMatchObject({ script: "translated Hello", translatedFrom: "Hello" });
    expect(w.runs.find((run) => run.kind === "media-text")).toMatchObject({
      mediaText: { language: "ro-RO", assetKey: "hello", translate: true },
    });
  });

  it("finds narrations never translated, or translated from a line since rewritten", () => {
    const plan = manifest(true);
    plan.assets["es-MX"]![0]!.translatedFrom = "Hi there";
    expect(translationTargets(plan)).toEqual([
      { language: "es-MX", assetKey: "hello" },
      { language: "ro-RO", assetKey: "hello" },
    ]);
    plan.assets["es-MX"]![0]!.translatedFrom = "Hello";
    expect(translationTargets(plan)).toEqual([{ language: "ro-RO", assetKey: "hello" }]);
  });

  it("translates and speaks one language in one go, touching no other", async () => {
    const w = world({ romanian: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const ro = w.activity.draft.mediaPlan!.manifest.assets["ro-RO"]![0]!;
    delete ro.path;
    delete ro.script;
    delete ro.translatedFrom;
    w.started.length = 0;
    const { state, done } = w.runner.start("proj", "act", {
      selection: "narration",
      agentId: "agent",
      scope: { language: "ro-RO" },
    });
    expect(state.scope).toEqual({ language: "ro-RO" });
    await done;
    expect(w.started).toEqual(["media-text:ro-RO:hello", "audio:ro-RO:hello"]);
    expect(w.runner.status("act")!.status).toBe("succeeded");
  });

  it("speaks each narration in its own saved voice, and the run's voice where none is saved", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    for (const language of ["en-US", "es-MX"]) delete w.asset(language, "hello").path;
    w.asset("en-US", "hello").voice = "Fenrir";
    w.asset("es-MX", "hello").voice = "Retired voice";
    const before = w.runs.length;
    await w.runner.start("proj", "act", { selection: "speech", agentId: "agent", voice: "Puck" })
      .done;
    expect(w.runner.status("act")!.status).toBe("succeeded");
    expect(
      w.runs.slice(before).map((run) => [run.audio!.language, (run.audio as any).voice]),
    ).toEqual([
      ["en-US", "Fenrir"],
      ["es-MX", "Puck"],
    ]);
  });

  it("writes and accepts the assessment when the specification uses one, handing it the current one", async () => {
    const w = world({ usesAssessment: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "assessment")).toMatchObject({
      status: "succeeded",
      note: null,
      runIds: ["run_5"],
    });
    expect(w.started).toEqual([
      "spec",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "image:en-US:cat",
      "assessment",
      "module",
    ]);
    expect(w.accepted).toEqual(["run_5"]);
    expect(w.assessmentInputs).toEqual([{ current: { items: ["current"] } }]);
  });

  it("skips the assessment with a worded note when it is unused or the ref does not own it", async () => {
    const unused = world({ usesAssessment: false });
    await unused.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(
      unused.runner.status("act")!.steps.find((step) => step.step === "assessment"),
    ).toMatchObject({ status: "skipped", note: "noAssessment" });
    const shared = world({ usesAssessment: true, canonical: false });
    await shared.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(
      shared.runner.status("act")!.steps.find((step) => step.step === "assessment"),
    ).toMatchObject({ status: "skipped", note: "notCanonical" });
    expect(shared.accepted).toEqual([]);
    expect(shared.started).not.toContain("assessment");
  });

  it("stops at a failed assessment run with its own reason", async () => {
    const w = world({ usesAssessment: true, fail: "assessment" });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("failed");
    expect(final.error).toBe("assessment broke");
    expect(final.steps.at(-1)!.status).toBe("cancelled");
  });

  it("runs the acceptance tests after assembly when there are criteria and a test browser", async () => {
    const w = world({ criteria: ["Tapping the cat plays its name."] });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.at(-1)).toMatchObject({ step: "test", status: "succeeded", note: null });
    expect(w.started.slice(-2)).toEqual(["module", "test"]);
    expect(final.steps.at(-1)!.runIds).toEqual([w.runs.at(-1)!.runId]);
  });

  it("skips the tests with a worded note without criteria or without the test browser", async () => {
    const none = world();
    await none.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await none.runner.start("proj", "act", { selection: "test", agentId: "agent" }).done;
    expect(none.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "noCriteria",
    });
    const noBrowser = world({ criteria: ["It starts."], browser: false });
    await noBrowser.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await noBrowser.runner.start("proj", "act", { selection: "test", agentId: "agent" }).done;
    expect(noBrowser.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "noBrowser",
    });
    expect([...none.started, ...noBrowser.started]).not.toContain("test");
  });

  it("stops at a failed test run with its own reason", async () => {
    const w = world({ criteria: ["It starts."], fail: "test" });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("failed");
    expect(final.error).toBe("test broke");
    expect(final.steps.at(-1)!.status).toBe("failed");
  });

  it("limits targets to the scope's language and asset", () => {
    const targets = [
      { language: "ro-RO", assetKey: "a" },
      { language: "ro-RO", assetKey: "b" },
      { language: "es-MX", assetKey: "a" },
    ];
    expect(inScope(targets, undefined)).toEqual(targets);
    expect(inScope(targets, { language: "ro-RO" })).toEqual(targets.slice(0, 2));
    expect(inScope(targets, { language: "ro-RO", assetKey: "b" })).toEqual([targets[1]]);
  });
});

describe("the sounds step", () => {
  it("finds unbound music and effects with a usable prompt, and no narration", () => {
    const plan = manifest();
    plan.assets["en-US"]!.push(
      {
        key: "bound",
        type: "audio",
        kind: "sfx",
        description: "b",
        script: "x",
        path: "a.mp3",
        usages: usage,
      },
      {
        key: "tune",
        type: "audio",
        kind: "music",
        description: "m",
        script: "marimba loop",
        usages: usage,
      },
      {
        key: "empty",
        type: "audio",
        kind: "sfx",
        description: "e",
        script: '<audio kind="sfx"> </audio>',
        usages: usage,
      },
      {
        key: "long",
        type: "audio",
        kind: "sfx",
        description: "l",
        script: "x".repeat(2001),
        usages: usage,
      },
    );
    expect(soundTargets(plan)).toEqual([{ language: "en-US", assetKey: "tune" }]);
  });

  it("generates and accepts the one sound with a prompt and no file, after speech, leaving narration as it was", async () => {
    const w = world({ sounds: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "sounds")).toMatchObject({
      status: "succeeded",
      note: null,
      done: 1,
      total: 1,
      runIds: ["run_4"],
    });
    expect(w.started).toEqual([
      "spec",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "sound:elevenlabs:en-US:whoosh",
      "image:en-US:cat",
      "module",
    ]);
    expect(w.asset("en-US", "whoosh").path).toBe("run_4.mp3");
    expect(w.asset("en-US", "chime").path).toBe("media/chime.mp3");
    expect(w.soundSetups).toEqual(["agent"]);
  });

  it("uses the provider the sequence names", async () => {
    const w = world({ sounds: true });
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      soundProvider: "agenthub",
    }).done;
    expect(w.started.at(-1)).toBe("sound:agenthub:en-US:whoosh");
  });

  it("skips with noSounds when nothing is missing, without asking about providers", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(w.runner.status("act")!.steps.find((step) => step.step === "sounds")).toMatchObject({
      status: "skipped",
      note: "noSounds",
    });
    expect(w.soundSetups).toEqual([]);
  });

  it("skips, not fails, when the provider cannot be used, and runs the stages after it", async () => {
    const w = world({ sounds: true, soundProviders: { elevenlabs: false } });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "sounds")).toMatchObject({
      status: "skipped",
      note: "soundProviderUnavailable",
      runIds: [],
    });
    expect(w.started).not.toContain("sound:elevenlabs:en-US:whoosh");
    expect(w.started.at(-1)).toBe("module");
  });

  it("makes only the kinds the provider can make now, and skips when it can make none", async () => {
    // The hub's one usable model makes effects only; its music model has no key.
    const hubModels = [
      { id: "fx", kinds: ["sfx" as const], credential: "FX_KEY", available: true },
      { id: "tunes", kinds: ["music" as const], credential: "MUSIC_KEY", available: false },
    ];
    const w = world({ sounds: true, music: true, hubModels });
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      soundProvider: "agenthub",
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "succeeded",
      done: 1,
      total: 1,
    });
    expect(w.started.filter((entry) => entry.startsWith("sound:"))).toEqual([
      "sound:agenthub:en-US:whoosh",
    ]);
    expect(w.asset("en-US", "tune").path).toBeUndefined();

    // With only the music left, the provider can make nothing: skipped, not failed.
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      soundProvider: "agenthub",
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "soundProviderUnavailable",
    });
    expect(w.started.filter((entry) => entry.startsWith("sound:"))).toHaveLength(1);
  });

  it("keeps to the scope's language, and skips for a coding agent", async () => {
    const w = world({ sounds: true });
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      scope: { language: "es-MX" },
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "skipped", note: "noSounds" });
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "",
      codingAgentId: "codex",
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "needsPenguinAgent",
    });
    expect(w.started).toEqual(["spec"]);
  });
});

/** A decodable book's plan with words: one ready to record, one recorded, one unsounded. */
function wordWorld(
  options: {
    activityType?: "book" | "standard";
    bookMode?: "decodable" | "readAlong" | null;
    elevenlabs?: boolean;
    words?: MediaAsset[];
  } = {},
) {
  const word = (normalized: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
    key: `book-word-${normalized}`,
    type: "audio",
    role: "bookWord",
    description: normalized,
    word: normalized,
    normalizedWord: normalized,
    usages: usage,
    ...extra,
  });
  let revision = 1;
  const activity = {
    id: "act",
    productCode: "words",
    refNum: 1,
    activityType: options.activityType ?? "book",
    draft: {
      contentRevision: "r1",
      description: "A book",
      status: "valid",
      spec: {},
      mediaPlan: {
        specRevision: "s",
        requirements: {},
        manifest: {
          productCode: "words",
          refNum: 1,
          assets: {
            "en-US": options.words ?? [
              word("cat", { phonemes: ["k", "æ", "t"] }),
              word("sat", { phonemes: ["s", "æ", "t"], path: "media/sat.wav", script: "x" }),
              word("ran"),
              word("the", { phonemes: ["ð", "ə"], speechProvider: "gemini", voice: "Puck" }),
            ],
          },
        } as AssetManifest,
      },
    },
  };
  const bump = () => (activity.draft.contentRevision = `r${++revision}`);
  const group = () => activity.draft.mediaPlan.manifest.assets["en-US"]!;
  const runs: ActivityRun[] = [];
  const started: unknown[] = [];
  const prepared: string[] = [];
  const generation = {
    async start(_p: string, _a: string, agentId: string, expected: string, module?: any) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      const asset = group().find((item) => item.key === module.audio.assetKey)!;
      started.push({ ...module.audio, script: asset.script });
      const run = {
        kind: "audio",
        runId: `run_${runs.length + 1}`,
        sessionId: `session_${runs.length + 1}`,
        status: "running",
        error: null,
        agentId,
        audio: module.audio,
      } as unknown as ActivityRun;
      runs.push(run);
      return run;
    },
    async list() {
      for (const run of runs) if (run.status === "running") run.status = "succeeded";
      return runs.map((run) => ({ ...run, hasCandidate: true }));
    },
    async speechSetup() {
      return {
        providers: [
          { id: "gemini", available: true },
          { id: "elevenlabs", available: options.elevenlabs ?? true },
        ],
      };
    },
    async acceptAudio(_p: string, _a: string, runId: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      const run = runs.find((item) => item.runId === runId)!;
      group().find((item) => item.key === run.audio!.assetKey)!.path = `media/${runId}.mp3`;
      bump();
    },
  } as unknown as ActivityGeneration;
  const activities = {
    async getActivity() {
      return structuredClone(activity);
    },
    async bookWordsState() {
      return { bookMode: options.bookMode === undefined ? "decodable" : options.bookMode };
    },
    async prepareWordRecordings(
      _p: string,
      _a: string,
      provider: SpeechProviderId,
      expected: string,
      language?: string,
    ) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      prepared.push(`${provider}:${language ?? "all"}`);
      const before = structuredClone(group());
      for (const asset of group())
        if (asset.phonemes?.length && !asset.path && !asset.speechProvider)
          asset.speechProvider = provider;
      syncWordScripts(group(), before);
      bump();
      return structuredClone(activity.draft);
    },
  } as unknown as ActivityAuthoring;
  const runner = new PipelineRunner({
    generation,
    activities,
    pause: () => new Promise((resolve) => setImmediate(resolve)),
    now: () => "2026-09-25T12:00:00Z",
    newId: () => "pipeline_words",
  });
  return { runner, activity, group, started, prepared, word };
}

describe("the words step", () => {
  it("records each word with sounds and no recording, in its provider's script, and accepts it", async () => {
    const w = wordWorld();
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent", voice: "Kore" })
      .done;
    const step = w.runner.status("act")!.steps[0]!;
    expect(step).toMatchObject({ step: "words", status: "succeeded", done: 2, total: 2 });
    // ElevenLabs can be used, so the word naming no provider takes it; "the" keeps Gemini.
    expect(w.prepared).toEqual(["elevenlabs:all"]);
    expect(w.started).toEqual([
      {
        language: "en-US",
        assetKey: "book-word-cat",
        provider: "elevenlabs",
        voice: ELEVENLABS_DEFAULT_VOICE,
        script: drawnOutScript("cat", ["k", "æ", "t"]),
      },
      {
        language: "en-US",
        assetKey: "book-word-the",
        provider: "gemini",
        voice: "Puck",
        script: geminiScript("the", ["ð", "ə"]),
      },
    ]);
    expect(w.group().find((item) => item.key === "book-word-cat")!.path).toBe("media/run_1.mp3");
    // The word without sounds is left for later.
    expect(w.group().find((item) => item.key === "book-word-ran")!.path).toBeUndefined();
  });

  it("speaks with Gemini when the agent cannot use ElevenLabs", async () => {
    const w = wordWorld({ elevenlabs: false });
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.prepared).toEqual(["gemini:all"]);
    expect(w.started[0]).toMatchObject({
      assetKey: "book-word-cat",
      provider: "gemini",
      script: geminiScript("cat", ["k", "æ", "t"]),
    });
  });

  it("skips with a note for anything but a decodable book, a coding agent, or nothing to record", async () => {
    const skipped = async (world: ReturnType<typeof wordWorld>, input = {}) => {
      await world.runner.start("proj", "act", { selection: "words", agentId: "agent", ...input })
        .done;
      return world.runner.status("act")!.steps[0]!;
    };
    expect(await skipped(wordWorld({ activityType: "standard" }))).toMatchObject({
      status: "skipped",
      note: "notDecodable",
    });
    expect(await skipped(wordWorld({ bookMode: "readAlong" }))).toMatchObject({
      note: "notDecodable",
    });
    // No mode recorded: the sequence's choice counts, and so do words already listed.
    expect(
      await skipped(wordWorld({ bookMode: null, words: [] }), { bookMode: "readAlong" }),
    ).toMatchObject({ note: "notDecodable" });
    expect(await skipped(wordWorld({ bookMode: null }))).toMatchObject({ status: "succeeded" });
    expect(await skipped(wordWorld(), { agentId: "", codingAgentId: "codex" })).toMatchObject({
      note: "needsPenguinAgent",
    });
    const unsounded = wordWorld();
    unsounded.activity.draft.mediaPlan.manifest.assets["en-US"] = [unsounded.word("ran")];
    expect(await skipped(unsounded)).toMatchObject({ note: "wordsMissingSounds" });
    const recorded = wordWorld();
    recorded.activity.draft.mediaPlan.manifest.assets["en-US"] = [];
    expect(await skipped(recorded)).toMatchObject({ note: "noWords" });
    expect(recorded.prepared).toEqual([]);
  });

  it("keeps to the scope's language", async () => {
    const w = wordWorld();
    await w.runner.start("proj", "act", {
      selection: "words",
      agentId: "agent",
      scope: { language: "es-MX" },
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "skipped", note: "noWords" });
    expect(w.started).toEqual([]);
  });
});
