/**
 * Foundations › Motion, replayable: the three presence specimens (a menu from the top, a dialog
 * with its backdrop from the centre, a toast from the bottom) entering and leaving on the theme's
 * `data-presence` rules; tool rows appended to a settled list under `data-reveal`, what the
 * attribute is for (streaming text is not it: that is the `ui-stream` host, on the library's
 * streaming board); a sidebar's width folding to a rail and back under `data-layout-motion`; then
 * every duration × easing pair as a dot crossing a track, and the live signals — the package's
 * streaming caret, pulsing dot and spinner — on the timing each theme gives `.ui-live`. The
 * specimens set the same attributes the modules set, or are the modules' own components, so what
 * moves here is exactly what the theme's motion tokens say.
 *
 * With `motion=reduced` (chrome.css, and the package's own reduced rules) every change shows its
 * end state at once — which is also what keeps screenshots deterministic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationEvent, CSSProperties, ReactNode } from "react";
import { Dot, GlyphIcon, ICONS, Spinner, StreamingCaret } from "@prismshadow/penguin-ui";
import { useGallery } from "../state";
import { BoardGroup, NAV_GLYPHS, ReplayButton } from "./shared";
import { SPECIMENS } from "./specimens";

const DURATIONS = ["fast", "base", "slow"] as const;
const EASINGS = ["out", "in-out", "spring", "overlay-in", "overlay-out"] as const;

/** How long a presence specimen stays open between its entrance and its exit. */
const HOLD_MS = 1400;
/** A new row every so often; Frost's reveal overlaps the next row's, by design. */
const ROW_MS = 90;
/** The rows the list already holds when the new ones arrive: settled, never revealed. */
const SETTLED_ROWS = 2;

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

/**
 * Tool rows arriving in a list that is already on screen, the way a running work group's steps
 * do: the first rows are settled, and each new one moves once under `data-reveal` as it is
 * appended. Before the first replay every row is settled, as a page that loads finished is.
 */
function RevealSpecimen({ run }: { run: number }) {
  const { S } = useGallery();
  const rows = S.foundations.motionSpecimens.revealRows;
  const total = rows.length;
  const [shown, setShown] = useState(total);
  const [played, setPlayed] = useState(false);
  const timer = useRef<number | null>(null);

  const play = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    setPlayed(true);
    setShown(SETTLED_ROWS);
    timer.current = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= total && timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        return Math.min(n + 1, total);
      });
    }, ROW_MS);
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

  return (
    <div className="gf-specimen">
      <div className="gf-reveal">
        {rows.slice(0, shown).map((row, i) => (
          <div
            key={i}
            className="gf-reveal-row"
            {...(played && i >= SETTLED_ROWS ? { "data-reveal": true } : {})}
          >
            <GlyphIcon d={ICONS.checkCircle} size={14} />
            <span className="gf-mono">{row.name}</span>
            <span className="gf-reveal-detail">{row.detail}</span>
          </div>
        ))}
      </div>
      <div className="gf-specimen-foot">
        <span className="gf-caption gf-mono">data-reveal</span>
        <ReplayButton onClick={play} />
      </div>
    </div>
  );
}

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
                <path d={NAV_GLYPHS[i] ?? NAV_GLYPHS[0]} />
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
  // The board follows the OS preference, as the framed app does: there is no gallery switch.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? t.reducedNote
    : undefined;
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
            <StreamingCaret />
          </span>
          <span className="gf-live-item">
            <Dot tone="success" pulse />
            {t.toneWords.success}
          </span>
          <span className="gf-live-item">
            <Spinner size="sm" tone="success" label={t.loading} />
            {t.loading}
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
