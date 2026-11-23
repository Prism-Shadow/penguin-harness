import type {
  AgentPluginsInstallResponse,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import type { ServerClient } from "@prismshadow/penguin-server/cli";

const builtins = new Set([
  "exit",
  "quit",
  "thinking",
  "switch-model",
  "verbose",
  "compact",
  "clear",
  "goal",
]);

function agentPlugins(projectId: string, agentId: string) {
  return (
    "/api/projects/" +
    encodeURIComponent(projectId) +
    "/agents/" +
    encodeURIComponent(agentId) +
    "/plugins"
  );
}

/** An ordinary CLI line may name one installed composer mode, followed by its message. */
export async function composerModeCommand(
  client: ServerClient,
  projectId: string,
  agentId: string,
  line: string,
): Promise<{ name: string; command: string; body: string } | null> {
  const token = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(line);
  if (!token || builtins.has(token[1]!)) return null;
  const command = token[1]!;
  const library = await client.request<PluginLibraryResponse>("GET", "/api/plugins");
  const candidates = library.groups
    .flatMap((g) => g.plugins)
    .filter((p) => p.composerMode && p.composerCommand === command);
  if (candidates.length === 0) return null;
  const installed = await client.request<AgentPluginsInstallResponse>(
    "GET",
    agentPlugins(projectId, agentId),
  );
  if (installed.skills.some((s) => s.name === command)) return null;
  const mode = candidates.find((p) => installed.hooks.some((h) => h.name === p.name));
  return mode ? { name: mode.name, command, body: token[2] ?? "" } : null;
}
