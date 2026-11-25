import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Fold, HelpFoldToggle } from "@prismshadow/penguin-ui";
import { useGuideAnchor } from "./guide-anchor";

/** A non-modal step beside a real product control. Keyboard focus stays with the user's work. */
export function GuideCallout({
  anchorSelector,
  inChat,
  title,
  laterLabel,
  onLater,
  step,
  children,
}: {
  anchorSelector: string | null;
  inChat: boolean;
  title: string;
  laterLabel: string;
  onLater: () => void;
  children: ReactNode;
  step?: { current: number; total: number };
}) {
  const titleId = useId();
  const bodyId = useId();
  const [expanded, setExpanded] = useState(true);
  const { slot, obscured } = useGuideAnchor(anchorSelector, inChat);
  const inHistory = inChat && slot?.dataset.guideChat === "history";
  const scroll = inHistory ? "mt-3" : "max-h-[30dvh] overflow-y-auto overscroll-contain";
  const panel = (
    <aside
      role="region"
      data-guide-callout=""
      aria-labelledby={titleId}
      inert={obscured}
      aria-hidden={obscured || undefined}
      className={`mx-auto w-full max-w-3xl shrink-0 border-line px-3 py-2 text-sm text-fg ${scroll} ${inChat && !inHistory ? "mb-2 border-b" : "border-t"} ${obscured ? "invisible" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onLater();
        }
      }}
    >
      <header className="flex items-center gap-2">
        <h2 id={titleId} className="min-w-0 flex-1 font-semibold">
          <HelpFoldToggle
            open={expanded}
            onToggle={() => setExpanded((open) => !open)}
            panelId={bodyId}
            title={title}
          />
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
      <div id={bodyId}>
        <Fold open={expanded}>
          <div className="pt-2">{children}</div>
        </Fold>
      </div>
    </aside>
  );
  if (!inChat) return panel;
  return slot && createPortal(panel, slot);
}
