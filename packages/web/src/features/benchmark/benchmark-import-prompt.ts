/**
 * The prompt behind the import dialog's recommended path (pure logic, unit tested): whatever the
 * user pasted — a folder link in a repository such as Prism-Shadow/penguin-harness-benchmark, a
 * local path, or a description of a Benchmark — becomes a lead sentence for its kind, followed by
 * the fixed tail that tells the Agent what a package is, to pin the fetch to one commit, where the
 * copy goes and what it is written with. The server never fetches the link: the Agent does, in a
 * conversation the user starts by sending the draft. Reads S at call time (live binding), so the
 * prompt follows a language switch like every other string consumer.
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { composeAiPrompt, pickDefaultAgent } from "../ai-create";
import type { AiChatRequest } from "../ai-create";
import { classifyImportSource } from "../agents/skill-import-source";

/** What the pasted source is, as far as the prompt's lead sentence cares. */
export type BenchmarkSourceKind = "repoFolderUrl" | "localPath" | "reference";

/**
 * Lightly classifies a pasted source with the Skills import's heuristic: a link on a code host
 * (or any git remote) is a repository folder, a filesystem path is a local path, and anything
 * else — a web page, a name, a description — is a reference the Agent has to find. A miss only
 * picks a different lead sentence; the tail is the same for all three.
 */
export function classifyBenchmarkSource(input: string): BenchmarkSourceKind {
  const kind = classifyImportSource(input);
  if (kind === "repoUrl") return "repoFolderUrl";
  if (kind === "localPath") return "localPath";
  return "reference";
}

/** The whole prompt for one source in Project `projectId`: the lead, then the tail after a blank line. */
export function buildBenchmarkImportPrompt(input: string, projectId: string): string {
  const source = input.trim();
  return composeAiPrompt(
    S.benchmark.importPromptLead[classifyBenchmarkSource(source)](source),
    S.benchmark.importPromptTail(projectId),
  );
}

/**
 * The draft "Open a new chat" asks for: the prompt for `input`, to the Project's default Agent —
 * the one that carries the preinstalled agent-tuning plugin, whose benchmark-design Skill tells it
 * how to import a package. Null when there is nothing to send (no source) or no Agent to send it to.
 */
export function benchmarkImportChat(
  input: string,
  projectId: string,
  agents: readonly AgentSummary[],
): AiChatRequest | null {
  const agent = pickDefaultAgent(agents);
  if (agent === null || input.trim() === "") return null;
  return { agentId: agent.agentId, text: buildBenchmarkImportPrompt(input, projectId) };
}
