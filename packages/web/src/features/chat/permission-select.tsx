/**
 * The composer's permission button: an icon-only square like the + button, wearing lucide's
 * shield icon for the level (see lib/permission-level.ts) — a different icon per level, coloured
 * by it, so the level never depends on colour alone. The menu has three sections — Filesystem, Network and Approval — and, for an
 * administrator, More…, which opens the Settings page's Sandbox card.
 *
 * Filesystem and Network edit the Session's own sandbox policy: a Session keeps the policy it
 * was created with, so the Settings page only decides what NEW Sessions start from. The menu is
 * the same on every platform; a level this server cannot enforce is greyed out rather than
 * hidden — with no sandbox backend installed, every level short of full access, marked so.
 *
 * Approval lists the modes the composer passes in (see approval-mode.ts): an organization's
 * Session is not offered `always-ask` unless it is the current value.
 *
 * Popup direction depends on context: the draft card has room below and opens downward; the
 * chat input docked at the bottom of the screen opens upward.
 */
import { useState } from "react";
import type { ApprovalMode, SessionSandbox } from "@prismshadow/penguin-server/api";
import {
  Dropdown,
  GlyphIcon,
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  PERMISSION_LEVEL_GLYPH,
  PERMISSION_LEVEL_TONE,
  fsModeBlock,
  networkBlock,
  permissionLevel,
} from "../../lib/permission-level";
import type { LevelBlock } from "../../lib/permission-level";
import { useAuth } from "../../state/auth";
import { SettingsDialog } from "../settings/settings-dialog";

const FS_MODES: SessionSandbox["mode"][] = ["read-only", "workspace-write", "danger-full-access"];
const NETWORK_MODES: SessionSandbox["network"][] = ["open", "local", "none"];

/**
 * One choice row: its text, and a check when it is the current value. An unavailable choice
 * stays listed, greyed out, with a short note (`note`, "Not supported" unless given) and the
 * reason in its title (`unavailable`).
 */
function Choice({
  label,
  selected,
  onPick,
  unavailable,
  note,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
  unavailable?: string;
  note?: string;
}) {
  const off = unavailable !== undefined;
  return (
    <MenuRadioItem
      label={label}
      checked={selected}
      disabled={off}
      data-tooltip={unavailable}
      trailing={off ? (note ?? S.chat.permission.unsupported) : undefined}
      onSelect={onPick}
    />
  );
}

/** A pick not yet confirmed by its save: shown at once, dropped when the save settles. */
interface PendingPick {
  approvalMode?: ApprovalMode;
  sandbox?: Partial<SessionSandbox>;
}

export function PermissionSelect({
  approvalMode: savedApprovalMode,
  approvalModes,
  sandbox: savedSandbox,
  onChangeApprovalMode,
  onChangeSandbox,
  disabled,
  direction = "up",
}: {
  approvalMode: ApprovalMode;
  /** The modes the Approval section lists, in order (`approvalModeChoices`). */
  approvalModes: readonly ApprovalMode[];
  sandbox: SessionSandbox;
  /** A save that returns a promise keeps the pick on screen until it settles. */
  onChangeApprovalMode: (mode: ApprovalMode) => void | Promise<unknown>;
  onChangeSandbox: (pick: Partial<SessionSandbox>) => void | Promise<unknown>;
  /** Blocks a second pick while one saves; deliberately NOT drawn dimmed (that read as a flicker). */
  disabled: boolean;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  // The pick shows the moment it is made: waiting for the server's row would draw the old
  // level, then the new one — the flicker. When the save settles the saved values take over
  // (on a refusal those are the old ones, and the toast says why).
  const [pending, setPending] = useState<PendingPick | null>(null);
  const approvalMode = pending?.approvalMode ?? savedApprovalMode;
  const sandbox: SessionSandbox = { ...savedSandbox, ...pending?.sandbox };
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Sandbox card lives on the Plugins page, which only an administrator can open.
  const isAdmin = useAuth().user?.isAdmin === true;
  const P = S.chat.permission;
  // A level this server cannot enforce stays listed, greyed out, saying why — with no backend
  // installed, that is every level short of full access.
  const blocked = (block: LevelBlock | null) =>
    block === null
      ? {}
      : block === "no-backend"
        ? { unavailable: P.noBackend, note: P.notInstalled }
        : {
            unavailable:
              block === "local-unsupported" ? P.localUnsupported : P.noNetworkUnsupported,
          };
  const level = permissionLevel(approvalMode, sandbox);
  // The swap animation plays only for a CHANGE of level, never on the first paint — React's
  // "adjust state while rendering" pattern for information from the previous render.
  const [shownLevel, setShownLevel] = useState(level);
  const [animate, setAnimate] = useState(false);
  if (shownLevel !== level) {
    setShownLevel(level);
    setAnimate(true);
  }
  const levelName = P.levels[level] ?? level;
  const summary = [
    `${P.fs}: ${P.fsModes[sandbox.mode] ?? sandbox.mode}`,
    `${P.network}: ${P.networkModes[sandbox.network] ?? sandbox.network}`,
    `${P.approval}: ${S.chat.approvalModeNames[approvalMode] ?? approvalMode}`,
  ].join(" · ");
  const pick = (next: PendingPick, save: () => void | Promise<unknown>) => {
    setOpen(false);
    setPending(next);
    const saved = save();
    if (saved instanceof Promise) void saved.finally(() => setPending(null));
    else setPending(null);
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
            data-tooltip={`${P.label}：${levelName}\n${summary}`}
            data-level={level}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            // Icon only, the + button's square and its look (the package's ToolbarTrigger, which
            // this cannot be: that one dims while disabled): the level is in the icon's shape and
            // colour, and spelled out in the accessible name and the title.
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-surface-muted hover:text-fg"
          >
            {/* Keyed by level: a new level mounts a new icon, which swaps in. */}
            <span key={level} className={animate ? "anim-icon-swap" : undefined}>
              <GlyphIcon
                d={PERMISSION_LEVEL_GLYPH[level]}
                size={15}
                className={toneInk[PERMISSION_LEVEL_TONE[level]]}
              />
            </span>
          </button>
        }
      >
        <Menu label={P.label} density="sm" className="pb-1">
          <MenuLabel>{P.fs}</MenuLabel>
          {FS_MODES.map((mode) => (
            <Choice
              key={mode}
              label={P.fsModes[mode] ?? mode}
              selected={sandbox.mode === mode}
              {...blocked(fsModeBlock(sandbox, mode))}
              onPick={() =>
                mode === sandbox.mode
                  ? setOpen(false)
                  : pick({ sandbox: { mode } }, () => onChangeSandbox({ mode }))
              }
            />
          ))}
          <MenuLabel>{P.network}</MenuLabel>
          {NETWORK_MODES.map((network) => (
            <Choice
              key={network}
              label={P.networkModes[network] ?? network}
              selected={sandbox.network === network}
              {...blocked(networkBlock(sandbox, network))}
              onPick={() =>
                network === sandbox.network
                  ? setOpen(false)
                  : pick({ sandbox: { network } }, () => onChangeSandbox({ network }))
              }
            />
          ))}
          <MenuLabel>{P.approval}</MenuLabel>
          {approvalModes.map((mode) => (
            <Choice
              key={mode}
              label={S.chat.approvalModes[mode] ?? mode}
              selected={approvalMode === mode}
              onPick={() =>
                mode === approvalMode
                  ? setOpen(false)
                  : pick({ approvalMode: mode }, () => onChangeApprovalMode(mode))
              }
            />
          ))}
          {isAdmin && (
            <>
              <MenuSeparator />
              {/* More…: the rest of the sandbox (masked paths, the temp directory, the backend)
                is on the Settings page's Sandbox card, where this opens. */}
              <MenuItem
                label={P.more}
                onSelect={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
              />
            </>
          )}
        </Menu>
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
