/**
 * The page of one hub entry: a header (icon, title, one line under it, a link to its source),
 * then the body beside a column of facts — below 1024 px the facts follow the header. Sections in
 * the body are ruled, not boxed.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { GitHubIcon } from "@prismshadow/penguin-ui/site";
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

export function HubDetail({
  lead,
  title,
  subtitle,
  sourceUrl,
  facts,
  children,
}: {
  lead?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  sourceUrl?: string;
  facts: readonly { label: string; value: ReactNode }[];
  children: ReactNode;
}) {
  return (
    <ExternalLinkScope>
      <article className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {lead}
          <div className="min-w-0 flex-1 basis-72">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
          {sourceUrl && (
            <ExternalLink
              href={sourceUrl}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm whitespace-nowrap text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              <GitHubIcon aria-hidden className="h-4 w-4" />
              {S.hub.viewSource}
            </ExternalLink>
          )}
        </header>
        <div className="mt-8 grid gap-x-12 gap-y-8 border-t border-gray-200 pt-8 lg:grid-cols-[minmax(0,1fr)_15rem] dark:border-gray-800">
          <aside className="lg:order-2">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 lg:grid-cols-1 lg:gap-y-1">
              {facts.map(({ label, value }) => (
                <div key={label} className="contents lg:block lg:pb-3">
                  <dt className="text-xs leading-5 text-gray-500 dark:text-gray-400">{label}</dt>
                  <dd className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
          <div className="flex min-w-0 flex-col gap-8 lg:order-1">{children}</div>
        </div>
      </article>
    </ExternalLinkScope>
  );
}

/** A ruled section of a detail page's body. */
export function HubSection({
  title,
  id,
  children,
}: {
  title: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 border-t border-gray-200 pt-6 first:border-t-0 first:pt-0 dark:border-gray-800"
    >
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
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
