/**
 * The data root's layout over this server's root: every path from the helpers that define it —
 * core's for the Projects and Agents, the server's for its own folders.
 */
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import {
  agentAppDir,
  agentDir,
  agentStateDir,
  agentsDir,
  projectConfigPath,
  projectDir,
  projectsDir,
  scratchpadDir,
  sharedEnvDir,
  snapshotsDir,
  tracesDir,
  workspacesDir,
} from "@prismshadow/penguin-core";
import { Paths } from "../hmr/capabilities.js";
import type { DataLayout } from "../mechanisms/data-layout.js";
import { pluginsPrefix } from "../plugin/install.js";
import { agentStateRepoDir } from "../workbenches/repo.js";
import { deletingDir } from "./agent-service.js";

@Component()
export class RootDataLayout implements DataLayout {
  @Use() private readonly paths!: Paths;
  root(): string {
    return this.paths.root;
  }
  projectsDir(): string {
    return projectsDir(this.paths.root);
  }
  projectDir(projectId: string): string {
    return projectDir(this.paths.root, projectId);
  }
  projectConfigPath(projectId: string): string {
    return projectConfigPath(this.paths.root, projectId);
  }
  agentsDir(projectId: string): string {
    return agentsDir(this.paths.root, projectId);
  }
  agentDir(projectId: string, agentId: string): string {
    return agentDir(this.paths.root, projectId, agentId);
  }
  tracesDir(projectId: string, agentId: string): string {
    return tracesDir(this.paths.root, projectId, agentId);
  }
  agentStateDir(projectId: string, agentId: string): string {
    return agentStateDir(this.paths.root, projectId, agentId);
  }
  agentStateRepoDir(projectId: string, agentId: string): string {
    return agentStateRepoDir(agentDir(this.paths.root, projectId, agentId));
  }
  snapshotsDir(projectId: string, agentId: string): string {
    return snapshotsDir(this.paths.root, projectId, agentId);
  }
  scratchpadDir(projectId: string, agentId: string): string {
    return scratchpadDir(this.paths.root, projectId, agentId);
  }
  workspacesDir(projectId: string, agentId: string): string {
    return workspacesDir(this.paths.root, projectId, agentId);
  }
  sharedEnvDir(projectId: string, agentId: string): string {
    return sharedEnvDir(this.paths.root, projectId, agentId);
  }
  workbenchCachesDir(projectId: string, agentId: string): string {
    // The parent of core's workbenchCacheDir: `<agentDir>/app/cache`.
    return path.join(agentAppDir(this.paths.root, projectId, agentId), "cache");
  }
  deletingDir(projectId: string): string {
    return deletingDir(this.paths.root, projectId);
  }
  pluginsDir(): string {
    return pluginsPrefix(this.paths.root);
  }
}
