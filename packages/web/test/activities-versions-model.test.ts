import { describe, expect, it } from "vitest";
import type { VersionSummary } from "@prismshadow/penguin-server/api";
import {
  VERSION_NAME_MAX,
  kindText,
  saveAnnouncement,
  sizeText,
  versionName,
  versionRows,
} from "../src/features/activities/versions-model";

const version = (seq: number, extra: Partial<VersionSummary> = {}): VersionSummary => ({
  versionId: `ver_${seq}`,
  seq,
  label: null,
  kind: "manual",
  reason: null,
  createdAt: `2026-09-25T00:00:0${seq}.000Z`,
  author: "author",
  mediaBytes: 0,
  current: false,
  deployed: { qa: null, prod: null },
  ...extra,
});

describe("versionRows", () => {
  it("lists newest first, numbered, with a name, kind, author, size and the current one", () => {
    const rows = versionRows([
      version(1, { label: "First", mediaBytes: 2048 }),
      version(3, { kind: "auto", reason: "before_proposal", author: null, current: true }),
      version(2),
    ]);
    expect(rows.map((row) => row.number)).toEqual(["v3", "v2", "v1"]);
    expect(rows[0]).toEqual({
      versionId: "ver_3",
      seq: 3,
      number: "v3",
      name: null,
      kind: "Automatic · Before an agent's proposal",
      createdAt: "2026-09-25T00:00:03.000Z",
      author: "Penguin",
      size: "None",
      current: true,
    });
    expect(rows[2]).toMatchObject({ name: "First", kind: "Saved", size: "2.0 KB", current: false });
  });

  it("is empty for no versions", () => {
    expect(versionRows([])).toEqual([]);
  });
});

describe("kindText and sizeText", () => {
  it("names every kind, and the reason only when there is one", () => {
    expect(kindText({ kind: "manual", reason: null })).toBe("Saved");
    expect(kindText({ kind: "restore", reason: null })).toBe("Restore");
    expect(kindText({ kind: "deploy", reason: null })).toBe("Deploy");
    expect(kindText({ kind: "auto", reason: "before_restore" })).toBe(
      "Automatic · Before a restore",
    );
  });

  it("reads sizes like the media library does, and says None for no media", () => {
    expect(sizeText(0)).toBe("None");
    expect(sizeText(512)).toBe("512 B");
    expect(sizeText(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("versionName", () => {
  it("trims, sends null for an empty name, and refuses one that is too long", () => {
    expect(versionName("  Before review  ")).toEqual({ name: "Before review", problem: null });
    expect(versionName("   ")).toEqual({ name: null, problem: null });
    expect(versionName("x".repeat(VERSION_NAME_MAX))).toEqual({
      name: "x".repeat(VERSION_NAME_MAX),
      problem: null,
    });
    expect(versionName("x".repeat(VERSION_NAME_MAX + 1)).problem).toBe(
      "A name can be at most 80 characters.",
    );
  });
});

describe("saveAnnouncement", () => {
  it("follows the server's word on whether a version was made, not the list", () => {
    expect(saveAnnouncement({ version: version(3), created: true })).toEqual({
      kind: "success",
      text: "Saved version v3.",
    });
    expect(saveAnnouncement({ version: version(2), created: false })).toEqual({
      kind: "info",
      text: "Nothing changed since v2, so no new version was saved.",
    });
  });
});
