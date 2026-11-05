/**
 * The import dialog's migration path: the coding-agent frameworks an Agent can be moved in from,
 * the user directory each keeps its setup in, and the prompt the new conversation starts with.
 *
 * The prompt names the framework, the source — what was typed, or the framework's directory
 * while nothing is — and the Project, and leaves the mapping itself to the `agent-porting`
 * Skill, so a framework that changes its layout needs a Skill edit rather than a release of
 * this page. Reads S at call time (live binding), so it follows a language switch.
 */
import { S } from "../../lib/strings";

/** The frameworks the dialog offers, in its order; `other` is a source it has no directory for. */
export const MIGRATION_SOURCES = [
  "claude-code",
  "codex",
  "deepseek-harness",
  "qoder",
  "qwen-code",
  "workbuddy",
  "other",
] as const;
export type MigrationSource = (typeof MIGRATION_SOURCES)[number];

/** Where each framework keeps its user-level setup: the path field's placeholder and default. */
export const SOURCE_HOME: Readonly<Record<MigrationSource, string | null>> = {
  "claude-code": "~/.claude",
  codex: "~/.codex",
  "deepseek-harness": "~/.dsh",
  qoder: "~/.qoder",
  "qwen-code": "~/.qwen",
  workbuddy: "~/.workbuddy-ai",
  other: null,
};

/**
 * The prompt for `source` with `typed` in the path field, for `projectId`; null for `other` with
 * nothing typed, which has no directory to fall back on.
 */
export function migrationPrompt(
  source: MigrationSource,
  typed: string,
  projectId: string,
): string | null {
  const read = typed.trim() || SOURCE_HOME[source];
  if (read === null) return null;
  const framework = source === "other" ? null : S.agent.migrateFrameworks[source];
  return S.agent.migratePrompt(framework, read, projectId);
}
