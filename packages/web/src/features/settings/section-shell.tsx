/**
 * Shared frame for a System settings page that saves explicitly: body, and a trailing
 * action row. The dialog pane already draws the page heading and the "?" that discloses
 * what the page is, so the shell adds no title, no explanatory line and no box of its own.
 * Pages that apply on the spot pass no actions and the row is not drawn, so nothing on
 * screen suggests an unsaved edit is waiting.
 */
import type { ReactNode } from "react";

export function SectionShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="space-y-4">{children}</div>
      {actions !== undefined && (
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800/60">
          {actions}
        </div>
      )}
    </section>
  );
}
