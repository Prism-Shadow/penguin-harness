/**
 * Global docs search dialog: Ctrl/Cmd+K opens it, results update locally as the user
 * types, and every result navigates to the matching page heading. The input retains
 * focus while arrow keys move the active result, following command-palette behavior.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { useNavigate } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { getDoc } from "../lib/docs";
import { DOC_SLUGS, HOME_SLUG } from "../lib/nav";
import { buildSearchRecords, findSearchMatchRanges, searchRecords } from "../lib/search";
import { ArrowRightIcon, SearchIcon, XIcon } from "./icons";

function HighlightedText({ text, query }: { text: string; query: string }) {
  const ranges = findSearchMatchRanges(text, query);
  if (ranges.length === 0) return text;

  const parts = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) parts.push(text.slice(offset, range.start));
    parts.push(
      <mark
        key={`${range.start}:${range.end}`}
        className="bg-transparent text-brand-700 dark:text-brand-300"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    offset = range.end;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

export function DocSearchDialog({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const activeResultRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const records = useMemo(
    () =>
      buildSearchRecords(
        DOC_SLUGS.map((slug) => getDoc(slug, locale)).filter(
          (doc): doc is NonNullable<typeof doc> => doc !== undefined,
        ),
      ),
    [locale],
  );
  const results = useMemo(() => searchRecords(records, query), [records, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, returnFocusRef]);

  const openResult = (index: number) => {
    const result = results[index];
    if (!result) return;
    const page = result.record.slug === HOME_SLUG ? "/" : `/${result.record.slug}`;
    const target = result.record.anchor ? `${page}#${result.record.anchor}` : page;
    navigate(target);
    onClose();
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter" && results.length > 0) {
      event.preventDefault();
      openResult(activeIndex);
    }
  };

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  if (!open) return null;

  const activeResultId = results[activeIndex] ? `doc-search-result-${activeIndex}` : undefined;

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 pt-[10vh] sm:px-6 sm:pt-[14vh]"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-search-title"
        className="anim-rise flex max-h-[min(38rem,80vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-950"
        onKeyDown={onDialogKeyDown}
      >
        <div className="flex min-h-14 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-800">
          <SearchIcon className="h-5 w-5 shrink-0 text-gray-400" />
          <label id="doc-search-title" htmlFor="doc-search-input" className="sr-only">
            {S.search.label}
          </label>
          <input
            ref={inputRef}
            id="doc-search-input"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={S.search.placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="doc-search-results"
            aria-activedescendant={activeResultId}
            className="min-w-0 flex-1 bg-transparent py-4 text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={S.search.close}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-32 overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="flex min-h-28 flex-col items-center justify-center px-5 text-center">
              <SearchIcon className="h-6 w-6 text-gray-300 dark:text-gray-600" />
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{S.search.start}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center px-5 text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {S.search.noResults}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {S.search.noResultsHint}
              </p>
            </div>
          ) : (
            <ul id="doc-search-results" role="listbox" aria-label={S.search.results}>
              {results.map((result, index) => {
                const active = index === activeIndex;
                return (
                  <li key={`${result.record.slug}:${result.record.anchor || "page"}:${index}`}>
                    <button
                      ref={active ? activeResultRef : undefined}
                      id={`doc-search-result-${index}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onFocus={() => setActiveIndex(index)}
                      onClick={() => openResult(index)}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "bg-brand-50 text-gray-950 dark:bg-gray-800 dark:text-white"
                          : "text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-sm font-medium">
                            <HighlightedText
                              text={result.record.heading || result.record.pageTitle}
                              query={query}
                            />
                          </span>
                          {result.record.heading && (
                            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                              <HighlightedText text={result.record.pageTitle} query={query} />
                            </span>
                          )}
                        </span>
                        {result.snippet && (
                          <span className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                            <HighlightedText text={result.snippet} query={query} />
                          </span>
                        )}
                      </span>
                      <ArrowRightIcon
                        className={`h-4 w-4 shrink-0 ${active ? "text-brand-600 dark:text-brand-300" : "text-gray-300 dark:text-gray-600"}`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="hidden border-t border-gray-200 px-4 py-2 text-xs text-gray-500 sm:block dark:border-gray-800 dark:text-gray-400">
          {S.search.keyboardHint}
        </div>
      </div>
    </div>
  );
}
