/**
 * The empty state: what stands where a list or a detail would be when there is nothing in it —
 * plain words and optionally the one action that fills it.
 *
 * Two frames. A page's empty state is open, centred in generous space. `dashed` is the slot form
 * (a settings tab's table, a panel's list): the message centred on both axes inside a dashed
 * block that stands exactly where the populated list would, dashed rather than solid so an empty
 * slot never reads as a rendered-but-blank container. `SettingsEmpty` is that form for a single
 * sentence.
 *
 * It carries the `ui-empty` hook: the frame names its form (`data-form="page" | "slot"`) and its
 * parts their slots (`art`, `title`, `description`, `action`), so a theme can dress an empty state
 * as a whole. The page form holds a small piece of art above the title, drawn in every style at
 * once (the line set's drawing here; a theme adds its own beside it), which theme.css hides: no
 * theme shows art until its own file says so, and the art never says what the words do not.
 */
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export function EmptyState({
  title,
  description,
  action,
  dashed = false,
}: {
  title: ReactNode;
  description?: string;
  action?: ReactNode;
  /** The slot form: a dashed block the size of the missing list, the message in the small rung. */
  dashed?: boolean;
}) {
  return (
    <div
      data-form={dashed ? "slot" : "page"}
      className={
        dashed
          ? "ui-empty flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-4 text-center"
          : "ui-empty flex flex-col items-center justify-center gap-2 py-12 text-center"
      }
    >
      {!dashed && (
        <div data-slot="art" aria-hidden className="text-fg-subtle">
          <span data-set="line" className="flex">
            <GlyphIcon d={ICONS.folderOpen} size={ICON_SIZE.sectionMark} decor="empty" />
          </span>
        </div>
      )}
      <p
        data-slot="title"
        className={dashed ? "text-xs text-fg-subtle" : "text-sm font-medium text-fg-muted"}
      >
        {title}
      </p>
      {description && (
        <p data-slot="description" className="text-xs text-fg-muted">
          {description}
        </p>
      )}
      {action && (
        <div data-slot="action" className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}

/** A settings slot with nothing in it yet: `EmptyState dashed` holding one sentence. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <EmptyState dashed title={children} />;
}
