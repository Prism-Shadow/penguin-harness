/**
 * The window's one timed thing: the scripted reply to a prompt the reader sends.
 *
 * The window runs its own clock rather than a gallery card's, because nothing in it plays until
 * the reader asks — it opens settled, on a Task that has already answered, and every other move
 * (a page, a Session, the rail, a dock tab) is plain state (hero/shell.ts). Sending plays the
 * reply once from `working` through `answer` to `settled`, where the clock stops again. The
 * clock is the package's own (scene.tsx), provided to the chat column, so the transcript's parts
 * — the work group, the streamed text, the caret — read it exactly as they read a card's.
 */
import { useEffect, useMemo, useReducer, useState } from "react";
import type { SceneFrame, SceneSpec } from "../module";
import {
  msToNextFrame,
  reached,
  sceneClock,
  sceneControls,
  sceneReducer,
  settledTimeline,
} from "../scene";
import type { SceneAction, SceneClock, SceneControls, SceneTimeline } from "../scene";

/** The reply's frames in play order. The last one is what the window shows at rest. */
export const REPLY_FRAMES: readonly SceneFrame[] = [
  { key: "working", title: "Working", hold: 2600 },
  { key: "answer", title: "Answer", hold: 3200 },
  { key: "settled", title: "Settled", hold: 1800 },
];

export const REPLY_SCENE: SceneSpec = { frames: REPLY_FRAMES };

/**
 * Reduced motion, as the gallery marks it on the document root or the system asks for it. Read
 * once per window: under it the frames still step, but a stream shows its whole text at once.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.motion === "reduced") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const advance = (timeline: SceneTimeline, action: SceneAction) =>
  sceneReducer(REPLY_FRAMES, timeline, action);

/**
 * The reply's clock and its controls, settled until `playFrom("working")`. Only a playing clock
 * schedules anything: one timeout to the end of the current frame, which moves it on.
 */
export function useReplyClock(): { clock: SceneClock; controls: SceneControls } {
  const [timeline, dispatch] = useReducer(advance, 0, (now) => settledTimeline(REPLY_FRAMES, now));
  const [reduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const wait = msToNextFrame(REPLY_FRAMES, timeline, Date.now());
    if (wait === null) return;
    // A millisecond past the hold, so the tick never lands early and leaves the frame in place.
    const id = window.setTimeout(
      () => dispatch({ type: "tick", now: Date.now() }),
      Math.ceil(wait) + 1,
    );
    return () => window.clearTimeout(id);
  }, [timeline]);
  const controls = useMemo(
    () =>
      sceneControls(REPLY_FRAMES, (command) =>
        dispatch({ ...command, now: Date.now() } as SceneAction),
      ),
    [],
  );
  const clock = useMemo(() => sceneClock(REPLY_FRAMES, timeline, reduced), [timeline, reduced]);
  return { clock, controls };
}

// ---------------------------------------------------------------------------------------------
// What a frame names
// ---------------------------------------------------------------------------------------------

/** How far the second turn has got: working, answering, or settled. */
export type HeroTurn = "working" | "answering" | "settled";

export function heroTurn(clock: SceneClock | null): HeroTurn {
  if (!reached(clock, "answer")) return "working";
  return reached(clock, "settled") ? "settled" : "answering";
}

/** What the composer holds: nothing, the reader's draft, or a run (stop instead of send). */
export type HeroComposer = "empty" | "draft" | "running";

export function heroComposer(clock: SceneClock | null, draft: string): HeroComposer {
  if (draft !== "") return "draft";
  return heroTurn(clock) === "settled" ? "empty" : "running";
}
