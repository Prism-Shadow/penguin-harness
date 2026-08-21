/**
 * Shared frame for a System settings page that saves explicitly: optional explanatory
 * line, body, and a trailing action row. The dialog pane already draws the page heading,
 * so the shell adds no title and no box of its own. Pages that apply on the spot pass no
 * actions and the row is not drawn, so nothing on screen suggests an unsaved edit is
 * waiting.
 */
import type { ReactNode } from "react";

export function SectionShell({
  description,
  actions,
  children,
}: {
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {description !== undefined && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      )}
      <div className="mt-4 space-y-4">{children}</div>
      {actions !== undefined && (
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800/60">
          {actions}
        </div>
      )}
    </section>
  );
}
