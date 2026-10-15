/**
 * The docs' search: the shared site search dialog over this locale's pages (lib/search.ts ranks
 * them), each result opening its page at the matching heading.
 */
import { useCallback, useMemo } from "react";
import type { RefObject } from "react";
import { useNavigate } from "react-router";
import { SiteSearchDialog, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteSearchResult } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { getDoc } from "../lib/docs";
import { DOC_SLUGS, HOME_SLUG } from "../lib/nav";
import { buildSearchRecords, findSearchMatchRanges, searchRecords } from "../lib/search";

interface DocResult extends SiteSearchResult {
  /** The page route, with the heading's anchor when the hit is in a section. */
  target: string;
}

export function DocSearch({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { locale } = useSiteLocale();
  const navigate = useNavigate();
  const records = useMemo(
    () =>
      buildSearchRecords(
        DOC_SLUGS.map((slug) => getDoc(slug, locale)).filter(
          (doc): doc is NonNullable<typeof doc> => doc !== undefined,
        ),
      ),
    [locale],
  );
  const search = useCallback(
    (query: string): DocResult[] =>
      searchRecords(records, query).map(({ record, snippet }, index) => {
        const page = record.slug === HOME_SLUG ? "/" : `/${record.slug}`;
        return {
          key: `${record.slug}:${record.anchor || "page"}:${index}`,
          title: record.heading || record.pageTitle,
          context: record.heading ? record.pageTitle : undefined,
          snippet: snippet || undefined,
          target: record.anchor ? `${page}#${record.anchor}` : page,
        };
      }),
    [records],
  );

  return (
    <SiteSearchDialog
      open={open}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      search={search}
      highlight={findSearchMatchRanges}
      onSelect={(result) => navigate(result.target)}
      labels={S.search}
    />
  );
}
