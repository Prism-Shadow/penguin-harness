/**
 * The built-in browser's own tab strip, under the dock's header: one tab per page — favicon,
 * title, an always-visible × — and a "+" for a new tab. The panel passes only the current
 * conversation's entries from the server registry. The strip itself is the shared panel strip
 * (`PanelTabs`), which the terminal panel's shells use too; what is the browser's own is each
 * tab's marks.
 *
 * A page still loading shows a spinner where its icon goes, and a tab's first page is named after
 * the address it is opening until the page has a title; a crashed page shows the warning glyph; a
 * page an agent is working in carries the busy dot, and one of the heaviest while the browser
 * warns about memory a small warning mark — each named in the tab's tooltip.
 */
import { useState } from "react";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { Dot, GlyphIcon, ICONS, ICON_SIZE, PanelTabs, Spinner } from "@prismshadow/penguin-ui";
import type { PanelTabItem } from "@prismshadow/penguin-ui";
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
  const items = tabs.map((tab): PanelTabItem => {
    const shown = address(tab);
    const label = tabLabel({ title: tab.title, url: shown }, S.builtinBrowser.untitled);
    const working = busy(tab.id);
    const heavyKB = heavyMemory(tab.id);
    const heavy = heavyKB === null ? null : S.builtinBrowser.load.heavyTab(formatMemory(heavyKB));
    // The tooltip carries what a truncated tab cannot: the whole title, the address, the
    // agent at work in it, a crash, and the memory it holds when the browser warns about it.
    const lines = [label];
    if (!isBlankUrl(shown) && shown !== label) lines.push(shown);
    if (tab.crashed !== undefined) lines.push(S.builtinBrowser.crashedTab);
    if (working) lines.push(S.builtinBrowser.agentBusyTab);
    if (heavy !== null) lines.push(heavy);
    return {
      key: String(tab.id),
      label,
      icon: <TabIcon tab={tab} />,
      title: lines.join("\n"),
      titleExtra: lines.length > 1,
      trailing: (
        <>
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
        </>
      ),
    };
  });
  return (
    <PanelTabs
      tabs={items}
      active={activeTabId === null ? null : String(activeTabId)}
      onSelect={(key) => onSelect(Number(key))}
      onClose={(key) => onClose(Number(key))}
      onNew={onNew}
      listLabel={S.builtinBrowser.tabs}
      newLabel={S.builtinBrowser.newTab}
      closeLabel={S.builtinBrowser.closeTab}
      testIdPrefix="builtin-browser"
    />
  );
}
