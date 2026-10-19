/**
 * The Markdown reader: a Markdown document to read, with an outline and an in-page find. The
 * plugin detail's README, the file browser's Markdown preview (plugin files, Benchmark cases), the
 * Files panel's Markdown preview and the organization handbook all read through it, so a reader
 * who knows one knows them all.
 *
 * Four pieces, because the reader's controls belong in its host's title row — the path bar of the
 * Files panel and the handbook, the file browser's header, the README section's title — beside
 * the host's own actions, not in a row of their own:
 *
 * - `useMarkdownReader` holds the state (the outline, the current section, the find and its hits),
 *   so the host's header and the text share it. The host calls it and hands the result to the
 *   other three.
 * - `MarkdownReader` is the text: its scroll box and, when the reader is wide enough, the outline
 *   rail beside it. A host that has no title row passes no `reader`, and the reader draws a
 *   minimal strip of its own above the text with the same two controls.
 * - `ReaderTools` are the controls for the host's title row, the size of the host's own icon
 *   actions: the outline button (while the outline is folded, the reader being too narrow for the
 *   rail) and the find button (while the find is closed).
 * - `ReaderFindBar` is the open find bar, which the host draws in place of its path (or under the
 *   row, where the row is too narrow for both). Nothing of it lies over the text, so it covers no
 *   line, and a match the find scrolls to lands in a box nothing covers. Escape closes it and the
 *   path comes back.
 *
 * The text renders through the shared pipeline (`Md`), so the reader adds nothing to and takes
 * nothing from the rules every other Markdown surface follows. A site with a pipeline of its own
 * (the docs site's tabs and callouts) passes its rendered `children` instead: the outline and the
 * find read the rendered DOM, never the source, so they work over either.
 *
 * **Outline.** Headings h1–h4, read from the rendered text after every commit, so the outline is
 * the document's as it is on screen. With fewer than two there is none. When the reader is at
 * least `railMinWidth` wide the outline stands as a rail beside the text; narrower, it opens as a
 * popover from the outline button. A row scrolls the reader's own box, and nothing around it, to
 * bring its heading to the top; the current section follows the scroll (outline.ts has the
 * reading line). A row just chosen stays current until the reader scrolls by hand: a heading near
 * the end can never reach the reading line, and position alone would highlight a neighbour of
 * what was chosen.
 *
 * **Find.** The find button opens it, and so does the find shortcut while the focus is inside the
 * reader or its find bar — the host passes its binding (`isFindKey`; Mod+F when it passes none).
 * The key is only taken there: elsewhere the page's own find, or the browser's, keeps it. The
 * search runs over the rendered text through the shared find machinery (find-dom.ts),
 * case-insensitively, and paints every hit with the current one stronger. Typing jumps to the
 * first hit; Enter and ↓ go on, Shift+Enter and ↑ go back, wrapping at either end, scrolling only
 * the reader's box. Escape closes the find and drops its paint — and goes no further, so inside a
 * dialog the first Escape closes the find and the second the dialog. Text that is not displayed is
 * not searched (find-dom.ts skips it), so a match never points at something that cannot be shown.
 * The rendered text can still change under an open search (code blocks colour themselves after
 * they mount), which re-indexes after a pause and keeps the current hit. A reader that goes away
 * (another file opened, the editor taking its place) closes its find.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  ReactNode,
  Ref,
  RefObject,
  TouchEvent as ReactTouchEvent,
  UIEvent as ReactUIEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { Components } from "react-markdown";
import { ICON_SIZE } from "../../../icon-scale";
import { useUiStrings } from "../../../strings";
import { filesActionClass } from "../../files/files-frame/files-frame";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useMeasuredWidth } from "../../layout/measure/use-measured-width";
import { navRowClass } from "../../navigation/nav-list/nav-list";
import { Dropdown } from "../../overlays/dropdown/dropdown";
import { clearHighlights, indexRegions, paintHits, revealHit } from "../find/find-dom";
import type { FindHit } from "../find/find-dom";
import { FindField } from "../find/find-field";
import { stepMatchIndex } from "../find/find-text";
import { Md } from "../prose/prose";
import {
  OUTLINE_MIN_ENTRIES,
  OUTLINE_SELECTOR,
  activeEntry,
  outlineEntries,
  scrollTargetFor,
} from "./outline";
import type { OutlineEntry } from "./outline";

/** The reader's width (px) from which the outline stands beside the text rather than in a popover. */
export const READER_RAIL_MIN_WIDTH = 720;

/** Re-index this long after the rendered text last changed under an open search. */
const REINDEX_SETTLE_MS = 200;

/** Keys that scroll the box: pressed in it, they release a chosen outline row. */
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

/** Mod+F without Alt or Shift: the find key when the host names no binding. */
function isDefaultFindKey(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "KeyF"
  );
}

/** An outline row's indent, by depth. */
const INDENT: Record<number, string> = { 0: "", 1: "pl-3", 2: "pl-6", 3: "pl-9" };

/** The headings on screen and the outline they make. */
interface Outline {
  entries: OutlineEntry[];
  elements: HTMLElement[];
}

const NO_OUTLINE: Outline = { entries: [], elements: [] };

/** The outline of the headings under `content`, with each entry's element. */
function readOutline(content: HTMLElement): Outline {
  const elements: HTMLElement[] = [];
  const facts: { level: number; text: string }[] = [];
  for (const el of content.querySelectorAll<HTMLElement>(OUTLINE_SELECTOR)) {
    const text = (el.textContent ?? "").trim();
    if (text === "") continue;
    elements.push(el);
    facts.push({ level: Number(el.tagName.slice(1)), text });
  }
  return { entries: outlineEntries(facts), elements };
}

function sameOutline(a: Outline, b: Outline): boolean {
  return (
    a.elements.length === b.elements.length &&
    a.elements.every((el, i) => el === b.elements[i] && a.entries[i]!.text === b.entries[i]!.text)
  );
}

/** How far down the box's content an element starts, in px. */
function offsetIn(body: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
}

/** Hands `value` to a ref the caller passed, whichever kind it is. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null && ref !== undefined) (ref as MutableRefObject<T | null>).current = value;
}

export interface MarkdownReaderOptions {
  /** Whether a keydown is the find shortcut; the app passes the user's binding. */
  isFindKey?: (event: KeyboardEvent) => boolean;
  /** The find shortcut as the platform writes it ("⌘F"), for the find button's hint. */
  findShortcut?: string | null;
  /** The reader's width (px) from which the outline stands beside the text. */
  railMinWidth?: number;
}

/** A reader's state, shared by its text, its controls and its find bar wherever the host puts them. */
export interface MarkdownReaderState {
  /** A reader is on screen: the controls have a text to act on. */
  attached: boolean;
  /** The document has an outline (two or more headings). */
  hasOutline: boolean;
  /** The outline stands as a rail beside the text; otherwise it opens from the outline button. */
  rail: boolean;
  outline: readonly OutlineEntry[];
  /** The current section, an index into `outline`; -1 for none. */
  active: number;
  outlineOpen: boolean;
  setOutlineOpen: (open: boolean) => void;
  /** Scrolls the reader's box to entry `index`'s heading and makes it current. */
  goTo: (index: number) => void;
  findOpen: boolean;
  /** The find bar is on screen: open, over a reader that is. */
  findShown: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** "3/12", the no-match word, or "" while the query is empty. */
  counter: string;
  canStep: boolean;
  step: (delta: 1 | -1) => void;
  openFind: () => void;
  closeFind: () => void;
  isFindKey: (event: KeyboardEvent) => boolean;
  findShortcut: string | null;
  /** The pieces' own wiring: the elements they measure and focus, and the hooks of the scroll box. */
  wiring: ReaderWiring;
}

/** How the reader's pieces reach each other's elements. */
interface ReaderWiring {
  root: RefObject<HTMLDivElement | null>;
  body: MutableRefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  rail: RefObject<HTMLElement | null>;
  input: RefObject<HTMLInputElement | null>;
  attach: () => void;
  detach: () => void;
  scheduleActive: () => void;
  unpin: () => void;
}

/** A reader's state, held by the host that draws its controls; see the module header. */
export function useMarkdownReader({
  isFindKey = isDefaultFindKey,
  findShortcut = null,
  railMinWidth = READER_RAIL_MIN_WIDTH,
}: MarkdownReaderOptions = {}): MarkdownReaderState {
  const owner = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const rail = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const width = useMeasuredWidth(root);
  const [attached, setAttached] = useState(false);

  // ------------------------------------------------------------------------------ outline
  const [outline, setOutline] = useState<Outline>(NO_OUTLINE);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const [active, setActive] = useState(-1);
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** The row just chosen, current until the reader is scrolled by hand. */
  const pinnedRef = useRef<number | null>(null);
  const frameRef = useRef(0);

  // Every commit re-reads the headings: the text, the host's children or a late block may have
  // changed them, and reading a handful of elements costs less than knowing which.
  useLayoutEffect(() => {
    const next = content.current === null ? NO_OUTLINE : readOutline(content.current);
    if (!sameOutline(outlineRef.current, next)) {
      pinnedRef.current = null;
      setOutline(next);
    }
  });

  const updateActive = (): void => {
    frameRef.current = 0;
    const box = body.current;
    if (box === null) return;
    if (pinnedRef.current !== null) {
      setActive(pinnedRef.current);
      return;
    }
    const tops = outlineRef.current.elements.map((el) => offsetIn(box, el));
    setActive(
      activeEntry(tops, {
        top: box.scrollTop,
        height: box.scrollHeight,
        viewport: box.clientHeight,
      }),
    );
  };
  const scheduleActive = (): void => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(updateActive);
  };
  // A new outline, or a new width (which reflows the text), moves the headings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(updateActive, [outline, width]);
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  /** Releases a chosen row: the reader is being scrolled by hand. */
  const unpin = (): void => {
    if (pinnedRef.current === null) return;
    pinnedRef.current = null;
    scheduleActive();
  };

  const goTo = (index: number): void => {
    const box = body.current;
    const heading = outlineRef.current.elements[index];
    if (box === null || heading === undefined) return;
    box.scrollTop = scrollTargetFor(offsetIn(box, heading), {
      height: box.scrollHeight,
      viewport: box.clientHeight,
    });
    pinnedRef.current = index;
    setActive(index);
  };

  const hasOutline = outline.entries.length >= OUTLINE_MIN_ENTRIES;
  const showRail = hasOutline && width >= railMinWidth;

  // The rail keeps its current row in view as the reader scrolls past more headings than it shows.
  useEffect(() => {
    const box = rail.current;
    const row = box?.querySelector<HTMLElement>('[aria-current="location"]');
    if (box == null || row == null) return;
    // The rail is positioned, so a row's offset is measured from the rail's own top.
    const top = row.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
  }, [active, showRail]);

  // --------------------------------------------------------------------------------- find
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FindHit[]>([]);
  const [current, setCurrent] = useState(-1);
  /** Bumped to re-index without anything else changing. */
  const [generation, setGeneration] = useState(0);
  const hitsRef = useRef<readonly FindHit[]>(hits);
  hitsRef.current = hits;
  const currentRef = useRef(current);
  currentRef.current = current;
  /** The next index keeps the current hit (the text changed under it) instead of starting over. */
  const keepRef = useRef(false);
  /** The next index scrolls to the current hit even though it keeps it (the hit had gone). */
  const revealRef = useRef(false);

  const focusQuery = (): void => {
    input.current?.focus();
    input.current?.select();
  };

  const openFind = (): void => {
    if (findOpen) focusQuery();
    else setFindOpen(true);
  };

  const closeFind = useCallback((): void => {
    setFindOpen(false);
    setHits([]);
    setCurrent(-1);
    clearHighlights(owner);
    body.current?.focus({ preventScroll: true });
  }, [owner]);

  // The find bar takes the caret as it opens.
  useEffect(() => {
    if (findOpen && attached) focusQuery();
  }, [findOpen, attached]);

  // Index: a new query starts on the first hit and shows it; a re-index of the same query keeps
  // the hit the reader was on.
  useEffect(() => {
    if (!findOpen) return;
    const text = content.current;
    const next =
      text === null || query === ""
        ? []
        : indexRegions([{ kind: "document", element: text }], {
            text: query,
            caseSensitive: false,
          });
    const keep = keepRef.current;
    const reveal = !keep || revealRef.current;
    keepRef.current = false;
    revealRef.current = false;
    const index =
      next.length === 0
        ? -1
        : keep
          ? Math.min(Math.max(currentRef.current, 0), next.length - 1)
          : 0;
    setHits(next);
    setCurrent(index);
    if (reveal && index >= 0) revealHit(next[index]!);
  }, [findOpen, query, generation, attached]);

  // Paint, apart from the index, so stepping between hits repaints without a re-walk.
  useEffect(() => {
    if (findOpen) paintHits(hits, current, owner);
  }, [findOpen, hits, current, owner]);
  useEffect(() => () => clearHighlights(owner), [owner]);

  // The rendered text changing under an open search (a code block colouring itself) re-indexes
  // once it settles, keeping the hit the reader is on.
  useEffect(() => {
    const text = content.current;
    if (!findOpen || query === "" || text === null || typeof MutationObserver === "undefined")
      return;
    let timer: number | null = null;
    const observer = new MutationObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        keepRef.current = true;
        setGeneration((g) => g + 1);
      }, REINDEX_SETTLE_MS);
    });
    observer.observe(text, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [findOpen, query, attached]);

  const step = (delta: 1 | -1): void => {
    const list = hitsRef.current;
    if (list.length === 0) return;
    const index = stepMatchIndex(currentRef.current, list.length, delta);
    setCurrent(index);
    if (revealHit(list[index]!) === "gone") {
      // The text was re-rendered under the index: settle it, then show the same hit.
      currentRef.current = index;
      keepRef.current = true;
      revealRef.current = true;
      setGeneration((g) => g + 1);
    }
  };

  const attach = useCallback(() => setAttached(true), []);
  // A reader that goes away takes its find with it.
  const detach = useCallback(() => {
    setAttached(false);
    closeFind();
  }, [closeFind]);

  const t = useUiStrings().reader;
  const counter =
    query === "" ? "" : hits.length === 0 ? t.noResults : `${current + 1}/${hits.length}`;

  return {
    attached,
    hasOutline,
    rail: showRail,
    outline: outline.entries,
    active,
    outlineOpen,
    setOutlineOpen,
    goTo,
    findOpen,
    findShown: findOpen && attached,
    query,
    setQuery,
    counter,
    canStep: hits.length > 0,
    step,
    openFind,
    closeFind,
    isFindKey,
    findShortcut,
    wiring: { root, body, content, rail, input, attach, detach, scheduleActive, unpin },
  };
}

/** The outline's rows, in the rail or in the popover. */
function OutlineRows({ reader, onChosen }: { reader: MarkdownReaderState; onChosen?: () => void }) {
  return (
    <ul className="flex flex-col">
      {reader.outline.map((entry, index) => (
        <li key={index}>
          <button
            type="button"
            aria-current={index === reader.active ? "location" : undefined}
            onClick={() => {
              reader.goTo(index);
              onChosen?.();
            }}
            className={navRowClass({ active: index === reader.active, density: "sm" })}
          >
            <span className={`min-w-0 truncate ${INDENT[entry.depth] ?? ""}`}>{entry.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reader's controls, for the host's title row beside its own icon actions: the outline
 * button while the outline is folded, the find button while the find is closed. Nothing while no
 * reader is on screen.
 */
export function ReaderTools({
  reader,
  className = "",
}: {
  reader: MarkdownReaderState;
  className?: string;
}) {
  const t = useUiStrings().reader;
  if (!reader.attached) return null;
  const outline = reader.hasOutline && !reader.rail;
  if (!outline && reader.findOpen) return null;
  return (
    <span className={`flex shrink-0 items-center gap-1 ${className}`}>
      {outline && (
        <Dropdown
          open={reader.outlineOpen}
          setOpen={reader.setOutlineOpen}
          portal={{ direction: "down", align: "right" }}
          className="shrink-0"
          menuClass="w-64 max-h-[60vh] overflow-y-auto p-1"
          button={
            <button
              type="button"
              aria-label={t.outline}
              data-tooltip={t.outline}
              aria-expanded={reader.outlineOpen}
              onClick={() => reader.setOutlineOpen(!reader.outlineOpen)}
              className={filesActionClass}
            >
              <GlyphIcon d={ICONS.textLines} size={ICON_SIZE.iconButton} />
            </button>
          }
        >
          <nav aria-label={t.outline}>
            <OutlineRows reader={reader} onChosen={() => reader.setOutlineOpen(false)} />
          </nav>
        </Dropdown>
      )}
      {!reader.findOpen && (
        <button
          type="button"
          aria-label={t.find}
          data-tooltip={
            reader.findShortcut === null ? t.find : `${t.find} (${reader.findShortcut})`
          }
          onClick={reader.openFind}
          className={filesActionClass}
        >
          <GlyphIcon d={ICONS.search} size={ICON_SIZE.iconButton} />
        </button>
      )}
    </span>
  );
}

/**
 * The open find bar, for the host's title row in place of its path. It keeps its own keys: the
 * find shortcut selects the query again, Escape closes the find and goes no further.
 */
export function ReaderFindBar({
  reader,
  className = "",
}: {
  reader: MarkdownReaderState;
  className?: string;
}) {
  const t = useUiStrings().reader;
  if (!reader.findShown) return null;
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (reader.isFindKey(e.nativeEvent)) {
      e.preventDefault();
      reader.openFind();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      reader.closeFind();
    }
  };
  return (
    <div
      role="search"
      data-find-skip
      data-presence="enter"
      onKeyDown={onKeyDown}
      className={`min-w-0 ${className}`}
    >
      <FindField
        className="w-full"
        query={reader.query}
        onQueryChange={reader.setQuery}
        counter={reader.counter}
        canStep={reader.canStep}
        onStep={reader.step}
        onClose={reader.closeFind}
        inputRef={reader.wiring.input}
        arrowKeys
        labels={{
          placeholder: t.findPlaceholder,
          previous: t.previousMatch,
          next: t.nextMatch,
          close: t.closeFind,
        }}
        hints={{ close: `${t.closeFind} (Esc)` }}
      />
    </div>
  );
}

export interface MarkdownReaderProps extends MarkdownReaderOptions {
  /**
   * The state from the host's `useMarkdownReader`, whose controls the host draws in its title
   * row. Omitted, the reader keeps its own and draws its controls in a strip above the text.
   */
  reader?: MarkdownReaderState;
  /** The Markdown, rendered through the shared pipeline. */
  text?: string;
  /** Element adapters for `text` (images and links that know where the file lives); a module constant or a memo. */
  components?: Components;
  /** Rendered reading content in place of `text`, for a site with its own pipeline. */
  children?: ReactNode;
  /** The scroll box's accessible name: the document's name. */
  label?: string;
  /** The host's actions, in the reader's own strip (only drawn without a host `reader`). */
  actions?: ReactNode;
  /** Under the text, inside the scroll box: a note that the file was cut short. */
  footer?: ReactNode;
  /** The scroll box: its padding. */
  bodyClassName?: string;
  /** The reading box: its size and ink (`text-sm`, `leading-relaxed`, `text-fg`). */
  contentClassName?: string;
  /** The scroll box's element, for a host that hangs a context menu off it. */
  bodyRef?: Ref<HTMLDivElement>;
  /** Handlers on the scroll box: a context menu's gestures, a link interceptor. */
  bodyProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "tabIndex" | "children">;
  /** The reader's size in its host: a height, or `flex-1` in a column. */
  className?: string;
}

export function MarkdownReader({
  reader: hostReader,
  isFindKey,
  findShortcut,
  railMinWidth,
  text,
  components,
  children,
  label,
  actions,
  footer,
  bodyClassName = "p-3",
  contentClassName = "text-sm leading-relaxed text-fg",
  bodyRef: hostBodyRef,
  bodyProps = {},
  className = "",
}: MarkdownReaderProps) {
  const t = useUiStrings().reader;
  // A reader with no host keeps its own state; with one, this copy stays idle (nothing of it is
  // ever attached to an element).
  const own = useMarkdownReader({ isFindKey, findShortcut, railMinWidth });
  const reader = hostReader ?? own;
  const standalone = hostReader === undefined;
  const { wiring } = reader;

  useEffect(() => {
    wiring.attach();
    return wiring.detach;
  }, [wiring.attach, wiring.detach]);

  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.defaultPrevented) return;
    if (reader.isFindKey(e.nativeEvent)) {
      // Kept from the browser's find and from the page's: the reader has the focus.
      e.preventDefault();
      reader.openFind();
      return;
    }
    // The outline's popover takes its own Escape; with it closed, Escape closes the find and
    // goes no further (a dialog around the reader stays open).
    if (
      e.key === "Escape" &&
      reader.findOpen &&
      !reader.outlineOpen &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      e.stopPropagation();
      reader.closeFind();
    }
  };

  const setBody = (el: HTMLDivElement | null): void => {
    wiring.body.current = el;
    assignRef(hostBodyRef, el);
  };
  const { onScroll, onWheel, onTouchMove, onKeyDown, ...restBodyProps } = bodyProps;

  return (
    <div
      ref={wiring.root}
      className={`flex min-h-0 min-w-0 flex-col ${className}`}
      onKeyDown={onRootKeyDown}
    >
      {/* No host title row to hold the controls: a minimal strip of the reader's own, above the
          text rather than over it. */}
      {standalone && (
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-line-muted px-2 py-1">
          <ReaderFindBar reader={reader} className="max-w-sm flex-1" />
          {actions}
          <ReaderTools reader={reader} />
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {/* The scroll box. Focusable, so the keyboard can scroll it and the find key has
            somewhere to land. */}
        <div
          {...restBodyProps}
          ref={setBody}
          tabIndex={0}
          {...(label !== undefined ? { role: "region", "aria-label": label } : {})}
          onScroll={(e: ReactUIEvent<HTMLDivElement>) => {
            onScroll?.(e);
            wiring.scheduleActive();
          }}
          onWheel={(e: ReactWheelEvent<HTMLDivElement>) => {
            onWheel?.(e);
            wiring.unpin();
          }}
          onTouchMove={(e: ReactTouchEvent<HTMLDivElement>) => {
            onTouchMove?.(e);
            wiring.unpin();
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(e);
            if (SCROLL_KEYS.has(e.key)) wiring.unpin();
          }}
          className={`min-h-0 min-w-0 flex-1 overflow-auto outline-none [scrollbar-gutter:stable] focus-visible:[outline:var(--ui-focus-ring)] focus-visible:[outline-offset:-2px] ${bodyClassName}`}
        >
          <div ref={wiring.content} className={`md-body font-sans ${contentClassName}`}>
            {text !== undefined ? <Md text={text} components={components} /> : children}
          </div>
          {footer}
        </div>

        {reader.rail && (
          <nav
            ref={wiring.rail}
            aria-label={t.outline}
            className="relative w-56 shrink-0 overflow-y-auto border-l border-line-muted px-2 py-3"
          >
            <p className="px-2 pb-1.5 text-xs font-medium text-fg-subtle">{t.outline}</p>
            <OutlineRows reader={reader} />
          </nav>
        )}
      </div>
    </div>
  );
}
