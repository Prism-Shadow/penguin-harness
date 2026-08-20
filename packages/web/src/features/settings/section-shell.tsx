/**
 * Shared frame for a System settings sub-page: heading, optional explanatory line, body, and
 * a trailing action row for the sections that save explicitly. Sections that apply on the
 * spot pass no actions and the row is not drawn, so nothing on screen suggests an unsaved
 * edit is waiting.
 */
import type { ReactNode } from "react";

export function SectionShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-4 md:p-5 dark:border-gray-800">
      <h2 className="text-base font-semibold">{title}</h2>
      {description !== undefined && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
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
