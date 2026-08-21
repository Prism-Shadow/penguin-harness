/**
 * Empty state components: a placeholder message for when a list/detail view has no data
 * (plain text, no graphic decoration) — `EmptyState` for a page, `SettingsEmpty` for the
 * slot a settings tab's table or list would occupy.
 */
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</p>
      {description && <p className="text-xs text-gray-500 dark:text-gray-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Settings-area empty state: the message centered on both axes inside a dashed, rounded
 * block that stands where the populated list or table would. Dashed rather than solid so an
 * empty slot never reads as a rendered-but-blank container, and `min-h` gives the text
 * something to be vertically centered in. Every settings tab that can come up empty
 * (Skills, Vault, Schedules, MCP servers) uses this, so they stay identical.
 */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-gray-300 px-4 text-center text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
      {children}
    </div>
  );
}
