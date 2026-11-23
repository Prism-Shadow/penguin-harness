/**
 * Release notes, as the App info dialog reads them (lib/release-notes.ts).
 *
 * - Given entries in any order, the dialog lists them newest first, and 0.2.10 sorts above 0.2.9.
 * - Given a locale, a note's lines are that language's.
 * - No shipped version is listed twice: the one rule on the data file the type system cannot
 *   hold (`ReleaseNote` holds the 1–5 lines per language and the date's shape).
 */
import { describe, expect, it } from "vitest";
import { noteLines, releaseNotesNewestFirst, type ReleaseNote } from "../src/lib/release-notes";

import { RELEASE_NOTES } from "../src/lib/release-notes-data";

const note = (version: string): ReleaseNote => ({
  version,
  date: "2026-09-15",
  zh: [`zh line of ${version}`],
  en: [`en line of ${version}`],
});

describe("release notes", () => {
  it("entries in any order list newest first, with 0.2.10 above 0.2.9", () => {
    const scrambled = [note("0.2.9"), note("0.2.10"), note("0.1.5")];

    expect(releaseNotesNewestFirst(scrambled).map((n) => n.version)).toEqual([
      "0.2.10",
      "0.2.9",
      "0.1.5",
    ]);
  });

  it("a note's lines are the reader's language", () => {
    const entry = note("0.2.13");

    expect(noteLines(entry, "en")).toEqual(["en line of 0.2.13"]);
    expect(noteLines(entry, "zh")).toEqual(["zh line of 0.2.13"]);
  });

  it("lists no shipped version twice", () => {
    const versions = RELEASE_NOTES.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
