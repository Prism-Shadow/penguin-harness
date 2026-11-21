/**
 * A pager's page number that the reader can type over, to go straight to a page.
 *
 * At rest it is the number in the readout's own type, with nothing drawn around it, so a readout
 * that holds it looks as it did without it. Focusing it, by Tab or a click, selects the number;
 * the reader types a page and presses Enter to go there. A number past either end lands on that
 * end, and text that is not a whole number is ignored. Escape puts the current page back, and so
 * does leaving the field; a second Escape, with nothing typed, is left to the surface around it.
 * Full-width digits from an IME count as digits, and nothing is decided while a composition is
 * open.
 *
 * The field is as wide as the number it shows, in the readout's figures, so turning editable moves
 * nothing. While the reader types it grows to at most the digits of the last page; anything longer
 * scrolls inside it, since no page needs more digits than that.
 */
import { useLayoutEffect, useRef, useState } from "react";

/**
 * The theme's keyboard ring, drawn flush with the field: the number sits between two words, and
 * the theme's offset would carry the ring onto their glyphs.
 */
const FOCUS_RING = "focus-visible:[outline:var(--ui-focus-ring)] focus-visible:outline-offset-0";

/** The page typed, 0-based and inside the range, or `null` when the text is not a whole number. */
function typedPage(text: string, pageCount: number): number | null {
  const digits = text.normalize("NFKC").trim();
  if (!/^\d+$/.test(digits)) return null;
  return Math.min(Math.max(Number(digits), 1), pageCount) - 1;
}

export function PageField({
  page,
  pageCount,
  onChange,
  label,
  className = "",
}: {
  /** The page shown, 0-based; the field counts from 1. */
  page: number;
  pageCount: number;
  /** Go to a page, 0-based and already inside the range. */
  onChange: (page: number) => void;
  /** The field's accessible name: what typing a number in it does ("Go to step"). */
  label: string;
  /** Layout only. */
  className?: string;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // Bumped by Enter, so the page it lands on is selected once it is in the field.
  const [landed, setLanded] = useState(0);
  const shown = String(page + 1);
  const text = draft ?? shown;
  const width = Math.max(shown.length, Math.min(text.length, String(pageCount).length));

  useLayoutEffect(() => {
    if (landed > 0 && document.activeElement === field.current) field.current?.select();
  }, [landed]);

  return (
    <input
      ref={field}
      type="text"
      inputMode="numeric"
      enterKeyHint="go"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      value={text}
      size={1}
      // A pixel either side keeps the caret from scrolling a number that fills the field; the
      // negative margins give them back, so the field takes the line's room of the bare number.
      style={{ width: `calc(${width}ch + 2px)` }}
      className={`-mx-px rounded-sm bg-transparent p-0 text-center tabular-nums outline-none hover:bg-fg/5 focus:bg-fg/5 ${FOCUS_RING} ${className}`}
      onMouseDown={(event) => {
        // A click focuses and selects; left to the browser, its mouseup would drop a caret
        // into the selection.
        if (document.activeElement === event.currentTarget) return;
        event.preventDefault();
        event.currentTarget.focus();
      }}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => setDraft(null)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        // The caret's own keys stay in the field rather than paging the control around it.
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.stopPropagation();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const target = draft === null ? null : typedPage(draft, pageCount);
          setDraft(null);
          setLanded((count) => count + 1);
          if (target !== null && target !== page) onChange(target);
          return;
        }
        if (event.key === "Escape" && draft !== null) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
          setLanded((count) => count + 1);
        }
      }}
    />
  );
}
