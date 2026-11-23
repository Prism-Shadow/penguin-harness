import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ResizeHandle } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { fitTextarea } from "../../lib/textarea-fit";

/** The start page leaves room for the toolbar and the on-screen keyboard. A manual height is
 * local to this draft and gives way to automatic sizing when a long draft is cleared or shortened. */
export function DraftHeightHandle({
  textarea,
  text,
}: {
  textarea: RefObject<HTMLTextAreaElement | null>;
  text: string;
}) {
  const manual = useRef<number | null>(null);
  const last = useRef({ text: "", natural: 0 });
  const drag = useRef({ y: 0, height: 0 });
  const [range, setRange] = useState({ min: 0, max: 0, height: 0 });
  const measure = useCallback(() => {
    const box = textarea.current;
    if (!box) return;
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
    setRange((prev) =>
      prev.min === min && prev.max === max && prev.height === height ? prev : { min, max, height },
    );
  }, [textarea]);

  useLayoutEffect(measure, [text, measure]);
  useLayoutEffect(() => {
    const box = textarea.current;
    if (!box) return;
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
  }, [measure, textarea]);

  function resize(height: number | null) {
    manual.current = height === null ? null : Math.min(range.max, Math.max(range.min, height));
    measure();
  }

  return (
    <ResizeHandle
      axis="y"
      label={S.chat.resizeDraft}
      min={range.min}
      max={range.max}
      value={range.height}
      onPointerDownCapture={(e) => {
        drag.current = { y: e.clientY, height: range.height };
      }}
      onResize={(e) => resize(drag.current.height + e.clientY - drag.current.y)}
      onStep={(delta) => resize(range.height + delta)}
      onReset={() => resize(null)}
      className="relative mx-auto h-5 w-12 touch-none rounded-control after:absolute after:inset-x-2 after:top-1/2 after:h-0.5 after:rounded-full after:bg-fg-subtle"
    />
  );
}
