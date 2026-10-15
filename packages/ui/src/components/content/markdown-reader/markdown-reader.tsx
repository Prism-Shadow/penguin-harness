/**
 * MarkdownReader: a Markdown document to read, with an outline and an in-page find. The plugin
 * detail's README, the file browser's Markdown preview (plugin files, Benchmark cases), the Files
 * panel's Markdown preview and the organization handbook all read through it, so a reader who
 * knows one knows them all.
 *
 * The text renders through the shared pipeline (`Md`), so the reader adds nothing to and takes
 * nothing from the rules every other Markdown surface follows. A site with a pipeline of its own
 * (the docs site's tabs and callouts) passes its rendered `children` instead: the outline and the
 * find read the rendered DOM, never the source, so they work over either.
 *
 * The reader owns its scroll box. Over its top-right corner floats one pill of tools: the host's
 * own actions first (the Files panel's view toggle and Edit), then the outline button (only while
 * the outline is folded into it) and the find button.
 *
 * **Outline.** Headings h1–h4, read from the rendered text after every commit, so the outline is
 * the document's as it is on screen. With fewer than two there is none. When the reader is at
 * least `railMinWidth` wide the outline stands as a rail beside the text; narrower, it opens from
 * the pill as a popover. A row scrolls the reader's own box, and nothing around it, to bring its
 * heading to the top; the current section follows the scroll (outline.ts has the reading line). A
 * row just chosen stays current until the reader scrolls by hand: a heading near the end can never
 * reach the reading line, and position alone would highlight a neighbour of what was chosen.
 *
 * **Find.** The pill's find button opens it, and so does the find shortcut while the focus is
 * anywhere inside the reader — the host passes its binding (`isFindKey`; Mod+F when it passes
 * none). The key is only taken inside the reader: elsewhere the page's own find, or the browser's,
 * keeps it, because this handler sits on the reader and nowhere else. The search runs over the
 * rendered text through the shared find machinery (find-dom.ts), case-insensitively, and paints
 * every hit with the current one stronger. Typing jumps to the first hit; Enter and ↓ go on, Shift+
 * Enter and ↑ go back, wrapping at either end, scrolling only the reader's box. Escape closes the
 * find and drops its paint — and goes no further, so inside a dialog the first Escape closes the
 * find and the second the dialog. Text that is not displayed is not searched (find-dom.ts skips
 * it), so a match never points at something that cannot be shown. The rendered text can still
 * change under an open search (code blocks colour themselves after they mount), which re-indexes
 * after a pause and keeps the current hit.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  ReactNode,
  Ref,
  TouchEvent as ReactTouchEvent,
  UIEvent as ReactUIEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { Components } from "react-markdown";
import { ICON_SIZE } from "../../../icon-scale";
import { useUiStrings } from "../../../strings";
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

/** The reader's width (px) from which the outline stands beside the text rather than in the pill. */
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

/** The pill's square controls: flat, the glyph deepening on hover. */
const TOOL_BUTTON =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-control-hover hover:text-fg";

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

export interface MarkdownReaderProps {
  /** The Markdown, rendered through the shared pipeline. */
  text?: string;
  /** Element adapters for `text` (images and links that know where the file lives); a module constant or a memo. */
  components?: Components;
  /** Rendered reading content in place of `text`, for a site with its own pipeline. */
  children?: ReactNode;
  /** The scroll box's accessible name: the document's name. */
  label?: string;
  /** The host's controls in the pill, before the reader's own. */
  actions?: ReactNode;
  /** Under the text, inside the scroll box: a note that the file was cut short. */
  footer?: ReactNode;
  /**
   * The scroll box: its padding. The default leaves the pill's band clear above the first line,
   * so the pill covers text only once the reader scrolls it underneath.
   */
  bodyClassName?: string;
  /** The reading box: its size and ink (`text-sm`, `leading-relaxed`, `text-fg`). */
  contentClassName?: string;
  /** The scroll box's element, for a host that hangs a context menu off it. */
  bodyRef?: Ref<HTMLDivElement>;
  /** Handlers on the scroll box: a context menu's gestures, a link interceptor. */
  bodyProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "tabIndex" | "children">;
  /** Whether a keydown is the find shortcut; the app passes the user's binding. */
  isFindKey?: (event: KeyboardEvent) => boolean;
  /** The find shortcut as the platform writes it ("⌘F"), for the find button's hint. */
  findShortcut?: string | null;
  /** The reader's width (px) from which the outline stands beside the text. */
  railMinWidth?: number;
  /** The reader's size in its host: a height, or `flex-1` in a column. */
  className?: string;
}

export function MarkdownReader({
  text,
  components,
  children,
  label,
  actions,
  footer,
  bodyClassName = "px-3 pb-3 pt-11",
  contentClassName = "text-sm leading-relaxed text-fg",
  bodyRef: hostBodyRef,
  bodyProps = {},
  isFindKey = isDefaultFindKey,
  findShortcut = null,
  railMinWidth = READER_RAIL_MIN_WIDTH,
  className = "",
}: MarkdownReaderProps) {
  const t = useUiStrings().reader;
  const owner = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const width = useMeasuredWidth(rootRef);

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
    const content = contentRef.current;
    if (content === null) return;
    const next = readOutline(content);
    if (!sameOutline(outlineRef.current, next)) {
      pinnedRef.current = null;
      setOutline(next);
    }
  });

  const updateActive = (): void => {
    frameRef.current = 0;
    const body = bodyRef.current;
    if (body === null) return;
    if (pinnedRef.current !== null) {
      setActive(pinnedRef.current);
      return;
    }
    const tops = outlineRef.current.elements.map((el) => offsetIn(body, el));
    setActive(
      activeEntry(tops, {
        top: body.scrollTop,
        height: body.scrollHeight,
        viewport: body.clientHeight,
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

  /** Scrolls the reader's own box to entry `index`'s heading and makes it current. */
  const goTo = (index: number): void => {
    const body = bodyRef.current;
    const heading = outlineRef.current.elements[index];
    if (body === null || heading === undefined) return;
    body.scrollTop = scrollTargetFor(offsetIn(body, heading), {
      height: body.scrollHeight,
      viewport: body.clientHeight,
    });
    pinnedRef.current = index;
    setActive(index);
  };

  const hasOutline = outline.entries.length >= OUTLINE_MIN_ENTRIES;
  const rail = hasOutline && width >= railMinWidth;

  // The rail keeps its current row in view as the reader scrolls past more headings than it shows.
  useEffect(() => {
    const box = railRef.current;
    const row = box?.querySelector<HTMLElement>('[aria-current="location"]');
    if (box == null || row == null) return;
    // The rail is positioned, so a row's offset is measured from the rail's own top.
    const top = row.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
  }, [active, rail]);

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
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const openFind = (): void => {
    if (findOpen) focusQuery();
    else setFindOpen(true);
  };

  const closeFind = (): void => {
    setFindOpen(false);
    setHits([]);
    setCurrent(-1);
    clearHighlights(owner);
    bodyRef.current?.focus({ preventScroll: true });
  };

  // The box takes the caret as the find opens.
  useEffect(() => {
    if (findOpen) focusQuery();
  }, [findOpen]);

  // Index: a new query starts on the first hit and shows it; a re-index of the same query keeps
  // the hit the reader was on.
  useEffect(() => {
    if (!findOpen) return;
    const content = contentRef.current;
    const next =
      content === null || query === ""
        ? []
        : indexRegions([{ kind: "document", element: content }], {
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
  }, [findOpen, query, generation, text]);

  // Paint, apart from the index, so stepping between hits repaints without a re-walk.
  useEffect(() => {
    if (findOpen) paintHits(hits, current, owner);
  }, [findOpen, hits, current, owner]);
  useEffect(() => () => clearHighlights(owner), [owner]);

  // The rendered text changing under an open search (a code block colouring itself) re-indexes
  // once it settles, keeping the hit the reader is on.
  useEffect(() => {
    const content = contentRef.current;
    if (!findOpen || query === "" || content === null || typeof MutationObserver === "undefined")
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
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [findOpen, query]);

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

  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.defaultPrevented) return;
    if (isFindKey(e.nativeEvent)) {
      // Kept from the browser's find and from the page's: the reader has the focus.
      e.preventDefault();
      openFind();
      return;
    }
    // The outline's popover takes its own Escape; with it closed, Escape closes the find and
    // goes no further (a dialog around the reader stays open).
    if (e.key === "Escape" && findOpen && !outlineOpen && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      closeFind();
    }
  };

  // ------------------------------------------------------------------------------ the box
  const setBody = (el: HTMLDivElement | null): void => {
    bodyRef.current = el;
    assignRef(hostBodyRef, el);
  };
  const { onScroll, onWheel, onTouchMove, onKeyDown, ...restBodyProps } = bodyProps;

  const counter =
    query === "" ? "" : hits.length === 0 ? t.noResults : `${current + 1}/${hits.length}`;

  const outlineRows = (onChosen?: () => void) => (
    <ul className="flex flex-col">
      {outline.entries.map((entry, index) => (
        <li key={index}>
          <button
            type="button"
            aria-current={index === active ? "location" : undefined}
            onClick={() => {
              goTo(index);
              onChosen?.();
            }}
            className={navRowClass({ active: index === active, density: "sm" })}
          >
            <span className={`min-w-0 truncate ${INDENT[entry.depth] ?? ""}`}>{entry.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={rootRef} className={`flex min-h-0 min-w-0 ${className}`} onKeyDown={onRootKeyDown}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The scroll box. Focusable, so the keyboard can scroll it and the find key has
            somewhere to land; a positioned ancestor holds the pill, since an absolute box inside
            a static scroller escapes to the initial containing block. */}
        <div
          {...restBodyProps}
          ref={setBody}
          tabIndex={0}
          {...(label !== undefined ? { role: "region", "aria-label": label } : {})}
          onScroll={(e: ReactUIEvent<HTMLDivElement>) => {
            onScroll?.(e);
            scheduleActive();
          }}
          onWheel={(e: ReactWheelEvent<HTMLDivElement>) => {
            onWheel?.(e);
            unpin();
          }}
          onTouchMove={(e: ReactTouchEvent<HTMLDivElement>) => {
            onTouchMove?.(e);
            unpin();
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(e);
            if (SCROLL_KEYS.has(e.key)) unpin();
          }}
          className={`min-h-0 flex-1 overflow-auto outline-none [scrollbar-gutter:stable] focus-visible:[outline:var(--ui-focus-ring)] focus-visible:[outline-offset:-2px] ${bodyClassName}`}
        >
          <div ref={contentRef} className={`md-body font-sans ${contentClassName}`}>
            {text !== undefined ? <Md text={text} components={components} /> : children}
          </div>
          {footer}
        </div>

        <div className="pointer-events-none absolute inset-x-4 top-2 z-10 flex justify-end">
          <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-md border border-line bg-surface p-1 shadow-sm">
            {findOpen && (
              <div role="search" data-find-skip data-presence="enter" className="min-w-0 shrink">
                <FindField
                  className="w-64 min-w-0 max-w-full"
                  query={query}
                  onQueryChange={setQuery}
                  counter={counter}
                  canStep={hits.length > 0}
                  onStep={step}
                  onClose={closeFind}
                  inputRef={inputRef}
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
            )}
            {actions}
            {hasOutline && !rail && (
              <Dropdown
                open={outlineOpen}
                setOpen={setOutlineOpen}
                portal={{ direction: "down", align: "right" }}
                className="shrink-0"
                menuClass="w-64 max-h-[60vh] overflow-y-auto p-1"
                button={
                  <button
                    type="button"
                    aria-label={t.outline}
                    data-tooltip={t.outline}
                    aria-expanded={outlineOpen}
                    onClick={() => setOutlineOpen(!outlineOpen)}
                    className={TOOL_BUTTON}
                  >
                    <GlyphIcon d={ICONS.textLines} size={ICON_SIZE.iconButton} />
                  </button>
                }
              >
                <nav aria-label={t.outline}>{outlineRows(() => setOutlineOpen(false))}</nav>
              </Dropdown>
            )}
            {!findOpen && (
              <button
                type="button"
                aria-label={t.find}
                data-tooltip={findShortcut === null ? t.find : `${t.find} (${findShortcut})`}
                onClick={openFind}
                className={TOOL_BUTTON}
              >
                <GlyphIcon d={ICONS.search} size={ICON_SIZE.iconButton} />
              </button>
            )}
          </div>
        </div>
      </div>

      {rail && (
        <nav
          ref={railRef}
          aria-label={t.outline}
          className="relative w-56 shrink-0 overflow-y-auto border-l border-line-muted px-2 py-3"
        >
          <p className="px-2 pb-1.5 text-xs font-medium text-fg-subtle">{t.outline}</p>
          {outlineRows()}
        </nav>
      )}
    </div>
  );
}
