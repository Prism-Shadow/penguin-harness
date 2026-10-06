/**
 * Find bar: Ctrl+F searches the region the focused element is inside, Ctrl+Shift+F searches
 * every region on screen at once and lists what it found. Escape closes it.
 *
 * **What a region is** is lib/find-dom.ts's business: an element that opted in with
 * `data-find-region="<kind>"` — the conversation, the subagent panel's conversation, the
 * sidebar's Session list, the Files panel. This component only asks the DOM which of them are
 * on screen, and which one (if any) holds the focus, so adding a searchable surface is one
 * attribute on that surface and nothing here.
 *
 * **The page moves only when asked.** Typing re-indexes and re-counts on every keystroke, but
 * never scrolls: in a conversation that streams while you read it, a scroll that follows each
 * character typed is a scroll that fights the reader. Enter, the next/previous buttons and a
 * click on a result row are the three ways to travel to a hit, and the first of those only
 * travels on the second press — the first press is what shows you the match you already have
 * selected. (This is why `revealedRef` exists: the counter says "1/12" the moment a query
 * matches, and the page has deliberately not moved yet.)
 *
 * **Searching shows what was collapsed.** work-group.tsx mounts a group's rows only while it is
 * open, so a hit inside one you closed would be text this search cannot see. While a query is
 * live the flag in lib/find-expand.ts keeps every collapsible body mounted; the groups' own
 * open/closed state is untouched, so closing the bar restores the page exactly.
 *
 * **Content that was never loaded is the one thing this cannot fix**, and it says so instead:
 * a region that knows about more history carries `data-find-more`, which becomes the
 * "earlier content is not loaded — load and keep searching" row. Clicking it starts the same
 * backfill the region's own scroll affordance does (a `penguin:find-load-older` event on the
 * region element) and, when the window lands, keeps the search going *upward* — the next hit
 * is the nearest one above where the reader was, not the top of the conversation
 * (`nearestBefore`).
 *
 * **Re-indexing is driven by mutation, debounced.** The transcript changes under the search
 * while it streams, so a stale index is the normal case rather than an error: the bar watches
 * the document (ignoring its own panel — see the observer's filter) and re-indexes after a
 * quiet spell, and any hit that has left the document gets one re-index to settle before the
 * bar gives up on it (`revealHit`'s "gone").
 *
 * Nothing here is portaled: the panel is `fixed` at z-40, the in-flow-overlay layer the app
 * menus use, so a dialog (z-50) opened over it still covers it. Ctrl+F inside a dialog is left
 * alone entirely — a form in a dialog is a place where Ctrl+F means the browser's find, and
 * stealing it would be the one place a global shortcut is unwelcome.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { S } from "../../lib/strings";
import { writeFindActive } from "../../lib/find-expand";
import {
  FIND_LOAD_OLDER_EVENT,
  FIND_MORE_ATTR,
  clearHighlights,
  findRegions,
  hitSnippet,
  indexRegions,
  paintHits,
  revealHit,
} from "../../lib/find-dom";
import type { FindHit, FindRegion } from "../../lib/find-dom";
import { stepMatchIndex } from "../../lib/find-text";
import {
  CloseIcon,
  GlyphIcon,
  isTopEscLayer,
  popEscLayer,
  pushEscLayer,
} from "@prismshadow/penguin-ui";

/** Attribute a container opts in with (lib/find-dom.ts); read off the focused element's ancestors. */
const REGION_ATTR = "data-find-region";
/** Re-index this long after the last change to the searched DOM. */
const MUTATION_DEBOUNCE_MS = 300;
/** …and this long after the FIRST of a burst, so a stream that never pauses is still re-indexed. */
const MUTATION_MAX_WAIT_MS = 1_500;
/** Characters of context shown on either side of a hit in the aggregated list. */
const SNIPPET_RADIUS = 40;
/** Result rows drawn at once; the rest are counted (S.find.moreRows) instead of rendered. */
const MAX_ROWS = 50;

const STEP_UP_ICON = "M6 15l6-6 6 6";
const STEP_DOWN_ICON = "M6 9l6 6 6-6";

/** A hit's position, kept across the backfill that prepends content above it. */
interface Anchor {
  node: Node;
  offset: number;
}

/** The name of a region kind, for the scope button and the result rows. */
function regionLabel(kind: string): string {
  switch (kind) {
    case "conversation":
      return S.find.regionConversation;
    case "subagent":
      return S.find.regionSubagent;
    case "sessions":
      return S.find.regionSessions;
    case "files":
      return S.find.regionFiles;
    default:
      return kind;
  }
}

/** The region an element sits in, if any. */
function regionOf(element: Element | null): FindRegion | null {
  const container = element?.closest<HTMLElement>(`[${REGION_ATTR}]`) ?? null;
  if (container === null) return null;
  return { kind: container.dataset["findRegion"] ?? "", element: container };
}

/**
 * The region Ctrl+F falls back to when the focus is nowhere in particular (the body, the
 * composer, a toolbar): the conversation if there is one, else whatever is first. Sidebar-first
 * document order makes "the first region" the wrong guess on its own.
 */
function preferredRegion(regions: readonly FindRegion[]): FindRegion | null {
  return regions.find((r) => r.kind === "conversation") ?? regions[0] ?? null;
}

/** A dialog owns the keyboard while it is open; see the file header. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * The last hit that starts before `anchor` in document order — how "keep searching upward"
 * picks where to land after an earlier window is prepended. Hits are in document order, so the
 * walk stops at the first one at or past the anchor. A hit whose node has left the document is
 * skipped rather than compared, and -1 means there is nothing above to go to.
 */
function nearestBefore(hits: readonly FindHit[], anchor: Anchor): number {
  let best = -1;
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i]!.range.startContainer;
    if (start === anchor.node) {
      if (hits[i]!.range.startOffset < anchor.offset) {
        best = i;
        continue;
      }
      break;
    }
    if (!start.isConnected) continue;
    const rel = anchor.node.compareDocumentPosition(start);
    if ((rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) break;
    best = i;
  }
  return best;
}

/** The hit a query starts on: the first one, or none. */
function firstIndex(hits: readonly FindHit[]): number {
  return hits.length > 0 ? 0 : -1;
}

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  /** Search every region at once (Ctrl+Shift+F) instead of one. */
  const [allRegions, setAllRegions] = useState(false);
  /**
   * The region Ctrl+F found the focus in. It is the scope while `allRegions` is false, and the
   * way back from the widened search while it is true — so it is kept either way, rather than
   * cleared when the scope widens.
   */
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [hits, setHits] = useState<FindHit[]>([]);
  const [current, setCurrent] = useState(-1);
  /** Regions that hold content this search could not reach (see `data-find-more`). */
  const [moreRegions, setMoreRegions] = useState<HTMLElement[]>([]);
  /** Bumped to ask for a re-index without any other input changing. */
  const [generation, setGeneration] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** The live hit list, for the handlers that travel between hits (state is a paint behind them). */
  const hitsRef = useRef<readonly FindHit[]>([]);
  hitsRef.current = hits;
  /** Open state for the window listener, which is registered once. */
  const openRef = useRef(false);
  openRef.current = open;
  /** Where focus goes when the bar closes. */
  const restoreRef = useRef<HTMLElement | null>(null);
  /** This bar's place in the Escape stack (components/ui/modal.tsx). */
  const layerRef = useRef<symbol | null>(null);

  /** A re-index was asked for by a mutation: keep the reader's selection where it was. */
  const keepRef = useRef(false);
  /** The hit the mutation-driven re-index should scroll to once it has indexed (a "gone" retry, or a backfill). */
  const revealAfterRef = useRef(false);
  /** A "gone" hit gets exactly one re-index to settle, so a stream cannot loop this. */
  const goneTriedRef = useRef(false);
  /** The hit last scrolled to; differs from `current` after a query or scope change moved the selection. */
  const revealedRef = useRef(-1);
  /** Where the backfill that was just triggered should keep searching from. */
  const anchorRef = useRef<Anchor | null>(null);
  /** Hit count of the previous index, to tell a backfill's growth from a streaming repaint. */
  const lastCountRef = useRef(0);

  const close = () => {
    setOpen(false);
    setHits([]);
    setCurrent(-1);
    setMoreRegions([]);
    keepRef.current = false;
    revealAfterRef.current = false;
    goneTriedRef.current = false;
    revealedRef.current = -1;
    anchorRef.current = null;
    lastCountRef.current = 0;
    clearHighlights();
  };

  // The panel is an Escape layer of its own, so Escape closes it before anything under it
  // (and a dialog opened on top of it takes the first Escape instead).
  useEffect(() => {
    if (!open) return;
    const layer = pushEscLayer();
    layerRef.current = layer;
    return () => {
      layerRef.current = null;
      popEscLayer(layer);
    };
  }, [open]);

  // Ctrl/Cmd+F and Ctrl/Cmd+Shift+F, from anywhere. Capture phase: the composer's own key
  // handling must not see a Ctrl+F it would do nothing with anyway.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === "f" || e.key === "F")) {
        if (dialogOpen()) return;
        e.preventDefault();
        const regions = findRegions();
        const focused = regionOf(document.activeElement);
        const target = focused?.element ?? preferredRegion(regions)?.element ?? null;
        if (!openRef.current) {
          restoreRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        setAllRegions(e.shiftKey);
        setRegion(target);
        setOpen(true);
        // Every Ctrl+F re-indexes, even when nothing about the query or scope changed: the
        // point of pressing it again is to look at the page as it is now.
        setGeneration((g) => g + 1);
        return;
      }
      if (e.key !== "Escape" || !openRef.current) return;
      const layer = layerRef.current;
      if (layer === null || !isTopEscLayer(layer)) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // `close` reads nothing but refs and setters, and the listener is registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the query field when the bar opens (and hand focus back when it closes).
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore !== null && restore.isConnected) restore.focus();
  }, [open]);

  // A live query is what keeps collapsed bodies mounted (lib/find-expand.ts).
  useEffect(() => {
    writeFindActive(open && query !== "");
    return () => writeFindActive(false);
  }, [open, query]);

  // Re-index. Everything that decides what is searched or where the selection sits is settled
  // here rather than in the handlers, so a stale DOM is always re-read before anything is
  // scrolled to.
  useEffect(() => {
    if (!open) return;
    if (region !== null && !region.isConnected) {
      // The panel that held the region closed under the search: fall back rather than keep
      // reporting hits from a detached tree.
      setRegion(null);
      return;
    }
    const regions = findRegions();
    const fallback = preferredRegion(regions);
    const scoped = region === null ? [] : regions.filter((r) => r.element === region);
    const scope: readonly FindRegion[] = allRegions
      ? regions
      : scoped.length > 0
        ? scoped
        : fallback === null
          ? []
          : [fallback];
    const next = indexRegions(scope, { text: query, caseSensitive });
    setHits(next);
    setMoreRegions(
      scope.filter((r) => r.element.hasAttribute(FIND_MORE_ATTR)).map((r) => r.element),
    );

    const anchor = anchorRef.current;
    const grew = next.length > lastCountRef.current;
    let index: number;
    if (anchor !== null && grew) {
      // The backfill landed: continue upward from where the reader was.
      anchorRef.current = null;
      const at = nearestBefore(next, anchor);
      index = at >= 0 ? at : firstIndex(next);
      revealAfterRef.current = true;
    } else if (keepRef.current) {
      // A streaming repaint of the same search: the selection stays on the same hit.
      index =
        current < 0 || next.length === 0 ? firstIndex(next) : Math.min(current, next.length - 1);
    } else {
      // A new query or scope, or a fresh Ctrl+F: the first hit, and the page does not move.
      index = firstIndex(next);
      revealedRef.current = -1;
    }
    keepRef.current = false;
    lastCountRef.current = next.length;
    setCurrent(index);

    if (revealAfterRef.current) {
      revealAfterRef.current = false;
      const hit = next[index];
      if (hit !== undefined && revealHit(hit) === "gone" && !goneTriedRef.current) {
        // The index this was built from has since left the document (a stream trimmed its
        // window, say). One more pass, against the DOM that now exists, settles it.
        goneTriedRef.current = true;
        keepRef.current = true;
        revealAfterRef.current = true;
        setGeneration((g) => g + 1);
      }
    }
    // `current` is read only by the "keep the selection" branch, and re-running this effect
    // when it changes by itself would re-index on every Next/Prev.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, caseSensitive, allRegions, region, generation]);

  // Paint. Separate from the index above so travelling between hits repaints without a re-walk.
  useEffect(() => {
    if (!open) return;
    paintHits(hits, current);
  }, [open, hits, current]);

  // The page under the search changes while it streams: re-index after the changes quiet down,
  // and at least once per burst so a stream that never stops is still searchable.
  useEffect(() => {
    if (!open || query === "") return;
    let debounce: number | null = null;
    let cap: number | null = null;
    const reindex = (): void => {
      if (debounce !== null) window.clearTimeout(debounce);
      if (cap !== null) window.clearTimeout(cap);
      debounce = null;
      cap = null;
      keepRef.current = true;
      setGeneration((g) => g + 1);
    };
    const observer = new MutationObserver((records) => {
      // The bar's own panel mutates on every re-index (the counter, the result list) — reacting
      // to that would be a re-index loop with itself.
      const panel = panelRef.current;
      const foreign = records.some(
        (r) => panel === null || (r.target !== panel && !panel.contains(r.target)),
      );
      if (!foreign) return;
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(reindex, MUTATION_DEBOUNCE_MS);
      if (cap === null) cap = window.setTimeout(reindex, MUTATION_MAX_WAIT_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (debounce !== null) window.clearTimeout(debounce);
      if (cap !== null) window.clearTimeout(cap);
    };
  }, [open, query]);

  /** Show a hit: select it, and scroll to it — unless it is not there any more, which re-indexes. */
  const goTo = (index: number): void => {
    if (index < 0) return;
    setCurrent(index);
    goneTriedRef.current = false;
    const hit = hitsRef.current[index];
    if (hit === undefined) return;
    if (revealHit(hit) === "gone") {
      goneTriedRef.current = true;
      keepRef.current = true;
      revealAfterRef.current = true;
      setGeneration((g) => g + 1);
      return;
    }
    revealedRef.current = index;
  };

  /** Next/previous. The first press only shows the hit already selected (see the file header). */
  const step = (delta: number): void => {
    const list = hitsRef.current;
    if (list.length === 0) return;
    if (revealedRef.current !== current) goTo(current);
    else goTo(stepMatchIndex(current, list.length, delta));
  };

  /** The backfill: ask every region that has older content, and keep searching from where we are. */
  const loadMore = (): void => {
    const hit = hitsRef.current[current];
    anchorRef.current =
      hit === undefined ? null : { node: hit.range.startContainer, offset: hit.range.startOffset };
    revealAfterRef.current = true;
    goneTriedRef.current = false;
    for (const regionElement of moreRegions) {
      regionElement.dispatchEvent(new CustomEvent(FIND_LOAD_OLDER_EVENT, { bubbles: false }));
    }
    keepRef.current = true;
    setGeneration((g) => g + 1);
  };

  const onQueryChange = (value: string): void => {
    setQuery(value);
    // An anchor belongs to the backfill that is running; a new query abandons it.
    anchorRef.current = null;
    goneTriedRef.current = false;
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" || e.key === "F3") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  if (!open) return null;

  const counter =
    query === "" ? "" : hits.length === 0 ? S.find.noResults : `${current + 1}/${hits.length}`;
  const shown = hits.slice(0, MAX_ROWS);
  const scopeLabel =
    region === null
      ? null
      : S.find.scopeThisRegion(regionLabel(region.dataset["findRegion"] ?? ""));

  const iconButton =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100";

  return (
    <div
      ref={panelRef}
      role="search"
      data-find-skip
      className="anim-pop fixed right-3 top-3 z-40 flex max-h-[70vh] w-[27rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={S.find.placeholder}
          aria-label={S.find.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
        {/* Announced, not just drawn: a screen reader gets the same "3 of 12" a sighted reader does. */}
        <span
          aria-live="polite"
          className={`shrink-0 px-1 text-xs tabular-nums ${
            query !== "" && hits.length === 0
              ? "text-red-600 dark:text-red-400"
              : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {counter}
        </span>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={hits.length === 0}
          aria-label={S.find.prev}
          title={S.find.prev}
          className={iconButton}
        >
          <GlyphIcon d={STEP_UP_ICON} size={16} />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={hits.length === 0}
          aria-label={S.find.next}
          title={S.find.next}
          className={iconButton}
        >
          <GlyphIcon d={STEP_DOWN_ICON} size={16} />
        </button>
        <button
          type="button"
          onClick={() => setCaseSensitive((v) => !v)}
          aria-pressed={caseSensitive}
          aria-label={S.find.caseSensitive}
          title={S.find.caseSensitive}
          className={`${iconButton} text-xs font-semibold ${
            caseSensitive ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100" : ""
          }`}
        >
          Aa
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={S.find.close}
          title={S.find.close}
          className={iconButton}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {allRegions && shown.length > 0 && (
        <div
          role="listbox"
          aria-label={S.find.resultsLabel}
          className="min-h-0 flex-1 overflow-y-auto border-t border-gray-200 py-1 dark:border-gray-800"
        >
          {shown.map((hit, i) => {
            const snippet = hitSnippet(hit, SNIPPET_RADIUS);
            const selected = i === current;
            return (
              <button
                key={`${hit.region}:${i}`}
                type="button"
                role="option"
                aria-selected={selected}
                // Keeps the caret in the query field while the list scrolls under it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goTo(i)}
                className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs transition-colors duration-150 ${
                  selected
                    ? "bg-brand-50 dark:bg-brand-950"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <span className="shrink-0 rounded bg-gray-100 px-1 py-px text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {regionLabel(hit.region)}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400">
                  {snippet.before}
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {snippet.hit}
                  </span>
                  {snippet.after}
                </span>
              </button>
            );
          })}
          {hits.length > shown.length && (
            <p className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500">
              {S.find.moreRows(hits.length - shown.length)}
            </p>
          )}
        </div>
      )}

      {moreRegions.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-200 px-2 py-1.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span className="min-w-0 truncate">{S.find.loadMore}</span>
          <button
            type="button"
            onClick={loadMore}
            className="shrink-0 font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {S.find.loadMoreAction}
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-200 px-2 py-1 dark:border-gray-800">
        {scopeLabel !== null && (
          <button
            type="button"
            // Widening covers everything on screen; narrowing goes back to the region Ctrl+F
            // found the focus in. Both re-index from scratch (a new query, in effect).
            onClick={() => setAllRegions((v) => !v)}
            className="mr-auto rounded px-1.5 py-0.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            {allRegions ? scopeLabel : S.find.scopeAll}
          </button>
        )}
      </div>
    </div>
  );
}
