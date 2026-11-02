/**
 * One entry of a hub list: the whole card links to the entry's page. Title, a two-line summary,
 * then a row of short facts (author, version, counts) separated by space alone.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { InlineText } from "./inline-text";

export function HubCard({
  to,
  title,
  summary,
  facts,
  lead,
}: {
  to: string;
  title: string;
  summary?: string;
  facts: readonly ReactNode[];
  /** A glyph before the title (a plugin's icon). */
  lead?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex w-full min-w-0 gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      {lead}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-base font-semibold tracking-tight group-hover:text-brand-700 dark:group-hover:text-brand-300">
          {title}
        </h2>
        {summary && (
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
            <InlineText>{summary}</InlineText>
          </p>
        )}
        <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-2 text-xs text-gray-500 dark:text-gray-400">
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
