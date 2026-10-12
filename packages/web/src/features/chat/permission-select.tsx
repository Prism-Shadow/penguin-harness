/**
 * The composer's permission button: an icon-only square like the + button, wearing lucide's
 * shield icon for the level (see lib/permission-level.ts) — a different icon per level, coloured
 * by it, so the level never depends on colour alone. The menu lists the server's sandbox presets
 * that are in the menu — each a named mode, network level and approval mode, its name led by the
 * shield of the level it sets, so a row shows beforehand the mark the button takes once it is
 * picked — and, for an administrator, More…, which opens the Settings page's Sandbox card, where
 * the presets are renamed, remapped and put in or out of the menu, and where the full settings
 * stay.
 *
 * A pick edits the Session's own policy and approval mode in one save: a Session keeps the
 * policy it was created with, so the Settings page only decides what NEW Sessions start from.
 * The Session stores the three values, never the preset: the button names it by the first row
 * matching them, and says custom when none does. A preset this server cannot enforce is greyed
 * out rather than hidden, marked with why — with no sandbox backend installed, every preset
 * that confines. So is, for a non-admin, a preset wider than the server's sandbox settings
 * (`aboveCeiling`), which the server would refuse: marked admin-only, unless it is the current one.
 *
 * With the server's Sandbox switch off, new Sessions start unconfined and the menu lists the
 * approval modes alone (permissionMenu), each led by its level's shield the same way; a pick
 * changes only the approval mode.
 *
 * The menu offers only presets whose approval mode is among the modes the composer passes in
 * (see approval-mode.ts): an organization's Session is not offered an `always-ask` preset unless
 * it is the current one.
 *
 * Popup direction depends on context: the draft card has room below and opens downward; the
 * chat input docked at the bottom of the screen opens upward.
 */
import { useState } from "react";
import type {
  ApprovalMode,
  SessionSandbox,
  SessionSandboxPreset,
} from "@prismshadow/penguin-server/api";
import {
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  PERMISSION_LEVEL_GLYPH,
  PERMISSION_LEVEL_TONE,
  approvalModePick,
  firstUnavailableBackend,
  matchPreset,
  menuRowLevel,
  permissionLevel,
  permissionMenu,
  presetBlock,
  presetEffects,
  presetPick,
  presetsOf,
  sandboxSwitchOff,
} from "../../lib/permission-level";
import type { PermissionLevel, PermissionPick, PresetBlock } from "../../lib/permission-level";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { localizedText } from "./skill-use";
import { SettingsDialog } from "../settings/settings-dialog";

/**
 * A level's shield in the level's tone: the button's mark, and the mark ahead of each row's name.
 * Not decorative — the shape and the tone are the level, which the row's name does not say.
 */
function LevelGlyph({ level, size }: { level: PermissionLevel; size: number }) {
  return (
    <GlyphIcon
      d={PERMISSION_LEVEL_GLYPH[level]}
      size={size}
      className={toneInk[PERMISSION_LEVEL_TONE[level]]}
    />
  );
}

/**
 * One preset row: the shield of the level it sets, its name, and a check when it is the
 * Session's level. Its tooltip says what it blocks and allows and whether this machine can
 * enforce it; an unenforceable one stays listed, greyed out, with a short note.
 */
function Choice({
  label,
  level,
  selected,
  onPick,
  hint,
  unavailable,
  note,
}: {
  label: string;
  level: PermissionLevel;
  selected: boolean;
  onPick: () => void;
  hint: string;
  unavailable: boolean;
  note?: string;
}) {
  return (
    <MenuRadioItem
      glyph={<LevelGlyph level={level} size={ICON_SIZE.inlineGlyph} />}
      label={label}
      checked={selected}
      disabled={unavailable}
      data-tooltip={hint}
      trailing={unavailable ? (note ?? S.chat.permission.unsupported) : undefined}
      onSelect={onPick}
    />
  );
}

export function PermissionSelect({
  approvalMode: savedApprovalMode,
  approvalModes,
  sandbox: savedSandbox,
  onChange,
  disabled,
  direction = "up",
}: {
  approvalMode: ApprovalMode;
  /**
   * The approval modes the Session may be given, in order (`approvalModeChoices`): a preset
   * holding any other is not offered, unless it is the current one.
   */
  approvalModes: readonly ApprovalMode[];
  sandbox: SessionSandbox;
  /** Saves a preset's three values together; a returned promise keeps the pick on screen until it settles. */
  onChange: (pick: PermissionPick) => void | Promise<unknown>;
  /** Blocks a second pick while one saves; deliberately NOT drawn dimmed (that read as a flicker). */
  disabled: boolean;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  // The pick shows the moment it is made: waiting for the server's row would draw the old
  // level, then the new one — the flicker. When the save settles the saved values take over
  // (on a refusal those are the old ones, and the toast says why).
  const [pending, setPending] = useState<PermissionPick | null>(null);
  const approvalMode = pending?.approvalMode ?? savedApprovalMode;
  const sandbox: SessionSandbox = { ...savedSandbox, ...pending?.sandbox };
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Sandbox card lives on the Plugins page, which only an administrator can open.
  const isAdmin = useAuth().user?.isAdmin === true;
  const { locale } = useLocale();
  const P = S.chat.permission;
  const nameOf = (p: SessionSandboxPreset) => localizedText(locale, p.name, p.nameZh);
  const presets = presetsOf(sandbox);
  const current = matchPreset(presets, approvalMode, sandbox);
  // A preset this server cannot enforce stays listed, greyed out, saying why — with no backend
  // mounted, every preset that confines: not installed, or enabled but failing its check, with
  // the first such backend's reason.
  const failed = firstUnavailableBackend(sandbox);
  const inUse = sandbox.backendsInUse?.join(", ");
  const blockText = (block: PresetBlock): { reason: string; note?: string } =>
    block === "above-ceiling"
      ? { reason: P.aboveCeiling, note: P.adminOnly }
      : block === "no-backend"
        ? { reason: P.noBackend, note: P.notInstalled }
        : block === "unavailable" && failed !== null
          ? { reason: P.backendUnavailable(failed.name, failed.reason), note: P.notAvailable }
          : {
              reason:
                block === "local-unsupported"
                  ? P.localUnsupported
                  : block === "mask-unsupported"
                    ? P.maskUnsupported(inUse)
                    : P.noNetworkUnsupported(inUse),
            };
  const hintOf = (p: SessionSandboxPreset, block: PresetBlock | null) => {
    const { blocks, allows } = presetEffects(p);
    const list = (effects: string[]) =>
      effects.length === 0 ? P.nothing : effects.map((e) => P.effects[e] ?? e).join(", ");
    const confines = p.mode !== "danger-full-access" || p.network !== "open";
    return [
      `${P.blocks}: ${list(blocks)}`,
      `${P.allows}: ${list(allows)}`,
      block !== null ? blockText(block).reason : confines ? P.enforceable : P.needsNoBackend,
    ].join("\n");
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
  // With the Sandbox switch off the menu is the approval modes, so the button names the mode.
  const switchOff = sandboxSwitchOff(sandbox);
  const levelName = switchOff
    ? (S.chat.approvalModeNames[approvalMode] ?? approvalMode)
    : current !== null
      ? nameOf(current)
      : P.custom;
  const summary = [
    `${P.fs}: ${P.fsModes[sandbox.mode] ?? sandbox.mode}`,
    `${P.network}: ${P.networkModes[sandbox.network] ?? sandbox.network}`,
    `${P.approval}: ${S.chat.approvalModeNames[approvalMode] ?? approvalMode}`,
  ].join(" · ");
  const pick = (p: SessionSandboxPreset) => {
    if (current?.id === p.id) {
      setOpen(false);
      return;
    }
    save(presetPick(p));
  };
  // Switch off: only the approval mode changes; the pick carries no policy (see PermissionPick).
  const pickMode = (mode: ApprovalMode) => {
    if (mode === approvalMode) {
      setOpen(false);
      return;
    }
    save(approvalModePick(mode));
  };
  const save = (next: PermissionPick) => {
    setOpen(false);
    setPending(next);
    const saved = onChange(next);
    if (saved instanceof Promise) void saved.finally(() => setPending(null));
    else setPending(null);
  };
  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        // A row's name does not widen a `w-max` panel (it sits in a `flex-1` column), so the
        // floor is what keeps the longest built-in row whole in Chinese: its shield, the
        // Workspace Write name, an "Admin only" note and the check.
        menuClass="w-max min-w-50"
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
              <LevelGlyph level={level} size={ICON_SIZE.iconButton} />
            </span>
          </button>
        }
      >
        <Menu label={P.label} density="sm" className="py-1">
          {/* The two views say the same policy: what the presets cannot show is flagged here. */}
          {sandbox.advanced === true && !switchOff && (
            <div
              role="presentation"
              data-tooltip={P.advancedHint}
              className="px-3 pt-1 pb-1.5 text-xs font-medium text-fg-subtle"
            >
              {P.advancedActive}
            </div>
          )}
          {permissionMenu(sandbox, approvalModes, current).map((row) => {
            if (row.kind === "approval") {
              return (
                <MenuRadioItem
                  key={row.mode}
                  glyph={
                    <LevelGlyph level={menuRowLevel(row, sandbox)} size={ICON_SIZE.inlineGlyph} />
                  }
                  label={S.chat.approvalModeNames[row.mode] ?? row.mode}
                  checked={row.mode === approvalMode}
                  onSelect={() => pickMode(row.mode)}
                />
              );
            }
            const p = row.preset;
            const block = presetBlock(sandbox, p, { isAdmin, current });
            return (
              <Choice
                key={p.id}
                label={nameOf(p)}
                level={menuRowLevel(row, sandbox)}
                selected={current?.id === p.id}
                hint={hintOf(p, block)}
                unavailable={block !== null}
                {...(block !== null && blockText(block).note !== undefined
                  ? { note: blockText(block).note }
                  : {})}
                onPick={() => pick(p)}
              />
            );
          })}
          {isAdmin && (
            <>
              <MenuSeparator />
              {/* More…: the presets table and the full settings (masked paths, the temp
                directory, the backends) are on the Settings page's Sandbox card. Its gear keeps
                its name in the column the level rows' names start in — so it is a node, not a
                registry path: a path is drawn as a decorative mark, which a theme may drop
                (Console does), and the name would then step out of line. */}
              <MenuItem
                glyph={
                  <GlyphIcon
                    d={ICONS.gear}
                    size={ICON_SIZE.inlineGlyph}
                    className="text-fg-subtle"
                  />
                }
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
