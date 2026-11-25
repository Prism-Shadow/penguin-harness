/**
 * The Project service moved to the projects domain package
 * (@prismshadow/penguin-library-project/project-service, server restack S11) — it speaks
 * library vocabulary and the ports in that package (paths, preinstall plugins, app seeds).
 * This file keeps the assembly: the Provider binds the service's decorator-injected fields
 * and ports by hand and re-exports the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { PluginModules } from "../mechanisms/plugins.js";
import type { AppSeeds } from "./app-seeds.js";
import type {
  Access,
  AgentIndex,
  Members,
  ProjectConfigStore,
  ProjectLifecycle,
  Projects,
} from "@prismshadow/penguin-library-project";
import type { Users, UserDraftsStore } from "@prismshadow/penguin-library-auth";
import type { SessionIndex, Schedules } from "@prismshadow/penguin-library-session";
import type { ErrorLog, UsageStore } from "@prismshadow/penguin-library-observability";
import type { TraceIndex } from "@prismshadow/penguin-library-trace";
import type { OrgCache } from "@prismshadow/penguin-library-organization";
import type { AgentApi } from "@prismshadow/penguin-library-agent-api";
import {
  BuiltinBenchmarkSeeds,
  ProjectRuns,
  ProjectService,
} from "@prismshadow/penguin-library-project/project-service";

export * from "@prismshadow/penguin-library-project/project-service";

/** The projects assembly: the service's ports and decorator-injected fields are bound by hand here (the kernel does not inject @Use on a hand-built instance). */
@Module()
export class ProjectServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly access!: Access;
  @Use() private readonly users!: Users;
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly usage!: UsageStore;
  @Use() private readonly errors!: ErrorLog;
  @Use() private readonly schedules!: Schedules;
  /** Company-mode caches: a destroyed Project takes its organization projections with it. */
  @Use() private readonly orgCache!: OrgCache;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  /** What destroying a Project needs of the session runtime — declared at the consumer. */
  @Use() private readonly manager!: ProjectRuns;
  /** Trace-index cleanup on Project destruction (rows describe files removed with the Project dir). */
  @Use() private readonly traceIndex!: TraceIndex;
  /** The Project's Agents' API settings and keys (web.db): a destroyed Project exposes nothing. */
  @Use() private readonly agentApi!: AgentApi;
  /** Users' unsent drafts of the Project and of its Sessions: nowhere left to send them. */
  @Use() private readonly drafts!: UserDraftsStore;
  @Use() private readonly benchmarkSeeds!: BuiltinBenchmarkSeeds;
  /** The preinstalled built-in modules a new Project lists (PRFC-0030). */
  @Use() private readonly pluginModules!: PluginModules;
  /** The seeds built-in plugins ship for their system apps' data, written once at creation. */
  @Use() private readonly appSeeds!: AppSeeds;
  @Provide() lifecycle!: ProjectLifecycle;
  @Provide() service!: ProjectService;

  setup() {
    this.service = Object.assign(new ProjectService(), {
      paths: this.paths,
      access: this.access,
      users: this.users,
      projects: this.projects,
      members: this.members,
      agents: this.agents,
      sessions: this.sessions,
      usage: this.usage,
      errors: this.errors,
      schedules: this.schedules,
      orgCache: this.orgCache,
      projectConfig: this.projectConfig,
      manager: this.manager,
      traceIndex: this.traceIndex,
      agentApi: this.agentApi,
      drafts: this.drafts,
      benchmarkSeeds: this.benchmarkSeeds,
      pluginModules: this.pluginModules,
      appSeeds: this.appSeeds,
    });
    this.lifecycle = this.service;
  }
}
