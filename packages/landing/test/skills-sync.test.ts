/**
 * Landing ↔ plugin-library sync: the home page's Skills section presents the built-in skills,
 * so every skill that ships in a packages/plugins plugin has to appear in both dictionaries and
 * nothing else may (hook packages are not skills and are not listed there). Derived from the
 * library directories — the same source docs' skills-sync test reads — so shipping a skill
 * without listing it here fails instead of leaving the section quietly short.
 *
 * Membership only, not order and not which card a skill sits in: the categories are the
 * plugin manifests' call, pinned in packages/plugins' own tests, and a reordering inside a card
 * is not a regression worth a red suite.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zh } from "../src/lib/strings";
import type { Strings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const pluginsRoot = join(__dirname, "..", "..", "..", "plugins");

/** Every skill directory under every plugin's skills/ (a plugin may ship none). */
const librarySkills = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((plugin) => plugin.isDirectory() && existsSync(join(pluginsRoot, plugin.name, "skills")))
  .flatMap((plugin) =>
    readdirSync(join(pluginsRoot, plugin.name, "skills"), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(join(pluginsRoot, plugin.name, "skills", entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name),
  )
  .sort();

/** Every Skill name a dictionary's Skills section renders, flattened across its cards. */
const listedSkills = (dict: Strings): string[] =>
  dict.skills.groups.flatMap((group) => group.skills);

const DICTIONARIES: ReadonlyArray<{ file: string; dict: Strings }> = [
  { file: "strings.ts", dict: zh },
  { file: "strings-en.ts", dict: en },
];

describe("landing ↔ skill library sync", () => {
  it("found the skill library", () => {
    expect(librarySkills.length).toBeGreaterThan(0);
  });

  for (const { file, dict } of DICTIONARIES) {
    it(`${file}'s Skills section lists exactly the library`, () => {
      const listed = listedSkills(dict);
      expect(
        librarySkills.filter((name) => !listed.includes(name)),
        `Skills that ship but are missing from ${file}`,
      ).toEqual([]);
      expect(
        listed.filter((name) => !librarySkills.includes(name)).sort(),
        `Skills listed in ${file} that no longer ship`,
      ).toEqual([]);
    });

    it(`${file} names each Skill once`, () => {
      const listed = listedSkills(dict);
      expect(
        listed.filter((name, index) => listed.indexOf(name) !== index).sort(),
        `Skills listed in more than one group in ${file}`,
      ).toEqual([]);
    });
  }

  /**
   * Card by card rather than as one flat list: the two dictionaries render the same cards
   * in the same order, so a Skill that moves card in one language and not the other is drift a
   * flattened comparison cannot see. Membership inside a card only — the chips are free to be
   * reordered.
   */
  it("both dictionaries put each Skill on the same card", () => {
    const cards = (dict: Strings): string[][] =>
      dict.skills.groups.map((group) => [...group.skills].sort());
    expect(cards(en)).toEqual(cards(zh));
  });
});
