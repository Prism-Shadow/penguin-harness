/**
 * Shortcuts page of the System settings dialog: every rebindable command, grouped, each row the
 * command's bindings as removable chips plus a recorder that adds one more. Everything applies
 * on the spot — the store writes the browser mirror and the account's prefs — so there is no
 * Save button; the trailing action row only holds "Reset all", which asks first however many
 * shortcuts it would put back: what it undoes is the user's own setup, and nothing brings it
 * back. Each group is a titled run of the settings rows every other page uses (`SettingsGroup`,
 * `PrefRow`), so the page keeps their pitch. A row's hint is a fact about its bindings, kept on
 * screen: a conflict with another command first, then a claim on a chord from outside the page
 * (a browser tab never receives ⌘W; ⌘P takes over the browser's Print; the desktop menu also
 * carries ⌘R).
 */
import { useState } from "react";
import {
  Button,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  IconButton,
  PrefRow,
  SettingsGroup,
  SettingsSection,
} from "@prismshadow/penguin-ui";
import { ChordKbd } from "../../components/ui/chord-kbd";
import { S } from "../../lib/strings";
import { conflictsOf, findConflicts, type Conflict } from "../../lib/shortcuts/conflicts";
import { currentHost, currentPlatform } from "../../lib/shortcuts/platform";
import { SHORTCUT_COMMANDS, SHORTCUT_GROUPS, commandById } from "../../lib/shortcuts/registry";
import { browserCommon, browserReserved, desktopReserved } from "../../lib/shortcuts/reserved";
import {
  addBinding,
  isOverridden,
  removeBinding,
  resetAll,
  resetBinding,
  unbindCommand,
} from "../../lib/shortcuts/store";
import type { Chord, CommandId, ShortcutCommand } from "../../lib/shortcuts/types";
import { useKeymap } from "../../lib/shortcuts/use-keymap";
import { ShortcutRecorder } from "./shortcut-recorder";

interface RowHint {
  text: string;
  tone?: "attention";
}

/**
 * The one line under a row — the highest-priority fact about ANY of its bindings: a conflict (a
 * chord the row may not fire on), then a chord a browser keeps for itself (dead in every browser
 * tab), then one the host also uses (the binding takes that function over). A conflict shows
 * only from the side that loses: both rows of a same-scope clash, but only the global row of a
 * shadowed one — the focus-scoped command wins there. Bindings are per account and shared by the
 * browser and the desktop app, so the browser's claims show on either host; in the desktop app
 * its own menu's claim is named first.
 */
function rowHint(
  cmd: ShortcutCommand,
  bindings: readonly Chord[],
  conflicts: readonly Conflict[],
): RowHint | null {
  const mine = conflictsOf(cmd.id, conflicts);
  const other = (c: Conflict): CommandId => (c.a === cmd.id ? c.b : c.a);
  const same = mine.find((c) => c.kind === "same-scope");
  if (same !== undefined) {
    return { text: S.shortcuts.conflictSame(S.shortcuts.commands[other(same)]), tone: "attention" };
  }
  const shadowed = mine.find((c) => c.kind === "shadowed" && cmd.scope === "global");
  if (shadowed !== undefined) {
    const winner = commandById(other(shadowed));
    const surface = winner.scope === "global" ? "" : S.shortcuts.scopes[winner.scope];
    return {
      text: S.shortcuts.conflictShadowed(S.shortcuts.commands[winner.id], surface),
      tone: "attention",
    };
  }
  const platform = currentPlatform();
  const reserved = bindings.some((chord) => browserReserved(chord, platform));
  if (reserved) {
    return { text: S.shortcuts.browserReserved, tone: "attention" };
  }
  // The shell binds no key before the page today, so only the menu case can arise here.
  const menu =
    currentHost() === "desktop" &&
    bindings.some((chord) => desktopReserved(chord, platform) === "menu");
  if (menu) {
    return { text: S.shortcuts.desktopMenuReserved };
  }
  return bindings.some((chord) => browserCommon(chord, platform))
    ? { text: S.shortcuts.browserCommon }
    : null;
}

function ShortcutRow({
  cmd,
  bindings,
  conflicts,
}: {
  cmd: ShortcutCommand;
  bindings: readonly Chord[];
  conflicts: readonly Conflict[];
}) {
  const hint = rowHint(cmd, bindings, conflicts);
  const overridden = isOverridden(cmd.id);
  // The row draws a hint in the muted ink; a conflict or a chord the browser keeps says so in
  // the attention tone instead.
  const hintNode =
    hint === null ? undefined : hint.tone === "attention" ? (
      <span className="text-tone-attention-fg">{hint.text}</span>
    ) : (
      hint.text
    );
  return (
    <PrefRow label={S.shortcuts.commands[cmd.id]} hint={hintNode}>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {bindings.length === 0 && (
          <span className="text-xs text-fg-subtle">{S.shortcuts.unbound}</span>
        )}
        {bindings.map((chord) => (
          <span
            key={`${chord.mod}/${chord.ctrl}/${chord.alt}/${chord.shift}/${chord.code}`}
            className="flex items-center gap-0.5"
          >
            <ChordKbd chord={chord} />
            <IconButton
              variant="ghost"
              size="sm"
              label={`${S.shortcuts.removeBinding}: ${S.shortcuts.commands[cmd.id]}`}
              title={S.shortcuts.removeBinding}
              onClick={() => removeBinding(cmd.id, chord)}
            >
              <GlyphIcon d={ICONS.xCircle} size={ICON_SIZE.iconButton} />
            </IconButton>
          </span>
        ))}
        <ShortcutRecorder
          onCommit={(next) => {
            if (next === null) unbindCommand(cmd.id);
            else addBinding(cmd.id, next);
          }}
        />
        {overridden && (
          <IconButton
            variant="ghost"
            size="sm"
            label={`${S.shortcuts.resetRow}: ${S.shortcuts.commands[cmd.id]}`}
            title={S.shortcuts.resetRow}
            onClick={() => resetBinding(cmd.id)}
          >
            <GlyphIcon d={ICONS.rotateCcw} size={ICON_SIZE.iconButton} />
          </IconButton>
        )}
      </div>
    </PrefRow>
  );
}

export function ShortcutsSection() {
  const keymap = useKeymap();
  const conflicts = findConflicts(keymap, SHORTCUT_COMMANDS);
  const overriddenCount = SHORTCUT_COMMANDS.filter((cmd) => isOverridden(cmd.id)).length;
  const [confirmReset, setConfirmReset] = useState(false);
  const groups = SHORTCUT_GROUPS.map((group) => ({
    group,
    commands: SHORTCUT_COMMANDS.filter((cmd) => cmd.group === group),
  })).filter(({ commands }) => commands.length > 0);

  return (
    <SettingsSection
      actions={
        <Button size="sm" disabled={overriddenCount === 0} onClick={() => setConfirmReset(true)}>
          {S.shortcuts.resetAll}
        </Button>
      }
    >
      <div className="space-y-6">
        {groups.map(({ group, commands }) => (
          <SettingsGroup key={group} title={S.shortcuts.groups[group]}>
            {commands.map((cmd) => (
              <ShortcutRow
                key={cmd.id}
                cmd={cmd}
                bindings={keymap.get(cmd.id) ?? []}
                conflicts={conflicts}
              />
            ))}
          </SettingsGroup>
        ))}
      </div>
      {confirmReset && (
        <ConfirmModal
          open
          title={S.shortcuts.resetAll}
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            resetAll();
            setConfirmReset(false);
          }}
          confirmLabel={S.shortcuts.resetAll}
          cancelLabel={S.common.cancel}
        >
          {S.shortcuts.resetAllBody(overriddenCount)}
        </ConfirmModal>
      )}
    </SettingsSection>
  );
}
