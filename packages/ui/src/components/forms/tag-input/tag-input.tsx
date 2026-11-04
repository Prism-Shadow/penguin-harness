/**
 * Chips with remove buttons: one staged value per chip — an agent a message is handed to, a model
 * it forks onto, a skill it invokes, a file or passage it quotes — each naming what it stands for
 * in a word or two and taking itself back with its ×.
 *
 * `Chip` is one chip, `TagInput` a wrapping row of them. A chip holds a leading mark the caller
 * sized (an avatar, a provider logo, a glyph), a label that gives way when the chip runs out of
 * room and an optional suffix kept whole after it (a quoted range's lines), on the neutral tint.
 * A file or an image carried along with a message is not a chip but an attachment tile
 * (`AttachmentFile`, `AttachmentImage`).
 *
 * A chip with a `control` holds an inline control after its label (a goal's budget picker): the
 * label keeps its width and the control gives way, a rule parts the two, and the tooltip names
 * the label alone so it never covers the control.
 *
 * The remove button is named by the caller, because "remove" alone does not say what goes; a chip
 * given no name for it has no remove button.
 */
import type { ReactNode } from "react";

export interface ChipProps {
  /** What the chip stands for; it truncates first when the chip runs out of room. */
  label: ReactNode;
  /** The leading mark, sized by the caller. */
  glyph?: ReactNode;
  /** Kept whole after the label, in the label's ink (a quoted range's `:12-30`). */
  suffix?: ReactNode;
  /** The whole of what the chip stands for, on hover (a path, a description). */
  tooltip?: string;
  /** `tooltip` says what the label does not (a full path, what sending does): it shows over the label in full. */
  tooltipExtra?: boolean;
  /** Set the chip in the mono face: it names an id, a file or a command. */
  mono?: boolean;
  /** An inline control after the label; see the module header. */
  control?: ReactNode;
  /** The remove button's accessible name; without it the chip has no remove button. */
  removeLabel?: string;
  onRemove?: () => void;
}

/** A chip's tooltip attributes, marked as adding to the label when the caller says it does. */
const hint = (tooltip: string, extra: boolean) => ({
  "data-tooltip": tooltip,
  ...(extra ? { "data-tooltip-extra": true } : {}),
});

export function Chip({
  label,
  glyph,
  suffix,
  tooltip,
  tooltipExtra = false,
  mono = false,
  control,
  removeLabel,
  onRemove,
}: ChipProps) {
  const inline = control !== undefined && control !== null;
  return (
    <span
      {...(tooltip !== undefined && !inline ? hint(tooltip, tooltipExtra) : {})}
      className={`anim-pop flex ${inline ? "max-w-full" : "max-w-48"} items-center gap-1 rounded-md bg-fill-neutral py-0.5 pl-2 pr-1 text-xs text-fg ${mono ? "font-mono" : ""}`}
    >
      {inline ? (
        <>
          <span
            {...(tooltip !== undefined ? hint(tooltip, tooltipExtra) : {})}
            className="flex shrink-0 items-center gap-1"
          >
            {glyph}
            <span>{label}</span>
          </span>
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line-emphasis" />
          {control}
        </>
      ) : (
        <>
          {glyph}
          <span className="min-w-0 truncate">{label}</span>
          {suffix !== undefined && suffix !== null && suffix !== "" && (
            <span className="shrink-0">{suffix}</span>
          )}
        </>
      )}
      {removeLabel !== undefined && (
        // The box is the line's height and a hair either side of the ×, so the chip keeps one
        // height whatever it holds.
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="flex h-5 shrink-0 items-center rounded px-0.5 text-fg-subtle transition-colors duration-150 hover:text-fg"
        >
          <span aria-hidden>×</span>
        </button>
      )}
    </span>
  );
}

/** One chip of a `TagInput`, keyed; its remove button reports the key to the row's `onRemove`. */
export interface TagInputChip extends Omit<ChipProps, "onRemove"> {
  key: string;
}

export function TagInput({
  chips,
  onRemove,
  leading,
  trailing,
  className = "",
}: {
  chips: readonly TagInputChip[];
  /** A chip's × was pressed. */
  onRemove?: (key: string) => void;
  /** Chips the caller draws itself, before the listed ones (a chip with its own control). */
  leading?: ReactNode;
  /** Chips the caller draws itself, after the listed ones. */
  trailing?: ReactNode;
  /** Layout only (a margin); the row's look is the family's. */
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {leading}
      {chips.map(({ key, ...chip }) => (
        <Chip
          key={key}
          {...chip}
          {...(onRemove !== undefined ? { onRemove: () => onRemove(key) } : {})}
        />
      ))}
      {trailing}
    </div>
  );
}
