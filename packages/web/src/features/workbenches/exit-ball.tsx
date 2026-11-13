/**
 * The full-page workbench's exit: the UI package's `FloatingBall` with the exit-full-screen glyph,
 * under the window band. It rests in the bottom-right corner until the reader drags it to the
 * other edge or tucks it away there; that placement is this browser's preference
 * (exit-ball-state.ts), read once on mount and written on every change the reader makes.
 */
import { useState } from "react";
import { FloatingBall, GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { readExitBall, writeExitBall } from "./exit-ball-state";

export interface WorkbenchExitBallProps {
  /** The exit's name: the ball's accessible name and hover hint. */
  label: string;
  onExit: () => void;
}

export function WorkbenchExitBall({ label, onExit }: WorkbenchExitBallProps) {
  const [placement, setPlacement] = useState(() => readExitBall());
  return (
    <FloatingBall
      placement={placement}
      onChange={(next) => {
        writeExitBall(next);
        setPlacement(next);
      }}
      onActivate={onExit}
      glyph={<GlyphIcon d={ICONS.cornersIn} size={ICON_SIZE.launcherEntry} />}
      label={label}
      tuckLabel={S.workbenches.exitBallTuck}
      showLabel={S.workbenches.exitBallShow}
      areaTop="var(--window-band-height, 0px)"
      testId="workbench-exit-ball"
    />
  );
}
