import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { chordEquals, chordOf, currentPlatform, fitTextarea, parseChord } from "@prismshadow/penguin-web/internal";

const taller = parseChord("Alt+Shift+ArrowDown");
const shorter = parseChord("Alt+Shift+ArrowUp");

/** The start page leaves room for the toolbar and the on-screen keyboard. A manual height is
 * local to this draft and gives way to automatic sizing when a long draft is cleared or shortened. */
export function useDraftHeight(
  textarea: RefObject<HTMLTextAreaElement | null>,
  text: string,
  enabled: boolean,
) {
  const manual = useRef<number | null>(null);
  const last = useRef({ text: "", natural: 0 });
  const range = useRef({ min: 0, max: 0, height: 0 });
  const measure = useCallback(() => {
    const box = textarea.current;
    if (!box || !enabled) return;
    const min = parseFloat(getComputedStyle(box).minHeight);
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const max = Math.max(min, Math.floor(viewport * 0.58));
    let height = min;
    fitTextarea(box, () => {
      const natural = box.scrollHeight;
      if (
        box.value !== last.current.text &&
        (box.value === "" || (natural <= min && last.current.natural > min))
      ) {
        manual.current = null;
      }
      last.current = { text: box.value, natural };
      const auto = Math.min(natural, Math.round(viewport * 0.4));
      height = Math.max(min, Math.min(max, manual.current ?? auto));
      return height;
    });
    range.current = { min, max, height };
  }, [enabled, textarea]);

  useLayoutEffect(measure, [text, measure]);
  useLayoutEffect(() => {
    const box = textarea.current;
    if (!box || !enabled) return;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === box.clientWidth) return;
      width = box.clientWidth;
      measure();
    });
    observer.observe(box);
    window.addEventListener("resize", measure);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
    };
  }, [enabled, measure, textarea]);

  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !enabled ||
      event.nativeEvent.isComposing ||
      (event.key !== "ArrowDown" && event.key !== "ArrowUp")
    )
      return false;
    const chord = chordOf(event.nativeEvent, currentPlatform());
    if (!chordEquals(chord, event.key === "ArrowDown" ? taller : shorter)) return false;
    event.preventDefault();
    const { min, max, height } = range.current;
    manual.current = Math.max(min, Math.min(max, height + (event.key === "ArrowDown" ? 16 : -16)));
    measure();
    return true;
  };
}
