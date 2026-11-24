import { useLayoutEffect, useState } from "react";

function visibleAnchor(selector: string, width: number, top: number, bottom: number) {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(element).visibility === "hidden") continue;
    const left = Math.max(0, rect.left);
    const right = Math.min(width, rect.right);
    const y1 = Math.max(top, rect.top);
    const y2 = Math.min(bottom, rect.bottom);
    if (right <= left || y2 <= y1) continue;
    const hit = document.elementFromPoint((left + right) / 2, (y1 + y2) / 2);
    if (hit && element.contains(hit)) return element;
  }
}

/** The chat owns the space above its composer. Other pages share the shell's guide below them. */
export function useGuideAnchor(selector: string | null, inChat: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [obscured, setObscured] = useState(false);
  useLayoutEffect(() => {
    let anchor: HTMLElement | undefined;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const sizes = new ResizeObserver(schedule);
    const changes = new MutationObserver(schedule);
    function update() {
      frame = 0;
      const chatSlot = inChat
        ? document.querySelector<HTMLElement>("[data-guide-chat]:not([inert] *)")
        : null;
      setSlot(chatSlot);
      const overlay = [
        ...document.querySelectorAll<HTMLElement>(
          '[aria-modal="true"], [role="menu"], [role="listbox"]',
        ),
      ].some((el) => el.getClientRects().length > 0 && !el.closest("[data-guide-callout]"));
      setObscured(overlay);
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const next =
        !overlay && selector
          ? visibleAnchor(
              selector,
              viewport?.width ?? window.innerWidth,
              top,
              top + (viewport?.height ?? window.innerHeight),
            )
          : undefined;
      if (next !== anchor) {
        if (anchor) {
          sizes.unobserve(anchor);
          delete anchor.dataset.guideHighlight;
        }
        anchor = next;
        if (anchor) {
          anchor.dataset.guideHighlight = "";
          sizes.observe(anchor);
        }
      }
    }
    changes.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "inert",
        "aria-hidden",
        "aria-expanded",
        "open",
        "data-guide-chat",
        "data-fullscreen",
      ],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
      if (anchor) delete anchor.dataset.guideHighlight;
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [selector, inChat]);
  return { slot, obscured };
}
