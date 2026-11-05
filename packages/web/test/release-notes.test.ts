/**
 * Release notes, as the App info dialog reads them (lib/release-notes.ts).
 *
 * - Given entries in any order, the dialog lists them newest first, and 0.2.10 sorts above 0.2.9.
 * - Given a locale, a note's lines are that language's.
 * - Every shipped entry has 1–5 lines in both languages and a yyyy-mm-dd date, and no version is
 *   listed twice — the one guard on the data file, which the type system cannot hold.
 */
import { describe, expect, it } from "vitest";
import { noteLines, releaseNotesNewestFirst } from "../src/lib/release-notes";
import type { ReleaseNote } from "../src/lib/release-notes";
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

  it("every shipped entry has 1–5 lines per language and a calendar date, and no version twice", () => {
    for (const entry of RELEASE_NOTES) {
      expect(entry.zh.length, `${entry.version} zh`).toBeGreaterThanOrEqual(1);
      expect(entry.zh.length, `${entry.version} zh`).toBeLessThanOrEqual(5);
      expect(entry.en.length, `${entry.version} en`).toBeGreaterThanOrEqual(1);
      expect(entry.en.length, `${entry.version} en`).toBeLessThanOrEqual(5);
      expect(entry.date, entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const versions = RELEASE_NOTES.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
