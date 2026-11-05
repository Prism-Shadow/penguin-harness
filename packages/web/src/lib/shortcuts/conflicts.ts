/**
 * Two commands on one chord. Because the matcher's resolution is deterministic (focus scope
 * first, then registry order) a conflict is a warning about which one will fire, not an error.
 */
import { chordEquals } from "./chord";
import type { Chord, CommandId, Keymap, ShortcutCommand } from "./types";

export type ConflictKind =
  /** Same scope (or both global): only the first in registry order ever fires. */
  | "same-scope"
  /** One global, one focus-scoped: the focus command wins while its surface has focus, and the global one is unreachable there. */
  | "shadowed";

export interface Conflict {
  chord: Chord;
  /** The two ids in registry order: `a` is the one that fires in a same-scope conflict. */
  a: CommandId;
  b: CommandId;
  kind: ConflictKind;
}

/** Every pair of commands bound to the same chord. Two different focus scopes never hold focus together and do not conflict. */
export function findConflicts(keymap: Keymap, commands: readonly ShortcutCommand[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < commands.length; i++) {
    const a = commands[i]!;
    const chordA = keymap.get(a.id) ?? null;
    if (chordA === null) continue;
    for (let j = i + 1; j < commands.length; j++) {
      const b = commands[j]!;
      if (!chordEquals(chordA, keymap.get(b.id) ?? null)) continue;
      if (a.scope === b.scope) {
        out.push({ chord: chordA, a: a.id, b: b.id, kind: "same-scope" });
      } else if (a.scope === "global" || b.scope === "global") {
        out.push({ chord: chordA, a: a.id, b: b.id, kind: "shadowed" });
      }
    }
  }
  return out;
}

export function conflictsOf(id: CommandId, conflicts: readonly Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.a === id || c.b === id);
}
