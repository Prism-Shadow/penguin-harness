/**
 * Foundations › Motion: every duration × easing pair as a dot crossing a track (the move takes
 * exactly the duration, then holds), and the live signals — a streaming caret, a running dot and a
 * spinner — on the timing each theme gives `.ui-live`. With `motion=reduced` every animation in the
 * preview holds its first frame (chrome.css), which is also what keeps screenshots deterministic.
 */
import type { CSSProperties } from "react";
import { useGallery } from "../state";
import { BoardGroup } from "./shared";
import { SPECIMENS } from "./specimens";

const DURATIONS = ["fast", "base", "slow"] as const;
const EASINGS = ["out", "in-out", "spring", "overlay-in", "overlay-out"] as const;

export function MotionBoard() {
  const { S, state } = useGallery();
  return (
    <div className="gf-board">
      <BoardGroup
        title={S.foundations.durations}
        aside={state.motion === "reduced" ? S.foundations.reducedNote : undefined}
      >
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
      <BoardGroup title={S.foundations.liveSignal}>
        <div className="gf-live">
          <span>
            {SPECIMENS[state.lang].heading}
            <span className="ui-live gf-caret" data-live="caret">
              ▌
            </span>
          </span>
          <span className="gf-live-item">
            <span className="ui-live gf-live-dot" data-live="dot" />
            {S.foundations.toneWords.success}
          </span>
          <span className="gf-live-item">
            <span className="ui-live gf-spinner" data-live="spinner" />
            {S.foundations.loading}
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
