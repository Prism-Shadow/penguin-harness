/**
 * Top-right panel switcher of the chat toolbar (Codex-style): icon-only buttons for the
 * pinned panels, then an "all panels" dropdown listing every panel with icon + name.
 *
 * Three panels exist: the subagents panel ("智能体面板"), the terminal dock and the
 * Workspace files panel. Which of them get their own toolbar icon is user-configurable via
 * the pin toggles inside the dropdown (persisted per browser); the default pins the
 * subagents panel and the Workspace, leaving the terminal reachable through the dropdown
 * (or Ctrl+`) until pinned.
 *
 * The open/close state itself lives with each panel's own hook/store — this component only
 * renders triggers, so pinning/unpinning never touches panel state.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { NAV_ICONS } from "../../components/ui/icons";
import { toggleTerminalDock } from "../terminal/terminal-dock-state";
import { useTerminalDockOpen } from "../terminal/terminal-dock";

export type PanelKey = "agents" | "terminal" | "workspace";

const PIN_STORAGE_KEY = "penguin.chat.pinnedPanels";
const DEFAULT_PINS: readonly PanelKey[] = ["agents", "workspace"];
/** Display order of pinned icons and dropdown rows (the product-specified order). */
const PANEL_ORDER: readonly PanelKey[] = ["agents", "terminal", "workspace"];

/** Folder glyph, duplicated from the chat stats icons to avoid exporting page internals. */
const FOLDER_ICON = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
/** 2x2 grid: the "all panels" trigger. */
const ALL_ICON = "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z";
/** Pin (map-pin style tack), shown filled while pinned. */
const PIN_ICON = "M12 17v5M7 4h10l-1.5 6.5L18 13H6l2.5-2.5z";

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

/** The subagents spawn-tree glyph is multi-element (circles + edges), so it is a component. */
function AgentsGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="19" cy="5.5" r="2.5" />
      <circle cx="19" cy="18.5" r="2.5" />
      <path d="M7.4 11 16.7 6.6M7.4 13l9.3 4.4" />
    </svg>
  );
}

function PathGlyph({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export interface PanelsToolbarProps {
  agentsOpen: boolean;
  onToggleAgents: () => void;
  /** A pending approval inside a subagent: amber dot on the agents trigger. */
  agentsPending: boolean;
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
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
  pending?: boolean;
}

const triggerClass = (active: boolean) =>
  `flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-150 ${
    active
      ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  }`;

export function PanelsToolbar(props: PanelsToolbarProps) {
  const terminalOpen = useTerminalDockOpen();
  const [pins, setPins] = useState<PanelKey[]>(loadPins);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const entries: PanelEntry[] = [
    {
      key: "agents",
      label: S.chat.openAgents,
      buttonLabel: S.chat.openAgents,
      glyph: () => <AgentsGlyph />,
      open: props.agentsOpen,
      toggle: props.onToggleAgents,
      pending: props.agentsPending,
    },
    {
      key: "terminal",
      label: S.terminal.title,
      buttonLabel: S.terminal.title,
      glyph: () => <PathGlyph d={NAV_ICONS.terminal} />,
      open: terminalOpen,
      toggle: toggleTerminalDock,
    },
    {
      key: "workspace",
      label: S.chat.workspacePanel,
      // The established accessible name ("打开工作区") — several flows and tests target it.
      buttonLabel: S.chat.openWorkspace,
      glyph: () => <PathGlyph d={FOLDER_ICON} />,
      open: props.workspaceOpen,
      toggle: props.onToggleWorkspace,
    },
  ];

  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="panels-toolbar">
      {/* Pinned panels: icon-only triggers in fixed order. */}
      {entries
        .filter((entry) => pins.includes(entry.key))
        .map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-expanded={entry.open}
            onClick={entry.toggle}
            title={entry.buttonLabel}
            aria-label={entry.buttonLabel}
            data-testid={`panel-btn-${entry.key}`}
            className={triggerClass(entry.open)}
          >
            {entry.glyph()}
            {entry.pending && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          </button>
        ))}

      {/* "All panels" dropdown: every panel, icon + name, with a pin toggle per row. */}
      <Dropdown
        open={menuOpen}
        setOpen={setMenuOpen}
        menuClass="right-0 top-full mt-1 w-56 origin-top-right"
        button={
          <button
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            title={S.chat.allPanels}
            aria-label={S.chat.allPanels}
            data-testid="panels-all"
            className={triggerClass(menuOpen)}
          >
            <PathGlyph d={ALL_ICON} />
          </button>
        }
      >
        {entries.map((entry) => {
          const pinned = pins.includes(entry.key);
          return (
            <div
              key={entry.key}
              className={`group mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
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
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.pending && (
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                )}
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
                    : "text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-300"
                }`}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill={pinned ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d={PIN_ICON} />
                </svg>
              </button>
            </div>
          );
        })}
      </Dropdown>
    </div>
  );
}
