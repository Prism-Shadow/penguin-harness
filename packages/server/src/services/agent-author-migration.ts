/**
 * One-time migration of Agent authors: every organization employee whose system_config.yaml
 * has no `author` gets `author: company`.
 *
 * Agents made before `author` existed carry none, and a missing author reads as `user`. For an
 * employee that is wrong: company mode made it (the CEO of an organization, a hire), so on
 * upgrade the Agents page would file every employee under the people's Agents. The fix is
 * written once, on the first Agent listing that sees the employee, in place (comments and
 * formatting kept); an author already in the file is never touched, so a later edit to `user`
 * sticks, and an Agent no organization employs is left alone. An employee the chart names but
 * whose folder has no config gets no file.
 *
 * Remove at the next major release (1.0) — this module, its call in the Agent list route
 * (http/routes/agents.ts) and `AgentConfig.stampMissingAuthor` — once every install has
 * listed its Agents on a build that carries it.
 */
import type { AgentConfig } from "../mechanisms/agents.js";

export async function migrateEmployeeAuthors(
  config: Pick<AgentConfig, "stampMissingAuthor">,
  projectId: string,
  employeeIds: readonly string[],
): Promise<void> {
  for (const agentId of employeeIds) {
    // One unreadable config must not fail the list of all of them; the next listing retries.
    await config.stampMissingAuthor(projectId, agentId, "company").catch(() => false);
  }
}
