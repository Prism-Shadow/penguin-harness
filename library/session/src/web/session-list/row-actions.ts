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
import { contributionShown, useContributionShown } from "@prismshadow/penguin-web/internal";
import type {
  RowAction,
  SessionRowEntry,
  SessionRowMark,
  SessionRowMarkKind,
  WorkspaceGroupEntry,
} from "@prismshadow/penguin-web/internal";
import type { RowActionData } from "./iface";

/** What a row's marks say, by kind; an absent kind draws no mark. */
export type RowMarks = Partial<Record<SessionRowMarkKind, string>>;

/** A contributed entry with the module it came from, when that module may be gated. */
type FromModule = { from?: string };

export interface RowExtensions {
  sessionEntries: readonly (SessionRowEntry & FromModule)[];
  workspaceEntries: readonly (WorkspaceGroupEntry & FromModule)[];
  marks: readonly SessionRowMark[];
}

/**
 * The contributions with each entry carrying its module and each mark falling silent while that
 * module waits for its server module (lib/module-gate.ts); `shownRows` then leaves the entries
 * of such a module out. The list's own module applies it at boot.
 */
export function gatedRowActions(contributions: readonly Contributed[]): Contributed[] {
  return contributions.map((c) => {
    const action = c.code as RowAction;
    const from = c.from;
    const mark = action.sessionMark;
    const gated: RowAction = {
      ...(action.sessionEntry !== undefined
        ? { sessionEntry: { ...action.sessionEntry, from } as SessionRowEntry }
        : {}),
      ...(action.workspaceEntry !== undefined
        ? { workspaceEntry: { ...action.workspaceEntry, from } as WorkspaceGroupEntry }
        : {}),
      ...(mark !== undefined
        ? {
            sessionMark: {
              kind: mark.kind,
              useLabel: () => {
                const label = mark.useLabel();
                return useContributionShown(from) ? label : () => null;
              },
            },
          }
        : {}),
    };
    return { ...c, code: gated };
  });
}

/** The entries drawn now: those whose module is shown. Re-read whenever the gates move. */
export function shownRows(rows: RowExtensions): RowExtensions {
  const shown = (entry: FromModule) => entry.from === undefined || contributionShown(entry.from);
  return {
    sessionEntries: rows.sessionEntries.filter(shown),
    workspaceEntries: rows.workspaceEntries.filter(shown),
    marks: rows.marks,
  };
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
