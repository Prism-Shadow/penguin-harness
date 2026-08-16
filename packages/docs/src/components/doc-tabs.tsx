/**
 * Tabbed code group: one tab strip over the code blocks remark-tabs grouped together.
 * Only the selected panel is mounted, so a long install page shows one command instead of
 * three stacked ones.
 *
 * Labels arrive as the `data-tab` of each child, and the panels are those same children in
 * order — the pairing comes from the document, not from a separate list that could drift.
 * Arrow keys move between tabs, the roving tabindex keeping one stop for the whole strip.
 */
import { Children, useRef, useState } from "react";
import type { ReactNode } from "react";

export function DocTabs({ labels, children }: { labels: string[]; children: ReactNode }) {
  const panels = Children.toArray(children);
  const [selected, setSelected] = useState(0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const active = Math.min(selected, labels.length - 1);

  const move = (delta: number) => {
    const next = (active + delta + labels.length) % labels.length;
    setSelected(next);
    // Follow the selection with focus, so the next arrow key continues from the new tab.
    stripRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div className="md-tabs-group">
      <div className="md-tabs-strip" role="tablist" ref={stripRef}>
        {labels.map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{panels[active]}</div>
    </div>
  );
}
