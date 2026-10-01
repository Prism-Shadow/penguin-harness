/**
 * The built-in browser's toolbar: back, forward, reload (stop while the page loads), Home
 * while a homepage is set, the address bar, the mark of an agent at work while one drives the
 * browser, the load warning while the server gives one, and the overflow menu — import from a
 * system browser, clear browsing data, set the homepage, open the page in the system browser,
 * developer tools.
 *
 * Icon buttons are flat: no fill at rest or on hover, the glyph darkens instead, and each is
 * named by a tooltip below it. The agent mark and the load warning are icons with their tooltip,
 * never a text badge.
 */
import { useState } from "react";
import type { ReactNode, Ref } from "react";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import {
  CloseIcon,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuSeparator,
  Tooltip,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-150 hover:text-fg disabled:text-fg-subtle disabled:opacity-60"
      >
        {children}
      </button>
    </Tooltip>
  );
}

export interface BrowserToolbarProps {
  /** The tab on screen; null with none open (the address bar then opens one). */
  tab: BuiltinBrowserTab | null;
  /** What the address bar shows for it: its page's address, or the one it is opening. */
  address: string;
  /** An agent at work in the browser, if one is. */
  activity: BrowserActivity | null;
  /** The load warning, worded (load.ts), while the server gives one. */
  loadWarning: string | null;
  /** Whether this window hosts the tab's page (DevTools opens on the element). */
  hostsPage: boolean;
  addressRef: Ref<HTMLInputElement>;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  /** Goes to the homepage; null while none is set, which leaves the button out. */
  onHome: (() => void) | null;
  onNavigate: (url: string) => void;
  onImport: () => void;
  onClearData: () => void;
  onSetHomepage: () => void;
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
  // A server newer than this Web App may name an action the dictionary does not know yet;
  // the raw name still says more than nothing.
  const actions = S.builtinBrowser.actions as Record<string, string | undefined>;
  const busyLabel =
    activity !== null
      ? S.builtinBrowser.agentBusy(actions[activity.action] ?? activity.action)
      : null;

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line bg-canvas px-2 py-1">
      <ToolButton
        label={S.builtinBrowser.back}
        disabled={tab?.canGoBack !== true}
        onClick={props.onBack}
      >
        <GlyphIcon d={ICONS.arrowLeftCentered} size={ICON_SIZE.iconButton} />
      </ToolButton>
      <ToolButton
        label={S.builtinBrowser.forward}
        disabled={tab?.canGoForward !== true}
        onClick={props.onForward}
      >
        <GlyphIcon d={ICONS.arrowRightCentered} size={ICON_SIZE.iconButton} />
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
          <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.rowLead} />
        </ToolButton>
      )}
      {props.onHome !== null && (
        <ToolButton label={S.builtinBrowser.home} onClick={props.onHome}>
          <GlyphIcon d={ICONS.house} size={ICON_SIZE.rowLead} />
        </ToolButton>
      )}
      {/* Keyed by tab: switching tabs drops a half-typed address instead of carrying it over. */}
      <AddressBar
        key={tab?.id ?? "none"}
        url={props.address}
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
            <GlyphIcon d={ICONS.robot} size={ICON_SIZE.iconButton} />
          </span>
        </Tooltip>
      )}
      {props.loadWarning !== null && (
        <Tooltip label={props.loadWarning} placement="bottom">
          <span
            role="img"
            aria-label={props.loadWarning}
            data-testid="builtin-browser-load-warning"
            className={`flex h-7 w-7 shrink-0 items-center justify-center ${toneInk.attention}`}
          >
            <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.iconButton} />
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
            <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.rowLead} filled />
          </ToolButton>
        }
      >
        <Menu density="sm">
          <MenuItem
            glyph={ICONS.download}
            label={S.builtinBrowser.importAction}
            onSelect={item(props.onImport)}
          />
          <MenuItem
            glyph={ICONS.trash}
            label={S.builtinBrowser.clearDataAction}
            onSelect={item(props.onClearData)}
          />
          <MenuItem
            glyph={ICONS.house}
            label={S.builtinBrowser.setHomepageAction}
            onSelect={item(props.onSetHomepage)}
          />
          {(props.onOpenExternal !== null || props.hostsPage) && <MenuSeparator />}
          {props.onOpenExternal !== null && (
            <MenuItem
              glyph={ICONS.externalLink}
              label={S.builtinBrowser.openExternal}
              onSelect={item(props.onOpenExternal)}
            />
          )}
          {props.hostsPage && (
            <MenuItem
              glyph={ICONS.angleBrackets}
              label={S.builtinBrowser.devTools}
              onSelect={item(props.onDevTools)}
            />
          )}
        </Menu>
      </Dropdown>
    </div>
  );
}
