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

/**
 * A resized textarea keeps its old scrollTop until the next keypress. Measure the active end
 * of its selection in a copy of the text with the same wrapping, without touching the native
 * selection, focus or IME composition. If the user had scrolled away from it, keep their place.
 */
function keepEditingLine(editor: HTMLTextAreaElement, oldTop: number, oldHeight: number): void {
  const style = getComputedStyle(editor);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "0",
    visibility: "hidden",
    boxSizing: "border-box",
    width: `${editor.clientWidth}px`,
    padding: style.padding,
    font: style.font,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    tabSize: style.tabSize,
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    direction: style.direction,
  });
  // The extra character gives an empty last line a measurable caret.
  const text = document.createTextNode(editor.value + "\u200b");
  mirror.append(text);
  editor.after(mirror);
  const caret = document.createRange();
  caret.setStart(
    text,
    editor.selectionDirection === "backward" ? editor.selectionStart : editor.selectionEnd,
  );
  caret.collapse(true);
  const rect = caret.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight);
  const center = rect.top + rect.height / 2 - mirror.getBoundingClientRect().top;
  mirror.remove();
  if (!rect.height || center < oldTop || center > oldTop + oldHeight) return;
  const top = center - lineHeight / 2;
  const bottom = center + lineHeight / 2;
  if (top < editor.scrollTop) editor.scrollTop = Math.floor(top);
  else if (bottom > editor.scrollTop + editor.clientHeight)
    editor.scrollTop = Math.ceil(bottom - editor.clientHeight);
}

/** Keep the input and its notices reachable when a phone cannot fit them above an open dock.
 * The viewport starts at the input end of the composer. Its content keeps its natural height.
 */
export function measureMergedComposer(element: HTMLElement | null): (() => void) | undefined {
  if (element === null) return undefined;
  const content = element.firstElementChild;
  const chat = element.parentElement;
  const area = element.closest<HTMLElement>("[data-dock-area]");
  const host = element.closest<HTMLElement>("[data-dock-host]");
  const editor = element.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea');
  if (!(content instanceof HTMLElement) || !chat || !area || !host || !editor)
    return measureComposer(element);

  const showEditor = () => {
    if (!element.classList.contains("dock-composer-scroll")) return;
    const box = element.getBoundingClientRect();
    const field = editor.getBoundingClientRect();
    if (field.top < box.top) element.scrollTop += field.top - box.top;
    else if (field.bottom > box.bottom) element.scrollTop += field.bottom - box.bottom;
  };
  const viewport = window.visualViewport;
  const fit = () => {
    // Safari can raise the keyboard without resizing the layout viewport. Leave pinch zoom alone.
    const keyboard = viewport && viewport.scale === 1 && viewport.height < window.innerHeight;
    host.style.maxHeight = keyboard
      ? `${Math.max(0, viewport.offsetTop + viewport.height - host.getBoundingClientRect().top)}px`
      : "";
    const available = area.getBoundingClientRect().bottom - chat.getBoundingClientRect().top;
    if (available <= 0) return;
    // Give the field room to edit even when that means a shorter dock. In a very short window
    // both regions can still scroll; the user's stored dock ratio does not change.
    const editingRoom = Math.min(Math.max(editor.offsetHeight, editor.scrollHeight), available / 2);
    const limit = Math.max(available - DOCK_MIN_HEIGHT_PX, editingRoom);
    const scroll = content.getBoundingClientRect().height > limit;
    const maxHeight = scroll ? `${Math.floor(limit)}px` : "";
    const resized = element.style.getPropertyValue("--dock-composer-max-height") !== maxHeight;
    const oldHeight = editor.clientHeight;
    const oldTop = editor.scrollTop;
    element.classList.toggle("dock-composer-scroll", scroll);
    element.style.setProperty("--dock-composer-max-height", maxHeight);
    if (resized && document.activeElement === editor && editor.clientHeight < oldHeight)
      keepEditingLine(editor, oldTop, oldHeight);
    if (resized || document.activeElement === editor) showEditor();
  };
  fit();
  const observer = new ResizeObserver(fit);
  for (const node of [area, chat, content, editor]) observer.observe(node);
  viewport?.addEventListener("resize", fit);
  viewport?.addEventListener("scroll", fit);
  editor.addEventListener("focus", showEditor);
  const stopMeasuring = measureComposer(element);
  return () => {
    observer.disconnect();
    viewport?.removeEventListener("resize", fit);
    viewport?.removeEventListener("scroll", fit);
    editor.removeEventListener("focus", showEditor);
    stopMeasuring?.();
    element.classList.remove("dock-composer-scroll");
    element.style.removeProperty("--dock-composer-max-height");
    host.style.maxHeight = "";
  };
}
