import { useLayoutEffect, useState, type CSSProperties } from "react";

type Placement = { panel?: CSSProperties; highlight?: CSSProperties };
const margin = 12;
const gap = 8;

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
    if (hit && (element.contains(hit) || hit.closest("[data-guide-callout]"))) return element;
  }
}

/** Keep the real target clickable and yield the whole overlay to the product's menus and dialogs. */
export function useGuidePlacement(selector: string | null): Placement {
  const [placement, setPlacement] = useState<Placement>({});
  useLayoutEffect(() => {
    let anchor: HTMLElement | undefined;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const sizes = new ResizeObserver(schedule);
    const changes = new MutationObserver(schedule);
    function place() {
      frame = 0;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const bottom = top + height;
      const width = viewport?.width ?? window.innerWidth;
      const overlay = [
        ...document.querySelectorAll<HTMLElement>(
          '[aria-modal="true"], [role="menu"], [role="listbox"]',
        ),
      ].some((el) => el.getClientRects().length > 0 && !el.closest("[data-guide-callout]"));
      const next = !overlay && selector ? visibleAnchor(selector, width, top, bottom) : undefined;
      if (next !== anchor) {
        if (anchor) sizes.unobserve(anchor);
        anchor = next;
        if (anchor) sizes.observe(anchor);
      }
      if (overlay) {
        setPlacement({ panel: { display: "none" } });
        return;
      }
      if (!anchor) {
        setPlacement({});
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.min(336, width - 2 * margin);
      const left = Math.min(Math.max(margin, rect.left), width - panelWidth - margin);
      const above = rect.top - top;
      const below = bottom - rect.bottom;
      // A large preview may fill the pane. Sitting to its side leaves it usable.
      const atSide =
        rect.right + gap + panelWidth <= width - margin
          ? rect.right + gap
          : rect.left - gap - panelWidth >= margin
            ? rect.left - gap - panelWidth
            : undefined;
      const available = Math.max(above, below);
      const highlight = {
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
      };
      if (available < 100 && atSide === undefined) {
        setPlacement({});
        return;
      }
      const panel: CSSProperties = {
        left: atSide ?? left,
        right: "auto",
        width: panelWidth,
        maxHeight: Math.min(
          atSide === undefined ? available - margin - gap : height - 2 * margin,
          height * 0.48,
        ),
      };
      if (atSide !== undefined)
        panel.top = Math.min(Math.max(top + margin, rect.top), bottom - height * 0.48 - margin);
      else if (above > below) {
        panel.top = "auto";
        panel.bottom = window.innerHeight - rect.top + gap;
      } else panel.top = rect.bottom + gap;
      setPlacement({ panel, highlight });
    }
    changes.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "aria-expanded", "open"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    place();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [selector]);
  return placement;
}
