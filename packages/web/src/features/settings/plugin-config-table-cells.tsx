/**
 * The presets table's own cell controls: the pin toggle, the wrapping name box and the row's
 * drag handle.
 */
import { useLayoutEffect, useRef } from "react";
import { GlyphIcon, ICONS, ICON_SIZE, Textarea } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/**
 * A pin toggle: the pin glyph, filled while pinned. A real button with `aria-pressed`, named
 * "<row> · <column>"; its tooltip says the state in words.
 */
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
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      data-tooltip={tooltip}
      disabled={disabled}
      onClick={() => onChange(!pinned)}
      className={`inline-flex size-7 items-center justify-center rounded-md align-middle transition-colors duration-150 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 ${pinned ? "text-fg" : "text-fg-subtle"}`}
    >
      <GlyphIcon d={ICONS.pin} size={ICON_SIZE.iconButton} filled={pinned} />
    </button>
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
      className="!w-full resize-none overflow-hidden !px-1 !py-1 !leading-snug break-words whitespace-pre-wrap !border-transparent !bg-transparent hover:!border-line focus:!border-fg-muted"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
    />
  );
}

/**
 * A row's drag handle (three lines). Dragging it moves the row: the table is told the pointer's
 * height on every move and reorders as it crosses rows. Focused, the up and down arrow keys move
 * the row one place. `touch-none` keeps a touch drag from scrolling the page instead.
 */
export function RowGrip({
  row,
  disabled,
  onStep,
  onDrag,
  gripRef,
}: {
  /** The row's name, for the accessible name. */
  row: string;
  disabled: boolean;
  onStep: (by: -1 | 1) => void;
  onDrag: (clientY: number) => void;
  gripRef: (el: HTMLButtonElement | null) => void;
}) {
  const dragging = useRef(false);
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
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (dragging.current) onDrag(e.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className="inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-md align-middle text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GlyphIcon d={ICONS.menu} size={ICON_SIZE.inlineGlyph} />
    </button>
  );
}
