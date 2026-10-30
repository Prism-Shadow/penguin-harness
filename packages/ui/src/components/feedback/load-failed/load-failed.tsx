/**
 * What stands in a pane, in place of its content, when that content could not be loaded — a
 * conversation's history, a page's data: the one "could not load" notice, centred in the pane.
 *
 * One anatomy whatever the cause, so two failures that replace each other in the same place read
 * as one surface: a mark; a title saying what could not be loaded — or, where the cause is known,
 * where things stand ("gpu-box is unreachable; reconnecting"); a muted line under it, the failure
 * in words or what happens next; whatever the caller adds below (the shared retry row while
 * something retries on its own); the one press that moves on, a text action rather than a boxed
 * button, so the notice stays a few lines of words; and the raw technical detail folded away at
 * the bottom, for whoever has to diagnose it.
 *
 * Not an alarm: the words stay in the body and muted inks, never the danger ink, and the title
 * and its reason are two lines, not one "failed: <error>" string. The mark says it failed: the
 * cross in the danger tone by default; a caller whose failure is another thing's state (a machine
 * out of reach) passes that thing's glyph instead, in the subtle ink.
 *
 * Props only: every word is the caller's, and so is what the press does.
 */
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { TextAction } from "../../actions/text-action/text-action";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { HelpFold } from "../../overlays/info-popover/help-fold";

export interface LoadFailedAction {
  label: string;
  onClick: () => void;
}

export interface LoadFailedProps {
  /** One line: what could not be loaded, or where things stand. */
  title: string;
  /** Under the title, muted: the failure in words, or what happens next; null for none. */
  description?: string | null;
  /**
   * The mark: a registry glyph's path for the thing whose state this is (a machine), drawn in the
   * subtle ink. Omitted, the cross in the danger tone: the load itself failed.
   */
  glyph?: string;
  /** Between the words and the press: a live status, such as the shared retry row. */
  children?: ReactNode;
  /** The one press that moves on: try again, or go where the fix is; null for none. */
  action?: LoadFailedAction | null;
  /** The raw technical detail, folded under its own title and set in mono; null for none. */
  details?: { title: string; text: string } | null;
}

export function LoadFailed({
  title,
  description = null,
  glyph,
  children,
  action = null,
  details = null,
}: LoadFailedProps) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <GlyphIcon
          d={glyph ?? ICONS.xCircle}
          size={ICON_SIZE.sectionMark}
          className={glyph === undefined ? "text-tone-danger-fg" : "text-fg-subtle"}
        />
        <h2 className="max-w-full break-words text-base font-semibold text-fg">{title}</h2>
        {description !== null && (
          <p className="max-w-full break-words text-sm text-fg-muted">{description}</p>
        )}
        {children}
        {action !== null && (
          // At the reason's size, under it: a word to press, not a box.
          <TextAction className="text-sm" onClick={action.onClick}>
            {action.label}
          </TextAction>
        )}
        {details !== null && (
          <HelpFold title={details.title} className="mt-2 max-w-full text-left">
            <p className="break-words font-mono text-xs text-fg-muted">{details.text}</p>
          </HelpFold>
        )}
      </div>
    </div>
  );
}
