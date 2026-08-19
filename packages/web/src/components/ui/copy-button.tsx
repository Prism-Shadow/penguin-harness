/**
 * Copy-to-clipboard button and the hook behind it — the single place the app's "copy"
 * affordance and its feedback live, so every copy control behaves the same:
 *
 *   - the write is optimistic (an insecure context or denied permission must not leave the
 *     control stuck), matching the clipboard convention used across the chat views;
 *   - the feedback is ALWAYS shown AT THE BUTTON, and it is the icon alone: copy swaps to
 *     the check for COPIED_MS and the tooltip flips to "已复制" (#312 — no transient
 *     "已复制" text is rendered, and the feedback never replaces an unrelated label/title
 *     elsewhere). A control that keeps a visible text label (e.g. "复制 Prompt") keeps it
 *     unchanged and swaps only its glyph — see CopyCheckGlyph + useCopied.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import { GlyphIcon } from "./glyph-icon";

/** How long the copied state (check icon + flipped tooltip) stays after a click. */
const COPIED_MS = 1500;

/** Best-effort clipboard write (never throws; no-op where the API is unavailable). */
export function writeClipboard(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/**
 * Transient "just copied" flag: `flash()` writes the text and turns `copied` on for
 * COPIED_MS. Exposed for the caller whose copy trigger is not a plain CopyButton
 * (e.g. a text button rendering CopyCheckGlyph next to its label); most callers
 * should use CopyButton directly.
 */
export function useCopied(): { copied: boolean; flash: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const flash = (text: string) => {
    writeClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return { copied, flash };
}

/** The glyph pair every copy affordance shows: the copy icon, swapping to the check while copied. */
export function CopyCheckGlyph({ copied, size }: { copied: boolean; size?: number }) {
  return <GlyphIcon d={copied ? STAT_ICONS.check : STAT_ICONS.copy} size={size} />;
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
    <button
      type="button"
      title={copied ? S.common.copied : label}
      aria-label={label}
      onClick={() => flash(typeof text === "function" ? text() : text)}
      className={className}
    >
      <CopyCheckGlyph copied={copied} />
    </button>
  );
}
