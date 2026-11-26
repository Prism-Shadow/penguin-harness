/**
 * The Skills installed on one Agent, by name (PRFC-0036's read views): what a server module reads
 * to show an Agent's Skills, or to say which Skill a task needs that the Agent lacks.
 *
 * A Skill is a `skills/<name>/` folder of the Agent State that holds a SKILL.md, named by its
 * folder — the identity install and uninstall address it by, as core's `listInstalledSkills`
 * says. A dot-prefixed folder is an install being staged, never a Skill. Only names are read: no
 * SKILL.md is opened, so the answer costs one directory listing and a check per folder.
 *
 * Moved from the server's services/agent-skills.ts beside the AgentConfig contract and the
 * agent config service it asks (services+http+cli restack S10). The `AgentSkills` interface
 * class stays on the server (services/agent-skills.ts): a plugin requires it under the host's
 * own key, so the declaration is part of the host's face.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isValidId, skillsDir } from "@prismshadow/penguin-core";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { badRequest } from "@prismshadow/penguin-library-http/validate";
import type { AgentConfig } from "./contract.js";
import type { AgentPaths } from "./ports.js";

@Component({
  name: "InstalledAgentSkillsImpl",
  key: "@prismshadow/penguin-server#InstalledAgentSkills",
})
export class InstalledAgentSkills {
  @Use() private readonly paths!: AgentPaths;
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
