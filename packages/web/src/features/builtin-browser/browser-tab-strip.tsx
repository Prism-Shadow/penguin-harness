/**
 * The built-in browser's own tab strip, under the dock's header: one compact pill per page —
 * favicon, title, an always-visible × — and a "+" for a new tab. The tabs are the server's
 * registry, shared by every conversation, so every dock that shows the browser shows the
 * same strip. A page still loading shows a spinner where its icon goes, and a page an agent
 * is working in carries the busy dot, named in its tooltip.
 */
import { useState } from "react";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { CloseIcon, GLOBE_ICON, PlusIcon } from "../../components/ui/icons";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot } from "../../lib/tone";
import { faviconSrc, tabLabel } from "./address";

function TabIcon({ tab }: { tab: BuiltinBrowserTab }) {
  // A favicon that fails to load falls back to the globe, and stays there for that address.
  const [failed, setFailed] = useState<string | null>(null);
  if (tab.loading) {
    return (
      <span
        aria-hidden
        className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent text-gray-400 dark:text-gray-500"
      />
    );
  }
  const src = faviconSrc(tab.favicon, window.location.origin);
  if (src === null || src === failed) {
    return (
      <span aria-hidden className="shrink-0 text-gray-400 dark:text-gray-500">
        <GlyphIcon d={GLOBE_ICON} size={ICON_SIZE.inlineGlyph} />
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
  busy,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** Whether an agent is working in a tab right now. */
  busy: (tabId: number) => boolean;
  onSelect: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pt-1.5">
      <div
        role="tablist"
        aria-label={S.builtinBrowser.tabs}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const label = tabLabel(tab, S.builtinBrowser.untitled);
          const working = busy(tab.id);
          // The title attribute carries the full name and address a truncated pill cannot.
          const title = [label, tab.url, working ? S.builtinBrowser.agentBusyTab : null]
            .filter((part): part is string => part !== null && part !== "" && part !== label)
            .reduce((all, part) => `${all}\n${part}`, label);
          return (
            <div
              key={tab.id}
              data-testid="builtin-browser-tab"
              data-tab-id={tab.id}
              data-active={active}
              className={`flex h-6 max-w-44 shrink-0 items-center rounded-md pr-0.5 transition-colors duration-150 ${
                active
                  ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={title}
                onClick={() => onSelect(tab.id)}
                // A middle click closes a tab, as in every browser.
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(tab.id);
                }}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-xs"
              >
                <TabIcon tab={tab} />
                <span className="min-w-0 truncate">{label}</span>
                {working && (
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.busy}`}
                  />
                )}
              </button>
              <button
                type="button"
                title={S.builtinBrowser.closeTab}
                aria-label={`${S.builtinBrowser.closeTab}: ${label}`}
                onClick={() => onClose(tab.id)}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
              >
                <CloseIcon size={10} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        title={S.builtinBrowser.newTab}
        aria-label={S.builtinBrowser.newTab}
        data-testid="builtin-browser-new-tab"
        onClick={onNew}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
      >
        <PlusIcon size={ICON_SIZE.rowLead} />
      </button>
    </div>
  );
}
