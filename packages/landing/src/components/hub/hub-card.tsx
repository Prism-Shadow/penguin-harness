/**
 * One entry of a hub list: the whole card links to the entry's page. Its title, then a row of
 * short facts (author, version, counts) separated by space alone; the description is left to
 * the entry's page.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";

export function HubCard({
  to,
  title,
  facts,
  lead,
}: {
  to: string;
  title: string;
  facts: readonly ReactNode[];
  /** A glyph before the title (a plugin's icon). */
  lead?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex w-full min-w-0 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      {lead}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-300">
          {title}
        </h2>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
          {facts.map((fact, index) => (
            <span key={index} className="whitespace-nowrap">
              {fact}
            </span>
          ))}
        </p>
      </div>
    </Link>
  );
}
