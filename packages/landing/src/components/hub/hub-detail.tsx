/**
 * The page of one hub entry: a header (icon, title, one line under it, a link to its source),
 * the kind's tags, then the body's panels beside a column with the facts panel (below 1024 px, or
 * on a `stacked` page, that column follows the body). Each block is an opaque panel with a
 * titled bar, so the blocks read apart at a glance; they rise in one after another on load.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { GitHubIcon, SiteGlyph } from "@prismshadow/penguin-ui/site";
import type { SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { TONE_INK } from "../../lib/hub/tones";
import type { HubTone } from "../../lib/hub/tones";
import { S } from "../../lib/strings";
import { loadDetail } from "../../lib/hub/data";
import type { DetailOf } from "../../lib/hub/data";
import { ExternalLink, ExternalLinkScope } from "../external-link";
import { PostPending } from "../post-pending";

/** The detail record of `id`: undefined while it loads, null when there is none. */
export function useHubDetail<K extends keyof DetailOf>(kind: K, id: string) {
  const [state, setState] = useState<{ id: string; detail: DetailOf[K] | null } | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    // A chunk that fails to load reloads the page (main.tsx): nothing to handle here.
    void loadDetail(kind, id)
      .then((detail) => {
        if (live) setState({ id, detail });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kind, id]);
  return state?.id === id ? state.detail : undefined;
}

export function HubPending() {
  return <PostPending />;
}

export function HubMissing({ listHref }: { listHref: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 text-center text-sm text-gray-600 sm:px-6 dark:text-gray-400">
      <p>{S.hub.notFound}</p>
      <Link
        to={listHref}
        className="mt-3 inline-block text-brand-700 hover:underline dark:text-brand-300"
      >
        {S.hub.backToList}
      </Link>
    </div>
  );
}

/** The opaque panel every block of a detail page sits in, matching the site's other cards. */
export const PANEL =
  "rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900";

export interface HubFact {
  label: string;
  value: ReactNode;
}

export function HubDetail({
  lead,
  title,
  subtitle,
  tags,
  sourceUrl,
  facts,
  aside,
  layout = "side",
  children,
}: {
  lead?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  /** A row of `HubTag`s under the title. */
  tags?: ReactNode;
  sourceUrl?: string;
  facts: readonly HubFact[];
  /** More panels after the facts. */
  aside?: ReactNode;
  /**
   * `side` keeps the facts in a right column from 1024 px; `stacked` gives the body the full
   * width and sets the facts and the other side panels in a row under it (a page whose body is a
   * wide chart).
   */
  layout?: "side" | "stacked";
  children: ReactNode;
}) {
  const stacked = layout === "stacked";
  return (
    <ExternalLinkScope>
      <article className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="anim-rise flex flex-wrap items-start gap-x-4 gap-y-3">
          {lead}
          <div className="min-w-0 flex-1 basis-48">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{subtitle}</p>
            )}
            {tags && <div className="mt-3 flex flex-wrap gap-1.5">{tags}</div>}
          </div>
          {sourceUrl && (
            <ExternalLink
              href={sourceUrl}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm whitespace-nowrap text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100"
            >
              <GitHubIcon aria-hidden className="h-4 w-4" />
              {S.hub.viewSource}
            </ExternalLink>
          )}
        </header>
        <div
          className={`mt-8 grid items-start gap-5 ${stacked ? "" : "lg:grid-cols-[minmax(0,1fr)_17rem]"}`}
        >
          <div className="hub-stagger flex min-w-0 flex-col gap-5">{children}</div>
          <aside
            className={`hub-stagger grid items-start gap-5 ${stacked ? "md:grid-cols-2" : ""}`}
          >
            <HubPanel title={S.hub.details} glyph="info" flush>
              <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                {facts.map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 px-4 py-2.5"
                  >
                    <dt className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{label}</dt>
                    <dd className="min-w-0 text-right text-sm font-medium [overflow-wrap:anywhere]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </HubPanel>
            {aside}
          </aside>
        </div>
      </article>
    </ExternalLinkScope>
  );
}

/**
 * One block of a detail page: an opaque panel with a title bar (its glyph, in the tone of the
 * page's kind, then the title; the block's own controls at the right end) over its content.
 * `flush` drops the content's padding for rows that run edge to edge.
 */
export function HubPanel({
  title,
  glyph,
  tone = "slate",
  id,
  actions,
  flush = false,
  children,
}: {
  title: ReactNode;
  glyph?: SiteGlyphName;
  tone?: HubTone;
  id?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-20 min-w-0 ${PANEL}`}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {glyph && <SiteGlyph name={glyph} className={`h-4 w-4 shrink-0 ${TONE_INK[tone]}`} />}
          <span>{title}</span>
        </h2>
        {actions}
      </header>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** A panel title with a count after it, the count in the muted ink. */
export function CountTitle({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      <span className="ml-1.5 font-normal text-gray-500 tabular-nums dark:text-gray-400">
        {count}
      </span>
    </>
  );
}

/** The References panel: a detail page's last block. */
export function HubReferences({ links }: { links: readonly string[] }) {
  if (links.length === 0) return null;
  return (
    <HubPanel title={S.hub.references} glyph="chainLink">
      <ul className="flex flex-col gap-1.5 text-sm">
        {links.map((href) => (
          <li key={href} className="[overflow-wrap:anywhere]">
            <ExternalLink
              href={href}
              className="text-brand-700 hover:underline dark:text-brand-300"
            >
              {href}
            </ExternalLink>
          </li>
        ))}
      </ul>
    </HubPanel>
  );
}

/** An author's name, linking to their homepage when they give one. */
export function AuthorName({ author }: { author?: { name: string; homepage?: string } }) {
  if (!author) return null;
  return author.homepage ? (
    <ExternalLink href={author.homepage} className="hover:underline">
      {author.name}
    </ExternalLink>
  ) : (
    <>{author.name}</>
  );
}
