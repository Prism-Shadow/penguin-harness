/**
 * A dock's tab strip: pill tabs, each a glyph, a name and an always-visible ×, in a row that
 * scrolls sideways once the tabs outgrow it.
 *
 * The strip is a tab list: each tab's select button is the `role="tab"`, so the selected tab's
 * marker is the theme's to draw through the `ui-underline-nav` hook (Primer draws none; the pill's
 * fill is the mark). The × is a sibling of the select button, never nested in it — a button inside
 * a button is invalid and unclickable — with a slot of its own after the name: crowded tabs shrink
 * by truncating the name while the glyph and the × keep their width, so the close target stays
 * where the pointer expects it.
 *
 * The strip keeps the shown tab in view (a half-clipped active tab reads as a stray × at the
 * strip's edge), and a wheel over it scrolls it sideways. What a drag does to the tabs is the
 * caller's: it spreads its pointer handlers on the strip and reads the tabs back by their
 * `data-tab-id`, which is why the strip's node can be shared through `stripRef`.
 */
import { useEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { CloseIcon } from "../../icons/marks/marks";
import { Dot } from "../../icons/dot/dot";

export interface DockTabItem {
  /** Stable id: the tab's `data-tab-id`, and what `onSelect` / `onClose` receive. */
  key: string;
  label: string;
  /** The hover hint; the label when omitted (a terminal's names its shell and directory). */
  title?: string;
  glyph: ReactNode;
  /** An attention dot beside the name (a pending approval behind the tab). */
  badge?: boolean;
  /** The ×'s verb: its tooltip, and with the label its accessible name. */
  closeLabel: string;
  /** The shortcut that runs the same close, named after the verb in the ×'s tooltip. */
  closeShortcut?: string;
  /** A terminal tab keeps its shell's id on the node, for the strip's drag and for tests. */
  terminalId?: string;
}

export interface DockTabButtonProps {
  tab: DockTabItem;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** One pill in the strip: the select button (the tab) and its ×, side by side. */
export function DockTabButton({ tab, active, onSelect, onClose }: DockTabButtonProps) {
  return (
    <div
      data-testid="dock-tab"
      data-tab-id={tab.key}
      {...(tab.terminalId !== undefined ? { "data-terminal-id": tab.terminalId } : {})}
      data-active={active}
      className={`flex h-6 max-w-44 items-center rounded-md pr-0.5 transition-colors duration-150 ${
        active ? "bg-line-muted text-fg" : "text-fg-muted hover:bg-line-muted hover:text-fg"
      }`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        data-tooltip={tab.title ?? tab.label}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-xs"
      >
        <span aria-hidden className="shrink-0">
          {tab.glyph}
        </span>
        <span className="min-w-0 truncate">{tab.label}</span>
        {tab.badge === true && <Dot tone="attention" />}
      </button>
      <button
        type="button"
        data-tooltip={
          tab.closeShortcut !== undefined
            ? `${tab.closeLabel} (${tab.closeShortcut})`
            : tab.closeLabel
        }
        aria-label={`${tab.closeLabel}: ${tab.label}`}
        data-testid="dock-tab-close"
        onClick={onClose}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-line-emphasis hover:text-fg"
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

export interface DockTabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  tabs: readonly DockTabItem[];
  /** The shown tab's key; null while nothing is shown. */
  active: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** The strip's node, for a caller that hit-tests its tabs during a drag. */
  stripRef?: RefObject<HTMLDivElement | null>;
}

export function DockTabs({
  tabs,
  active,
  onSelect,
  onClose,
  stripRef,
  className = "",
  ...rest
}: DockTabsProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = stripRef ?? ownRef;

  // The shown tab keeps itself in view: with many tabs the strip scrolls. It follows the shown
  // tab and the strip's lineup, not every render — a re-render for a new title must not pull a
  // strip the user scrolled back to the shown tab.
  const lineup = tabs.map((tab) => tab.key).join("\n");
  useEffect(() => {
    if (active === null) return;
    ref.current
      ?.querySelector(`[data-tab-id="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, lineup, ref]);

  // A wheel over the strip scrolls it sideways (there is no vertical axis to scroll, and a
  // trackpad's deltaX works too). A native non-passive listener: React's synthetic onWheel is
  // passive, so preventDefault there cannot stop the page handling the event.
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent): void => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0 || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [ref]);

  return (
    <div
      ref={ref}
      role="tablist"
      data-testid="dock-tab-strip"
      {...rest}
      // overflow-y-hidden: only the horizontal axis scrolls, so a theme's marker drawn just below
      // a tab cannot make the strip scroll vertically.
      className={`ui-underline-nav flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {tabs.map((tab) => (
        <DockTabButton
          key={tab.key}
          tab={tab}
          active={tab.key === active}
          onSelect={() => onSelect(tab.key)}
          onClose={() => onClose(tab.key)}
        />
      ))}
    </div>
  );
}
