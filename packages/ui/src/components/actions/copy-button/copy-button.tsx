/**
 * Copy-to-clipboard button and the hook behind it — the single place the "copy" affordance and
 * its feedback live, so every copy control behaves the same:
 *
 *   - the feedback follows the WRITE: the check appears only once the text has actually
 *     reached the clipboard (the clipboard writer reports that), so a copy the browser refused
 *     never reads as one that succeeded;
 *   - the feedback is shown AT THE BUTTON, and it is the icon alone: copy swaps to the check for
 *     COPIED_MS. No text changes anywhere — not a label, not the tooltip, which keeps naming the
 *     action. A control that keeps a visible text label keeps it unchanged and swaps only its
 *     glyph — see CopyCheckGlyph + useCopied;
 *   - the icon swap is silent, so every copy affordance also renders a CopiedStatus live region
 *     beside itself — the screen-reader half of the same feedback.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

/** How long the copied state (the check icon) stays after a click. */
const COPIED_MS = 1500;

/**
 * Writes `text` to the clipboard, resolving to whether it actually got there. It never rejects,
 * and it never reports a write it did not make: the copy feedback is shown on its answer.
 */
export type ClipboardWriter = (text: string) => Promise<boolean>;

/**
 * The writer used where the app supplies none: the async Clipboard API, which exists only in a
 * secure context. The app hands in a sturdier one through {@link ClipboardWriterProvider}.
 */
async function writeWithClipboardApi(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const ClipboardWriterContext = createContext<ClipboardWriter>(writeWithClipboardApi);

/** Supplies the app's clipboard writer to every copy control below it; mount it once. */
export function ClipboardWriterProvider({
  write,
  children,
}: {
  write: ClipboardWriter;
  children?: ReactNode;
}): ReactElement {
  return (
    <ClipboardWriterContext.Provider value={write}>{children}</ClipboardWriterContext.Provider>
  );
}

/**
 * Transient "just copied" flag: `flash()` writes the text and, if the write landed, turns
 * `copied` on for COPIED_MS. For a caller whose copy trigger is not a plain CopyButton (a text
 * button rendering CopyCheckGlyph beside its label); most callers use CopyButton directly.
 */
export function useCopied(): { copied: boolean; flash: (text: string) => void } {
  const write = useContext(ClipboardWriterContext);
  const [copied, setCopied] = useState(false);
  // The pending reset is held so it can be restarted and cancelled. Restarted: a second click
  // must get its own full COPIED_MS, or the first click's timer clears the check right after the
  // second copy — and the check is the only visible feedback, so a check that vanishes on click
  // reads as "the copy didn't take". Cancelled: the control can unmount inside the window (a
  // popover or a modal that closes itself), and the timeout must not outlive it.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );
  const flash = (text: string) => {
    void write(text).then((ok) => {
      // A refused write shows nothing rather than a check: the control returns to idle, so the
      // copy can simply be retried — there is no state to be stuck in.
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
  return <GlyphIcon d={copied ? ICONS.check : ICONS.copy} size={size} />;
}

/**
 * Screen-reader half of the copy feedback, rendered NEXT TO the control (never inside it, so it
 * joins neither the visible label nor the accessible name). The check glyph is `aria-hidden` and
 * the tooltip names the action, not the result, so without this region the confirmation is
 * silent. The region is always rendered and merely filled on copy: a live region announces
 * changes to its content, so it has to exist before the text appears.
 *
 * Deliberately a bare `aria-live` region rather than `role="status"` (which would mean the same to
 * a screen reader): `role="status"` marks a running Spinner, and copy buttons sit on pages whose
 * tests assert no spinner is left over.
 */
export function CopiedStatus({
  copied,
  announcement,
}: {
  copied: boolean;
  /** What is announced once copied; the interface's word for "copied" when omitted. */
  announcement?: string;
}) {
  const strings = useUiStrings();
  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {copied ? (announcement ?? strings.copied) : ""}
    </span>
  );
}

/** The compact look every copy button shares: a quiet glyph that fills in on hover. */
const LOOK =
  "rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted";

const SIZE = {
  // Beside a line of small text (an id, a path, a stats row): a 20 px square, the line height
  // those rows keep, so the button sits on the line without making it taller.
  sm: "inline-flex size-5 items-center justify-center",
  // A message footer, a code block's corner: the glyph with a rhythm step of padding round it.
  md: "p-1",
} as const;

export function CopyButton({
  text,
  label,
  size = "md",
  className = "",
}: {
  /** The string to copy, or a getter for content computed at click time (a formatted stats line). */
  text: string | (() => string);
  /** Accessible name and tooltip of the copy action; neither changes while copied. */
  label: string;
  size?: keyof typeof SIZE;
  /** Layout the caller's row needs (`shrink-0`, a margin); the look is the button's own. */
  className?: string;
}) {
  const { copied, flash } = useCopied();
  return (
    <>
      <button
        type="button"
        data-tooltip={label}
        aria-label={label}
        onClick={() => flash(typeof text === "function" ? text() : text)}
        className={`${LOOK} ${SIZE[size]} ${className}`}
      >
        <CopyCheckGlyph copied={copied} />
      </button>
      {/* Sibling, not a child: the button's accessible name stays `label`, and `sr-only` is
          position:absolute, so it is not a flex item and disturbs no caller's layout. */}
      <CopiedStatus copied={copied} />
    </>
  );
}
