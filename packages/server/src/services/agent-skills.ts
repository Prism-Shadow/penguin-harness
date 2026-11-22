/**
 * The Skills installed on one Agent, by name (PRFC-0036's read views): what a server module reads
 * to show an Agent's Skills, or to say which Skill a task needs that the Agent lacks.
 *
 * A Skill is a `skills/<name>/` folder of the Agent State that holds a SKILL.md, named by its
 * folder — the identity install and uninstall address it by, as core's `listInstalledSkills`
 * says. A dot-prefixed folder is an install being staged, never a Skill. Only names are read: no
 * SKILL.md is opened, so the answer costs one directory listing and a check per folder.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isValidId, skillsDir } from "@prismshadow/penguin-core";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import { badRequest } from "../http/errors.js";
import type { AgentConfig } from "../mechanisms/agents.js";

/** AgentSkills: what InstalledAgentSkills implements, and a server module reaches through the plugin face. */
@Interface()
export abstract class AgentSkills {
  /**
   * The names of the Skills installed on the Agent, sorted. 400 for an id that is not one plain
   * segment, 404 `agent_not_found` for an Agent the Project does not have. Callers check the
   * caller's access to the Project first; this does not.
   */
  abstract installedSkills(projectId: string, agentId: string): Promise<string[]>;
}

@Component()
export class InstalledAgentSkills implements AgentSkills {
  @Use() private readonly paths!: Paths;
  @Use() private readonly agentConfig!: AgentConfig;

  async installedSkills(projectId: string, agentId: string): Promise<string[]> {
    if (!isValidId(projectId) || !isValidId(agentId)) {
      throw badRequest("projectId and agentId must be letters, digits, '_' and '-' only.");
    }
    await this.agentConfig.requireExists(projectId, agentId);
    const dir = skillsDir(this.paths.root, projectId, agentId);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skill = await fs.stat(path.join(dir, entry.name, "SKILL.md")).catch(() => null);
      if (skill?.isFile() === true) names.push(entry.name);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }
}
