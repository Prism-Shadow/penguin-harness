/**
 * The tab strip INSIDE a dock panel — the second tier under the dock's own pills: one tab per
 * item the panel holds (the built-in browser's pages, a conversation's shells), each a lead
 * mark, a name and an always-visible ×, and a "+" at the strip's end.
 *
 * It is shaped like a browser's tab strip rather than like the dock's pills right above it, so
 * the two tiers never read as one: it sits on the muted surface, and the active tab takes the
 * dock's canvas — the panel's surface below it — and joins it. Tabs shrink to a minimum before
 * the strip scrolls sideways. A middle click closes a tab, as in every browser. The select button
 * and the × are siblings, never nested: a button inside a button is invalid and unclickable.
 *
 * What a tab holds besides its name is the caller's: `icon` is its lead mark (a favicon, a
 * spinner, a glyph) and `trailing` the marks after the name (a busy dot, a warning), each named
 * in the tab's `title` when it carries meaning.
 */
import type { ReactNode } from "react";
import { WallpaperSurface } from "../../shell/app-shell/wallpaper";
import { CloseIcon, PlusIcon } from "../../icons/marks/marks";
import { ICON_SIZE } from "../../../icon-scale";

export interface PanelTabItem {
  /** Stable id: the tab's `data-tab-id`, and what `onSelect` / `onClose` receive. */
  key: string;
  label: string;
  /** The lead mark, drawn before the name. */
  icon: ReactNode;
  /** The hover hint; the label when omitted. */
  title?: string;
  /** Whether `title` says what the label does not — then it shows over the visible name too. */
  titleExtra?: boolean;
  /** Marks after the name. */
  trailing?: ReactNode;
}

export interface PanelTabsProps {
  tabs: readonly PanelTabItem[];
  /** The shown tab's key; null while nothing is shown. */
  active: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
  /** The strip's accessible name. */
  listLabel: string;
  /** The "+": its tooltip and its accessible name. */
  newLabel: string;
  /** The ×'s verb; with the tab's name it is the ×'s accessible name ("Close tab: …"). */
  closeLabel: string;
  /**
   * A hover hint on the ×, only when it says what the glyph cannot — a consequence, a shortcut.
   * Omitted, the × beside its tab needs none.
   */
  closeHint?: string;
  /** Test ids: `<prefix>-tab`, `<prefix>-tab-close` and `<prefix>-new-tab`. */
  testIdPrefix: string;
}

export function PanelTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onNew,
  listLabel,
  newLabel,
  closeLabel,
  closeHint,
  testIdPrefix,
}: PanelTabsProps) {
  return (
    <WallpaperSurface className="flex shrink-0 items-end gap-1 bg-surface-muted px-1.5 pt-1.5">
      <div
        role="tablist"
        aria-label={listLabel}
        className="flex min-w-0 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const shown = tab.key === active;
          const title = tab.title ?? tab.label;
          return (
            <div
              key={tab.key}
              data-testid={`${testIdPrefix}-tab`}
              data-tab-id={tab.key}
              data-active={shown}
              data-wallpaper-surface={shown ? "panel" : undefined}
              className={`flex h-7 w-48 min-w-20 items-center rounded-t-md pr-1 transition-colors duration-150 ${
                shown ? "bg-canvas text-fg" : "text-fg-muted hover:bg-line-muted hover:text-fg"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={shown}
                data-tooltip={title}
                data-tooltip-extra={tab.titleExtra === true}
                onClick={() => onSelect(tab.key)}
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(tab.key);
                }}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-xs"
              >
                {tab.icon}
                <span className="min-w-0 truncate">{tab.label}</span>
                {tab.trailing}
              </button>
              <button
                type="button"
                aria-label={`${closeLabel}: ${tab.label}`}
                {...(closeHint !== undefined
                  ? { "data-tooltip": closeHint, "data-tooltip-extra": true }
                  : {})}
                data-testid={`${testIdPrefix}-tab-close`}
                onClick={() => onClose(tab.key)}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:text-fg"
              >
                <CloseIcon size={10} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        data-tooltip={newLabel}
        aria-label={newLabel}
        data-testid={`${testIdPrefix}-new-tab`}
        onClick={onNew}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:text-fg"
      >
        <PlusIcon size={ICON_SIZE.rowLead} />
      </button>
    </WallpaperSurface>
  );
}
