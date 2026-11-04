/**
 * `unzipBounded`, the caps every zip import of Skills and Benchmarks reads off the central
 * directory, as they apply to directory entries: those carry no content, yet fflate inflates
 * whatever bytes an accepted entry holds, whatever its name.
 *
 * - A directory entry within the caps is never inflated: the files come back, the directory
 *   entry does not, however many bytes it holds.
 * - Directory entries count towards the entry limit: an archive of one file and directories past
 *   it is refused.
 *
 * A directory entry past the per-entry cap is the Skills archive route's scenario
 * (skills.test.ts), where the refusal reaches the user.
 */
import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { MAX_ARCHIVE_FILES, unzipBounded } from "../src/services/skill-import-limits.js";

describe("unzipBounded and directory entries", () => {
  it("a directory entry within the caps is never inflated, however many bytes it holds", () => {
    const zip = zipSync({
      "s/SKILL.md": strToU8("skill"),
      "s/pad/": new Uint8Array(1024 * 1024),
    });

    const entries = unzipBounded(zip);

    expect(Object.keys(entries)).toEqual(["s/SKILL.md"]);
    expect(strFromU8(entries["s/SKILL.md"]!)).toBe("skill");
  });

  it("directory entries count towards the entry limit", () => {
    const files: Record<string, Uint8Array> = { "s/SKILL.md": strToU8("skill") };
    for (let i = 0; i < MAX_ARCHIVE_FILES; i++) files[`s/d${i}/`] = new Uint8Array(0);

    let refusal: unknown;
    try {
      unzipBounded(zipSync(files));
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal).toMatchObject({
      status: 400,
      message: expect.stringContaining(`${MAX_ARCHIVE_FILES}-entry limit`),
    });
  });
});
