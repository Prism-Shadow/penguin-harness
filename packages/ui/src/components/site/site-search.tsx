/**
 * Site search: the trigger that names its shortcut, the Ctrl/Cmd+K hotkey, and the dialog.
 *
 * The dialog is a command palette over the host's index: results update as the reader types,
 * the input keeps focus while the arrow keys move the active result, Enter opens it, Escape and
 * a click on the backdrop close, Tab stays inside, and closing returns focus to whatever opened
 * it. The host owns the index and the ranking (`search`), the match ranges a result's text is
 * marked by (`highlight`) and what opening a result does (`onSelect`, typically a navigation);
 * the dialog owns the query, the keyboard and the look.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { ArrowRightIcon, SearchIcon, XIcon } from "./site-icons";

export interface SiteSearchResult {
  /** Unique within one result list. */
  key: string;
  /** What the result is: a section's heading, or a page's title. */
  title: string;
  /** Where it is, when the title is a section's heading: the page's title. */
  context?: string;
  /** The matching text around the hit. */
  snippet?: string;
}

/** A matched span, as UTF-16 offsets into the text, end exclusive. */
export interface SiteSearchRange {
  start: number;
  end: number;
}

export interface SiteSearchLabels {
  /** The dialog's and the input's name. */
  label: string;
  placeholder: string;
  /** Under an empty query. */
  start: string;
  noResults: string;
  noResultsHint: string;
  /** The result list's name. */
  results: string;
  close: string;
  /** The keyboard hint along the foot (hidden on phones). */
  keyboardHint: string;
}

/** The shortcut as a platform writes it: ⌘ K on Apple platforms, Ctrl K elsewhere. */
export function searchShortcutLabel(platform: string | undefined): string {
  return platform && /(Mac|iPhone|iPad|iPod)/i.test(platform) ? "⌘ K" : "Ctrl K";
}

/** The shortcut for this browser; module evaluation stays browser-free. */
export function currentSearchShortcutLabel(): string {
  const platform =
    typeof navigator === "undefined" ? undefined : navigator.platform || navigator.userAgent;
  return searchShortcutLabel(platform);
}

/** Ctrl/Cmd+K anywhere on the page opens search, unless it is open already. */
export function useSearchHotkey(open: boolean, onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        if (!open) onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpen]);
}

/** The full-width trigger at the top of a sidebar, with the shortcut on its right. */
export function SiteSearchButton({
  label,
  shortcut,
  onOpen,
}: {
  label: string;
  shortcut: string;
  /** Called with the button, so the dialog can return focus to it. */
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className="site-search-trigger mb-6 flex min-h-11 w-full items-center gap-2 px-3 text-left"
    >
      <SearchIcon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <kbd className="site-search-kbd">{shortcut}</kbd>
    </button>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: readonly SiteSearchRange[] }) {
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) parts.push(text.slice(offset, range.start));
    parts.push(
      <mark key={`${range.start}:${range.end}`}>{text.slice(range.start, range.end)}</mark>,
    );
    offset = range.end;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

export function SiteSearchDialog<Result extends SiteSearchResult>({
  open,
  onClose,
  returnFocusRef,
  search,
  highlight,
  onSelect,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  /** Focused again once the dialog closes, when still in the document. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** The results for a query, best first; pass a stable function (it reruns when it changes). */
  search: (query: string) => readonly Result[];
  /** The spans of `text` the query matches, to mark. */
  highlight: (text: string, query: string) => readonly SiteSearchRange[];
  /** Opens a result (the dialog closes itself after). */
  onSelect: (result: Result) => void;
  labels: SiteSearchLabels;
}) {
  const ids = useId();
  const inputId = `${ids}-input`;
  const titleId = `${ids}-title`;
  const listId = `${ids}-results`;
  const resultId = (index: number) => `${ids}-result-${index}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const activeResultRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => search(query), [search, query]);

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
    onSelect(result);
    onClose();
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
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

  return (
    <div
      className="site-search-backdrop anim-fade fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh] sm:px-6 sm:pt-[14vh]"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="site-search-panel anim-rise flex max-h-[min(38rem,80vh)] w-full max-w-2xl flex-col overflow-hidden"
        onKeyDown={onDialogKeyDown}
      >
        <div className="site-search-head flex min-h-14 items-center gap-3 px-4">
          <SearchIcon className="site-search-glyph h-5 w-5 shrink-0" />
          <label id={titleId} htmlFor={inputId} className="sr-only">
            {labels.label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={labels.placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={results[activeIndex] ? resultId(activeIndex) : undefined}
            className="site-search-input min-w-0 flex-1 py-4"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="site-search-close inline-flex h-11 w-11 shrink-0 items-center justify-center"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-32 overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="flex min-h-28 flex-col items-center justify-center px-5 text-center">
              <SearchIcon className="site-search-empty-glyph h-6 w-6" />
              <p className="site-search-note mt-3">{labels.start}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center px-5 text-center">
              <p className="site-search-note" data-strong="">
                {labels.noResults}
              </p>
              <p className="site-search-note mt-1">{labels.noResultsHint}</p>
            </div>
          ) : (
            <ul id={listId} role="listbox" aria-label={labels.results}>
              {results.map((result, index) => {
                const active = index === activeIndex;
                return (
                  <li key={result.key}>
                    <button
                      ref={active ? activeResultRef : undefined}
                      id={resultId(index)}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onFocus={() => setActiveIndex(index)}
                      onClick={() => openResult(index)}
                      className="site-search-result flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-sm font-medium">
                            <Highlighted
                              text={result.title}
                              ranges={highlight(result.title, query)}
                            />
                          </span>
                          {result.context && (
                            <span className="site-search-context truncate">
                              <Highlighted
                                text={result.context}
                                ranges={highlight(result.context, query)}
                              />
                            </span>
                          )}
                        </span>
                        {result.snippet && (
                          <span className="site-search-snippet mt-1 line-clamp-2">
                            <Highlighted
                              text={result.snippet}
                              ranges={highlight(result.snippet, query)}
                            />
                          </span>
                        )}
                      </span>
                      <ArrowRightIcon className="site-search-arrow h-4 w-4 shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="site-search-foot hidden px-4 py-2 sm:block">{labels.keyboardHint}</div>
      </div>
    </div>
  );
}
