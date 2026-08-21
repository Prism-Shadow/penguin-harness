/**
 * Top-right panel switcher of the chat toolbar (Codex-style): icon-only buttons for the
 * pinned panels, then a "create" dropdown listing every panel with icon + name.
 *
 * Five side elements exist — the subagents panel, the terminal, the Workspace files
 * panel, the Memory panel and the Trace panel — and every one of them is a dock tab
 * (features/dock): a trigger toggles the element on/off screen, and the dropdown rows
 * carry placement actions (open on the right / at the bottom) plus a pin toggle deciding
 * which elements get their own toolbar icon (persisted per browser). The default pins the
 * subagents panel and the Workspace; the terminal stays reachable through the dropdown
 * and Ctrl+`.
 *
 * The open/close state itself lives in the dock store — this component only renders
 * triggers, so pinning/unpinning never touches dock state.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { NAV_ICONS } from "../../components/ui/icons";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import {
  dockVersion,
  isTabShown,
  openPanel,
  showTerminal,
  subscribeDock,
  togglePanel,
  type DockPosition,
  type PanelKind,
} from "../dock/dock-state";
import { openTerminalInDock, toggleTerminal } from "../dock/dock-terminal";
import { AgentsGlyph, panelGlyph, panelLabel } from "../dock/panel-meta";
import {
  displayTitle,
  liveTerminals,
  subscribeTerminals,
  terminalApiSupported,
} from "../terminal/terminal-list";
import { toneDot } from "../../lib/tone";

export type PanelKey = PanelKind | "terminal";

const PIN_STORAGE_KEY = "penguin.chat.pinnedPanels";
const DEFAULT_PINS: readonly PanelKey[] = ["agents", "workspace"];
/** Display order of pinned icons and dropdown rows (the product-specified order). */
const PANEL_ORDER: readonly PanelKey[] = ["agents", "terminal", "workspace", "memory", "trace"];

/** Plus: the "create" trigger opening the panels menu. */
const CREATE_ICON = "M12 5v14M5 12h14";
/** Pin (map-pin style tack), shown filled while pinned. */
const PIN_ICON = "M12 17v5M7 4h10l-1.5 6.5L18 13H6l2.5-2.5z";
/** Window with a right pane / a bottom pane: the placement actions. */
const PANEL_RIGHT_ICON = "M4 5h16v14H4zM14 5v14";
const PANEL_BOTTOM_ICON = "M4 5h16v14H4zM4 14h16";

function loadPins(): PanelKey[] {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PINS];
    return PANEL_ORDER.filter((key) => parsed.includes(key));
  } catch {
    return [...DEFAULT_PINS];
  }
}

export interface PanelsToolbarProps {
  /** A pending approval inside a subagent: amber dot on the agents trigger. */
  agentsPending: boolean;
}

interface PanelEntry {
  key: PanelKey;
  /** Dropdown row copy (the short panel name). */
  label: string;
  /** Pinned icon tooltip/aria — kept distinct where an established name exists. */
  buttonLabel: string;
  glyph: () => ReactNode;
  open: boolean;
  toggle: () => void;
  /** The row's placement actions: put this element in a specific dock. */
  place: (position: DockPosition) => void;
  pending?: boolean;
}

const triggerClass = (active: boolean) =>
  `relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-150 ${
    active
      ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  }`;

/**
 * Floating count of live terminals. It rides on the terminal's own trigger when the
 * terminal is pinned, and on the "create" trigger otherwise — so the number stays
 * visible wherever the terminal is actually reachable from. Zero renders nothing.
 */
function TerminalCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      data-testid="terminal-count-badge"
      aria-hidden
      className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gray-700 px-0.5 text-[9px] font-semibold leading-none text-white dark:bg-gray-300 dark:text-gray-900"
    >
      {count}
    </span>
  );
}

/**
 * Hover-open disclosure: enter opens immediately, leave closes after a short grace so the
 * pointer can travel from the trigger into the panel without the menu vanishing.
 */
function useHoverMenu(): {
  open: boolean;
  setOpen: (v: boolean) => void;
  hoverProps: { onMouseEnter: () => void; onMouseLeave: () => void };
  /** False while the menu was opened by the pointer — see Dropdown's `focusOnOpen`. */
  focusOnOpen: boolean;
} {
  const [open, setOpen] = useState(false);
  const [openedByHover, setOpenedByHover] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  return {
    open,
    // Explicit opens (the trigger's click, hence also its keyboard activation) take focus.
    setOpen: (v: boolean) => {
      cancelClose();
      setOpenedByHover(false);
      setOpen(v);
    },
    hoverProps: {
      onMouseEnter: () => {
        cancelClose();
        setOpenedByHover(true);
        setOpen(true);
      },
      onMouseLeave: () => {
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 160);
      },
    },
    focusOnOpen: !openedByHover,
  };
}

/**
 * Rows of live terminals; picking one brings it on screen in its dock. The pick fires on
 * mousedown: the flyout variant lives outside the Dropdown's panel, whose outside-click
 * dismissal would otherwise unmount the row before its click event ever dispatched.
 */
function TerminalListMenu({ onPick }: { onPick: (id: string) => void }) {
  const terminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  if (terminals.length === 0) {
    return (
      <div className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500">
        {S.terminal.noTerminals}
      </div>
    );
  }
  return (
    <>
      {terminals.map((terminal, index) => (
        <button
          key={terminal.id}
          type="button"
          data-testid="terminal-menu-item"
          data-terminal-id={terminal.id}
          onMouseDown={() => onPick(terminal.id)}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <span className="shrink-0 text-gray-500 dark:text-gray-400">
            <GlyphIcon d={NAV_ICONS.terminal} />
          </span>
          <span className="min-w-0 truncate">
            {terminal.seq ?? index + 1}: {displayTitle(terminal.title) || terminal.name}
          </span>
        </button>
      ))}
    </>
  );
}

export function PanelsToolbar({ agentsPending }: PanelsToolbarProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  const allTerminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  // Every live shell: the docks are global now, so any of them is one click from a tab
  // here (the hover menu lists exactly these).
  const terminalCount = allTerminals.length;
  const [pins, setPins] = useState<PanelKey[]>(loadPins);
  const createMenu = useHoverMenu();
  const terminalMenu = useHoverMenu();
  const terminalPinned = pins.includes("terminal");
  const menuOpen = createMenu.open;
  const setMenuOpen = createMenu.setOpen;

  const pickTerminal = (id: string): void => {
    showTerminal(id);
    setMenuOpen(false);
    terminalMenu.setOpen(false);
  };

  const togglePin = (key: PanelKey): void => {
    setPins((current) => {
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : PANEL_ORDER.filter((k) => current.includes(k) || k === key);
      try {
        localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private-mode storage failures only cost persistence.
      }
      return next;
    });
  };

  const terminalShown = allTerminals.some((t) => isTabShown(`terminal:${t.id}`));

  // An older runtime (hot update can leave the Web App ahead of it) has no terminal API;
  // offering the panel would only produce a 404 on click.
  const terminalSupported = useSyncExternalStore(subscribeTerminals, terminalApiSupported);
  const panelEntry = (kind: PanelKind, buttonLabel: string): PanelEntry => ({
    key: kind,
    label: panelLabel(kind),
    buttonLabel,
    glyph: () => (kind === "agents" ? <AgentsGlyph /> : panelGlyph(kind)),
    open: isTabShown(kind),
    toggle: () => togglePanel(kind),
    place: (position) => openPanel(kind, position),
    ...(kind === "agents" ? { pending: agentsPending } : {}),
  });
  const entries: PanelEntry[] = [
    panelEntry("agents", S.chat.openAgents),
    {
      key: "terminal",
      label: S.terminal.title,
      buttonLabel: S.terminal.title,
      glyph: () => <GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.iconButton} />,
      open: terminalShown,
      toggle: toggleTerminal,
      place: (position) => void openTerminalInDock(position),
    },
    // The established accessible name ("打开工作区") — several flows and tests target it.
    panelEntry("workspace", S.chat.openWorkspace),
    panelEntry("memory", S.chat.openMemoryPanel),
    panelEntry("trace", S.chat.openTracePanel),
  ];

  const panels = entries.filter((entry) => entry.key !== "terminal" || terminalSupported);

  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="panels-toolbar">
      {/* Pinned panels: icon-only triggers in fixed order. The terminal trigger also
          shows the terminal list on hover (first-level dropdown); its click still toggles
          the terminal tabs. */}
      {panels
        .filter((entry) => pins.includes(entry.key))
        .map((entry) => {
          const trigger = (
            <button
              key={entry.key}
              type="button"
              aria-expanded={entry.open}
              onClick={() => {
                entry.toggle();
                if (entry.key === "terminal") terminalMenu.setOpen(false);
              }}
              title={entry.buttonLabel}
              aria-label={entry.buttonLabel}
              data-testid={`panel-btn-${entry.key}`}
              className={triggerClass(entry.open)}
            >
              {entry.glyph()}
              {entry.pending && (
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${toneDot.attention}`} />
              )}
              {entry.key === "terminal" && <TerminalCountBadge count={terminalCount} />}
            </button>
          );
          if (entry.key !== "terminal" || terminalCount === 0) return trigger;
          return (
            <div key={entry.key} {...terminalMenu.hoverProps}>
              <Dropdown
                open={terminalMenu.open}
                setOpen={terminalMenu.setOpen}
                focusOnOpen={terminalMenu.focusOnOpen}
                menuClass="right-0 top-full mt-1 w-56 origin-top-right"
                button={trigger}
              >
                <div data-testid="terminal-hover-menu">
                  <TerminalListMenu onPick={pickTerminal} />
                </div>
              </Dropdown>
            </div>
          );
        })}

      {/* "Create" menu: opens on hover (click keeps it open for touch/keyboard); every
          panel as a row with placement actions and a pin toggle, and the terminal row
          carries a second-level terminal list on hover. */}
      <div {...createMenu.hoverProps}>
        <Dropdown
          open={menuOpen}
          setOpen={setMenuOpen}
          focusOnOpen={createMenu.focusOnOpen}
          menuClass="right-0 top-full mt-1 w-64 origin-top-right"
          button={
            <button
              type="button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              title={S.chat.panelsCreate}
              aria-label={S.chat.panelsCreate}
              data-testid="panels-all"
              className={triggerClass(menuOpen)}
            >
              <GlyphIcon d={CREATE_ICON} size={ICON_SIZE.iconButton} />
              {!terminalPinned && <TerminalCountBadge count={terminalCount} />}
            </button>
          }
        >
          {panels.map((entry) => {
            const pinned = pins.includes(entry.key);
            return (
              <div
                key={entry.key}
                className={`group relative mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  entry.open
                    ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                }`}
              >
                {/* The row body toggles the panel and dismisses the menu. */}
                <button
                  type="button"
                  data-testid={`panels-menu-${entry.key}`}
                  onClick={() => {
                    setMenuOpen(false);
                    entry.toggle();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">{entry.glyph()}</span>
                  <span className="min-w-0 truncate">{entry.label}</span>
                  {/* Live shell count, right beside the name — the row's right edge belongs
                    to the hover-revealed action cluster (which must not look like a gap
                    next to content). */}
                  {entry.key === "terminal" && terminalCount > 0 && (
                    <span
                      data-testid="panels-menu-terminal-count"
                      className="shrink-0 rounded-full bg-gray-200 px-1.5 text-[10px] font-semibold leading-4 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                    >
                      {terminalCount}
                    </span>
                  )}
                  <span className="min-w-0 flex-1" />
                  {entry.pending && (
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.attention}`}
                    />
                  )}
                </button>
                {/* Placement actions: this element straight into a chosen dock. Hover-revealed
                    with the pin, so the resting row stays a clean name. They keep the menu
                    open — placing several panels in one visit is the point of having them. */}
                <button
                  type="button"
                  title={S.dock.openInRight}
                  aria-label={`${S.dock.openInRight}: ${entry.label}`}
                  data-testid={`panels-place-right-${entry.key}`}
                  onClick={() => entry.place("right")}
                  className="shrink-0 rounded p-1 text-gray-300 opacity-0 transition-colors duration-150 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-300"
                >
                  <GlyphIcon d={PANEL_RIGHT_ICON} />
                </button>
                <button
                  type="button"
                  title={S.dock.openInBottom}
                  aria-label={`${S.dock.openInBottom}: ${entry.label}`}
                  data-testid={`panels-place-bottom-${entry.key}`}
                  onClick={() => entry.place("bottom")}
                  className="shrink-0 rounded p-1 text-gray-300 opacity-0 transition-colors duration-150 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-300"
                >
                  <GlyphIcon d={PANEL_BOTTOM_ICON} />
                </button>
                {/* Pin toggle: keeps the menu open so several pins can be adjusted in one go. */}
                <button
                  type="button"
                  title={pinned ? S.chat.unpinPanel : S.chat.pinPanel}
                  aria-label={pinned ? S.chat.unpinPanel : S.chat.pinPanel}
                  aria-pressed={pinned}
                  data-testid={`panels-pin-${entry.key}`}
                  onClick={() => togglePin(entry.key)}
                  className={`shrink-0 rounded p-1 transition-colors duration-150 ${
                    pinned
                      ? "text-gray-700 dark:text-gray-200"
                      : "text-gray-300 opacity-0 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-300"
                  }`}
                >
                  <GlyphIcon d={PIN_ICON} filled={pinned} />
                </button>
              </div>
            );
          })}
        </Dropdown>
      </div>
    </div>
  );
}
