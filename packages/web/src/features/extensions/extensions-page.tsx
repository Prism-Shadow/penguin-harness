/**
 * Extension marketplace page: the extension index served by GET /api/extensions (currently the
 * builtin registry — the four sandbox backends), as a SINGLE-COLUMN list. One column
 * because the entry that identifies an extension is its package specifier, which is long,
 * scoped and monospace: side-by-side columns truncated exactly the string an operator
 * came here to read.
 *
 * Each row opens the entry's detail page. Read-only discovery: no install action here —
 * installing an extension is an install-side operation (`extensions.json`), not a Web App one.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ExtensionIndexEntry } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";

export function ExtensionsPage() {
  useDocumentTitle(S.nav.extensions);

  const [extensions, setExtensions] = useState<ExtensionIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Index list: readable once logged in, fetched once on page entry (skills-page convention).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getExtensionIndex()
      .then((res) => {
        if (!cancelled) setExtensions(res.extensions);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">{S.extensions.pageTitle}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{S.extensions.pageDesc}</p>

        {error ? (
          <div className="mt-6 flex items-center gap-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button size="sm" onClick={() => window.location.reload()}>
              {S.common.retry}
            </Button>
          </div>
        ) : extensions === null ? (
          <div className="mt-6 flex flex-col gap-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} className="p-4">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-3 h-5 w-40" />
              </SkeletonCard>
            ))}
          </div>
        ) : extensions.length === 0 ? (
          <p className="mt-6 text-sm text-gray-400 dark:text-gray-500">{S.extensions.empty}</p>
        ) : (
          <div className="mt-6 flex flex-col gap-2.5">
            {extensions.map((extension) => (
              // Versions are distinct index entries (typst-style flat index), so the key needs both halves.
              <ExtensionCard key={`${extension.name}@${extension.version}`} extension={extension} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One index entry as a row: icon tile + specifier/version, description, and a license +
 * keywords metadata row. The whole row is the link — an extension has one destination, so a
 * separate "open" affordance would only add a second target for the same action.
 */
function ExtensionCard({ extension }: { extension: ExtensionIndexEntry }) {
  return (
    <Link
      to={`/extensions/${extension.name}`}
      className="block rounded-md border border-gray-200 bg-white p-4 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800/60"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <GlyphIcon d={NAV_ICONS.extensions} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="min-w-0 truncate font-mono text-[13px] font-semibold"
              title={`${S.extensions.specifierHint}: ${extension.name}`}
            >
              {extension.name}
            </span>
            <span className="shrink-0 font-mono text-xs text-gray-400">v{extension.version}</span>
          </div>
          <p
            className="mt-0.5 truncate text-xs leading-5 text-gray-500 dark:text-gray-400"
            title={extension.description}
          >
            {extension.description}
          </p>
        </div>
        <GlyphIcon
          d="M9 6l6 6-6 6"
          size={14}
          className="shrink-0 text-gray-300 dark:text-gray-600"
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-gray-400 dark:text-gray-500">{extension.license}</span>
        {(extension.keywords ?? []).map((keyword) => (
          <span
            key={keyword}
            className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          >
            {keyword}
          </span>
        ))}
      </div>
    </Link>
  );
}
