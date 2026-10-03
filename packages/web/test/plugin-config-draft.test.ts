/**
 * A settings table's draft reads its stored value the way the server reads it (`resolveTable`):
 *
 * - A locked cell reads as declared whatever is stored (a hand-edited document cannot remap it),
 *   and so does a stored value its column does not accept.
 * - A malformed added row — an id that is no row id or a declared row's, a missing column, a
 *   value its column refuses — is dropped, so a save does not send it back; a well-formed one
 *   is kept with its columns only.
 */
import { describe, expect, it } from "vitest";
import type { PluginConfigField } from "@prismshadow/penguin-server/api";
import { tableDraftOf } from "../src/features/settings/plugin-config-draft";

const FIELD: PluginConfigField = {
  type: "table",
  title: "Rows",
  columns: [
    { name: "name", type: "string", title: "Name" },
    {
      name: "level",
      type: "enum",
      title: "Level",
      options: [
        { value: "low", title: "Low" },
        { value: "high", title: "High" },
      ],
    },
  ],
  rows: [
    { id: "a", values: { name: "A", level: "high" }, locked: ["level"] },
    { id: "b", values: { name: "B", level: "low" } },
  ],
  extensible: { add: "Add", values: { name: "New", level: "low" } },
};

describe("a table's draft", () => {
  it("reads a locked cell, or a value its column refuses, as declared", () => {
    const draft = tableDraftOf(FIELD, {
      a: { name: "Mine", level: "low" },
      b: { level: "max" },
    });
    expect(draft.rows).toEqual({
      a: { name: "Mine", level: "high" },
      b: { name: "", level: "low" },
    });
  });

  it("drops the malformed added rows the server's reading drops", () => {
    const draft = tableDraftOf(FIELD, {
      $added: {
        bad: { name: "Bad" },
        worse: { name: "W", level: "max" },
        Upper: { name: "U", level: "low" },
        a: { name: "Shadow", level: "low" },
        list: ["x"],
        ok: { name: "Ok", level: "low", extra: 1 },
      },
      $order: ["ok", "bad", "b"],
    });
    expect(draft.added).toEqual({ ok: { name: "Ok", level: "low" } });
    expect(draft.order).toEqual(["ok", "b", "a"]);
  });
});
