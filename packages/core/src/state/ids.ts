/**
 * The id rule: what a Project, an Agent, a Session or a skill may be named. Its own module, with
 * no imports, so a code plugin that checks an id (through `@prismshadow/penguin-core/plugin`)
 * bundles this file and nothing of the SDK around it.
 */

/** project_id / agent_id / skill_name only allow letters, digits, underscore `_`, and hyphen `-` (prevents path traversal). */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export type IdKind = "project_id" | "agent_id" | "skill_name";

/**
 * The semantic id rule a creator-typed id answers (`org`, `channel`, `agent`, `project`):
 * starts with a lowercase letter, then lowercase letters, digits and underscores, 2–64 chars.
 * The vocabulary beside the id rule, so every domain that names a thing with one — the
 * organization files and the server's semantic-id service alike — reads the same pattern.
 */
export const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function assertValidId(kind: IdKind, id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid ${kind} ${JSON.stringify(id)}: only letters, digits, "_" and "-" are allowed.`,
    );
  }
}
