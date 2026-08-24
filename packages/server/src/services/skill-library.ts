/**
 * Library Skill lookup shared by every surface that installs from the built-in library: the
 * Skills tab's install route and Agent creation's seed list. Both resolve the whole batch of
 * names before a single file is written, so an unknown name leaves nothing half-installed.
 */
import { librarySkill } from "@prismshadow/penguin-skills";
import type { LibrarySkill } from "@prismshadow/penguin-skills";
import { HttpError } from "../http/errors.js";

/**
 * Resolves library Skill names to their entries, in the order given. Throws 404 `unknown_skill`
 * on the first name the library does not carry — the caller is expected to run this before it
 * creates or writes anything.
 */
export function resolveLibrarySkills(names: readonly string[]): LibrarySkill[] {
  return names.map((name) => {
    const skill = librarySkill(name);
    if (!skill) throw new HttpError(404, "unknown_skill", `Skill is not in the library: ${name}`);
    return skill;
  });
}
