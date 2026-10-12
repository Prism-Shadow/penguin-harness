/**
 * A collapsible section: a flush card whose head strip folds its body away — a provider's model
 * group, a memory scope, a plugin list.
 *
 * The head's toggle is one button over the leading mark, the title, the meta and the chevron;
 * the section's own controls sit after it, outside the button, because a button cannot hold
 * another. The body stays mounted while folded and is `inert` then, so its rows are neither
 * focusable nor clickable at zero height.
 *
 * The fold is a layout tween, not a measured height: the body is a grid whose one row goes from
 * `1fr` to `0fr`, and it carries `data-layout-motion`, so the theme's layout motion moves it (and
 * nothing does under reduced motion). A component never transitions a size itself.
 *
 * The clip is on the grid's own box, never on the row inside it. Between `0fr` and `1fr` a
 * browser gives the grid f of the content's height but the row only f² of it, so a row that
 * clipped its content would vanish ahead of the space it leaves and show a blank band under
 * itself; clipped at the grid, what shows is always the grid. It is `overflow: clip`, not
 * `hidden`, since a hidden box would become a scroll container for anything sticky inside it.
 *
 * Open or folded is the caller's when it passes `open` (a page that remembers it), the section's
 * own otherwise, starting from `defaultOpen`.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Chevron } from "../../icons/chevron/chevron";
import { Card } from "../card/card";

export interface CollapsibleSectionProps {
  title: ReactNode;
  /** A mark before the title: a provider logo, a glyph, an avatar. */
  leading?: ReactNode;
  /** Quiet text after the title: a count, a summary of what is folded. */
  meta?: ReactNode;
  /** The section's own controls, after the toggle. */
  actions?: ReactNode;
  /** Whether the body shows, when the caller keeps it. */
  open?: boolean;
  /** Where an uncontrolled section starts. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Layout on the card. */
  className?: string;
  children?: ReactNode;
}

export function CollapsibleSection({
  title,
  leading,
  meta,
  actions,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  className = "",
  children,
}: CollapsibleSectionProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const bodyId = useId();
  const toggle = () => {
    if (openProp === undefined) setOpenState(!open);
    onOpenChange?.(!open);
  };
  return (
    <Card as="section" padding="none" className={className}>
      <div
        data-slot="head"
        className={`flex items-center gap-2 bg-surface-muted ${actions !== undefined ? "pr-2" : ""}`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
        >
          {leading !== undefined && <span className="flex shrink-0 items-center">{leading}</span>}
          <span className="min-w-0 truncate text-sm font-semibold text-fg">{title}</span>
          {meta !== undefined && <span className="shrink-0 text-xs text-fg-muted">{meta}</span>}
          <span className="min-w-0 flex-1" />
          <Chevron open={open} className="text-fg-subtle" />
        </button>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div
        data-slot="body"
        data-layout-motion
        className={`grid overflow-clip ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div id={bodyId} className="min-h-0" inert={!open}>
          <div className="border-t border-line-muted">{children}</div>
        </div>
      </div>
    </Card>
  );
}
