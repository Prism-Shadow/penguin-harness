/**
 * `/switch-model` — the chat REPL's in-session model switch (pure logic, unit-tested).
 *
 * Syntax: `/switch-model <provider> <model_id>`. The target is the explicit
 * `(provider, model_id)` pair, never inferred — the same rule `--provider` / `--model-id`
 * follow. Both tokens are taken verbatim (case preserved) and split on whitespace: an
 * upstream model id may carry slashes or colons (`anthropic/claude-opus-5` under
 * `openrouter`, `accounts/fireworks/models/…` under `fireworks`) but never whitespace, so a
 * third token is a usage error rather than part of the id. Bare `/switch-model` shows the
 * current model.
 *
 * The switch itself is `POST /api/sessions/:id/switch-model`: the server compacts on the
 * current model first (always summarizing), then opens the next context on the target; a
 * Session that never ran switches inline.
 */
import { DEFAULT_PROJECT_ID } from "@prismshadow/penguin-core";
import type { Messages } from "./i18n.js";

/** A model reference as the server API spells it. */
export interface ModelTarget {
  provider: string;
  modelId: string;
}

export type SwitchModelCommandResult =
  /** `target` null = bare `/switch-model`: show the current model. */
  { ok: true; target: ModelTarget | null } | { ok: false };

/** Parses a full `/switch-model…` chat line (the caller has already matched the prefix). */
export function parseSwitchModelCommand(line: string): SwitchModelCommandResult {
  const rest = line.trim().slice("/switch-model".length).trim();
  if (rest === "") return { ok: true, target: null };
  const tokens = rest.split(/\s+/);
  if (tokens.length !== 2) return { ok: false };
  return { ok: true, target: { provider: tokens[0]!, modelId: tokens[1]! } };
}

/** How the REPL names a model in its lines: the upstream id, then its provider group. */
export function formatModelLabel(provider: string, modelId: string): string {
  return `${modelId} (${provider})`;
}

/**
 * The one line a 409 refusal of the switch prints, localized by its code; null for a code
 * this client does not know (the caller prints the server's own message instead).
 * `projectId` is the Session's Project: the `penguin config model` commands named for an
 * unconfigured target carry `--project-id` when it is not the default one.
 */
export function switchModelRefusal(
  err: { code: string; detail: string },
  target: ModelTarget,
  projectId: string,
  t: Messages,
): string | null {
  const label = formatModelLabel(target.provider, target.modelId);
  const projectFlag = projectId === DEFAULT_PROJECT_ID ? "" : ` --project-id ${projectId}`;
  switch (err.code) {
    case "task_in_progress":
    case "compacting":
      return t.switchModelBusy();
    case "same_model":
      return t.switchModelSame(label);
    case "model_not_configured":
      return t.switchModelNotConfigured(
        label,
        `penguin config model list${projectFlag}`,
        `penguin config model add --provider ${target.provider} --model-id ${target.modelId}${projectFlag}`,
      );
    case "model_unavailable":
      return t.switchModelUnavailable(label, err.detail);
    case "compaction_not_configured":
      return t.switchModelNoCompaction();
    default:
      return null;
  }
}
