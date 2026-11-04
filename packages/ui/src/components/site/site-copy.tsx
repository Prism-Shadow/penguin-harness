/**
 * The public sites' copy control: a labelled button that copies like every copy control in the
 * package (`useCopied`). The feedback follows the write — a refused one shows nothing — and it
 * is the glyph alone: the copy mark turns to a check while the label keeps naming the action, and
 * a live region beside the button says the copy happened. The sites hand `useCopied` a writer
 * that also works where the async Clipboard API does not (an insecure origin, a denied
 * permission).
 */
import type { ReactNode } from "react";
import {
  ClipboardWriterProvider,
  CopiedStatus,
  useCopied,
} from "../actions/copy-button/copy-button";
import { CheckIcon, CopyIcon, LinkIcon } from "./site-icons";

/**
 * Writes `text` to the clipboard, resolving to whether it got there: the async Clipboard API,
 * else a hidden textarea and `execCommand("copy")`. The textarea is fixed and transparent so
 * `select()` cannot scroll the page.
 */
export async function writeSiteClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    try {
      area.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

const LOOK = {
  /** Beside a code card's label. */
  pill: "site-copy inline-flex items-center gap-1.5 px-2 py-1 text-xs",
  /** A page action beside a title (Copy Markdown). */
  "pill-md": "site-copy inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs",
  /** Inline in a line of metadata, in its ink (a post's "copy link"). */
  text: "site-copy-text inline-flex items-center gap-1.5",
} as const;

const GLYPH = { copy: CopyIcon, link: LinkIcon } as const;

export type SiteCopyLook = keyof typeof LOOK;

function CopyControl({
  text,
  label,
  announcement,
  look,
  glyph,
  className,
}: {
  text: string | (() => string);
  label: string;
  announcement: string;
  look: SiteCopyLook;
  glyph: keyof typeof GLYPH;
  className: string;
}) {
  const { copied, flash } = useCopied();
  const Glyph = GLYPH[glyph];
  return (
    <>
      <button
        type="button"
        onClick={() => flash(typeof text === "function" ? text() : text)}
        title={look === "text" ? undefined : label}
        className={`${LOOK[look]} ${className}`}
      >
        {copied ? (
          <CheckIcon className="site-copy-done h-3.5 w-3.5" />
        ) : (
          <Glyph className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
      </button>
      {/* Sibling, not a child: the button's name stays its label. */}
      <CopiedStatus copied={copied} announcement={announcement} />
    </>
  );
}

export function SiteCopyButton({
  text,
  label,
  announcement,
  look = "pill",
  glyph = "copy",
  className = "",
}: {
  /** The string to copy, or a getter read at click time (the page's URL). */
  text: string | (() => string);
  /** The action, shown on the button throughout. */
  label: string;
  /** What a screen reader hears once the text is copied. */
  announcement: string;
  look?: SiteCopyLook;
  glyph?: keyof typeof GLYPH;
  className?: string;
}): ReactNode {
  return (
    <ClipboardWriterProvider write={writeSiteClipboard}>
      <CopyControl
        text={text}
        label={label}
        announcement={announcement}
        look={look}
        glyph={glyph}
        className={className}
      />
    </ClipboardWriterProvider>
  );
}
