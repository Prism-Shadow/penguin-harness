/**
 * The session list's row extensions (features/session-list/row-actions.ts).
 *
 * - Contributions are split by what they add, each kind in `order`.
 * - Contributed menu entries go right after rename — before archive, copy and delete — and at
 *   the end of a menu with no rename.
 * - A row's marks: each kind says the first non-null label of its contributions.
 */
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type { RowActionItem } from "@prismshadow/penguin-ui";
import { describe, expect, it } from "vitest";
import {
  composeMarks,
  rowExtensionsOf,
  withEntries,
} from "../src/features/session-list/row-actions";
import type { RowAction } from "../src/lib/session-row-contributions";

const contributed = (id: string, order: number, code: RowAction): Contributed =>
  ({ id, from: "Test", data: { order }, code }) as unknown as Contributed;

const item = (id: string): RowActionItem => ({
  id,
  label: id,
  glyph: "",
  danger: false,
  onSelect: () => undefined,
});

const Dialog = () => null;
const entry = (id: string) => ({ id, label: () => id, icon: "", Dialog });
const session = (sessionId: string) => ({ sessionId }) as SessionInfo;

describe("rowExtensionsOf", () => {
  it("splits the contributions by what they add, in order", () => {
    const browse = { id: "browse", label: () => "", icon: "", run: () => undefined };
    const relay = { kind: "relay" as const, useLabel: () => () => null };
    const rows = rowExtensionsOf([
      contributed("late", 20, { sessionEntry: entry("late") }),
      contributed("both", 10, { sessionEntry: entry("early"), sessionMark: relay }),
      contributed("dock", 10, { workspaceEntry: browse }),
    ]);
    expect(rows.sessionEntries.map((e) => e.id)).toEqual(["early", "late"]);
    expect(rows.marks).toEqual([relay]);
    expect(rows.workspaceEntries).toEqual([browse]);
  });
});

describe("withEntries", () => {
  it("puts the contributed entries right after rename", () => {
    const builtIn = ["pin", "rename", "archive", "copy", "delete"].map(item);
    expect(withEntries(builtIn, [item("messaging")]).map((i) => i.id)).toEqual([
      "pin",
      "rename",
      "messaging",
      "archive",
      "copy",
      "delete",
    ]);
  });

  it("appends them to a menu with no rename", () => {
    expect(withEntries([item("copy")], [item("x")]).map((i) => i.id)).toEqual(["copy", "x"]);
  });
});

describe("composeMarks", () => {
  it("each kind says the first non-null label of its contributions", () => {
    const marksOf = composeMarks([
      { kind: "scheduled", useLabel: () => (s) => (s.sessionId === "a" ? "alarm" : null) },
      { kind: "relay", useLabel: () => () => null },
      { kind: "relay", useLabel: () => (s) => `via ${s.sessionId}` },
    ])();
    expect(marksOf(session("a"))).toEqual({ scheduled: "alarm", relay: "via a" });
    expect(marksOf(session("b"))).toEqual({ relay: "via b" });
  });
});
