/**
 * The search box: a `type="search"` field with a clear button, and optionally a magnifier before
 * the text. It filters what is already on screen, so it is not a form field — no label above it
 * (its `aria-label` names it), no hint, no error — and it never offers the browser's saved logins.
 *
 * Three shapes, because the containers differ:
 *
 * - `field` (the default) — a filter box on a page or a panel's toolbar, on the control look every
 *   other text control wears.
 * - `panel` — a box standing inside a panel with room around it: a quieter line than a form
 *   field's, so the panel's own border stays the stronger one (the Workspace browser, a picker).
 * - `menu` — the box sits directly under its menu's own divider and draws no line of its own (a
 *   second line a pixel below the first reads as a mistake); tighter padding to match menu rows.
 *
 * Escape in a non-empty box clears it and goes no further, so one press empties the search rather
 * than also closing the dialog, dock or menu around it; in an empty box Escape passes through.
 * The right side always reserves the clear button's room, so the text never shifts when it
 * appears.
 */
import { useRef } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";
import { useUiStrings } from "../../../strings";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { CloseIcon } from "../../icons/marks/marks";
import { controlBase } from "../field/field";
import { noAutofill, sizeTextClass } from "../input/input";
import type { ControlSize } from "../input/input";

export type SearchInputVariant = "field" | "panel" | "menu";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "value" | "defaultValue" | "onChange"
> {
  value: string;
  onChange: (value: string) => void;
  /** The container it stands in (see above). */
  variant?: SearchInputVariant;
  size?: ControlSize;
  /** The clear button's name and tooltip; the interface's "clear search" when omitted. */
  clearLabel?: string;
  /** What clearing does; empties the box when omitted. */
  onClear?: () => void;
  /**
   * Keep the clear button, and Escape's clearing, while the box is empty — for a search that
   * closes itself when cleared, where the button is also the way out.
   */
  alwaysClearable?: boolean;
  /** Draw the magnifier before the text, where the placeholder alone would not say "search". */
  icon?: boolean;
}

const LOOK: Record<SearchInputVariant, string> = {
  field: `${controlBase} placeholder:text-fg-subtle`,
  panel:
    "rounded-md border border-line bg-transparent text-fg placeholder:text-fg-subtle " +
    "transition-colors duration-150 focus:border-fg-subtle focus:outline-none",
  menu:
    "rounded-sm border border-transparent bg-transparent text-fg placeholder:text-fg-subtle " +
    "focus:outline-none",
};

/** Padding and the two marks' positions, per shape and rung; written out, as classes must be. */
const GEOMETRY: Record<
  "box" | "menu",
  Record<ControlSize, { pad: string; padWithIcon: string; iconAt: string; clearAt: string }>
> = {
  box: {
    sm: {
      pad: "py-1 pl-2 pr-7",
      padWithIcon: "py-1 pl-7 pr-7",
      iconAt: "left-2",
      clearAt: "right-1",
    },
    base: {
      pad: "py-2 pl-3 pr-9",
      padWithIcon: "py-2 pl-9 pr-9",
      iconAt: "left-3",
      clearAt: "right-2",
    },
  },
  menu: {
    sm: {
      pad: "py-0.5 pl-1 pr-6",
      padWithIcon: "py-0.5 pl-6 pr-6",
      iconAt: "left-1",
      clearAt: "right-0",
    },
    base: {
      pad: "py-1 pl-2 pr-7",
      padWithIcon: "py-1 pl-7 pr-7",
      iconAt: "left-2",
      clearAt: "right-1",
    },
  },
};

const MARK_SIZE: Record<ControlSize, number> = { sm: 12, base: 14 };

export function SearchInput({
  value,
  onChange,
  variant = "field",
  size = "sm",
  clearLabel,
  onClear,
  alwaysClearable = false,
  icon = false,
  className = "",
  onKeyDown,
  title,
  ...rest
}: SearchInputProps) {
  const strings = useUiStrings();
  const input = useRef<HTMLInputElement>(null);
  const clearName = clearLabel ?? strings.clearSearch;
  const clearable = value !== "" || alwaysClearable;
  const geometry = GEOMETRY[variant === "menu" ? "menu" : "box"][size];
  const clear = () => {
    if (onClear !== undefined) {
      onClear();
      return;
    }
    onChange("");
    // The box stays, so the caret stays in it: the next keystroke starts the next search.
    input.current?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape" || event.nativeEvent.isComposing) return;
    if (!clearable) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  };
  return (
    <div className={`relative ${className}`}>
      {icon && (
        <GlyphIcon
          d={ICONS.search}
          size={MARK_SIZE[size]}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${geometry.iconAt} text-fg-subtle`}
        />
      )}
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        {...noAutofill}
        // A hover hint shows in the shared tooltip, never the browser's own `title`.
        data-tooltip={title}
        className={
          `block w-full appearance-none [&::-webkit-search-cancel-button]:appearance-none ` +
          `${LOOK[variant]} ${sizeTextClass[size]} ${icon ? geometry.padWithIcon : geometry.pad}`
        }
        {...rest}
      />
      {clearable && (
        <button
          type="button"
          aria-label={clearName}
          data-tooltip={clearName}
          onClick={clear}
          className={`absolute top-1/2 -translate-y-1/2 ${geometry.clearAt} flex items-center justify-center rounded-sm p-1 text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg`}
        >
          <CloseIcon size={MARK_SIZE[size]} />
        </button>
      )}
    </div>
  );
}
