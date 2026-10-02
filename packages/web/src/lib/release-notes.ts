/**
 * Release notes: what each released version brought, a few short lines per language, as the App
 * info dialog's "What's new" section lists them. The entries live in `release-notes-data.ts`.
 *
 * They are bundled rather than fetched: the desktop app has to show them offline, and a browser
 * signed into a self-hosted server has no reason to call GitHub to read what is new. They are
 * editorial text, not an extract of `changelog/<version>/RELEASE.md` — that file is English-only
 * and long-form, and some released tags have none.
 *
 * The data file is edited only at release preparation, in the same commit that writes the
 * release's `RELEASE.md` and adds its line to `CHANGELOG.md`; an ordinary change never touches it,
 * so it is not a file every PR edits. The dialog sorts the entries itself, so a new one may be
 * added at either end.
 *
 * The rules for an entry:
 *
 * - 1–5 lines per language — two to five for a release; a version that shipped no installers of
 *   its own (an npm-only tag) says in one line where its content went — with zh and en mirroring
 *   each other line for line.
 * - A tag that published nothing at all (a release run that failed before any upload) has no
 *   entry: no one can be running it.
 * - The App Store "What's New" register: what a user gets, no internal names, no backticks (the
 *   lines render as plain text, not Markdown).
 * - The docs' typography: a space between CJK and Latin letters or digits, full-width punctuation
 *   in zh, "Agent" capitalized in zh and "agent" lowercase in en.
 *
 * Pure helpers only (vitest runs node-only here, so nothing renders).
 */
import { RELEASE_NOTES } from "./release-notes-data";

export interface ReleaseNote {
  /** Plain semver, no "v". */
  readonly version: string;
  /** The release line's date in CHANGELOG.md (yyyy-mm-dd); a tag-only version uses its tag date. */
  readonly date: string;
  /** 1–5 short user-facing lines per language; zh and en mirror each other line for line. */
  readonly zh: readonly string[];
  readonly en: readonly string[];
}

/** The numeric parts of a version's dotted core: `0.2.10-beta.1` → [0, 2, 10]. */
function versionCore(version: string): number[] {
  const core = version.split(/[-+]/, 1)[0] ?? "";
  return core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

/** Numeric semver compare on the dotted core; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const x = versionCore(a);
  const y = versionCore(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const delta = (x[i] ?? 0) - (y[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** The notes newest first, whatever order the data file lists them in. */
export function releaseNotesNewestFirst(
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote[] {
  return [...notes].sort((a, b) => compareVersions(b.version, a.version));
}

/** One note's lines in the reader's language. */
export function noteLines(note: ReleaseNote, locale: "zh" | "en"): readonly string[] {
  return locale === "en" ? note.en : note.zh;
}
