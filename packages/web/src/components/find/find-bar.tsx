/**
 * Find bar: `find.open` (Mod+F by default) searches the region the focused element is inside,
 * `find.all` (Mod+Shift+F) searches every region on screen at once and lists what it found.
 * Both are registry commands (lib/shortcuts/registry.ts), so they are rebindable and suspended
 * behind a dialog or a menu like every other global shortcut. A command declines, leaving the
 * key to the browser's own find, when the focus is in no region and no conversation is on
 * screen: a page with nothing but the sidebar to search is better served by the browser.
 *
 * **What a region is** is lib/find-dom.ts's business: an element that opted in with
 * `data-find-region="<kind>"` — the conversation, the subagent panel's conversation, the
 * sidebar's Session list, the Files panel. This component only asks the DOM which of them are
 * on screen, and which one (if any) holds the focus, so adding a searchable surface is one
 * attribute on that surface and nothing here.
 *
 * **Escape closes the bar from inside it**, the way a browser's find bar does. The bar is not
 * an Escape layer: an open layer suspends every global shortcut, and the bar stays open while
 * the reader works in the page.
 *
 * **The page moves only when asked.** Typing re-indexes and re-counts on every keystroke, but
 * never scrolls: in a conversation that streams while you read it, a scroll that follows each
 * character typed is a scroll that fights the reader. Enter, the next/previous buttons and a
 * click on a result row are the three ways to travel to a hit, and the first of those only
 * travels on the second press — the first press is what shows you the match you already have
 * selected. (This is why `revealedRef` exists: the counter says "1/12" the moment a query
 * matches, and the page has deliberately not moved yet.)
 *
 * **Searching shows what was collapsed.** A work group mounts its rows only while it is open, so
 * a hit inside one the reader closed would be text this search cannot see. Once the query has
 * settled, the searched regions open their collapsed groups (lib/find-expand.ts); the groups'
 * own open/closed state is untouched, so clearing the query or closing the bar folds them back.
 * Mounting them is the one expensive step of a search, so it waits for a pause in the typing.
 *
 * **Content that was never loaded is the one thing this cannot fix**, and it says so instead:
 * a region that knows about more history carries `data-find-more`, which becomes the
 * "earlier content is not loaded — load and keep searching" row. Clicking it starts the same
 * backfill the region's own scroll affordance does (a `penguin:find-load-older` event on the
 * region element) and, when hits land above the reader, keeps the search going *upward* — the
 * next hit is the nearest one above where the reader was, not the top of the conversation.
 *
 * **Re-indexing is driven by mutation, debounced.** The transcript changes under the search
 * while it streams, so a stale index is the normal case rather than an error: the bar watches
 * the document (ignoring its own panel — see the observer's filter) and re-indexes after a
 * quiet spell, and any hit that has left the document gets one re-index to settle before the
 * bar gives up on it (`revealHit`'s "gone").
 *
 * Nothing here is portaled: the panel is `fixed` at z-40, the in-flow-overlay layer the app
 * menus use, so a dialog (z-50) opened over it still covers it.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { CloseIcon, GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { revealCollapsedIn } from "../../lib/find-expand";
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
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { formatChord } from "../../lib/shortcuts/format";
import { currentPlatform } from "../../lib/shortcuts/platform";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";

/** Attribute a container opts in with (lib/find-dom.ts); read off the focused element's ancestors. */
const REGION_ATTR = "data-find-region";
/** Re-index this long after the last change to the searched DOM. */
const MUTATION_DEBOUNCE_MS = 300;
/** …and this long after the FIRST of a burst, so a stream that never pauses is still re-indexed. */
const MUTATION_MAX_WAIT_MS = 1_500;
/** Collapsed groups open for a query that has stayed unchanged this long. */
const REVEAL_SETTLE_MS = 300;
/** Characters of context shown on either side of a hit in the aggregated list. */
const SNIPPET_RADIUS = 40;
/** Result rows drawn at once; the rest are counted (S.find.moreRows) instead of rendered. */
const MAX_ROWS = 50;

/** A position in the document: a hit's start, kept across the backfill that prepends above it. */
interface Position {
  node: Node;
  offset: number;
}

/** Where "load and keep searching" resumes once the backfill lands. */
interface Anchor {
  /** The start of the hit the reader was on; null when there was none, so every hit lies above. */
  at: Position | null;
  /** How many hits lay above it when the backfill was asked for. */
  above: number;
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

/** The region a search falls back to when the focus is in none: the conversation, if one is on screen. */
function conversationRegion(regions: readonly FindRegion[]): FindRegion | null {
  return regions.find((r) => r.kind === "conversation") ?? null;
}

/**
 * The index of the last hit that starts before `at` in document order, or the last hit of all
 * when `at` is null; -1 when none does. Hits are in document order, so the walk stops at the
 * first one at or past `at`. A hit whose node has left the document is skipped.
 */
function lastHitAbove(hits: readonly FindHit[], at: Position | null): number {
  if (at === null) return hits.length - 1;
  let best = -1;
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i]!.range.startContainer;
    if (start === at.node) {
      if (hits[i]!.range.startOffset < at.offset) {
        best = i;
        continue;
      }
      break;
    }
    if (!start.isConnected) continue;
    if ((at.node.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) break;
    best = i;
  }
  return best;
}

/** The hit a query starts on: the first one, or none. */
function firstIndex(hits: readonly FindHit[]): number {
  return hits.length > 0 ? 0 : -1;
}

function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  return a.length === b.length && a.every((element, i) => element === b[i]);
}

/** A control's tooltip naming the fixed key that does the same, as the platform writes it. */
function keyHint(label: string, code: string, shift = false): string {
  const key = formatChord({ code, mod: false, ctrl: false, alt: false, shift }, currentPlatform());
  return `${label} (${key})`;
}

/** The bar's square controls: flat, the glyph deepening on hover. */
const ICON_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:text-fg-subtle disabled:opacity-60";
/** Their ink at rest; an option that is on takes the accent instead. */
const ICON_INK = "text-fg-muted hover:text-fg";

/** Pressing a control keeps the caret in the query field, so Enter goes on stepping. */
const keepFocus = (e: { preventDefault: () => void }): void => e.preventDefault();

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  /** Search every region at once (`find.all`) instead of one. */
  const [allRegions, setAllRegions] = useState(false);
  /**
   * The region the command found the focus in. It is the scope while `allRegions` is false, and
   * the way back from the widened search while it is true — so it is kept either way, rather
   * than cleared when the scope widens.
   */
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [hits, setHits] = useState<FindHit[]>([]);
  const [current, setCurrent] = useState(-1);
  /** The regions the last index searched: the ones whose collapsed groups a query opens. */
  const [scope, setScope] = useState<readonly HTMLElement[]>([]);
  /** Regions that hold content this search could not reach (see `data-find-more`). */
  const [moreRegions, setMoreRegions] = useState<HTMLElement[]>([]);
  /** Bumped to ask for a re-index without any other input changing. */
  const [generation, setGeneration] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** The live hit list, for the handlers that travel between hits (state is a paint behind them). */
  const hitsRef = useRef<readonly FindHit[]>([]);
  hitsRef.current = hits;
  /** Open state for the command handlers, which are registered once. */
  const openRef = useRef(false);
  openRef.current = open;
  /** Where focus goes when the bar closes. */
  const restoreRef = useRef<HTMLElement | null>(null);

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

  const close = () => {
    setOpen(false);
    setHits([]);
    setCurrent(-1);
    setScope([]);
    setMoreRegions([]);
    keepRef.current = false;
    revealAfterRef.current = false;
    goneTriedRef.current = false;
    revealedRef.current = -1;
    anchorRef.current = null;
    clearHighlights();
  };

  // The two commands. Pressed again while the bar has the focus, a command keeps the region and
  // only switches between one region and all of them; pressed elsewhere, it re-reads where the
  // focus is. Either way it re-indexes: the point of pressing it again is to look at the page as
  // it is now.
  useEffect(() => {
    const begin = (all: boolean): boolean => {
      const active = document.activeElement;
      const panel = panelRef.current;
      const fromBar =
        openRef.current && panel !== null && active !== null && panel.contains(active);
      if (!fromBar) {
        const target = regionOf(active) ?? conversationRegion(findRegions());
        if (target === null) return false;
        restoreRef.current = active instanceof HTMLElement ? active : null;
        setRegion(target.element);
      }
      // A backfill's anchor counts hits in the scope it was asked in.
      anchorRef.current = null;
      setAllRegions(all);
      setOpen(true);
      setGeneration((g) => g + 1);
      // Already open, the focus effect below does not run again.
      inputRef.current?.focus();
      inputRef.current?.select();
      return true;
    };
    const offs = [
      onCommand("find.open", () => begin(false)),
      onCommand("find.all", () => begin(true)),
    ];
    return () => {
      for (const off of offs) off();
    };
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

  // A settled query opens the collapsed groups of the searched regions; an empty one, or a closed
  // bar, folds them back at once. The timer restarts on every keystroke without folding anything
  // already open, so typing on in an open search does not make the page jump.
  useEffect(() => {
    if (!open || query === "") {
      revealCollapsedIn([]);
      return;
    }
    const timer = window.setTimeout(() => revealCollapsedIn(scope), REVEAL_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, scope]);
  useEffect(() => () => revealCollapsedIn([]), []);

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
    const scoped = region === null ? [] : regions.filter((r) => r.element === region);
    const fallback = conversationRegion(regions);
    const searched: readonly FindRegion[] = allRegions
      ? regions
      : scoped.length > 0
        ? scoped
        : fallback === null
          ? []
          : [fallback];
    const next = indexRegions(searched, { text: query, caseSensitive });
    setHits(next);
    const elements = searched.map((r) => r.element);
    setScope((prev) => (sameElements(prev, elements) ? prev : elements));
    setMoreRegions(
      searched.filter((r) => r.element.hasAttribute(FIND_MORE_ATTR)).map((r) => r.element),
    );

    // The hit the reader was on was re-rendered away: there is nothing to resume from.
    const stale = anchorRef.current?.at?.node.isConnected === false;
    const anchor = stale ? null : anchorRef.current;
    anchorRef.current = anchor;
    const above = anchor === null ? -1 : lastHitAbove(next, anchor.at);
    let index: number;
    if (anchor !== null && above + 1 > anchor.above) {
      // The backfill landed hits above the reader: continue upward from where they were.
      anchorRef.current = null;
      index = above;
      revealAfterRef.current = true;
    } else if (keepRef.current) {
      // A streaming repaint of the same search: the selection stays on the same hit.
      index =
        current < 0 || next.length === 0 ? firstIndex(next) : Math.min(current, next.length - 1);
    } else {
      // A new query or scope, or a fresh command: the first hit, and the page does not move.
      index = firstIndex(next);
      revealedRef.current = -1;
    }
    keepRef.current = false;
    setCurrent(index);

    const hit = revealAfterRef.current ? next[index] : undefined;
    revealAfterRef.current = false;
    if (hit !== undefined) {
      if (revealHit(hit) === "scrolled") {
        revealedRef.current = index;
      } else if (!goneTriedRef.current) {
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

  // The chord that switches the scope from inside the bar, for the scope button's tooltip.
  const scopeChord = useShortcutLabel(allRegions ? "find.open" : "find.all");

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
    anchorRef.current = {
      at:
        hit === undefined
          ? null
          : { node: hit.range.startContainer, offset: hit.range.startOffset },
      above: hit === undefined ? hitsRef.current.length : current,
    };
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
    // Enter while an IME is composing commits the composition; it is not a step.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === "F3") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    // A popover the page left open must not take this Escape as its own as well.
    e.stopPropagation();
    close();
  };

  if (!open) return null;

  const counter =
    query === "" ? "" : hits.length === 0 ? S.find.noResults : `${current + 1}/${hits.length}`;
  const shown = hits.slice(0, MAX_ROWS);
  const scopeLabel =
    region === null
      ? null
      : allRegions
        ? S.find.scopeThisRegion(regionLabel(region.dataset["findRegion"] ?? ""))
        : S.find.scopeAll;

  return (
    <div
      ref={panelRef}
      role="search"
      data-find-skip
      data-presence="enter"
      data-side="top"
      onKeyDown={onPanelKeyDown}
      className="fixed right-3 top-3 z-40 flex max-h-[70vh] w-[27rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
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
          className="min-w-0 flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        {/* Announced, not just drawn: a screen reader gets the same "3/12" a sighted reader does. */}
        <span aria-live="polite" className="shrink-0 px-1 text-xs tabular-nums text-fg-muted">
          {counter}
        </span>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => step(-1)}
          disabled={hits.length === 0}
          aria-label={S.find.prev}
          data-tooltip={keyHint(S.find.prev, "Enter", true)}
          className={`${ICON_BUTTON} ${ICON_INK}`}
        >
          <GlyphIcon d={ICONS.chevronUp} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => step(1)}
          disabled={hits.length === 0}
          aria-label={S.find.next}
          data-tooltip={keyHint(S.find.next, "Enter")}
          className={`${ICON_BUTTON} ${ICON_INK}`}
        >
          <GlyphIcon d={ICONS.chevronDown} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setCaseSensitive((v) => !v)}
          aria-pressed={caseSensitive}
          aria-label={S.find.caseSensitive}
          data-tooltip={S.find.caseSensitive}
          className={`${ICON_BUTTON} text-xs font-semibold ${caseSensitive ? "text-accent" : ICON_INK}`}
        >
          Aa
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={S.find.close}
          data-tooltip={keyHint(S.find.close, "Escape")}
          className={`${ICON_BUTTON} ${ICON_INK}`}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {allRegions && shown.length > 0 && (
        <div
          role="listbox"
          aria-label={S.find.resultsLabel}
          className="min-h-0 flex-1 overflow-y-auto border-t border-line-muted py-1"
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
                onMouseDown={keepFocus}
                onClick={() => goTo(i)}
                className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs transition-colors duration-150 ${
                  selected ? "bg-line-muted" : "hover:bg-surface-muted"
                }`}
              >
                <span className="shrink-0 text-fg-subtle">{regionLabel(hit.region)}</span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {snippet.before}
                  <span className="font-medium text-fg">{snippet.hit}</span>
                  {snippet.after}
                </span>
              </button>
            );
          })}
          {hits.length > shown.length && (
            <p className="px-2 py-1 text-xs text-fg-subtle">
              {S.find.moreRows(hits.length - shown.length)}
            </p>
          )}
        </div>
      )}

      {query !== "" && moreRegions.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line-muted px-2 py-1.5 text-xs text-fg-muted">
          <span className="min-w-0 truncate">{S.find.loadMore}</span>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={loadMore}
            className="shrink-0 font-medium text-link transition-colors duration-150 hover:text-link-hover"
          >
            {S.find.loadMoreAction}
          </button>
        </div>
      )}

      {scopeLabel !== null && (
        <div className="flex shrink-0 items-center border-t border-line-muted px-2 py-1">
          <button
            type="button"
            onMouseDown={keepFocus}
            // Widening covers everything on screen; narrowing goes back to the region the command
            // found the focus in. Both re-index from scratch (a new query, in effect).
            onClick={() => {
              anchorRef.current = null;
              setAllRegions((v) => !v);
            }}
            {...(scopeChord === null ? {} : { "data-tooltip": `${scopeLabel} (${scopeChord})` })}
            className="rounded-sm px-1.5 py-0.5 text-xs text-fg-muted transition-colors duration-150 hover:text-fg"
          >
            {scopeLabel}
          </button>
        </div>
      )}
    </div>
  );
}
