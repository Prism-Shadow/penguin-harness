/**
 * The run log's remembered "Show reasoning" switch, shared by the stage run panel and the
 * conversation panel. Storage is injectable so the rules are testable without a DOM.
 */
import { useSyncExternalStore } from "react";

export const SHOW_REASONING_KEY = "penguin.activityRunLog.showReasoning";

/** Only an explicit "hidden" hides reasoning, so unreadable storage shows it. */
export function readShowReasoning(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? localStorage).getItem(SHOW_REASONING_KEY) !== "hidden";
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return true;
  }
}

export function writeShowReasoning(show: boolean, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(SHOW_REASONING_KEY, show ? "shown" : "hidden");
  } catch {
    // A remembered switch is a convenience; losing it is not worth failing the toggle.
  }
}

/** The value this page last set, so a blocked storage still keeps the choice until a reload. */
let sessionValue: boolean | null = null;
const listeners = new Set<() => void>();

export function currentShowReasoning(): boolean {
  return sessionValue ?? readShowReasoning();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SHOW_REASONING_KEY) return;
    sessionValue = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The switch's live value, one setting for every panel: flipping it in one panel updates the
 * other (and other tabs, through the storage event). If storage is blocked, the choice still
 * holds for this page until it reloads.
 */
export function useShowReasoning(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(subscribe, currentShowReasoning, () => true);
  return [show, setShowReasoning];
}

/** Sets the switch for every panel on the page, as a layout does when it is applied. */
export function setShowReasoning(show: boolean): void {
  sessionValue = show;
  writeShowReasoning(show);
  for (const listener of listeners) listener();
}
