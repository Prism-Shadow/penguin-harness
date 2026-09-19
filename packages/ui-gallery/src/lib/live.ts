/**
 * Live variants in the gallery's addresses and messages — pure, so the rules are unit-tested.
 *
 *   /embed?module=navigation&variant=live-collapse                  paused on the last frame
 *   /embed?module=navigation&variant=live-collapse&frame=rail       paused on `rail`
 *   /embed?module=navigation&variant=live-collapse&play=1           playing from the first frame
 *   /embed?module=navigation&variant=live-collapse&frame=rail&play=1
 *
 * An embed is a screenshot unit before it is anything else, so by default it holds still on the
 * frame a scene settles into; `frame=` picks another (an unknown key reads as the last frame). A
 * compare frame carries `sync=1` instead: its clock belongs to the card around it, which posts its
 * timeline as `gallery:clock` messages — the frame's src never changes with the frame, so it never
 * reloads mid-scene.
 */
import type { SceneFrame } from "../../../ui/src/module";
import { frameIndexOf } from "../../../ui/src/scene";
import type { SceneTimeline } from "../../../ui/src/scene";

export interface SceneCue {
  index: number;
  playing: boolean;
}

/** Where an embed's clock starts, from its `frame` and `play` params. */
export function parseEmbedCue(frames: readonly SceneFrame[], search: string): SceneCue {
  const params = new URLSearchParams(search);
  const playing = params.get("play") === "1";
  const last = Math.max(0, frames.length - 1);
  const key = params.get("frame");
  if (key === null) return { index: playing ? 0 : last, playing };
  const index = frameIndexOf(frames, key);
  return { index: index === -1 ? last : index, playing };
}

/** The card → compare frame message: the one clock, for one module variant. */
export const CLOCK_MESSAGE = "gallery:clock";
/** Compare frame → card: "I am listening", answered with the current timeline. */
export const CLOCK_READY = "gallery:clock-ready";

export interface ClockMessage {
  type: typeof CLOCK_MESSAGE;
  module: string;
  variant: string;
  timeline: SceneTimeline;
}

export function clockMessage(module: string, variant: string, t: SceneTimeline): ClockMessage {
  const { index, playing, rate, frameStartedAt, pausedElapsed } = t;
  return {
    type: CLOCK_MESSAGE,
    module,
    variant,
    timeline: { index, playing, rate, frameStartedAt, pausedElapsed },
  };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The timeline a message carries for this module variant, or null for anything else — a stray
 * message, or one meant for the variant the frame showed before its src changed.
 */
export function readClockMessage(
  data: unknown,
  module: string,
  variant: string,
): SceneTimeline | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Partial<ClockMessage>;
  if (message.type !== CLOCK_MESSAGE || message.module !== module || message.variant !== variant)
    return null;
  const t = (message.timeline ?? {}) as Partial<Record<keyof SceneTimeline, unknown>>;
  const { index, playing, rate, frameStartedAt, pausedElapsed } = t;
  if (typeof playing !== "boolean" || !finite(index) || !finite(rate) || rate <= 0) return null;
  if (!finite(frameStartedAt) || !finite(pausedElapsed)) return null;
  return { index, playing, rate, frameStartedAt, pausedElapsed };
}
