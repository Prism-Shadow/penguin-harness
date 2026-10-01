/**
 * The composer's permission level (lib/permission-level.ts): how much the Agent may do on its
 * own, in one mark.
 *
 * - The level is all only when nothing holds the Agent back; any approval, network or
 *   sandbox limit makes it partial.
 * - It is read-only when commands cannot write, and off when every call is denied.
 * - Each level wears its own glyph, so the level never depends on colour alone.
 */
import { describe, expect, it } from "vitest";
import type { SessionSandbox } from "@prismshadow/penguin-server/api";
import { PERMISSION_LEVEL_GLYPH, permissionLevel } from "../src/lib/permission-level";

const FULL: SessionSandbox = { mode: "danger-full-access", network: "open" };

describe("permission level", () => {
  it("is all only when nothing holds the Agent back", () => {
    expect(permissionLevel("allow-all", FULL)).toBe("all");
    expect(permissionLevel("always-ask", FULL)).toBe("partial");
    expect(permissionLevel("read-only", FULL)).toBe("partial");
    expect(permissionLevel("allow-all", { ...FULL, network: "none" })).toBe("partial");
    expect(permissionLevel("allow-all", { ...FULL, mode: "workspace-write" })).toBe("partial");
  });

  it("is read-only when commands cannot write, and off when every call is denied", () => {
    expect(permissionLevel("allow-all", { mode: "read-only", network: "open" })).toBe("read-only");
    expect(permissionLevel("deny-all", FULL)).toBe("off");
    expect(permissionLevel("deny-all", { mode: "read-only", network: "none" })).toBe("off");
  });

  it("draws each level with its own mark, so the level never depends on colour alone", () => {
    const glyphs = Object.values(PERMISSION_LEVEL_GLYPH);
    expect(glyphs).toHaveLength(4);
    expect(new Set(glyphs).size).toBe(4);
  });
});
