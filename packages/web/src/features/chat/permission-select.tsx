/**
 * The composer's permission button: ONE shield glyph whose colour says how much the Agent may do
 * on its own (see lib/permission-level.ts), with the level's name beside it when the card is
 * wide enough, and a different mark inside the shield per level so it never depends on colour
 * alone. The menu has three sections — Filesystem, Network and Approval — and, for an
 * administrator, More…, which opens the Settings page's Sandbox card.
 *
 * Filesystem and Network edit the Session's own sandbox policy: a Session keeps the policy it
 * was created with, so the Settings page only decides what NEW Sessions start from.
 *
 * Popup direction depends on context: the draft card has room below and opens downward; the
 * chat input docked at the bottom of the screen opens upward.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { ApprovalMode, SessionSandbox } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ChevronDown } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import {
  PERMISSION_LEVEL_GLYPH,
  PERMISSION_LEVEL_TONE,
  permissionLevel,
} from "../../lib/permission-level";
import { useAuth } from "../../state/auth";
import { SettingsDialog } from "../settings/settings-dialog";

const APPROVAL_MODES: ApprovalMode[] = ["always-ask", "read-only", "allow-all", "deny-all"];
const FS_MODES: SessionSandbox["mode"][] = ["read-only", "workspace-write", "danger-full-access"];
const NETWORK_MODES: SessionSandbox["network"][] = ["open", "none"];

/** An arrow leaving a box: More… leaves the menu for the Settings page. */
const OPEN_SETTINGS_GLYPH =
  "M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5";

/** A section's small heading inside the panel. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
      {children}
    </div>
  );
}

/** One choice row: its text, and a check when it is the current value. */
function Choice({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onPick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
        selected
          ? "font-medium text-gray-900 dark:text-gray-100"
          : "text-gray-600 dark:text-gray-400"
      }`}
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
      <span className="w-3 shrink-0 text-center">{selected ? "✓" : ""}</span>
    </button>
  );
}

export function PermissionSelect({
  approvalMode,
  sandbox,
  onChangeApprovalMode,
  onChangeSandbox,
  disabled,
  direction = "up",
}: {
  approvalMode: ApprovalMode;
  sandbox: SessionSandbox;
  onChangeApprovalMode: (mode: ApprovalMode) => void;
  onChangeSandbox: (pick: Partial<SessionSandbox>) => void;
  disabled: boolean;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Sandbox card lives on the Plugins page, which only an administrator can open.
  const isAdmin = useAuth().user?.isAdmin === true;
  const P = S.chat.permission;
  const level = permissionLevel(approvalMode, sandbox);
  const levelName = P.levels[level] ?? level;
  const summary = [
    `${P.fs}: ${P.fsModes[sandbox.mode] ?? sandbox.mode}`,
    `${P.network}: ${P.networkModes[sandbox.network] ?? sandbox.network}`,
    `${P.approval}: ${S.chat.approvalModeNames[approvalMode] ?? approvalMode}`,
  ].join(" · ");
  const pick = (apply: () => void) => {
    apply();
    setOpen(false);
  };
  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        menuClass="w-max min-w-44"
        portal={{ direction, align: "left" }}
        button={
          <button
            type="button"
            aria-label={`${P.label}: ${levelName}`}
            title={`${P.label}：${levelName}\n${summary}`}
            data-level={level}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <GlyphIcon
              d={PERMISSION_LEVEL_GLYPH[level]}
              className={toneInk[PERMISSION_LEVEL_TONE[level]]}
            />
            {/* The level's name only when the card is wide enough; the title carries it always. */}
            <span className="hidden min-w-0 truncate @md:block">{levelName}</span>
            <ChevronDown size={ICON_SIZE.caretDense} />
          </button>
        }
      >
        <div role="menu" aria-label={P.label} className="pb-1">
          <Heading>{P.fs}</Heading>
          {FS_MODES.map((mode) => (
            <Choice
              key={mode}
              label={P.fsModes[mode] ?? mode}
              selected={sandbox.mode === mode}
              onPick={() => pick(() => mode !== sandbox.mode && onChangeSandbox({ mode }))}
            />
          ))}
          <Heading>{P.network}</Heading>
          {NETWORK_MODES.map((network) => (
            <Choice
              key={network}
              label={P.networkModes[network] ?? network}
              selected={sandbox.network === network}
              onPick={() => pick(() => network !== sandbox.network && onChangeSandbox({ network }))}
            />
          ))}
          <Heading>{P.approval}</Heading>
          {APPROVAL_MODES.map((mode) => (
            <Choice
              key={mode}
              label={S.chat.approvalModes[mode] ?? mode}
              selected={approvalMode === mode}
              onPick={() => pick(() => mode !== approvalMode && onChangeApprovalMode(mode))}
            />
          ))}
          {isAdmin && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
              {/* More…: the rest of the sandbox (masked paths, the temp directory, the backend)
                is on the Settings page's Sandbox card, where this opens. */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{P.more}</span>
                <GlyphIcon d={OPEN_SETTINGS_GLYPH} size={ICON_SIZE.caretDense + 2} />
              </button>
            </>
          )}
        </div>
      </Dropdown>
      {isAdmin && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          section="plugins"
          pluginFocus="sandbox"
        />
      )}
    </>
  );
}
