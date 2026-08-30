/**
 * Sandbox command-policy routes: GET|PUT /api/projects/:p/command-policy (the
 * `[command_policy]` block of .project_config.toml). Any member can read (the settings
 * dialog shows the effective policy); only the owner can replace it — it is Project-owned
 * security config, deliberately outside the Agent State an Agent edits for itself. The rules are
 * plain data: the factory set is seeded into new projects (and served to pre-seeding
 * projects that store none), and a PUT always carries the full rule list, materializing it
 * into the file model-presets style.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { readJson, requireValidId } from "../validate.js";
import type { Access, ProjectConfigStore } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface CommandPolicyRouteDeps {
  projectConfigService: ProjectConfigStore;
  access: Access;
}

/** Bounds for the rule list: enough for a serious deny list, small enough to stay a config file. */
const MAX_RULES = 64;
const MAX_RULE_NAME_LEN = 64;
const MAX_RULE_PATTERN_LEN = 512;
const MAX_RULE_DESCRIPTION_LEN = 300;

/** The validated shape a PUT rule reduces to. */
interface RuleInput {
  name: string;
  pattern: string;
  description?: string;
  enabled?: boolean;
}

/**
 * Validates the `rules` array: every entry needs a non-empty name and a pattern that
 * actually compiles — an uncompilable pattern would be silently skipped at match time
 * (core's tolerant reader), turning a typo into a rule that never fires. Rejecting it here
 * keeps "saved" equal to "enforced".
 */
function validateRules(value: unknown): RuleInput[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_rules", "rules must be an array.");
  }
  if (value.length > MAX_RULES) {
    throw new HttpError(400, "invalid_rules", `rules exceeds ${MAX_RULES} entries.`);
  }
  const rules: RuleInput[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "invalid_rules", "Each rule must be an object.");
    }
    const { name, pattern, description, enabled } = entry as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "" || name.length > MAX_RULE_NAME_LEN) {
      throw new HttpError(
        400,
        "invalid_rules",
        `Each rule needs a non-empty name of at most ${MAX_RULE_NAME_LEN} characters.`,
      );
    }
    if (typeof pattern !== "string" || pattern === "" || pattern.length > MAX_RULE_PATTERN_LEN) {
      throw new HttpError(
        400,
        "invalid_rules",
        `Each rule needs a non-empty pattern of at most ${MAX_RULE_PATTERN_LEN} characters.`,
      );
    }
    try {
      new RegExp(pattern);
    } catch {
      throw new HttpError(
        400,
        "invalid_rule_pattern",
        `Rule "${name.trim()}" has an invalid regular expression: ${pattern}`,
      );
    }
    if (description !== undefined && typeof description !== "string") {
      throw new HttpError(400, "invalid_rules", "A rule description must be a string.");
    }
    const desc = typeof description === "string" ? description.trim() : "";
    if (desc.length > MAX_RULE_DESCRIPTION_LEN) {
      throw new HttpError(
        400,
        "invalid_rules",
        `A rule description is at most ${MAX_RULE_DESCRIPTION_LEN} characters.`,
      );
    }
    if (enabled !== undefined && typeof enabled !== "boolean") {
      throw new HttpError(400, "invalid_rules", "A rule's enabled must be a boolean.");
    }
    rules.push({
      name: name.trim(),
      pattern,
      ...(desc !== "" ? { description: desc } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });
  }
  return rules;
}

export function commandPolicyRoutes(deps: CommandPolicyRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.projectConfigService.getCommandPolicy(projectId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);

    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new HttpError(400, "invalid_enabled", "enabled must be a boolean.");
    }
    // The full list is required: a PUT is the materialization point (an empty array is a
    // deliberate "no rules", distinct from omitting the field by mistake).
    const rules = validateRules(body.rules);

    return c.json(
      await deps.projectConfigService.setCommandPolicy(projectId, {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        rules,
      }),
    );
  });

  return app;
}
