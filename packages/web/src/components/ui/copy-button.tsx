/**
 * Copy-to-clipboard button and the hook behind it — the single place the app's "copy"
 * affordance and its feedback live, so every copy control behaves the same:
 *
 *   - the feedback follows the WRITE: the check appears only once the text has actually
 *     reached the clipboard (writeClipboard reports that), so a copy the browser refused
 *     never reads as one that succeeded;
 *   - the feedback is ALWAYS shown AT THE BUTTON, and it is the icon alone: copy swaps to
 *     the check for COPIED_MS and the tooltip flips to "已复制" (#312 — no transient
 *     "已复制" text is rendered, and the feedback never replaces an unrelated label/title
 *     elsewhere). A control that keeps a visible text label (e.g. "复制 Prompt") keeps it
 *     unchanged and swaps only its glyph — see CopyCheckGlyph + useCopied;
 *   - the icon swap is silent, so every copy affordance also renders a CopiedStatus live
 *     region beside itself — that is the screen-reader half of the same feedback.
 */
import { useEffect, useRef, useState } from "react";
import { writeClipboard } from "../../lib/clipboard";
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import { GlyphIcon } from "./glyph-icon";

/** How long the copied state (check icon + flipped tooltip) stays after a click. */
const COPIED_MS = 1500;

/**
 * Transient "just copied" flag: `flash()` writes the text and, if the write landed, turns
 * `copied` on for COPIED_MS. Exposed for the caller whose copy trigger is not a plain
 * CopyButton (e.g. a text button rendering CopyCheckGlyph next to its label); most callers
 * should use CopyButton directly.
 */
export function useCopied(): { copied: boolean; flash: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  // The pending reset is held so it can be restarted and cancelled. Restarted: a second
  // click must get its own full COPIED_MS, or the first click's timer clears the check
  // right after the second copy — and the check is now the only feedback, so a check that
  // vanishes on click reads as "the copy didn't take". Cancelled: the control can unmount
  // inside the window (the Trace row closes the details popover itself; the memory and
  // skill-import modals close the same way), and the timeout must not outlive it.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );
  const flash = (text: string) => {
    void writeClipboard(text).then((ok) => {
      // A refused write shows nothing rather than a check: the control returns to idle, so
      // the copy can simply be retried — there is no state to be stuck in.
      if (!ok) return;
      setCopied(true);
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setCopied(false);
      }, COPIED_MS);
    });
  };
  return { copied, flash };
}

/** The glyph pair every copy affordance shows: the copy icon, swapping to the check while copied. */
export function CopyCheckGlyph({ copied, size }: { copied: boolean; size?: number }) {
  return <GlyphIcon d={copied ? STAT_ICONS.check : STAT_ICONS.copy} size={size} />;
}

/**
 * Screen-reader half of the copy feedback, rendered NEXT TO the control (never inside it,
 * so it joins neither the visible label nor the accessible name). The check glyph is
 * `aria-hidden` and the tooltip flip is never announced — a `title` only contributes when
 * there is no `aria-label` — so without this region the confirmation is silent. The region
 * is always rendered and merely filled on copy: a live region announces changes to its
 * content, so it has to exist before the text appears.
 *
 * Deliberately a bare `aria-live` region rather than `role="status"` (which would mean the
 * same to a screen reader): `role="status"` is this app's RUNNING-SPINNER marker — see
 * status-icon.tsx — and copy buttons sit on pages that assert no spinner is left over.
 */
export function CopiedStatus({ copied }: { copied: boolean }) {
  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {copied ? S.common.copied : ""}
    </span>
  );
}

/** Default compact icon-button look (message footer / code block). */
const DEFAULT_CLASS =
  "rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300";

/**
 * The copy button beside a mono value row (details card Session id / Trace file, Agent
 * State path): the default look plus what a flex row needs — never shrink, and an
 * explicit dark-mode idle tone.
 */
export const ROW_COPY_CLASS =
  "shrink-0 rounded p-0.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300";

export function CopyButton({
  text,
  label,
  className = DEFAULT_CLASS,
}: {
  /** The string to copy, or a getter for content computed at click time (e.g. a formatted stats line). */
  text: string | (() => string);
  /** Accessible name / idle tooltip for the copy action (the tooltip flips to "已复制" while copied). */
  label: string;
  /** Overrides the compact default look (e.g. the reply row's fixed-size button). */
  className?: string;
}) {
  const { copied, flash } = useCopied();
  return (
    <>
      <button
        type="button"
        title={copied ? S.common.copied : label}
        aria-label={label}
        onClick={() => flash(typeof text === "function" ? text() : text)}
        className={className}
      >
        <CopyCheckGlyph copied={copied} />
      </button>
      {/* Sibling, not a child: the button's accessible name stays `label`, and `sr-only`
          is position:absolute, so it is not a flex item and disturbs no caller's layout. */}
      <CopiedStatus copied={copied} />
    </>
  );
}
