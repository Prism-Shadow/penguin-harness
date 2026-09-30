/**
 * Shortcuts page of the System settings dialog: every rebindable command, grouped, each row a
 * recorder showing the current chord. Everything applies on the spot — the store writes the
 * browser mirror and the account's prefs — so there is no Save button; the trailing action row
 * only holds "Reset all". The rows form a dense list: small type, no rule between rows, the group
 * heading the only divider. A row's hint is a fact about its current state, kept on screen: a
 * conflict with another command first, then a claim on the chord from outside the page (a browser
 * tab never receives ⌘W; ⌘P takes over the browser's Print; the desktop menu also carries ⌘R).
 */
import { useState } from "react";
import { Button, GlyphIcon, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { conflictsOf, findConflicts, type Conflict } from "../../lib/shortcuts/conflicts";
import { currentHost, currentPlatform } from "../../lib/shortcuts/platform";
import { SHORTCUT_COMMANDS, SHORTCUT_GROUPS, commandById } from "../../lib/shortcuts/registry";
import { browserCommon, browserReserved, desktopReserved } from "../../lib/shortcuts/reserved";
import { isOverridden, resetAll, resetBinding, setBinding } from "../../lib/shortcuts/store";
import type { Chord, CommandId, ShortcutCommand } from "../../lib/shortcuts/types";
import { useKeymap } from "../../lib/shortcuts/use-keymap";
import { toneInk } from "../../lib/tone";
import { SectionShell } from "./section-shell";
import { ShortcutRecorder } from "./shortcut-recorder";

/** Counter-clockwise arrow: back to the default. */
const RESET_ICON = "M3 12a9 9 0 1 0 2.64-6.36M3 4v5h5";

interface RowHint {
  text: string;
  tone?: "attention";
}

/**
 * The one line under a row, in priority order: a conflict (the row may not fire), then a chord a
 * browser keeps for itself (dead in every browser tab), then one the host also uses (the binding
 * takes that function over). A conflict shows only from the side that loses: both rows of a
 * same-scope clash, but only the global row of a shadowed one — the focus-scoped command wins
 * there. Bindings are per account and shared by the browser and the desktop app, so the browser's
 * claims show on either host; in the desktop app its own menu's claim is named first.
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
  if (browserReserved(chord, platform)) {
    return { text: S.shortcuts.browserReserved, tone: "attention" };
  }
  // The shell binds no key before the page today, so only the menu case can arise here.
  if (currentHost() === "desktop" && desktopReserved(chord, platform) === "menu") {
    return { text: S.shortcuts.desktopMenuReserved };
  }
  return browserCommon(chord, platform) ? { text: S.shortcuts.browserCommon } : null;
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
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-medium">{S.shortcuts.commands[cmd.id]}</p>
        {hint !== null && (
          <p
            className={`mt-0.5 text-[11px] ${
              hint.tone === "attention" ? toneInk.attention : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {hint.text}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {overridden && (
          <button
            type="button"
            data-tooltip={S.shortcuts.resetRow}
            aria-label={`${S.shortcuts.resetRow}: ${S.shortcuts.commands[cmd.id]}`}
            onClick={() => resetBinding(cmd.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
          >
            <GlyphIcon d={RESET_ICON} size={ICON_SIZE.iconButton} />
          </button>
        )}
        <ShortcutRecorder chord={chord} onCommit={(next) => setBinding(cmd.id, next)} />
      </div>
    </div>
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
          {commands.map((cmd) => (
            <ShortcutRow
              key={cmd.id}
              cmd={cmd}
              chord={keymap.get(cmd.id) ?? null}
              conflicts={conflicts}
            />
          ))}
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
