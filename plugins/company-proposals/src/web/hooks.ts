/**
 * Page-level hooks these surfaces were written against. `useLocale` reads the bridge's live
 * language view (the Web App remounts its tree on a language change, so a render's value is
 * the language on screen). The two command hooks are this half's own mini dispatcher for the
 * graph page's search: the Web App's dispatcher is not part of a plugin's import surface, so
 * `onCommand` registers handlers for the two command ids the graph uses and matches the
 * `find.open` chord itself in a capture-phase window listener — capture, so a chord the graph
 * takes never reaches the app's own bubble-phase dispatcher; `graph.search` has no default
 * binding to match and is reachable only through a handler that runs it directly.
 */
import { useEffect } from "react";
import { S } from "./strings";
import { webLocale } from "@prismshadow/penguin-web-plugin";

export type Locale = "zh" | "en";

/** The language on screen, at render time. */
export function useLocale(): { locale: Locale } {
  return { locale: webLocale() };
}

/** Sync the browser tab title: "{title} · <app name>" when a title is set, the app name otherwise. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${S.appName}` : S.appName;
  }, [title]);
}

/** The submit chord of a multi-line box: Enter with Cmd (macOS) or Ctrl — a newline stays a plain Enter. */
export function isSubmitChord(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

/** Returning false declines the command; anything else handles it. */
export type CommandHandler = () => boolean | void;

/** The command ids this half dispatches. */
export type CommandId = "find.open" | "graph.search";

const handlers = new Map<CommandId, CommandHandler[]>();

/** Registers a handler; the last registered runs first. Returns the unregister function. */
export function onCommand(id: CommandId, handler: CommandHandler): () => void {
  const list = handlers.get(id) ?? [];
  list.push(handler);
  handlers.set(id, list);
  return () => {
    const current = handlers.get(id);
    if (current === undefined) return;
    const index = current.lastIndexOf(handler);
    if (index >= 0) current.splice(index, 1);
  };
}

let listenerInstalled = false;

/** The find.open chord: Mod (Cmd on macOS, Ctrl elsewhere) and F, no other modifiers. */
function isFindChord(event: KeyboardEvent): boolean {
  return (
    event.code === "KeyF" &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey)
  );
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat) return;
  if (!isFindChord(event)) return;
  const list = handlers.get("find.open");
  if (list === undefined || list.length === 0) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!() !== false) {
      // The graph took the chord: the browser's find and the app's own find bar stay out.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
}

if (typeof window !== "undefined" && !listenerInstalled) {
  listenerInstalled = true;
  window.addEventListener("keydown", handleKeydown, true);
}
