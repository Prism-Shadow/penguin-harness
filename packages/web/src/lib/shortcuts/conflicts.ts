/**
 * Two commands sharing a chord. Because the matcher's resolution is deterministic (focus scope
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
  /** The shared chord — one of the pair's, the first each holds in binding order. */
  chord: Chord;
  /** The two ids in registry order: `a` is the one that fires in a same-scope conflict. */
  a: CommandId;
  b: CommandId;
  kind: ConflictKind;
}

/** Every chord two commands share, from either binding list. Two different focus scopes never hold focus together and do not conflict. */
export function findConflicts(keymap: Keymap, commands: readonly ShortcutCommand[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < commands.length; i++) {
    const a = commands[i]!;
    for (const chordA of keymap.get(a.id) ?? []) {
      for (let j = i + 1; j < commands.length; j++) {
        const b = commands[j]!;
        if (!(keymap.get(b.id) ?? []).some((chordB) => chordEquals(chordA, chordB))) continue;
        if (a.scope === b.scope) {
          out.push({ chord: chordA, a: a.id, b: b.id, kind: "same-scope" });
        } else if (a.scope === "global" || b.scope === "global") {
          out.push({ chord: chordA, a: a.id, b: b.id, kind: "shadowed" });
        }
      }
    }
  }
  return out;
}

export function conflictsOf(id: CommandId, conflicts: readonly Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.a === id || c.b === id);
}
