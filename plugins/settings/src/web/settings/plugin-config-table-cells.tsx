/**
 * The presets table's own cell controls: the pin toggle, the wrapping name box and the row's
 * drag handle.
 */
import { useLayoutEffect, useRef } from "react";
import { GlyphIcon, ICONS, ICON_SIZE, Textarea } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** The one box every icon control in a table row takes, so a row's icons line up. */
export const ICON_BUTTON =
  "inline-flex size-6 items-center justify-center rounded-md align-middle text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60";

/**
 * An icon toggle: the glyph, filled while pressed. A real button with `aria-pressed`; its
 * tooltip says the state in words.
 */
export function IconToggle({
  label,
  pressed,
  glyph,
  tooltip,
  disabled,
  onPress,
}: {
  label: string;
  pressed: boolean;
  glyph: string;
  tooltip: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={tooltip}
      disabled={disabled}
      onClick={onPress}
      className={`${ICON_BUTTON} ${pressed ? "!text-fg" : ""}`}
    >
      <GlyphIcon d={glyph} size={ICON_SIZE.iconButton} filled={pressed} />
    </button>
  );
}

/** A pin toggle: the pin glyph, filled while pinned (see IconToggle). */
export function PinToggle({
  label,
  pinned,
  tooltip,
  disabled,
  onChange,
}: {
  label: string;
  pinned: boolean;
  tooltip: string;
  disabled: boolean;
  onChange: (pinned: boolean) => void;
}) {
  return (
    <IconToggle
      label={label}
      pressed={pinned}
      glyph={ICONS.pin}
      tooltip={tooltip}
      disabled={disabled}
      onPress={() => onChange(!pinned)}
    />
  );
}

/**
 * A one-line text value that wraps instead of clipping: a name longer than the column (a
 * "Workspace Write with Ask") reads whole on two lines, where an <input> could only cut it off.
 * The box grows to its content; Enter and pasted line breaks never put a newline in the value.
 * Borderless until pointed at or focused: the row reads as a table of names, and the box shows
 * itself when it is about to be edited.
 */
export function WrappingNameBox({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Sized to its content on every change of the text AND of its width: the fixed table settles
  // its column widths after the first paint, and a height measured at the wider first width
  // would cut the wrapped name's last line off.
  useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) return;
    const fit = () => {
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      fit();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [value]);
  return (
    <Textarea
      ref={ref}
      size="sm"
      rows={1}
      aria-label={label}
      value={value}
      disabled={disabled}
      autoComplete="off"
      spellCheck={false}
      // As wide as the name, so a mark after it (the default's) sits right beside it; never wider
      // than the cell, where it wraps. A browser without `field-sizing` gives it the whole cell.
      className="!w-auto max-w-full min-w-8 resize-none overflow-hidden ![field-sizing:content] !px-1 !py-1 !leading-snug break-words whitespace-pre-wrap !border-transparent !bg-transparent hover:!border-line focus:!border-fg-muted supports-[not(field-sizing:content)]:!w-full"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
    />
  );
}

/**
 * A row's drag handle (three lines). Pressed, it takes the pointer capture and reports the drag
 * to the table, which moves the row by transform and reorders only on the drop — so this button
 * never moves in the DOM while it holds the capture. Losing the capture or a cancelled pointer
 * puts the row back. Focused, the up and down arrow keys move the row one place. `touch-none`
 * keeps a touch drag from scrolling the page instead.
 */
export function RowGrip({
  row,
  disabled,
  onStep,
  onDragStart,
  onDragMove,
  onDragEnd,
  gripRef,
}: {
  /** The row's name, for the accessible name. */
  row: string;
  disabled: boolean;
  onStep: (by: -1 | 1) => void;
  onDragStart: (clientY: number) => void;
  onDragMove: (clientY: number) => void;
  /** `true` drops the row where it is; `false` puts it back. */
  onDragEnd: (commit: boolean) => void;
  gripRef: (el: HTMLButtonElement | null) => void;
}) {
  const dragging = useRef(false);
  const end = (commit: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    onDragEnd(commit);
  };
  return (
    <button
      ref={gripRef}
      type="button"
      aria-label={S.settings.pluginTableMove(row)}
      data-tooltip={S.settings.pluginTableMoveHint}
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onStep(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onDragStart(e.clientY);
      }}
      onPointerMove={(e) => {
        if (dragging.current) onDragMove(e.clientY);
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(true)}
      className={`${ICON_BUTTON} cursor-grab touch-none active:cursor-grabbing`}
    >
      <GlyphIcon d={ICONS.menu} size={ICON_SIZE.iconButton} />
    </button>
  );
}
