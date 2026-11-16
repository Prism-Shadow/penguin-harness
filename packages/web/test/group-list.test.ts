/**
 * The sidebar header's group-list helpers (components/ui/group-list.tsx).
 *
 * - The create button creates what the list is grouped into: an Agent in Agent grouping, a
 *   Workspace (a new-chat draft) in Workspace grouping, and a conversation in time grouping,
 *   which nothing can be created into.
 */
import { describe, expect, it } from "vitest";
import { newEntityForGroupMode } from "../src/components/ui/group-list";

describe("newEntityForGroupMode", () => {
  it.each([
    ["agent", "agent"],
    ["workspace", "workspace"],
    ["time", "chat"],
  ] as const)("%s grouping creates a %s", (mode, entity) => {
    expect(newEntityForGroupMode(mode)).toBe(entity);
  });
});
