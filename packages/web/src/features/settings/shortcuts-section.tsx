/**
 * Shortcuts page of the System settings dialog: every rebindable command, grouped, each row a
 * recorder showing the current chord. Everything applies on the spot — the store writes the
 * browser mirror and the account's prefs — so there is no Save button; the trailing action row
 * only holds "Reset all". A row's hint is a fact about its current state, kept on screen: a
 * conflict with another command first, then the host's own claim on the chord (a browser tab
 * never receives ⌘W; the desktop shell's menu also carries ⌘R, and the binding takes it over).
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { conflictsOf, findConflicts, type Conflict } from "../../lib/shortcuts/conflicts";
import { currentHost, currentPlatform } from "../../lib/shortcuts/platform";
import { SHORTCUT_COMMANDS, SHORTCUT_GROUPS, commandById } from "../../lib/shortcuts/registry";
import { browserReserved, desktopReserved } from "../../lib/shortcuts/reserved";
import { isOverridden, resetAll, resetBinding, setBinding } from "../../lib/shortcuts/store";
import type { Chord, CommandId, ShortcutCommand } from "../../lib/shortcuts/types";
import { useKeymap } from "../../lib/shortcuts/use-keymap";
import { SectionShell } from "./section-shell";
import { PrefRow } from "./setting-row";
import { ShortcutRecorder } from "./shortcut-recorder";

/** Counter-clockwise arrow: back to the default. */
const RESET_ICON = "M3 12a9 9 0 1 0 2.64-6.36M3 4v5h5";

interface RowHint {
  text: string;
  tone?: "attention";
}

/**
 * The one line under a row, in priority order: a conflict (the row may not fire), then a chord
 * the host keeps for itself. Shown only from the side that loses: both rows of a same-scope
 * clash, but only the global row of a shadowed one — the focus-scoped command wins there.
 */
function rowHint(
  cmd: ShortcutCommand,
  chord: Chord | null,
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
  if (chord === null) return null;
  const platform = currentPlatform();
  if (currentHost() === "browser") {
    return browserReserved(chord, platform) ? { text: S.shortcuts.browserReserved } : null;
  }
  // The shell binds no key before the page today, so only the menu case can arise here.
  return desktopReserved(chord, platform) === "menu"
    ? { text: S.shortcuts.desktopMenuReserved }
    : null;
}

function ShortcutRow({
  cmd,
  chord,
  conflicts,
}: {
  cmd: ShortcutCommand;
  chord: Chord | null;
  conflicts: readonly Conflict[];
}) {
  const hint = rowHint(cmd, chord, conflicts);
  const overridden = isOverridden(cmd.id);
  return (
    <PrefRow label={S.shortcuts.commands[cmd.id]} hint={hint?.text} hintTone={hint?.tone}>
      <div className="flex items-center gap-1.5">
        {overridden && (
          <button
            type="button"
            title={S.shortcuts.resetRow}
            aria-label={`${S.shortcuts.resetRow}: ${S.shortcuts.commands[cmd.id]}`}
            onClick={() => resetBinding(cmd.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
          >
            <GlyphIcon d={RESET_ICON} size={ICON_SIZE.iconButton} />
          </button>
        )}
        <ShortcutRecorder chord={chord} onCommit={(next) => setBinding(cmd.id, next)} />
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
    <SectionShell
      actions={
        <Button
          size="sm"
          disabled={overriddenCount === 0}
          onClick={() => {
            // One override goes back without a question; several are worth a look first.
            if (overriddenCount > 1) setConfirmReset(true);
            else resetAll();
          }}
        >
          {S.shortcuts.resetAll}
        </Button>
      }
    >
      {groups.map(({ group, commands }) => (
        <div key={group}>
          <h3 className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            {S.shortcuts.groups[group]}
          </h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {commands.map((cmd) => (
              <ShortcutRow
                key={cmd.id}
                cmd={cmd}
                chord={keymap.get(cmd.id) ?? null}
                conflicts={conflicts}
              />
            ))}
          </div>
        </div>
      ))}
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
        >
          {S.shortcuts.resetAllBody(overriddenCount)}
        </ConfirmModal>
      )}
    </SectionShell>
  );
}
