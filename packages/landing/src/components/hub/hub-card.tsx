/**
 * One entry of a hub list: the whole card links to the entry's page. Its title, then a row of
 * short facts (author, version, counts) separated by space alone; the description is left to
 * the entry's page.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { SiteGlyph } from "@prismshadow/penguin-ui/site";
import type { SiteGlyphName } from "@prismshadow/penguin-ui/site";

export function HubCard({
  to,
  title,
  facts,
  lead,
}: {
  to: string;
  title: string;
  facts: readonly ReactNode[];
  /** The tile before the title (`HubTile`). */
  lead?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex w-full min-w-0 items-center gap-3.5 rounded-xl border border-gray-200 bg-white px-4 py-3.5 transition-colors hover:border-brand-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-700"
    >
      {lead}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-300">
          {title}
        </h2>
        <p className="mt-1 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
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

/** One fact on a card: a small glyph, then the words. */
export function CardFact({ glyph, children }: { glyph: SiteGlyphName; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <SiteGlyph name={glyph} className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
      {children}
    </span>
  );
}
