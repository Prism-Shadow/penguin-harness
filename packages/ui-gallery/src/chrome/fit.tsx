/**
 * A box that lays its children out at a fixed natural width and scales the result to the room it
 * has: the card's composition for a module designed at the app's width, and the framed embed of
 * one when comparing themes.
 *
 * Why a transform rather than CSS `zoom`: a transform leaves layout alone, so the composition is
 * laid out at exactly its natural width — the same line breaks, truncations and container-query
 * answers it has in the app — and only the picture shrinks. `zoom` re-lays the text out at the
 * scaled font size, where glyph advances round differently and a title can wrap or truncate at a
 * different word than it does at full size. The price is that a transform does not shrink the box
 * the page sees, so this measures the composition's height and gives the box the scaled height
 * itself. Pointer events map through the transform, so everything inside stays clickable, and the
 * composition stays in the page's own document, so its scene clock, its controls and the tokens
 * drawer's measuring all work as they do unscaled.
 */
import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { fitScale, fittedHeight } from "../lib/fit";

export function Fit({ natural, children }: { natural: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ available: 0, height: 0 });

  useLayoutEffect(() => {
    const out = outer.current;
    const content = inner.current;
    if (!out || !content) return;
    const measure = () =>
      setBox((current) => {
        const next = { available: out.clientWidth, height: content.offsetHeight };
        return next.available === current.available && next.height === current.height
          ? current
          : next;
      });
    measure();
    // The card's width moves with the window and the drawers; the composition's height moves as a
    // scene plays. Either changes the scaled box.
    const observer = new ResizeObserver(measure);
    observer.observe(out);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const scale = fitScale(natural, box.available);
  return (
    <div
      ref={outer}
      className="g-fit"
      data-scaled={scale < 1 || undefined}
      style={{ height: box.height > 0 ? fittedHeight(box.height, scale) : undefined }}
    >
      <div
        ref={inner}
        className="g-fit-inner"
        style={{ width: natural, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
