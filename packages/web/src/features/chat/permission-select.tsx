/**
 * The composer's permission button: ONE shield glyph whose colour says how much the Agent may do
 * on its own (see lib/permission-level.ts), with the level's name beside it when the card is
 * wide enough. The menu is three sections — Filesystem, Network, and More…, which unfolds the
 * approval modes inside the panel rather than opening a second one.
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
import { PERMISSION_LEVEL_TONE, permissionLevel } from "../../lib/permission-level";

const APPROVAL_MODES: ApprovalMode[] = ["always-ask", "read-only", "allow-all", "deny-all"];
const FS_MODES: SessionSandbox["mode"][] = ["read-only", "workspace-write", "danger-full-access"];
const NETWORK_MODES: SessionSandbox["network"][] = ["open", "none"];

/** The one glyph the button wears at every level: a shield, coloured by the level. */
const SHIELD = "M12 3 5 6v6c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6l-7-3z";

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
  const [moreOpen, setMoreOpen] = useState(false);
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
    <Dropdown
      open={open}
      setOpen={(next) => {
        setOpen(next);
        if (!next) setMoreOpen(false);
      }}
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
          <GlyphIcon d={SHIELD} className={toneInk[PERMISSION_LEVEL_TONE[level]]} />
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
        <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
        {/* More… unfolds in place: a second floating panel would lose the first. */}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">{P.more}</span>
          <span className={`transition-transform duration-150 ${moreOpen ? "rotate-180" : ""}`}>
            <ChevronDown size={ICON_SIZE.caretDense} />
          </span>
        </button>
        {moreOpen && (
          <>
            <Heading>{P.approval}</Heading>
            {APPROVAL_MODES.map((mode) => (
              <Choice
                key={mode}
                label={S.chat.approvalModes[mode] ?? mode}
                selected={approvalMode === mode}
                onPick={() => pick(() => mode !== approvalMode && onChangeApprovalMode(mode))}
              />
            ))}
          </>
        )}
      </div>
    </Dropdown>
  );
}
