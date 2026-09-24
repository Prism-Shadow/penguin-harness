/**
 * The built-in browser's toolbar: back, forward, reload (stop while the page loads), the
 * address bar, the mark of an agent at work while one drives the browser, and the overflow
 * menu — import from a system browser, clear browsing data, open the page in the system
 * browser, developer tools.
 *
 * Icon buttons are flat: no fill at rest or on hover, the glyph darkens instead, and each is
 * named by a tooltip below it. The agent mark is an icon with its tooltip, never a text badge.
 */
import { useState } from "react";
import type { ReactNode, Ref } from "react";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { AGENT_GROUP_ICON } from "../../components/ui/group-list";
import {
  ARROW_BACK_ICON,
  ARROW_FORWARD_ICON,
  CODE_ICON,
  CloseIcon,
  DOWNLOAD_ICON,
  EXTERNAL_LINK_ICON,
  REFRESH_ICON,
} from "../../components/ui/icons";
import {
  ELLIPSIS_ICON,
  TRASH_ICON,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { Tooltip } from "../../components/ui/tooltip";
import { AddressBar } from "./address-bar";
import type { BrowserActivity } from "./browser-state";

function ToolButton({
  label,
  disabled = false,
  tooltipSuppressed = false,
  onClick,
  children,
  ...aria
}: {
  label: string;
  disabled?: boolean;
  tooltipSuppressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
}) {
  return (
    <Tooltip label={label} placement="bottom" suppressed={tooltipSuppressed}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        {...aria}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 transition-colors duration-150 hover:text-gray-900 disabled:text-gray-300 dark:text-gray-400 dark:hover:text-gray-100 dark:disabled:text-gray-700"
      >
        {children}
      </button>
    </Tooltip>
  );
}

export interface BrowserToolbarProps {
  /** The tab on screen; null with none open (the address bar then opens one). */
  tab: BuiltinBrowserTab | null;
  /** An agent at work in the browser, if one is. */
  activity: BrowserActivity | null;
  /** Whether this window hosts the tab's page (DevTools opens on the element). */
  hostsPage: boolean;
  addressRef: Ref<HTMLInputElement>;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onNavigate: (url: string) => void;
  onImport: () => void;
  onClearData: () => void;
  /** Null when the page is not a web page the system browser could open. */
  onOpenExternal: (() => void) | null;
  onDevTools: () => void;
}

export function BrowserToolbar(props: BrowserToolbarProps) {
  const { tab, activity } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const item = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };
  const busyLabel =
    activity !== null
      ? S.builtinBrowser.agentBusy(S.builtinBrowser.actions[activity.action])
      : null;

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-gray-950">
      <ToolButton
        label={S.builtinBrowser.back}
        disabled={tab?.canGoBack !== true}
        onClick={props.onBack}
      >
        <GlyphIcon d={ARROW_BACK_ICON} size={ICON_SIZE.iconButton} />
      </ToolButton>
      <ToolButton
        label={S.builtinBrowser.forward}
        disabled={tab?.canGoForward !== true}
        onClick={props.onForward}
      >
        <GlyphIcon d={ARROW_FORWARD_ICON} size={ICON_SIZE.iconButton} />
      </ToolButton>
      {tab?.loading === true ? (
        <ToolButton label={S.builtinBrowser.stop} onClick={props.onStop}>
          <CloseIcon size={12} />
        </ToolButton>
      ) : (
        <ToolButton
          label={S.builtinBrowser.reload}
          disabled={tab === null}
          onClick={props.onReload}
        >
          <GlyphIcon d={REFRESH_ICON} size={ICON_SIZE.rowLead} />
        </ToolButton>
      )}
      {/* Keyed by tab: switching tabs drops a half-typed address instead of carrying it over. */}
      <AddressBar
        key={tab?.id ?? "none"}
        url={tab?.url ?? ""}
        onNavigate={props.onNavigate}
        inputRef={props.addressRef}
      />
      {busyLabel !== null && (
        <Tooltip label={busyLabel} placement="bottom">
          <span
            role="img"
            aria-label={busyLabel}
            data-testid="builtin-browser-agent-busy"
            className={`flex h-7 w-7 shrink-0 items-center justify-center ${toneInk.busy}`}
          >
            <GlyphIcon d={AGENT_GROUP_ICON} size={ICON_SIZE.iconButton} />
          </span>
        </Tooltip>
      )}
      <Dropdown
        open={menuOpen}
        setOpen={setMenuOpen}
        portal={{ direction: "down", align: "right" }}
        menuClass="w-56"
        button={
          <ToolButton
            label={S.builtinBrowser.more}
            tooltipSuppressed={menuOpen}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.rowLead} filled />
          </ToolButton>
        }
      >
        <button type="button" className={overflowMenuRowClass} onClick={item(props.onImport)}>
          {overflowMenuGlyph(DOWNLOAD_ICON)}
          {S.builtinBrowser.importAction}
        </button>
        <button type="button" className={overflowMenuRowClass} onClick={item(props.onClearData)}>
          {overflowMenuGlyph(TRASH_ICON)}
          {S.builtinBrowser.clearDataAction}
        </button>
        {(props.onOpenExternal !== null || props.hostsPage) && (
          <div className="mx-2 my-1 border-t border-gray-100 dark:border-gray-800" />
        )}
        {props.onOpenExternal !== null && (
          <button
            type="button"
            className={overflowMenuRowClass}
            onClick={item(props.onOpenExternal)}
          >
            {overflowMenuGlyph(EXTERNAL_LINK_ICON)}
            {S.builtinBrowser.openExternal}
          </button>
        )}
        {props.hostsPage && (
          <button type="button" className={overflowMenuRowClass} onClick={item(props.onDevTools)}>
            {overflowMenuGlyph(CODE_ICON)}
            {S.builtinBrowser.devTools}
          </button>
        )}
      </Dropdown>
    </div>
  );
}
