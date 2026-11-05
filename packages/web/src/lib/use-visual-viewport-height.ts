/**
 * The height actually visible on screen, on devices where a soft keyboard eats into it.
 *
 * `100dvh` answers for the browser's own collapsing toolbars, not for the keyboard: the
 * layout viewport a full-screen page is measured against does not shrink when the keyboard
 * slides up, so the bottom of the page — a terminal's last lines, its key bar — ends up
 * underneath it. `visualViewport` is the box that does shrink.
 *
 * `index.html` asks Chrome for `interactive-widget=resizes-content`, which makes the layout
 * viewport shrink too and would be the whole fix on its own; Safari does not implement it,
 * so this hook is what covers iOS. Where both apply they agree, and the explicit pixel
 * height simply restates the CSS one.
 *
 * Returns null when it has nothing to say (disabled, or no `visualViewport`), meaning "keep
 * whatever the stylesheet decided".
 */
import { useEffect, useState } from "react";

export function useVisualViewportHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!enabled || !viewport) {
      setHeight(null);
      return;
    }
    const apply = (): void => {
      setHeight(viewport.height);
      // iOS scrolls the layout viewport to bring the focused element into view and never
      // scrolls back. Once the page is sized to the visual viewport there is nothing below
      // the fold to reveal, so that offset only pushes the header off the top.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    apply();
    viewport.addEventListener("resize", apply);
    return () => viewport.removeEventListener("resize", apply);
  }, [enabled]);
  return height;
}
