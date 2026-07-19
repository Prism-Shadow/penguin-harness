/**
 * Semantic id rules (matches the server's services/ids.ts; the contract
 * package only exposes the type, this regex mirrors it): starts with a
 * lowercase letter, contains only lowercase letters, digits, and
 * underscores, 2-64 characters. The hyphen is a reserved separator — it
 * only appears at the join point of a non-admin project_id's
 * `<username>-<suffix>`; usernames never contain a hyphen, so the
 * namespaces don't overlap.
 */
export const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/** Username: same character rules, length tightened to 2-32 (leaves room for the default Project id `<username>-default_project`). */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

/** Suffix segment of a non-admin project_id (after `<username>-`): lowercase letters, digits, and underscores only. */
export const PROJECT_SUFFIX_PATTERN = /^[a-z0-9_]+$/;

/** Maximum total length of project_id. */
export const PROJECT_ID_MAX_LENGTH = 64;
