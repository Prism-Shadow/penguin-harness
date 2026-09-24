/**
 * The built-in browser's address bar: shows the page's address, takes a URL, a bare domain
 * or a search (address.ts decides which), and offers matching pages from the browser's
 * history underneath while the user types.
 *
 * It is a combobox: the text stays what the user typed, the arrows move a highlight through
 * the suggestions and back to the typed text (suggestion-nav.ts), Enter goes to the
 * highlighted page or the typed one, and Escape closes the list first, then reverts the text.
 * The list is portaled at viewport coordinates, above the page it hangs over — a `<webview>`
 * is a layer of its own, and an in-flow list would be drawn under it.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import { createPortal } from "react-dom";
import type { BuiltinBrowserHistoryEntry } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { noAutofill, panelSearchClass } from "../../components/ui/input";
import { displayAddress, normalizeAddress } from "./address";
import { NO_HIGHLIGHT, moveHighlight } from "./suggestion-nav";

/** How many history rows the list shows. */
const SUGGESTION_LIMIT = 8;
/** Typing pause before the history is asked (ms): one request per word, not per keystroke. */
const SUGGEST_DELAY_MS = 120;
/** Gap between the field and the list (px). */
const LIST_GAP = 4;

export function AddressBar({
  url,
  onNavigate,
  inputRef,
}: {
  /** The address of the page on screen ("" with none). */
  url: string;
  onNavigate: (url: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement | null>(null);
  /** What the user typed; null while not editing, when the field shows the page's address. */
  const [draft, setDraft] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<BuiltinBrowserHistoryEntry[]>([]);
  const [highlight, setHighlight] = useState(NO_HIGHLIGHT);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  /** Answers only count for the latest question: typing on makes earlier ones stale. */
  const querySeq = useRef(0);
  /**
   * Set by a focus that arrived with a mouse press: the address is selected whole on focus,
   * and the release of that same press would otherwise drop a caret into it instead.
   */
  const keepSelection = useRef(false);
  const text = draft ?? displayAddress(url);
  const listOpen = draft !== null && suggestions.length > 0 && anchor !== null;

  // Ask the history for what is typed, after a short pause; the typed text itself, trimmed,
  // is the query — an address typed in full still matches the pages it names.
  useEffect(() => {
    const query = draft?.trim() ?? "";
    const seq = ++querySeq.current;
    if (query === "") {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .searchBuiltinBrowserHistory(query, SUGGESTION_LIMIT)
        .then(({ entries }) => {
          if (seq !== querySeq.current) return;
          setSuggestions(entries);
          setHighlight(NO_HIGHLIGHT);
          setAnchor(fieldRef.current?.getBoundingClientRect() ?? null);
        })
        .catch(() => {
          if (seq === querySeq.current) setSuggestions([]);
        });
    }, SUGGEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // The list hangs off the field at viewport coordinates, so anything that moves the field
  // closes it rather than leaving it pointing at nothing.
  useEffect(() => {
    if (!listOpen) return;
    const close = () => setSuggestions([]);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(fieldRef.current)) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [listOpen]);

  const stopEditing = () => {
    querySeq.current += 1;
    setDraft(null);
    setSuggestions([]);
    setHighlight(NO_HIGHLIGHT);
  };

  const go = (target: string | null) => {
    stopEditing();
    fieldRef.current?.blur();
    if (target !== null) onNavigate(target);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return; // an IME is still composing the text
    const moved = listOpen ? moveHighlight(highlight, suggestions.length, event.key) : null;
    if (moved !== null) {
      event.preventDefault();
      setHighlight(moved);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const picked = highlight >= 0 ? suggestions[highlight] : undefined;
      go(picked !== undefined ? picked.url : normalizeAddress(text));
      return;
    }
    if (event.key === "Escape") {
      if (listOpen) {
        setSuggestions([]);
        setHighlight(NO_HIGHLIGHT);
      } else {
        stopEditing();
        requestAnimationFrame(() => fieldRef.current?.select());
      }
    }
  };

  const setRefs = (element: HTMLInputElement | null) => {
    fieldRef.current = element;
    if (typeof inputRef === "function") inputRef(element);
    else if (inputRef) inputRef.current = element;
  };

  return (
    <>
      <input
        ref={setRefs}
        type="text"
        role="combobox"
        aria-label={S.builtinBrowser.address}
        aria-autocomplete="list"
        aria-expanded={listOpen}
        {...(listOpen ? { "aria-controls": listId } : {})}
        {...(listOpen && highlight >= 0
          ? { "aria-activedescendant": `${listId}-${highlight}` }
          : {})}
        data-testid="builtin-browser-address"
        spellCheck={false}
        {...noAutofill}
        placeholder={S.builtinBrowser.addressPlaceholder}
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        onMouseDown={(event) => {
          keepSelection.current = document.activeElement !== event.currentTarget;
        }}
        onMouseUp={(event) => {
          if (keepSelection.current) event.preventDefault();
          keepSelection.current = false;
        }}
        onFocus={(event) => event.target.select()}
        onBlur={stopEditing}
        onKeyDown={onKeyDown}
        className={`${panelSearchClass} h-7 min-w-0 flex-1 px-2`}
      />
      {listOpen &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label={S.builtinBrowser.suggestions}
            style={{
              position: "fixed",
              top: anchor.bottom + LIST_GAP,
              left: anchor.left,
              width: anchor.width,
            }}
            className="anim-pop z-[60] max-h-80 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {suggestions.map((entry, index) => (
              <li
                key={entry.url}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlight}
                // Keeps focus in the field, so the click lands before the blur ends editing.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => go(entry.url)}
                className={`flex cursor-pointer flex-col px-2.5 py-1.5 text-xs ${
                  index === highlight ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                <span className="truncate text-gray-800 dark:text-gray-100">
                  {entry.title.trim() !== "" ? entry.title : entry.url}
                </span>
                <span className="truncate text-gray-500 dark:text-gray-400">{entry.url}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
