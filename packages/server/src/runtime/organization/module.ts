/**
 * Company mode's assembly, bound to the server's own mechanisms (services+routes restack S20):
 * the runtime service, its scheduler and their routes' factories live in
 * @prismshadow/penguin-library-organization — this file only binds the ports the library
 * declares (the deps seam the runtime runs through) and keeps the module node.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Channels, Clock, Config, Log } from "../../hmr/capabilities.js";
import type { ChannelHub } from "../channel.js";
import { userChannelKey } from "../../http/routes/events.js";
import type { OrgCache } from "@prismshadow/penguin-library-organization";
import type { AgentConfig, AgentLifecycle, AgentIndex } from "../../mechanisms/agents.js";
import type { ModuleActor, PluginModules } from "../../mechanisms/plugins.js";
import type {
  Members,
  ProjectConfigStore,
  Projects,
} from "@prismshadow/penguin-library-project";
import type { MessagingBindings } from "@prismshadow/penguin-library-messaging";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { Errors, UsageQueries } from "@prismshadow/penguin-library-observability";
import { OrgStore } from "@prismshadow/penguin-library-organization/store";
import { enabledMessagingChannel } from "@prismshadow/penguin-library-messaging/enabled-channel";
import { SEMANTIC_ID_RULES } from "../../services/semantic-id.js";
import { suggestSemanticId } from "../../services/semantic-id-suggest.js";
import { isNewSemanticId } from "../../services/ids.js";
import type {
  OrganizationService,
  OrgScheduler,
} from "@prismshadow/penguin-library-organization/runtime/service";
import type { OrgDeps, OrgRuns, OrgSessions } from "@prismshadow/penguin-library-organization/runtime/deps";
import { OrganizationScheduler } from "@prismshadow/penguin-library-organization/runtime/scheduler";

/**
 * Company mode's runtime, assembled over the same narrow seams the schedule scheduler
 * uses: the session manager for run state and task start, SessionService for sessions,
 * AgentService and AgentConfigService for hiring, UsageService for spend. The scheduler
 * is started by the platform's Startup component (one reconcile pass, no backfill) and
 * stopped with this App, like every other timer in the tree.
 */
@Module()
export class OrganizationModule {
  @Use() private readonly config!: Config;
  @Use() private readonly channels!: Channels;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly cache!: OrgCache;
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly runner!: OrgRuns;
  @Use() private readonly sessionCreator!: OrgSessions;
  @Use() private readonly agentService!: AgentLifecycle;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly agentsRepo!: AgentIndex;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly usage!: UsageQueries;
  @Use() private readonly errors!: Errors;
  @Use() private readonly settings!: Settings;
  @Use() private readonly messagingRepo!: MessagingBindings;
  @Use() private readonly pluginModules!: PluginModules;
  @Provide() orgService!: OrgService;
  @Provide() orgScheduler!: OrgScheduler;
  setup({ effect }: ClassCtx) {
    const channels = this.channels as ChannelHub;
    const agentService = this.agentService;
    const agentConfig = this.agentConfig;
    const agentsRepo = this.agentsRepo;
    const runner = this.runner;
    const projectConfig = this.projectConfig;
    const pluginModules = this.pluginModules;
    const deps: OrgDeps = {
      root: this.config.root,
      store: new OrgStore(this.config.root),
      cache: this.cache,
      projects: this.projects,
      members: this.members,
      sessions: this.sessionsRepo,
      runner,
      sessionCreator: this.sessionCreator,
      agents: {
        exists: async (projectId, agentId) =>
          agentsRepo.exists(projectId, agentId) || agentConfig.exists(projectId, agentId),
        // Every Agent company mode creates — an organization's CEO, a new hire — is its own.
        create: async (projectId, agentId, name, description, plugins) => {
          await agentService.createAgent(projectId, agentId, {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            author: "company",
            plugins,
          });
        },
        displayName: async (projectId, agentId) =>
          (await agentConfig.readCardMeta(projectId, agentId)).name ?? agentId,
        writeAgentsMd: (projectId, agentId, content) =>
          agentConfig.updateConfig(projectId, agentId, { agentsMd: content }),
        pluginVersion: (projectId, agentId, plugin) =>
          agentService.pluginVersion(projectId, agentId, plugin),
        updatePlugin: async (projectId, agentId, plugin) => {
          await agentService.updatePlugin(projectId, agentId, plugin);
          // Same reason the plugins route invalidates: a hook package is bound when a core
          // Session is built, so a runtime cached for this employee would keep the old set
          // until it was evicted. A Task in flight keeps what it started with.
          runner.invalidateAgentRuntimes(projectId, agentId);
          // LAST: the system's pass enables a built-in server module, and never asks (PRFC-0031).
          await pluginModules.ensure(projectId, [plugin], null, "install", agentId);
        },
        ensureModules: async (projectId, agentId, plugins, actor) => {
          await pluginModules.ensure(projectId, plugins, actor, "install", agentId);
        },
      },
      projectConfig,
      completeOnce: (projectId, prompt) => projectConfig.completeOnce(projectId, prompt),
      // The semantic-id vocabulary is the server's own (services/semantic-id*, shared with the
      // development routes' suggest-id): the service names what it needs, this binding closes
      // over the kind table and the shared suggester.
      semanticId: {
        suggest: ({ projectId, name, kind, taken, completeOnce, recordFailure }) =>
          suggestSemanticId(
            { completeOnce, recordFailure },
            projectId,
            { name, kind, rule: SEMANTIC_ID_RULES[kind], taken },
          ),
        acceptsNew: isNewSemanticId,
      },
      usage: this.usage,
      messagingChannel: (sessionId) => enabledMessagingChannel(this.messagingRepo, sessionId),
      errors: this.errors,
      notifyProject: (projectId, event) => {
        const ownerUserId = this.projects.findById(projectId)?.ownerUserId;
        if (ownerUserId === undefined) return;
        const audience = new Set([
          ownerUserId,
          ...this.members.list(projectId).map((m) => m.userId),
        ]);
        for (const userId of audience) {
          channels.peek(userChannelKey(userId))?.publish(event, "server_event");
        }
      },
      companyModeEnabled: () => this.settings.getCompanyMode(),
      now: () => this.clock.now().getTime(),
      log: (line: string) => this.log.line(line),
    };
    const orgScheduler = new OrganizationScheduler(deps);
    this.orgScheduler = orgScheduler;
    const service = new OrganizationService(deps, orgScheduler);
    this.orgService = service;
    // An employee's model is its desk Session's: a switch made on a desk reaches the chart.
    const unsubscribe = runner.onModelChanged((sessionId, model) => {
      service.deskModelChanged(sessionId, model).catch((err: unknown) =>
        deps.errors.record({
          source: "organization",
          err,
          code: "org_desk_model_sync_failed",
          ctx: { sessionId },
        }),
      );
    });
    effect(() => unsubscribe());
    // Only active while this App is; the successor's start() reconciles from the files.
    effect(() => orgScheduler.stop());
  }
}
