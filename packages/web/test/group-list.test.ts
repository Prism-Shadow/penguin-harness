/**
 * group-list.tsx pure helpers: the sidebar header's mode-dependent create button —
 * the created object follows the grouping mode (用户口径: 具体新建的对象按分组方式决定).
 * Agent grouping creates an Agent (the Agents page's existing create dialog, reached
 * via route state); workspace grouping creates a Workspace (a new-chat draft — there
 * is no standalone Workspace entity, one comes into being with the conversation
 * created in it).
 */
import { describe, expect, it } from "vitest";
import { newEntityForGroupMode } from "../src/components/ui/group-list";

describe("newEntityForGroupMode", () => {
  it("agent grouping creates an Agent; workspace grouping (the default) creates a Workspace", () => {
    expect(newEntityForGroupMode("agent")).toBe("agent");
    expect(newEntityForGroupMode("workspace")).toBe("workspace");
  });
});
