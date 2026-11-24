/**
 * The composer's height as the chat page last measured it: the part of the conversation row the
 * bottom dock leaves uncovered while docked (bottom-dock-size.ts). A tiny store rather than a prop
 * because its readers live apart from the page that renders the composer: the bottom dock, which
 * re-sizes on every change, and its boundary drag and the drag overlay's landing preview, which
 * read it once per pointer move.
 *
 * The last measurement outlives the composer. Switching conversations remounts it, with a skeleton
 * in its place while the history loads, and a dock at its ceiling must not leap up for that moment
 * and come back down when the composer returns. A box measuring nothing (the chat hidden) is not
 * a measurement either.
 */
import { useSyncExternalStore } from "react";
import { DOCK_MIN_HEIGHT_PX } from "./bottom-dock-size";

let height = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The composer's last measured height (px); 0 before the chat page has shown one. */
export function composerHeight(): number {
  return height;
}

/** The same, as a value that re-renders its component when it changes. */
export function useComposerHeight(): number {
  return useSyncExternalStore(subscribe, composerHeight);
}

/**
 * The ref the chat page puts on the composer's box: it follows the box's height while the box is
 * mounted. A stable function, so React attaches it once per mount and runs the cleanup it returns
 * on unmount.
 */
export function measureComposer(element: HTMLElement | null): (() => void) | undefined {
  if (element === null) return undefined;
  const measure = () => {
    const next = Math.ceil(element.getBoundingClientRect().height);
    if (next === 0 || next === height) return;
    height = next;
    for (const listener of listeners) listener();
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => observer.disconnect();
}

/** Keep the input and its notices reachable when a phone cannot fit them above an open dock.
 * The viewport starts at the input end of the composer. Its content keeps its natural height.
 */
export function measureMergedComposer(element: HTMLElement | null): (() => void) | undefined {
  if (element === null) return undefined;
  const content = element.firstElementChild;
  const chat = element.parentElement;
  const area = element.closest<HTMLElement>("[data-dock-area]");
  if (!(content instanceof HTMLElement) || !chat || !area) return measureComposer(element);

  const fit = () => {
    const available = area.getBoundingClientRect().bottom - chat.getBoundingClientRect().top;
    if (available <= 0) return;
    // Even in landscape the composer keeps a scrollable share below its notices.
    const limit = Math.max(available - DOCK_MIN_HEIGHT_PX, available / 4);
    const scroll = content.getBoundingClientRect().height > limit;
    element.classList.toggle("dock-composer-scroll", scroll);
    element.style.maxHeight = scroll ? `${Math.floor(limit)}px` : "";
  };
  fit();
  const observer = new ResizeObserver(fit);
  for (const node of [area, chat, content]) observer.observe(node);
  const stopMeasuring = measureComposer(element);
  return () => {
    observer.disconnect();
    stopMeasuring?.();
    element.classList.remove("dock-composer-scroll");
    element.style.maxHeight = "";
  };
}
