/**
 * The composer's permission level: one colour for how much the Agent may do on its own.
 */
import { describe, expect, it } from "vitest";
import type { SessionSandbox } from "@prismshadow/penguin-server/api";
import {
  PERMISSION_LEVEL_GLYPH,
  PERMISSION_LEVEL_TONE,
  SHIELD,
  permissionLevel,
} from "../src/lib/permission-level";

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

  it("gives each level its own tone, loudest for the most access", () => {
    expect(PERMISSION_LEVEL_TONE).toEqual({
      all: "danger",
      partial: "attention",
      "read-only": "success",
      off: "muted",
    });
  });

  it("draws each level with its own mark, so the level never depends on colour alone", () => {
    const glyphs = Object.values(PERMISSION_LEVEL_GLYPH);
    expect(glyphs).toHaveLength(4);
    expect(new Set(glyphs).size).toBe(4);
    // lucide's shield family: the three that keep the whole outline start with it.
    for (const level of ["all", "partial", "read-only"] as const) {
      expect(PERMISSION_LEVEL_GLYPH[level].startsWith(SHIELD)).toBe(true);
    }
  });
});
