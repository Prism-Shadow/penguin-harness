/**
 * Playing live variants: the clock a card owns, the clock a compare frame follows, and the
 * transport in the card's foot.
 *
 * A card's clock wakes only when the current frame's hold runs out — nothing ticks in between, so a
 * frame change re-renders the card once; a composition that moves within a frame (a stream, a
 * typing field) asks `useFrameTime()` for its own animation-frame updates. The card plays while it
 * is on screen and pauses when it scrolls away, unless the reader paused it, in which case it waits
 * for the reader.
 *
 * Compare mode keeps one clock: the card's. It posts its timeline to each theme's `/embed` frame,
 * which renders from that timeline and `Date.now()` alone and never advances on its own, so the
 * three themes show the same frame at the same moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Module, ModuleVariant, SceneFrame, SceneSpec } from "../../../ui/src/module";
import {
  cueTimeline,
  frameElapsed,
  holdOf,
  msToNextFrame,
  SCENE_RATES,
  sceneClock,
  sceneReducer,
} from "../../../ui/src/scene";
import type { SceneAction, SceneClock, SceneTimeline } from "../../../ui/src/scene";
import { CLOCK_READY, readClockMessage } from "../lib/live";
import type { SceneCue } from "../lib/live";
import { useText } from "../preview";
import { useGallery } from "../state";
import { Segmented } from "./controls";
import { ChromeIcon } from "./icons";
import type { ChromeIconName } from "./icons";

/** A reader's (or the viewport's) command; the player stamps the time. */
export type SceneCommand = {
  [K in SceneAction["type"]]: Omit<Extract<SceneAction, { type: K }>, "now">;
}[SceneAction["type"]];

interface Held {
  frames: readonly SceneFrame[];
  timeline: SceneTimeline;
}

export interface ScenePlayer {
  /** Null for a static variant. */
  clock: SceneClock | null;
  /** A reader's command from the transport. */
  control: (command: SceneCommand) => void;
  /** Callback ref: the element whose visibility plays and pauses the clock (with `autoplay`). */
  observe: (element: Element | null) => void;
}

/**
 * The clock a card (or a standalone `/embed`) owns for the variant it shows. A different variant
 * starts its own scene afresh; a static variant has no clock.
 */
export function useScenePlayer(
  scene: SceneSpec | undefined,
  {
    reduced,
    autoplay = false,
    start,
  }: {
    reduced: boolean;
    /** Play while the observed element is on screen, pause while it is not. */
    autoplay?: boolean;
    /** Where a scene starts. Default: the first frame, playing if it is on screen. */
    start?: (frames: readonly SceneFrame[]) => SceneCue;
  },
): ScenePlayer {
  const frames = scene?.frames;
  const inView = useRef(false);
  /** The reader paused (or stepped): scrolling back does not resume. */
  const readerPaused = useRef(false);

  const begin = (list: readonly SceneFrame[]): Held => {
    const cue = start?.(list) ?? { index: 0, playing: autoplay && inView.current };
    const now = Date.now();
    return { frames: list, timeline: cueTimeline(list, cue.index, { playing: cue.playing, now }) };
  };
  const [held, setHeld] = useState<Held | null>(() => (frames ? begin(frames) : null));
  let current = held;
  if ((frames ?? null) !== (held?.frames ?? null)) {
    // Another variant was picked: its scene starts afresh (React re-renders before painting).
    current = frames ? begin(frames) : null;
    setHeld(current);
  }

  useEffect(() => {
    readerPaused.current = false;
  }, [frames]);

  const send = useCallback((command: SceneCommand) => {
    const action = { ...command, now: Date.now() } as SceneAction;
    // Always a new object, even when nothing moved: a timer that fired a millisecond early must
    // still be scheduled again.
    setHeld((h) => h && { frames: h.frames, timeline: sceneReducer(h.frames, h.timeline, action) });
  }, []);

  const control = useCallback(
    (command: SceneCommand) => {
      if (command.type === "pause" || command.type === "step") readerPaused.current = true;
      if (command.type === "play" || command.type === "restart") readerPaused.current = false;
      send(command);
    },
    [send],
  );

  // The one timer: the moment the current frame's hold runs out.
  useEffect(() => {
    if (!held) return;
    const delay = msToNextFrame(held.frames, held.timeline, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => send({ type: "tick" }), Math.ceil(delay));
    return () => window.clearTimeout(timer);
  }, [held, send]);

  const [element, observe] = useState<Element | null>(null);
  useEffect(() => {
    if (!autoplay || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        inView.current = entry.isIntersecting;
        if (!entry.isIntersecting) send({ type: "pause" });
        else if (!readerPaused.current) send({ type: "play" });
      },
      // On screen = crossing the middle three fifths of the viewport, not a sliver at its edge.
      { rootMargin: "-20% 0px -20% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [autoplay, element, send]);

  const clock = useMemo(
    () => (current ? sceneClock(current.frames, current.timeline, reduced) : null),
    [current, reduced],
  );
  return { clock, control, observe };
}

/**
 * A compare frame's clock: the card's timeline, as its `gallery:clock` messages deliver it. Until
 * the first message the frame holds still on the last frame, as any embed does.
 */
export function useFollowedClock(
  scene: SceneSpec | undefined,
  module: string,
  variant: string,
  reduced: boolean,
): SceneClock | null {
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
  return useMemo(() => {
    if (!frames) return null;
    const t = timeline ?? cueTimeline(frames, frames.length - 1, { now: 0 });
    return sceneClock(frames, t, reduced);
  }, [frames, timeline, reduced]);
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

function TransportButton({
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
      className="g-icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <ChromeIcon name={icon} size={15} />
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
 * Play / pause, play from the start, previous and next frame, a chip per frame (the current one
 * pressed, with its progress), and the speed.
 */
export function Transport({
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
    <div className="g-transport" role="group" aria-label={S.transport.label}>
      <TransportButton
        icon={clock.playing ? "pause" : "play"}
        title={clock.playing ? S.transport.pause : S.transport.play}
        onClick={() => control(clock.playing ? { type: "pause" } : { type: "play" })}
      />
      <TransportButton
        icon="restart"
        title={S.transport.restart}
        onClick={() => control({ type: "restart" })}
      />
      <TransportButton
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
      <TransportButton
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
