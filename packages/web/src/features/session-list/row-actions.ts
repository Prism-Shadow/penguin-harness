/**
 * The `rowActions` contributions as the list reads them (pure, unit tested, apart from the one
 * composed hook): the conversation-row entries, the Workspace-group entries, and the row marks.
 *
 * Contributed conversation-row entries sit after rename and before archive, in `order` — among
 * the actions that change the Session, ahead of the ones that file or end it
 * (components/ui/session-row-menu.tsx gives the built-in order).
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type { RowActionItem } from "@prismshadow/penguin-ui";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type {
  RowAction,
  SessionRowEntry,
  SessionRowMark,
  SessionRowMarkKind,
  WorkspaceGroupEntry,
} from "../../lib/session-row-contributions";
import type { RowActionData } from "./iface";

/** What a row's marks say, by kind; an absent kind draws no mark. */
export type RowMarks = Partial<Record<SessionRowMarkKind, string>>;

export interface RowExtensions {
  sessionEntries: readonly SessionRowEntry[];
  workspaceEntries: readonly WorkspaceGroupEntry[];
  marks: readonly SessionRowMark[];
}

/** The contributions by `order`, split by what each adds. */
export function rowExtensionsOf(contributions: readonly Contributed[]): RowExtensions {
  const actions = [...contributions]
    .sort(
      (a, b) =>
        (a.data as unknown as RowActionData).order - (b.data as unknown as RowActionData).order,
    )
    .map((c) => c.code as RowAction);
  return {
    sessionEntries: actions.flatMap((a) => a.sessionEntry ?? []),
    workspaceEntries: actions.flatMap((a) => a.workspaceEntry ?? []),
    marks: actions.flatMap((a) => a.sessionMark ?? []),
  };
}

/** The built-in menu items with the contributed ones after rename (at the end when there is no rename). */
export function withEntries(
  builtIn: readonly RowActionItem[],
  contributed: readonly RowActionItem[],
): RowActionItem[] {
  const at = builtIn.findIndex((item) => item.id === "rename");
  const cut = at < 0 ? builtIn.length : at + 1;
  return [...builtIn.slice(0, cut), ...contributed, ...builtIn.slice(cut)];
}

/**
 * One hook over every mark's `useLabel`: what each row's marks say. The list of marks is fixed
 * at boot, so every render calls the same hooks in the same order; the first mark of a kind wins.
 */
export function composeMarks(marks: readonly SessionRowMark[]): () => (s: SessionInfo) => RowMarks {
  return () => {
    const labels = marks.map((m) => ({ kind: m.kind, label: m.useLabel() }));
    return (s) => {
      const out: RowMarks = {};
      for (const { kind, label } of labels) {
        if (out[kind] !== undefined) continue;
        const text = label(s);
        if (text !== null) out[kind] = text;
      }
      return out;
    };
  };
}
