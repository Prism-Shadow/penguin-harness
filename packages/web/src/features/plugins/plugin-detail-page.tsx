/**
 * One plugin's detail page: the index entry's metadata plus its long-form readme,
 * rendered from Markdown.
 *
 * The readme is fetched separately from the index (GET /api/plugins/readme) because the
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
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
import { Skeleton } from "../../components/ui/skeleton";

export function PluginDetailPage() {
  const params = useParams();
  const name = params["*"] ?? "";
  useDocumentTitle(name || S.pluginRegistry.pageTitle);

  const [entry, setEntry] = useState<PluginIndexEntry | null | undefined>(undefined);
  const [readme, setReadme] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = () => {
    void navigator.clipboard?.writeText(name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/plugins"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <GlyphIcon d="M15 6l-6 6 6 6" size={14} />
          {S.pluginRegistry.back}
        </Link>

        {error ? (
          <div className="mt-6 flex items-center gap-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
          <p className="mt-6 text-sm text-gray-400 dark:text-gray-500">
            {S.pluginRegistry.notFound}
          </p>
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
                    onClick={copy}
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {copied ? S.pluginRegistry.copied : S.pluginRegistry.copySpecifier}
                  </button>
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{entry.description}</p>
              </div>
            </header>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <Field label={S.pluginRegistry.license}>{entry.license}</Field>
              {entry.authors.length > 0 && (
                <Field label={S.pluginRegistry.authors}>{entry.authors.join(", ")}</Field>
              )}
              {entry.repository && (
                <Field label={S.pluginRegistry.repository}>
                  <ExternalLink href={entry.repository} />
                </Field>
              )}
              {entry.homepage && (
                <Field label={S.pluginRegistry.homepage}>
                  <ExternalLink href={entry.homepage} />
                </Field>
              )}
            </dl>

            {(entry.keywords ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
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
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="min-w-0 break-all text-gray-600 dark:text-gray-300">{children}</dd>
    </>
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
