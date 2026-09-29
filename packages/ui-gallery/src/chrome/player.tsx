/**
 * Playing scenes: the clock a variant's section owns, the clock a framed embed follows, and the
 * controls in the section's toolbar and under its preview.
 *
 * Nothing plays unasked. A section's clock starts settled — paused at the end of the last frame,
 * which is the variant itself — and moves only when the reader presses play; the scene then runs
 * once and settles again. The clock wakes only when the current frame's hold runs out — nothing
 * ticks in between, so a frame change re-renders the section once; a composition that moves within
 * a frame (a stream, a typing field) asks `useFrameTime()` for its own animation-frame updates.
 *
 * Compare mode and the phone view keep one clock: the section's. It posts its timeline to each
 * `/embed` frame, which renders from that timeline and `Date.now()` alone and never advances on
 * its own, so the three themes show the same frame at the same moment.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Module, ModuleVariant, SceneFrame, SceneSpec } from "../../../ui/src/module";
import {
  cueTimeline,
  frameElapsed,
  holdOf,
  isSettled,
  msToNextFrame,
  SCENE_RATES,
  sceneClock,
  sceneControls,
  sceneReducer,
  settledTimeline,
} from "../../../ui/src/scene";
import type {
  SceneAction,
  SceneClock,
  SceneCommand,
  SceneControls,
  SceneTimeline,
} from "../../../ui/src/scene";
import { CLOCK_READY, controlMessage, readClockMessage } from "../lib/live";
import type { SceneCue } from "../lib/live";
import { useText } from "../preview";
import { useGallery } from "../state";
import { Segmented } from "./controls";
import { ChromeIcon } from "./icons";
import type { ChromeIconName } from "./icons";

export type { SceneCommand } from "../../../ui/src/scene";

interface Held {
  frames: readonly SceneFrame[];
  timeline: SceneTimeline;
  /** The reader has played this scene (so a settled clock reads Replay, not Play). */
  ran: boolean;
}

export interface ScenePlayer {
  /** Null for a variant without a scene. */
  clock: SceneClock | null;
  /** True once the reader has pressed play on this variant's scene. */
  ran: boolean;
  /** A reader's command from the controls, or a framed embed's relayed one. */
  control: (command: SceneCommand) => void;
  /** The same clock as a composition may drive it; null without a scene. */
  controls: SceneControls | null;
}

/**
 * The clock a section (or a standalone `/embed`) owns for the variant it shows. A different
 * scene starts afresh, settled; no scene, no clock.
 */
export function useScenePlayer(
  scene: SceneSpec | undefined,
  {
    reduced,
    start,
  }: {
    reduced: boolean;
    /** Where a scene starts. Default: settled, on the last frame. */
    start?: (frames: readonly SceneFrame[]) => SceneCue;
  },
): ScenePlayer {
  const frames = scene?.frames;

  const begin = (list: readonly SceneFrame[]): Held => {
    const now = Date.now();
    const cue = start?.(list);
    const timeline = cue
      ? cueTimeline(list, cue.index, { playing: cue.playing, now })
      : settledTimeline(list, now);
    return { frames: list, timeline, ran: timeline.playing };
  };
  const [held, setHeld] = useState<Held | null>(() => (frames ? begin(frames) : null));
  let current = held;
  if ((frames ?? null) !== (held?.frames ?? null)) {
    // Another scene: it starts afresh (React re-renders before painting).
    current = frames ? begin(frames) : null;
    setHeld(current);
  }

  const control = useCallback((command: SceneCommand) => {
    const action = { ...command, now: Date.now() } as SceneAction;
    const played =
      action.type === "play" || action.type === "restart" || action.type === "playFrom";
    setHeld((h) => {
      if (!h) return h;
      const timeline = sceneReducer(h.frames, h.timeline, action);
      const ran = h.ran || played;
      // A tick that moved nothing still gets a new object: a timer that fired a millisecond early
      // must be scheduled again. Any other command that moved nothing (a composition settling an
      // already settled clock on every keystroke) leaves the state, and every reader, alone.
      if (action.type !== "tick" && timeline === h.timeline && ran === h.ran) return h;
      return { frames: h.frames, timeline, ran };
    });
  }, []);

  // The one timer: the moment the current frame's hold runs out.
  useEffect(() => {
    if (!held) return;
    const delay = msToNextFrame(held.frames, held.timeline, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => control({ type: "tick" }), Math.ceil(delay));
    return () => window.clearTimeout(timer);
  }, [held, control]);

  const clock = useMemo(
    () => (current ? sceneClock(current.frames, current.timeline, reduced) : null),
    [current, reduced],
  );
  const controls = useMemo(
    () => (current ? sceneControls(current.frames, control) : null),
    [current, control],
  );
  return { clock, ran: current?.ran ?? false, control, controls };
}

/**
 * A framed embed's clock: the section's timeline, as its `gallery:clock` messages deliver it.
 * Until the first message the frame holds still, settled, as any embed does. Its controls send
 * each command up to the section as a `gallery:control` message, so a reader's move inside a
 * framed mock moves the one clock the section owns.
 */
export function useFollowedClock(
  scene: SceneSpec | undefined,
  module: string,
  variant: string,
  reduced: boolean,
): { clock: SceneClock | null; controls: SceneControls | null } {
  const frames = scene?.frames;
  const [timeline, setTimeline] = useState<SceneTimeline | null>(null);
  useEffect(() => {
    if (!frames || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const next = readClockMessage(event.data, module, variant);
      if (next) setTimeline(next);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: CLOCK_READY }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [frames, module, variant]);
  const clock = useMemo(() => {
    if (!frames) return null;
    return sceneClock(frames, timeline ?? settledTimeline(frames, 0), reduced);
  }, [frames, timeline, reduced]);
  const controls = useMemo(() => {
    if (!frames || window.parent === window) return null;
    return sceneControls(frames, (command) =>
      window.parent.postMessage(controlMessage(module, variant, command), window.location.origin),
    );
  }, [frames, module, variant]);
  return { clock, controls };
}

// ---------------------------------------------------------------------------------------------
// The controls
// ---------------------------------------------------------------------------------------------

/**
 * The toolbar's play control: Play on a settled clock (the scene runs once from the top), Pause
 * while it runs, Play again from wherever it was paused, Replay once it has run and settled again.
 */
export function PlayButton({
  clock,
  ran,
  control,
}: {
  clock: SceneClock;
  ran: boolean;
  control: (command: SceneCommand) => void;
}) {
  const { S } = useGallery();
  const replay = ran && isSettled(clock.frames, clock);
  const primary: { icon: ChromeIconName; label: string; command: SceneCommand } = clock.playing
    ? { icon: "pause", label: S.transport.pause, command: { type: "pause" } }
    : replay
      ? { icon: "restart", label: S.transport.replay, command: { type: "restart" } }
      : { icon: "play", label: S.transport.play, command: { type: "play" } };
  return (
    <button
      type="button"
      className="g-tool g-tool-primary"
      data-playing={clock.playing || undefined}
      onClick={() => control(primary.command)}
    >
      <ChromeIcon name={primary.icon} size={13} />
      <span>{primary.label}</span>
    </button>
  );
}

function StepButton({
  icon,
  title,
  onClick,
}: {
  icon: ChromeIconName;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="g-tool g-tool-icon"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <ChromeIcon name={icon} size={14} />
    </button>
  );
}

/** Any change to where the current frame stands restarts its progress animation. */
const progressKey = (c: SceneClock) =>
  [c.index, c.frameStartedAt, c.pausedElapsed, c.playing, c.rate].join(":");

/**
 * How far the current frame has run, drawn by one CSS animation per frame, so nothing re-renders to
 * move it. The style is measured once: the caller's key remounts the bar whenever the timeline
 * moves, and a later re-render must not shift a running animation's delay.
 */
function FrameProgress({ clock }: { clock: SceneClock }) {
  const [style] = useState(() => {
    const hold = holdOf(clock.frames[clock.index]);
    const spent = frameElapsed(clock.frames, clock, Date.now());
    return {
      animationDuration: `${hold / clock.rate}ms`,
      animationDelay: `${-spent / clock.rate}ms`,
      animationPlayState: clock.playing ? "running" : "paused",
    };
  });
  return <span className="g-scene-progress" aria-hidden style={style} />;
}

/**
 * The strip under an animated preview: the previous and next frame, a chip per frame (the current
 * one pressed, with its progress), and the speed. Quiet — plain text on the page, no box.
 */
export function FrameStrip({
  module,
  variant,
  clock,
  control,
}: {
  module: Module;
  variant: ModuleVariant;
  clock: SceneClock;
  control: (command: SceneCommand) => void;
}) {
  const { S } = useGallery();
  const text = useText();
  return (
    <div className="g-frames" role="group" aria-label={S.transport.label}>
      <StepButton
        icon="previous"
        title={S.transport.previous}
        onClick={() => control({ type: "step", by: -1 })}
      />
      <div className="g-scene-frames" role="group" aria-label={S.transport.frames}>
        {clock.frames.map((frame, index) => (
          <button
            key={frame.key}
            type="button"
            className="g-scene-chip"
            aria-pressed={index === clock.index}
            title={frame.key}
            onClick={() => control({ type: "jump", index })}
          >
            {text.frame(module, variant, frame)}
            {index === clock.index && <FrameProgress key={progressKey(clock)} clock={clock} />}
          </button>
        ))}
      </div>
      <StepButton
        icon="next"
        title={S.transport.next}
        onClick={() => control({ type: "step", by: 1 })}
      />
      <Segmented
        label={S.transport.rate}
        value={String(clock.rate)}
        options={SCENE_RATES.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
        onChange={(rate) => control({ type: "rate", rate: Number(rate) })}
      />
    </div>
  );
}
