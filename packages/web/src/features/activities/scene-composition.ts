/**
 * The scene-video experiment's derivations, kept apart from the view so they can be tested
 * without a DOM: which compositions belong to an asset, whether its scene has an image to
 * compose from, what a kept composition's frames are, how a failed run is worded, and what the
 * preview frame reports about itself.
 */
import type {
  ActivityRunSummary,
  AssetManifest,
  CompositionCandidate,
  CompositionFrame,
  CompositionProblemCode,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

type Asset = AssetManifest["assets"][string][number];

/** The asset's composition runs, newest first. */
export function compositionRuns(
  runs: readonly ActivityRunSummary[],
  language: string,
  assetKey: string,
): ActivityRunSummary[] {
  return runs
    .filter(
      (run) =>
        run.kind === "composition" &&
        run.composition?.language === language &&
        run.composition.assetKey === assetKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The scene a video or animation asset belongs to: the first that uses it. */
export function compositionScene(asset: Asset): string | null {
  return asset.usages[0]?.sceneId ?? null;
}

/** Whether the asset's scene has an image with a file bound, which a composition is made from. */
export function sceneHasImage(group: readonly Asset[], asset: Asset): boolean {
  const scene = compositionScene(asset);
  return (
    !!scene &&
    group.some(
      (entry) =>
        entry.type === "image" &&
        !!entry.path &&
        entry.usages.some((usage) => usage.sceneId === scene),
    )
  );
}

/** Fields a scene may use for what the learner chooses between. */
const CHOICE_FIELDS = ["choices", "options", "answers", "interactions", "interaction"] as const;

/**
 * Whether the scene asks the learner to choose something, which a video cannot do. Advisory
 * only: the author is warned, and may still compose the scene.
 */
export function sceneHasLearnerChoice(spec: unknown, sceneId: string | null): boolean {
  if (!sceneId || !spec || typeof spec !== "object") return false;
  const { scenes, stages } = spec as { scenes?: unknown; stages?: unknown };
  const list = Array.isArray(scenes) ? scenes : Array.isArray(stages) ? stages : [];
  const scene = list.find(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && (entry as { id?: unknown }).id === sceneId,
  );
  if (!scene) return false;
  return CHOICE_FIELDS.some((field) => {
    const value = scene[field];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return typeof value === "string" && value.trim() !== "";
  });
}

/** Whether a run kept a composition the preview can show. */
export function isShowable(run: ActivityRunSummary): boolean {
  return run.hasCandidate && (run.status === "succeeded" || run.status === "conflict");
}

/** A kept composition's candidate, or null when it is not one. */
export function parseCandidate(text: string | null): CompositionCandidate | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const candidate = value as Partial<CompositionCandidate> | null;
  if (!candidate || !Array.isArray(candidate.frames) || typeof candidate.seconds !== "number")
    return null;
  const frames = candidate.frames.filter(
    (frame): frame is CompositionFrame =>
      !!frame &&
      typeof frame.id === "string" &&
      typeof frame.description === "string" &&
      typeof frame.seconds === "number",
  );
  return {
    frames,
    seconds: candidate.seconds,
    sha256: String(candidate.sha256 ?? ""),
    bytes: Number(candidate.bytes ?? 0),
  };
}

/** Seconds as the studio shows them: whole, or to one decimal place. */
export function formatSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

const PROBLEMS: readonly CompositionProblemCode[] = [
  "composition_network",
  "composition_reference",
  "composition_timeline",
  "composition_template",
  "composition_random",
  "composition_size",
  "composition_frames",
];

/** Why a run did not keep a composition, in the App's words when the server named a check. */
export function compositionFailure(run: ActivityRunSummary): string | null {
  const code = run.composition?.problem;
  if (code && PROBLEMS.includes(code)) return S.activities.video.problems[code];
  return run.error;
}

/** What the preview frame says it is doing, as the bridge script reports it. */
export type PreviewState =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "broken"
  /** The frame loaded but its page never reported in: refused, changed, or switched off. */
  | "unavailable";

/** How long a loaded frame has to report in before the preview says it is unavailable. */
export const PREVIEW_GRACE_MS = 4000;

/**
 * A message from the composition's bridge script, or null for anything else: the frame is
 * agent-written, so only a known state is taken from it.
 */
export function previewState(data: unknown): PreviewState | null {
  const message = data as { source?: unknown; state?: unknown } | null;
  if (!message || typeof message !== "object" || message.source !== "penguin-composition")
    return null;
  return ["ready", "playing", "paused", "ended", "broken"].includes(message.state as string)
    ? (message.state as PreviewState)
    : null;
}

/** The message that asks the preview frame to play, pause or restart. */
export function previewCommand(action: "play" | "pause" | "restart") {
  return { source: "penguin-studio", action } as const;
}
