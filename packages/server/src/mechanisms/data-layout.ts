/**
 * Where things live on the data root: what a node may require to build a path into a Project, an
 * Agent or the server's own folders, declared apart from what implements it
 * (services/data-layout.ts).
 *
 * Every path is absolute and comes from the helpers that define the layout — core's and the
 * server's — so a reader that walks the root through this interface follows the layout wherever
 * a folder moves (Projects under a `projects/` level, say) with no edit of its own. A code plugin
 * reaches it through the plugin face; it never joins a folder name onto the root itself.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** DataLayout: the data root's folders, as RootDataLayout builds them. */
@Interface()
export abstract class DataLayout {
  /** The data root. */
  abstract root(): string;
  /** The folder every Project's folder sits in, one per id. */
  abstract projectsDir(): string;
  abstract projectDir(projectId: string): string;
  /** A Project's config file (`.project_config.toml`). */
  abstract projectConfigPath(projectId: string): string;
  /** The folder a Project's Agents sit in, one per id. */
  abstract agentsDir(projectId: string): string;
  abstract agentDir(projectId: string, agentId: string): string;
  abstract tracesDir(projectId: string, agentId: string): string;
  /** The Agent State: what the Agent may edit (`agent_state/`). */
  abstract agentStateDir(projectId: string, agentId: string): string;
  /** The Agent State's version history (`agent_state.git/`). */
  abstract agentStateRepoDir(projectId: string, agentId: string): string;
  abstract snapshotsDir(projectId: string, agentId: string): string;
  /** The folder holding one scratchpad per Session, each named by its Session's id. */
  abstract scratchpadDir(projectId: string, agentId: string): string;
  /** The folder holding the Agent's temporary and Test Workspaces, one per name. */
  abstract workspacesDir(projectId: string, agentId: string): string;
  /** The Agent's reusable tool environments, one folder per environment. */
  abstract sharedEnvDir(projectId: string, agentId: string): string;
  /** Where a Project's folders wait while their contents are removed (`agents/.deleting/`). */
  abstract deletingDir(projectId: string): string;
  /** The npm prefix the server installs plugins into. */
  abstract pluginsDir(): string;
}
