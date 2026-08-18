/**
 * Copy-to-clipboard button and the hook behind it — the single place the app's "copy"
 * affordance and its feedback live, so every copy control behaves the same:
 *
 *   - the write is optimistic (an insecure context or denied permission must not leave the
 *     control stuck), matching the clipboard convention used across the chat views;
 *   - the feedback is ALWAYS shown AT THE BUTTON — the icon swaps copy → check for
 *     COPIED_MS and the tooltip flips to "已复制"; a control with room can also show the
 *     "已复制" text next to the check (showCopiedText). The feedback never replaces an
 *     unrelated label/title elsewhere.
 *
 * Icon-only callers (message footer, code block, reply stats) pass their own compact
 * className and omit showCopiedText, keeping their existing look; wider affordances (the
 * details card's Session id row) opt into the text.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import { GlyphIcon } from "./glyph-icon";

/** How long the copied state (check icon + "已复制") stays after a click. */
const COPIED_MS = 1500;

/** Best-effort clipboard write (never throws; no-op where the API is unavailable). */
export function writeClipboard(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/**
 * Transient "just copied" flag: `flash()` writes the text and turns `copied` on for
 * COPIED_MS. Exposed for the rare caller whose copy trigger is not a plain CopyButton
 * (e.g. a whole row); most callers should use CopyButton directly.
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

/** Default compact icon-button look (message footer / code block). */
const DEFAULT_CLASS =
  "rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300";

export function CopyButton({
  text,
  label,
  className = DEFAULT_CLASS,
  showCopiedText = false,
}: {
  /** The string to copy, or a getter for content computed at click time (e.g. a formatted stats line). */
  text: string | (() => string);
  /** Accessible name / idle tooltip for the copy action (the tooltip flips to "已复制" while copied). */
  label: string;
  /** Overrides the compact default look (e.g. the reply row's fixed-size button). */
  className?: string;
  /** Render the "已复制" text beside the check while copied (for wide affordances with room). */
  showCopiedText?: boolean;
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
      {showCopiedText && copied ? (
        <span className="flex items-center gap-1">
          <GlyphIcon d={STAT_ICONS.check} />
          {S.common.copied}
        </span>
      ) : (
        <GlyphIcon d={copied ? STAT_ICONS.check : STAT_ICONS.copy} />
      )}
    </button>
  );
}
