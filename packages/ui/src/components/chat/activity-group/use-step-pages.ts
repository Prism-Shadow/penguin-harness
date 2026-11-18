import { useSyncExternalStore } from "react";
import { builtinPack, isThemeId } from "../../../themes";

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;

function subscribe(listener: () => void) {
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

function pagesInAppliedTheme() {
  const id = document.documentElement.dataset.theme;
  return isThemeId(id) && builtinPack(id).activitySteps === "pages";
}

const list = () => false;
const idle = () => () => {};

/** Only an on-screen run or one watched here needs to react. All of them share one observer. */
export function useStepPages(live: boolean): boolean {
  return useSyncExternalStore(live ? subscribe : idle, live ? pagesInAppliedTheme : list, list);
}
