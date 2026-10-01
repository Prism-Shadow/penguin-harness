/**
 * One plugin's detail page: the index entry's metadata plus its long-form readme,
 * rendered from Markdown.
 *
 * The readme is fetched separately from the index (GET /api/plugins/registry/readme) because the
 * shapes differ — the listing is sent in full on every visit to the Plugins page, while a
 * readme is large and wanted only for the entry someone opened.
 *
 * The specifier is the page's identity and arrives as the route's splat, since it is
 * scoped (`@scope/name`) and therefore contains a slash of its own.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { PluginIndexEntry } from "@prismshadow/penguin-server/api";
import ReactMarkdown from "react-markdown";
import {
  Button,
  CopiedStatus,
  CopyCheckGlyph,
  GlyphIcon,
  ICONS,
  KeyValue,
  KeyValueRow,
  PageFrame,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
  Skeleton,
  useCopied,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { NAV_ICONS } from "../../lib/nav-icons";
import { toneInk } from "../../lib/tone";

export function PluginDetailPage() {
  const params = useParams();
  const name = params["*"] ?? "";
  useDocumentTitle(name || S.pluginRegistry.pageTitle);

  const [entry, setEntry] = useState<PluginIndexEntry | null | undefined>(undefined);
  const [readme, setReadme] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { copied, flash } = useCopied();

  // The index carries every field this page shows except the readme, and it is one cached
  // call — cheaper and simpler than a per-entry metadata endpoint that would duplicate it.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEntry(undefined);
    setReadme(undefined);
    api
      .getPluginIndex()
      .then((res) => {
        if (cancelled) return;
        setEntry(res.plugins.find((p) => p.name === name) ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    api
      .getPluginReadme(name)
      .then((res) => {
        if (!cancelled) setReadme(res.readme);
      })
      // A missing readme is not a page error: the metadata above it is still worth showing.
      .catch(() => {
        if (!cancelled) setReadme(null);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    // The list's frame exactly — same column, same reserved gutter — so the content's edges stay
    // put when a row is opened and closed again.
    <PageFrame className="[scrollbar-gutter:stable]">
      <Link
        to="/plugins"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <GlyphIcon d={ICONS.chevronLeft} size={14} />
        {S.pluginRegistry.back}
      </Link>

      {error ? (
        <div className="mt-6 flex items-center gap-3">
          <p className={`text-sm ${toneInk.danger}`}>{error}</p>
          <Button size="sm" onClick={() => window.location.reload()}>
            {S.common.retry}
          </Button>
        </div>
      ) : entry === undefined ? (
        <div className="mt-6">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-6 h-40 w-full" />
        </div>
      ) : entry === null ? (
        <p className="mt-6 text-sm text-gray-400 dark:text-gray-500">{S.pluginRegistry.notFound}</p>
      ) : (
        <>
          <header className="mt-4 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <GlyphIcon d={NAV_ICONS.plugins} size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="min-w-0 break-all font-mono text-base font-semibold">
                  {entry.name}
                </h1>
                <span className="font-mono text-xs text-gray-400">v{entry.version}</span>
                <button
                  type="button"
                  onClick={() => flash(entry.name)}
                  data-tooltip={S.pluginRegistry.copySpecifier}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <CopyCheckGlyph copied={copied} size={12} />
                  {S.pluginRegistry.copySpecifier}
                </button>
                <CopiedStatus copied={copied} />
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{entry.description}</p>
            </div>
          </header>

          <KeyValue className="mt-4">
            <KeyValueRow label={S.pluginRegistry.license}>{entry.license}</KeyValueRow>
            {entry.authors.length > 0 && (
              <KeyValueRow label={S.pluginRegistry.authors}>{entry.authors.join(", ")}</KeyValueRow>
            )}
            {entry.repository && (
              <KeyValueRow label={S.pluginRegistry.repository}>
                <ExternalLink href={entry.repository} />
              </KeyValueRow>
            )}
            {entry.homepage && (
              <KeyValueRow label={S.pluginRegistry.homepage}>
                <ExternalLink href={entry.homepage} />
              </KeyValueRow>
            )}
          </KeyValue>

          {(entry.keywords ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              {(entry.keywords ?? []).map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  {keyword}
                </span>
              ))}
            </div>
          )}

          <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
            {S.pluginRegistry.installHint}
          </p>

          <section className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
            <h2 className="text-sm font-semibold">{S.pluginRegistry.readme}</h2>
            {readme === undefined ? (
              <Skeleton className="mt-3 h-40 w-full" />
            ) : readme === null ? (
              <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
                {S.pluginRegistry.noReadme}
              </p>
            ) : (
              <div className="md-body mt-3 text-sm text-gray-800 dark:text-gray-100">
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
                  {readme}
                </ReactMarkdown>
              </div>
            )}
          </section>
        </>
      )}
    </PageFrame>
  );
}

/** Index entries carry publisher-supplied URLs, so open them isolated from this origin. */
function ExternalLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {href}
    </a>
  );
}
