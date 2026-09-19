/**
 * Foundations › Motion, replayable: the three presence specimens (a menu from the top, a dialog
 * with its backdrop from the centre, a toast from the bottom) entering and leaving on the theme's
 * `data-presence` rules; a streamed line arriving chunk by chunk under `data-reveal`; a sidebar's
 * width folding to a rail and back under `data-layout-motion`; then every duration × easing pair
 * as a dot crossing a track, and the live signals — a caret, a running dot and a spinner — on the
 * timing each theme gives `.ui-live`. The specimens set the same attributes the modules set and
 * nothing else, so what moves here is exactly what the theme's motion tokens say.
 *
 * With `motion=reduced` (chrome.css, and the package's own reduced rules) every change shows its
 * end state at once — which is also what keeps screenshots deterministic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationEvent, CSSProperties, ReactNode } from "react";
import { useGallery } from "../state";
import { BoardGroup, ReplayButton } from "./shared";
import { SPECIMENS } from "./specimens";

const DURATIONS = ["fast", "base", "slow"] as const;
const EASINGS = ["out", "in-out", "spring", "overlay-in", "overlay-out"] as const;

/** How long a presence specimen stays open between its entrance and its exit. */
const HOLD_MS = 1400;
/** A streamed chunk every so often; Frost's reveal overlaps the next chunk's, by design. */
const CHUNK_MS = 90;

type Phase = "hidden" | "enter" | "exit";

/**
 * The presence owner, as the modules implement it: mounted with `enter`, flipped to `exit` after
 * the hold, unmounted when the exit's `animationend` arrives — or at once when the computed
 * `animation-name` is `none` (reduced motion, or a theme that jumps), since no event ever comes.
 */
function usePresence(run: number) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [key, setKey] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const hold = useRef<number | null>(null);

  const play = useCallback(() => {
    if (hold.current !== null) window.clearTimeout(hold.current);
    setKey((k) => k + 1);
    setPhase("enter");
    hold.current = window.setTimeout(() => setPhase("exit"), HOLD_MS);
  }, []);

  useEffect(() => {
    if (run > 0) play();
  }, [run, play]);

  useEffect(() => {
    if (phase !== "exit") return;
    const el = ref.current;
    if (el !== null && getComputedStyle(el).animationName === "none") setPhase("hidden");
  }, [phase]);

  useEffect(
    () => () => {
      if (hold.current !== null) window.clearTimeout(hold.current);
    },
    [],
  );

  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && phase === "exit") setPhase("hidden");
  };

  return { phase, key, ref, play, onAnimationEnd };
}

function PresenceSpecimen({
  title,
  side,
  run,
  backdrop = false,
  children,
}: {
  title: string;
  side: "top" | "bottom" | "center";
  run: number;
  backdrop?: boolean;
  children: ReactNode;
}) {
  const { S } = useGallery();
  const presence = usePresence(run);
  const shown = presence.phase !== "hidden";
  const trigger = S.foundations.motionSpecimens.trigger;
  return (
    <div className="gf-specimen">
      <div className="gf-stage" data-side={side}>
        {side === "top" && <span className="gf-stage-trigger">{trigger}</span>}
        {shown && backdrop && <span className="gf-backdrop" data-backdrop={presence.phase} />}
        {shown && (
          <div
            key={presence.key}
            ref={presence.ref}
            className="gf-layer"
            data-presence={presence.phase}
            data-side={side}
            onAnimationEnd={presence.onAnimationEnd}
          >
            {children}
          </div>
        )}
      </div>
      <div className="gf-specimen-foot">
        <span className="gf-caption">
          {title} <span className="gf-mono">{side}</span>
        </span>
        <ReplayButton onClick={presence.play} />
      </div>
    </div>
  );
}

/** Streaming splits into words for Latin text and one or two Han characters for Chinese. */
function chunksOf(text: string, lang: "en" | "zh"): string[] {
  const parts = lang === "zh" ? text.match(/[\s\S]{1,2}/g) : text.match(/\S+\s*/g);
  return parts ?? [text];
}

function RevealSpecimen({ run }: { run: number }) {
  const { state } = useGallery();
  const chunks = chunksOf(SPECIMENS[state.lang].paragraph, state.lang);
  const total = chunks.length;
  const [shown, setShown] = useState(total);
  const timer = useRef<number | null>(null);

  const play = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    setShown(0);
    timer.current = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= total && timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        return Math.min(n + 1, total);
      });
    }, CHUNK_MS);
  }, [total]);

  useEffect(() => {
    if (run > 0) play();
  }, [run, play]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );

  const streaming = shown < total;
  return (
    <div className="gf-specimen">
      <p className="gf-reveal" lang={state.lang === "zh" ? "zh-CN" : "en"}>
        {chunks.slice(0, shown).map((chunk, i) => (
          <span key={i} data-reveal>
            {chunk}
          </span>
        ))}
        {streaming && (
          <span className="ui-live gf-caret" data-live="caret">
            ▌
          </span>
        )}
      </p>
      <div className="gf-specimen-foot">
        <span className="gf-caption gf-mono">data-reveal</span>
        <ReplayButton onClick={play} />
      </div>
    </div>
  );
}

const ROW_GLYPHS = [
  "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
] as const;

function LayoutSpecimen({ run }: { run: number }) {
  const { S } = useGallery();
  const [rail, setRail] = useState(false);
  const timer = useRef<number | null>(null);

  const play = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setRail(true);
    timer.current = window.setTimeout(() => setRail(false), HOLD_MS);
  }, []);

  useEffect(() => {
    if (run > 0) play();
  }, [run, play]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="gf-specimen">
      <div className="gf-layout-stage">
        <div className="gf-layout-nav" data-layout-motion data-rail={rail || undefined}>
          {S.foundations.motionSpecimens.sidebarRows.map((row, i) => (
            <span key={row} className="gf-layout-row" aria-current={i === 0 ? "page" : undefined}>
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden
                className="gf-glyph"
                style={{ strokeWidth: "var(--ui-icon-stroke)" }}
              >
                <path d={ROW_GLYPHS[i] ?? ROW_GLYPHS[0]} />
              </svg>
              <span className="gf-layout-label">{row}</span>
            </span>
          ))}
        </div>
        <div className="gf-layout-main" aria-hidden>
          <span style={{ width: "72%" }} />
          <span style={{ width: "48%" }} />
          <span style={{ width: "60%" }} />
        </div>
      </div>
      <div className="gf-specimen-foot">
        <span className="gf-caption gf-mono">data-layout-motion</span>
        <ReplayButton onClick={play} />
      </div>
    </div>
  );
}

export function MotionBoard() {
  const { S, state } = useGallery();
  const t = S.foundations;
  const [run, setRun] = useState(0);
  const reduced = state.motion === "reduced" ? t.reducedNote : undefined;
  return (
    <div className="gf-board">
      <BoardGroup
        title={t.presence}
        aside={reduced ?? t.presenceNote}
        action={<ReplayButton label={t.replayAll} onClick={() => setRun((n) => n + 1)} />}
      >
        <div className="gf-presence">
          <PresenceSpecimen title={t.motionSpecimens.menu} side="top" run={run}>
            <div className="ui-glass gf-motion-menu" role="menu">
              {t.scene.menuItems.map((item, i) => (
                <span key={item} className="gf-menu-row" data-active={i === 1 || undefined}>
                  {item}
                </span>
              ))}
            </div>
          </PresenceSpecimen>
          <PresenceSpecimen title={t.motionSpecimens.dialog} side="center" run={run} backdrop>
            <div
              className="ui-glass gf-motion-dialog"
              role="dialog"
              aria-label={t.scene.dialogTitle}
            >
              <strong>{t.scene.dialogTitle}</strong>
              <p className="gf-muted">{t.scene.dialogBody}</p>
              <div className="gf-controls gf-controls-end">
                <span className="gf-button">{t.scene.cancel}</span>
                <span className="gf-button" data-variant="danger">
                  {t.scene.confirm}
                </span>
              </div>
            </div>
          </PresenceSpecimen>
          <PresenceSpecimen title={t.motionSpecimens.toast} side="bottom" run={run}>
            <div className="gf-motion-toast" role="status">
              {t.scene.toast}
            </div>
          </PresenceSpecimen>
        </div>
      </BoardGroup>
      <div className="gf-pair">
        <BoardGroup title={t.reveal} aside={t.revealNote}>
          <RevealSpecimen run={run} />
        </BoardGroup>
        <BoardGroup title={t.layout} aside={t.layoutNote}>
          <LayoutSpecimen run={run} />
        </BoardGroup>
      </div>
      <BoardGroup title={t.durations}>
        <div className="gf-motion">
          <span />
          {DURATIONS.map((duration) => (
            <span key={duration} className="gf-caption gf-mono">
              {duration}
            </span>
          ))}
          {EASINGS.map((easing) => (
            <div key={easing} className="gf-motion-row">
              <span className="gf-caption gf-mono">{easing}</span>
              {DURATIONS.map((duration) => (
                <span key={duration} className="gf-track">
                  <span
                    className="gf-track-dot"
                    style={
                      {
                        "--gf-dur": `var(--ui-dur-${duration})`,
                        "--gf-ease": `var(--ui-ease-${easing})`,
                      } as CSSProperties
                    }
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.liveSignal}>
        <div className="gf-live">
          <span>
            {SPECIMENS[state.lang].heading}
            <span className="ui-live gf-caret" data-live="caret">
              ▌
            </span>
          </span>
          <span className="gf-live-item">
            <span className="ui-live gf-live-dot" data-live="dot" />
            {t.toneWords.success}
          </span>
          <span className="gf-live-item">
            <span className="ui-live gf-spinner" data-live="spinner" />
            {t.loading}
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
