/**
 * `unzipBounded`, the caps every zip import of Skills and Benchmarks reads off the central
 * directory, as they apply to directory entries: those carry no content, yet fflate inflates
 * whatever bytes an accepted entry holds, whatever its name.
 *
 * - A directory entry is never inflated nor returned, and no cap counts it: one holding more than
 *   the per-file cap is not refused, and only the files come back.
 * - An archive with more directory entries than the file limit, plus a few files, reads: the
 *   files come back and nothing else.
 *
 * That nothing is inflated is measured where a user sends the zip: the Skills and plugin archive
 * routes (skills.test.ts, plugin-archive.test.ts).
 */
import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_ARCHIVE_FILES, unzipBounded } from "../src/services/skill-import-limits.js";

describe("unzipBounded and directory entries", () => {
  it("a directory entry is never inflated nor returned, not even one past the per-file cap", () => {
    const zip = zipSync({
      "s/SKILL.md": strToU8("skill"),
      "s/pad/": new Uint8Array(6 * 1024 * 1024),
    });

    const entries = unzipBounded(zip);

    expect(Object.keys(entries)).toEqual(["s/SKILL.md"]);
    expect(strFromU8(entries["s/SKILL.md"]!)).toBe("skill");
  });

  it("more directory entries than the file limit, plus a few files, read as just the files", () => {
    const files: Record<string, Uint8Array> = {
      "s/SKILL.md": strToU8("skill"),
      "s/ref/notes.md": strToU8("notes"),
    };
    for (let i = 0; i <= MAX_ARCHIVE_FILES; i++) files[`s/d${i}/`] = new Uint8Array(0);

    const entries = unzipBounded(zipSync(files));

    expect(Object.keys(entries).sort()).toEqual(["s/SKILL.md", "s/ref/notes.md"]);
  });
});
