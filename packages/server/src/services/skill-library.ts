/**
 * Library Skill lookup shared by every surface that installs from the built-in library: the
 * Skills tab's install route and Agent creation's seed list. Both resolve the whole batch of
 * names before a single file is written, so an unknown name leaves nothing half-installed.
 *
 * It also owns `toMetadataItem`, the one projection from a Skill onto the wire type. Every
 * endpoint that describes a Skill goes through it, so a field added to `SkillMetadata` cannot
 * start leaking out of one endpoint while the others correctly withhold it.
 */
import { librarySkill } from "@prismshadow/penguin-skills";
import type { LibrarySkill, SkillMetadata } from "@prismshadow/penguin-skills";
import type { SkillMetadataItem } from "../api/types.js";
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

/**
 * Strips a Skill down to what the API sends: the full body is written to disk on install and
 * read by the model on demand, never shipped in a listing. An allowlist rather than a
 * strip-these-two spread, so a new `SkillMetadata` field is withheld until someone adds it here
 * on purpose. The optional short description (shortDescription(Zh)) and custom icon (icon.svg
 * source) are conditionally passed through — the library side (LibrarySkill), the installed side
 * (core InstalledSkill) and the directory side all carry these fields.
 */
export function toMetadataItem(skill: SkillMetadata & { icon?: string }): SkillMetadataItem {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
    ...(skill.shortDescriptionZh !== undefined
      ? { shortDescriptionZh: skill.shortDescriptionZh }
      : {}),
    ...(skill.icon !== undefined ? { icon: skill.icon } : {}),
    version: skill.version,
    updated: skill.updated,
  };
}
