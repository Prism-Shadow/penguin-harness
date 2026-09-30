/**
 * The empty state: what stands where a list or a detail would be when there is nothing in it —
 * plain words, no illustration, and optionally the one action that fills it.
 *
 * Two frames. A page's empty state is open, centred in generous space. `dashed` is the slot form
 * (a settings tab's table, a panel's list): the message centred on both axes inside a dashed
 * block that stands exactly where the populated list would, dashed rather than solid so an empty
 * slot never reads as a rendered-but-blank container. `SettingsEmpty` is that form for a single
 * sentence.
 */
import type { ReactNode } from "react";

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
      className={
        dashed
          ? "flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-4 text-center"
          : "flex flex-col items-center justify-center gap-2 py-12 text-center"
      }
    >
      <p className={dashed ? "text-xs text-fg-subtle" : "text-sm font-medium text-fg-muted"}>
        {title}
      </p>
      {description && <p className="text-xs text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A settings slot with nothing in it yet: `EmptyState dashed` holding one sentence. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <EmptyState dashed title={children} />;
}
