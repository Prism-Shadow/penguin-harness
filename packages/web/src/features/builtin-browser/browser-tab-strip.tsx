/**
 * The built-in browser's own tab strip, under the dock's header: one tab per page — favicon,
 * title, an always-visible × — and a "+" for a new tab. The tabs are the server's registry,
 * shared by every conversation, so every dock that shows the browser shows the same strip.
 *
 * It is shaped like a browser's rather than like the dock's pills right above it, so the two
 * strips never read as one: it sits on the muted surface, and the active tab takes the dock's
 * canvas — the toolbar's surface — and joins it. Tabs shrink to a minimum before the strip
 * scrolls. A page still loading shows a spinner where its icon goes, and a tab's first page is
 * named after the address it is opening until the page has a title; a crashed page shows the
 * warning glyph; a page an agent is working in carries the busy dot, and one of the heaviest
 * while the browser warns about memory a small warning mark — each named in the tab's tooltip.
 */
import { useState } from "react";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import {
  CloseIcon,
  Dot,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  PlusIcon,
  Spinner,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { faviconSrc, isBlankUrl, tabLabel } from "./address";
import { formatMemory } from "./load";

function TabIcon({ tab }: { tab: BuiltinBrowserTab }) {
  // A favicon that fails to load falls back to the globe, and stays there for that address.
  const [failed, setFailed] = useState<string | null>(null);
  if (tab.crashed !== undefined) {
    return (
      <span
        role="img"
        aria-label={S.builtinBrowser.crashedTab}
        className="shrink-0 text-tone-danger-fg"
      >
        <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.inlineGlyph} />
      </span>
    );
  }
  if (tab.loading) {
    return <Spinner size="md" label={S.common.loading} className="text-fg-subtle" />;
  }
  const src = faviconSrc(tab.favicon, window.location.origin);
  if (src === null || src === failed) {
    return (
      <span aria-hidden className="shrink-0 text-fg-subtle">
        <GlyphIcon d={ICONS.globe} size={ICON_SIZE.inlineGlyph} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={ICON_SIZE.inlineGlyph}
      height={ICON_SIZE.inlineGlyph}
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className="shrink-0 rounded-sm"
    />
  );
}

export function BrowserTabStrip({
  tabs,
  activeTabId,
  address,
  busy,
  heavyMemory,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** A tab's address as the panel shows it: its page's, or the one it is opening. */
  address: (tab: BuiltinBrowserTab) => string;
  /** Whether an agent is working in a tab right now. */
  busy: (tabId: number) => boolean;
  /** The memory (KB) of a tab the load warning points at, else null. */
  heavyMemory: (tabId: number) => number | null;
  onSelect: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex shrink-0 items-end gap-1 bg-surface-muted px-1.5 pt-1.5">
      <div
        role="tablist"
        aria-label={S.builtinBrowser.tabs}
        className="no-scrollbar flex min-w-0 items-end gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const shown = address(tab);
          const label = tabLabel({ title: tab.title, url: shown }, S.builtinBrowser.untitled);
          const working = busy(tab.id);
          const heavyKB = heavyMemory(tab.id);
          const heavy =
            heavyKB === null ? null : S.builtinBrowser.load.heavyTab(formatMemory(heavyKB));
          // The tooltip carries what a truncated tab cannot: the whole title, the address, the
          // agent at work in it, a crash, and the memory it holds when the browser warns about it.
          const lines = [label];
          if (!isBlankUrl(shown) && shown !== label) lines.push(shown);
          if (tab.crashed !== undefined) lines.push(S.builtinBrowser.crashedTab);
          if (working) lines.push(S.builtinBrowser.agentBusyTab);
          if (heavy !== null) lines.push(heavy);
          const title = lines.join("\n");
          return (
            <div
              key={tab.id}
              data-testid="builtin-browser-tab"
              data-tab-id={tab.id}
              data-active={active}
              className={`flex h-7 w-48 min-w-20 items-center rounded-t-md pr-1 transition-colors duration-150 ${
                active ? "bg-canvas text-fg" : "text-fg-muted hover:bg-line-muted hover:text-fg"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                data-tooltip={title}
                onClick={() => onSelect(tab.id)}
                // A middle click closes a tab, as in every browser.
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(tab.id);
                }}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-xs"
              >
                <TabIcon tab={tab} />
                <span className="min-w-0 truncate">{label}</span>
                {/* Named in the tab's tooltip, so the dot itself is decoration. */}
                {working && <Dot tone="success" />}
                {heavy !== null && (
                  <span
                    role="img"
                    aria-label={heavy}
                    data-testid="builtin-browser-heavy-tab"
                    className="shrink-0 text-tone-attention-fg"
                  >
                    <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.inlineGlyph} />
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={`${S.builtinBrowser.closeTab}: ${label}`}
                onClick={() => onClose(tab.id)}
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
        data-tooltip={S.builtinBrowser.newTab}
        aria-label={S.builtinBrowser.newTab}
        data-testid="builtin-browser-new-tab"
        onClick={onNew}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:text-fg"
      >
        <PlusIcon size={ICON_SIZE.rowLead} />
      </button>
    </div>
  );
}
