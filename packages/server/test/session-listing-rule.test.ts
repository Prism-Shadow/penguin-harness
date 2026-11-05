/**
 * The listing rule: which list a Session is in, computed on every read from its source and the
 * user's two marks, so nothing on disk is rewritten to move a Session between lists.
 *
 * - A person's conversation is active until the user archives it.
 * - A Session a program opened (api / schedule / cli) is archived with nothing written.
 * - Once the user unarchives it (the keep mark), it is active; archived again, it is archived.
 * - A subagent or company Session is in no list, whatever marks its row carries.
 * - A row whose Trace has not been read yet (no source known) is active, as a person's would be.
 */
import { describe, expect, it } from "vitest";
import type { SessionSource } from "../src/api/types.js";
import { listCategory } from "../src/runtime/session-sources.js";

const unmarked = { archivedAt: null, keptAt: null };
const archived = { archivedAt: "2026-10-11T08:00:00.000Z", keptAt: null };
const kept = { archivedAt: null, keptAt: "2026-10-11T09:00:00.000Z" };

describe("the listing rule", () => {
  it("lists a person's conversation as active until the user archives it", () => {
    expect(listCategory("user", unmarked)).toBe("active");
    expect(listCategory("user", archived)).toBe("archived");
  });

  it.each(["api", "schedule", "cli"] as const)(
    "files a %s Session away with nothing written, until the user keeps it",
    (source) => {
      expect(listCategory(source, unmarked)).toBe("archived");
      expect(listCategory(source, kept)).toBe("active");
      // Archived again by the user: the archive mark replaced the keep mark.
      expect(listCategory(source, archived)).toBe("archived");
    },
  );

  it.each(["subagent", "company"] as const)(
    "lists a %s Session nowhere, whatever its marks",
    (source: SessionSource) => {
      for (const marks of [unmarked, archived, kept])
        expect(listCategory(source, marks)).toBe(null);
    },
  );

  it("lists a row whose Trace has not been read yet as active", () => {
    expect(listCategory(undefined, unmarked)).toBe("active");
    expect(listCategory(undefined, archived)).toBe("archived");
  });
});
