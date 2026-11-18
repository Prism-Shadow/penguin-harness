/** Browser access to the applied theme. The manifest registry also runs on the server. */
import { pagesLiveActivity } from "./index";

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;

/** One observer serves both hosts and disconnects when no component is interested. */
export function subscribeAppliedTheme(listener: () => void) {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const notify of listeners) notify();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}

export function currentActivityIsPaged(): boolean {
  return pagesLiveActivity(document.documentElement.dataset.theme);
}
