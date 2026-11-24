import { useId, type ReactNode } from "react";
import { Button } from "@prismshadow/penguin-ui";
import { useGuidePlacement } from "./guide-anchor";

/** A non-modal step beside a real product control. Keyboard focus stays with the user's work. */
export function GuideCallout({
  anchorSelector,
  title,
  laterLabel,
  onLater,
  step,
  children,
}: {
  anchorSelector: string | null;
  title: string;
  laterLabel: string;
  onLater: () => void;
  children: ReactNode;
  step?: { current: number; total: number };
}) {
  const titleId = useId();
  const { panel, highlight } = useGuidePlacement(anchorSelector);
  return (
    <>
      {highlight && (
        <span
          aria-hidden="true"
          data-guide-highlight=""
          style={highlight}
          className="pointer-events-none fixed z-dock rounded-control border-2 border-accent"
        />
      )}
      <aside
        role="region"
        data-guide-callout=""
        aria-labelledby={titleId}
        style={panel}
        className="fixed end-3 top-[calc(var(--window-band-height,0px)+3rem)] z-dock max-h-[48dvh] w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto rounded-panel border border-line bg-surface p-3 text-sm text-fg shadow-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.stopPropagation();
            onLater();
          }
        }}
      >
        <header className="mb-2 flex items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 font-semibold">
            {title}
          </h2>
          {step && (
            <span className="shrink-0 text-xs text-fg-muted tabular-nums">
              {step.current} / {step.total}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onLater}>
            {laterLabel}
          </Button>
        </header>
        {children}
      </aside>
    </>
  );
}
