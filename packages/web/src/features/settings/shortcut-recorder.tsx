/**
 * The control on a Shortcuts settings row: a button showing the current chord (or "not set"),
 * which on activation records the next key combination pressed. While recording it owns the
 * keyboard through a window capture listener that stops propagation — the portal-panel trick —
 * so Escape cancels the recording without also closing the settings dialog. The state machine
 * is lib/shortcuts/recorder.ts; this component only draws it and wires the DOM.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { Kbd } from "../../components/ui/kbd";
import { isModifierCode } from "../../lib/shortcuts/chord";
import { formatChord } from "../../lib/shortcuts/format";
import { currentPlatform } from "../../lib/shortcuts/platform";
import {
  RECORDER_IDLE,
  recorderRelease,
  recorderStart,
  recorderStep,
  type RecorderState,
} from "../../lib/shortcuts/recorder";
import type { Chord } from "../../lib/shortcuts/types";

export function ShortcutRecorder({
  chord,
  onCommit,
}: {
  chord: Chord | null;
  /** A new chord, or null to unbind. */
  onCommit: (chord: Chord | null) => void;
}) {
  const [state, setState] = useState<RecorderState>(RECORDER_IDLE);
  // The listeners below read the live state without re-registering on every keystroke.
  const stateRef = useRef<RecorderState>(state);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const recording = state.phase === "recording";

  const update = useCallback((next: RecorderState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const platform = currentPlatform();
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const step = recorderStep(stateRef.current, e, platform);
      update(step.state);
      if (step.commit !== undefined) onCommit(step.commit);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (isModifierCode(e.code)) update(recorderRelease(stateRef.current));
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (!buttonRef.current?.contains(e.target as Node)) update(RECORDER_IDLE);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [recording, onCommit, update]);

  const platform = currentPlatform();
  let content: ReactNode;
  if (state.phase === "recording") {
    content =
      state.preview !== null ? (
        <span className="font-mono">{`${formatChord(state.preview, platform)}…`}</span>
      ) : (
        S.shortcuts.record
      );
  } else if (chord !== null) {
    content = <Kbd chord={chord} size="control" />;
  } else {
    content = <span className="text-gray-400 dark:text-gray-500">{S.shortcuts.unbound}</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        ref={buttonRef}
        type="button"
        title={S.shortcuts.rebind}
        aria-pressed={recording}
        onClick={() => {
          if (!recording) update(recorderStart());
        }}
        onBlur={() => update(RECORDER_IDLE)}
        className={`min-w-28 rounded-md border px-2 py-1 text-xs transition-colors duration-150 ${
          recording
            ? "border-gray-500 text-gray-500 ring-2 ring-gray-400/40 dark:border-gray-400 dark:text-gray-400"
            : "border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        }`}
      >
        {content}
      </button>
      {state.phase === "recording" && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {state.notice === "needsModifier" ? S.shortcuts.needsModifier : S.shortcuts.recordHint}
        </p>
      )}
    </div>
  );
}
