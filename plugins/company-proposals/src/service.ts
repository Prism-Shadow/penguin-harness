/**
 * The proposal service: the use cases over the ports (ports.ts), the views a caller gets, and
 * the one way it speaks to employees — a line of work put straight on the employee's desk,
 * `[proposal #<n>] ` + what happened + the command to run, in nobody's name, sent as the write's
 * notice (desk.ts), a notify Action a company workflow may replace. No channel, no trigger kind
 * of its own.
 *
 * Who may do what, and in which state, are the default rules (guards.ts): the person delegates,
 * comments, requests changes and approves; the author publishes, marks ready, asks for an
 * implementer and resolves comments; the implementer reports merged, and so may anybody in the
 * organization once the forge reads the impl PR as merged into its default branch; anybody in
 * the organization — a person or an employee — gives feedback and rejects. A person may also
 * do what the author or the implementer may, so a stuck proposal never waits on an employee
 * that is not answering. Each write is one transaction of the store; the rules are checked in it.
 *
 * Reads are per person: a read position (the last `seq` seen) per proposal, kept in the store,
 * and the counts the queue shows derive from it. An employee has no read position — the page is
 * for people.
 */
import path from "node:path";
import type {
  AgentLifecycle,
  Log,
  OrgActor,
  OrgGateway,
  OrgView,
  PluginConfig,
} from "@prismshadow/penguin-server/plugin";
import type {
  ProposalAdoptImplResponse,
  ProposalComment,
  ProposalCommentsResponse,
  ProposalDetail,
  ProposalFileResponse,
  ProposalGraphResponse,
  ProposalCommentTarget,
  ProposalImplChanges,
  ProposalImplDiff,
  ProposalImplStat,
  ProposalImplRequest,
  ProposalBranchRef,
  ProposalImplBranchSide,
  ProposalItem,
  ProposalResolvedBranch,
  ProposalMaterial,
  ProposalRevision,
  ProposalRevisionsResponse,
  ProposalDeploymentRegisterRequest,
  ProposalDeploymentsResponse,
  ProposalMaterialKind,
  ProposalPluginEvent,
  ProposalTestGroup,
  ProposalTestGroupsResponse,
  ProposalsResponse,
} from "@prismshadow/penguin-server/api";
import {
  CONFIG_GROUP,
  graphConfigOf,
  remotesOf,
  testGroupsOf,
  undeclaredGroupsMessage,
  type GraphConfig,
} from "./config.js";
import { paragraphAtOffset, renderForAgent, sectionSource } from "./comments.js";
import { readBaseFile } from "./files.js";
import { PrStatusReader, ghRunner, parsePullUrl, type RunGh } from "./pr-status.js";
import { pullKey, type GraphProposal } from "./pr-chain.js";
import { declaredHeads } from "./graph-heads.js";
import { OPEN_PRS_UNCHECKED, implGraphFacts } from "./impl-on-graph.js";
import {
  deploymentIdOf,
  DeploymentRegistryError,
  fetchProbe,
  normalizeServerUrl,
  registryOf,
  requireUnregistered,
  type ProbeServer,
} from "./deployments.js";
import { gitRunner, type RunGit } from "./workspace-remotes.js";
import {
  ProposalError,
  type Project,
  type Proposal,
  type ProposalImpl,
  type ProposalImplSide,
} from "./domain.js";
import {
  afterPublish,
  batchOf,
  createKey,
  defaultAct,
  mergedOnWord,
  rebriefFromRoadmap,
  type Caller,
  type WriteAct,
} from "./guards.js";
import { noticeFailures, parseSubject, type NoticeResult, type Subject } from "./action-model.js";
import { ProposalDesk } from "./desk.js";
import type { HeadScope } from "./heads.js";
import type {
  DiffMirror,
  Forge,
  GitMirror,
  ProposalFacts,
  RoadmapModeratorOf,
  Viewer,
} from "./ports.js";
import { changeAuthor, type AuthorHost } from "./author.js";
import { SqliteProposalStore } from "./store-write.js";
import { SqliteGraphStore } from "./graph-store.js";
import { companyDbPath } from "./schema.js";
import { DeploymentStore, deploymentsPath } from "./deploy-store.js";
import { RetiredOrgs, retireOrg } from "./org-retire.js";
import { GithubForge, NoForge } from "./forge.js";
import { LocalGitMirror, githubUrl, mirrorDir } from "./git-mirror.js";
import { GraphRefresher, OrgRetiredError, type GraphContext } from "./graph-refresh.js";
import { ImplChangesCache, implChanges } from "./impl-diff.js";
import { ImplStats, statOf } from "./impl-stat.js";
import { checkDocTarget, diffTargetQuote } from "./comment-targets.js";
import {
  ImplBranchError,
  branchLinkOf,
  compareBranches,
  readPullBranches,
  refLabel,
  remoteFor,
  resolveRef,
  sameRef,
} from "./impl-branch.js";
import {
  checkScope,
  checkTests,
  missingMessage,
  missingTestsMessage,
  scopeBase,
  scopeStates,
  testStates,
} from "./scope-check.js";
import {
  ProposalDocumentError,
  parseProposalDocument,
  renderProposalDocument,
} from "./markdown.js";

export { ProposalError } from "./domain.js";

/** The plugin's name in the `plugin` server event. */
export const PLUGIN_NAME = "company-proposals";
/** The skills plugin the author and the implementer are given on demand. */
export const SKILLS_PLUGIN = "agent-company-proposals";

export const MATERIAL_KINDS: readonly ProposalMaterialKind[] = [
  "pr",
  "issue",
  "branch",
  "doc",
  "ticket",
  "url",
];

export interface ServiceDeps {
  gateway: OrgGateway;
  /** The Agent lifecycle: what an employee carries of the skills plugin, and installing it. */
  agents: Pick<AgentLifecycle, "pluginVersion" | "updatePlugin">;
  /** The data root (Paths.root). */
  root: string;
  log: Pick<Log, "line">;
  /** The plugin's settings group (config.ts); the declared defaults when absent (a test that does not care). */
  pluginConfig?: Pick<PluginConfig, "get">;
  now?: () => number;
  /** How `gh` runs (the impl's PR and diff reads, and the GitHub forge); the machine's own by default. */
  gh?: RunGh;
  /** How the shared workspace's remotes are read; the machine's `git` by default (a test feeds answers). */
  git?: RunGit;
  /** How a server deployment's `/api/install` is read (deployments.ts); the machine's `fetch` by default. */
  probe?: ProbeServer;
  /** The forge of a project on GitHub; the GitHub adapter over `gh` by default. */
  forge?: Forge;
  /** The delivery repository's mirror; a blobless bare repository under the organization by default. */
  mirrorFor?: (orgDir: string, repo: string) => GitMirror;
  /** The same mirror as an impl diff reads it (impl-diff.ts); the blobless bare repository by default. */
  diffMirrorFor?: (orgDir: string, repo: string) => DiffMirror;
}

/** One organization's stores: `company.db` (proposals, graph), and the deployment registry's file. */
interface OrgStores {
  proposals: SqliteProposalStore;
  graph: SqliteGraphStore;
  deployments: DeploymentStore;
}

/** One write's desk deliveries: the reasons a delivery failed, collected for the answer. */
interface Delivery {
  hints: string[];
}

const badRequest = (message: string): ProposalError =>
  new ProposalError(400, "bad_request", message);
const graphOff = (): ProposalError =>
  new ProposalError(
    409,
    "graph_not_configured",
    "No delivery repository: none is set under Settings → Plugins → Company proposals and the shared workspace has no GitHub remote.",
  );

/** Who acted, as a message names them: the employee's Agent id, else the person's user id. */
function whoOf(caller: Caller): string {
  return caller.agentId ?? caller.userId;
}

/** The caller a principal recorded elsewhere stands for (a roadmap's approver): `agent:<id>` or `user:<id>`. */
function callerOfPrincipal(principal: string): Caller {
  const agentId = principal.startsWith("agent:") ? principal.slice("agent:".length) : null;
  const userId = agentId === null ? principal.replace(/^user:/, "") : "";
  return { principal, agentId, userId };
}

/** A slug of a title for a branch name: lower-case ASCII words, at most six. */
export function slugOf(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, 6);
  return words.length > 0 ? words.join("-") : "proposal";
}

/** Who answers for a proposal now: the implementer once one is named, else the author. */
export function ownerOf(p: Pick<Proposal, "author" | "implementer">): string {
  return p.implementer ?? p.author;
}

export class ProposalService {
  private readonly stores = new Map<string, OrgStores>();

  /** Conclusions being delivered (`<projectId>/<orgId>/<sessionId>`): a second one waits for nothing and is refused. */
  private readonly concluding = new Set<string>();

  /** The PR status cache's reader (pr-status.ts). */
  private readonly prStatus: PrStatusReader;
  /** The PR graph's read path and refresher (graph-refresh.ts). */
  private readonly graphs: GraphRefresher;
  /** Impl diffs read from the mirror, by head and base commit. */
  private readonly changes = new ImplChangesCache();
  /** Each impl's `+N/−M`, computed off the read path from the same diffs. */
  private readonly stats = new ImplStats();
  /** Organizations being (or already) deleted, whose stores may not open again (org-retire.ts). */
  private readonly retired = new RetiredOrgs();
  /** How the plugin speaks to employees: the notices of its writes (desk.ts). */
  private readonly desk: ProposalDesk;
  /** Who moderates a roadmap, while the roadmaps plugin provides it (provideRoadmapModerators). */
  private moderatorOf: RoadmapModeratorOf | null = null;

  constructor(private readonly deps: ServiceDeps) {
    this.desk = new ProposalDesk({
      gateway: deps.gateway,
      log: (line) => deps.log.line(line),
      recordFailed: async (projectId, orgId, number, reason, by) => {
        const { org, store } = await this.openInternal(projectId, orgId);
        const written = store.notifyFailed(number, () => ({ reason, by }));
        this.notify(org, number, written.seq, "notify_failed");
      },
    });
    const forge = deps.forge ?? new GithubForge(deps.gh);
    this.prStatus = new PrStatusReader({
      forge,
      log: (line) => deps.log.line(line),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
    this.graphs = new GraphRefresher({
      log: (line) => deps.log.line(line),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      windowMs: () => this.graphConfig().windowMs,
      mirrorFor:
        deps.mirrorFor ??
        ((orgDir, repo) =>
          new LocalGitMirror({ dir: mirrorDir(orgDir, repo), url: githubUrl(repo) })),
      forgeFor: (project) => (project.forge === "github" ? forge : new NoForge()),
      probe: deps.probe ?? fetchProbe(),
    });
  }

  /** Closes every organization's store and stops the graph refreshes; the plugin is stopping. */
  close(): void {
    this.graphs.stop();
    for (const s of this.stores.values()) s.proposals.close();
    this.stores.clear();
  }

  /**
   * The organization is being deleted (org-retire.ts): its graph refresh and PR status batch
   * stopped and awaited, its connection closed and what is kept of it dropped; its stores open
   * again only for an organization found anew.
   */
  retire(projectId: string, orgId: string): Promise<void> {
    const key = `${projectId}/${orgId}`;
    return retireOrg({
      key,
      retired: this.retired,
      stores: this.stores,
      graph: (k) => this.graphs.retire(k),
      prStatus: (k) => this.prStatus.retire(k),
      forget: (k) => {
        for (const c of [...this.concluding]) if (c.startsWith(`${k}/`)) this.concluding.delete(c);
      },
    });
  }

  /** The skipped graph settings last reported, logged once per change like the test groups'. */
  private reportedGraphSkips = "";

  /** Where the PR graph reads from — the settings group, read on every use. */
  graphConfig(): GraphConfig {
    const config = graphConfigOf(this.deps.pluginConfig?.get(CONFIG_GROUP) ?? {});
    const key = config.skipped.join("\n");
    if (key !== this.reportedGraphSkips) {
      this.reportedGraphSkips = key;
      if (config.skipped.length > 0) {
        this.deps.log.line(
          `[company-proposals] PR graph settings skipped (want deliveryRepo owner/repo, origins name=owner/repo): ${config.skipped.join(" | ")}`,
        );
      }
    }
    return config;
  }

  /**
   * The organization's default Project: the settings where they are set, else the shared
   * workspace's GitHub remotes — the delivery repository is the remote holding the most of the
   * impl PRs (`origin` on a tie or when none does, else the first), its base the repository's
   * default branch, the origins the other remotes. `repo` is null when neither names one; each
   * fallback that could not be read is in `errors`.
   */
  /**
   * The project as the settings set it, read on every use (no git): with a delivery repository
   * set, the project; without one, `repo` is null and the shared workspace's remotes decide it
   * (project(), which the graph refresher alone runs for the graph).
   */
  private settingsProject(): Project {
    const config = this.graphConfig();
    if (config.repo !== null) {
      // A set repository stacks on the set base, or the default one: never its default branch.
      return {
        repo: config.repo,
        base: config.base,
        baseDeclared: true,
        origins: config.origins,
        forge: "github",
      };
    }
    return {
      repo: null,
      base: config.base,
      baseDeclared: config.baseDeclared,
      origins: config.origins,
      forge: "none",
    };
  }

  /**
   * The project: the settings', or — no delivery repository set — the shared workspace's GitHub
   * remote that holds the most impl PRs (`origin` on a tie). Runs `git remote -v` in that case.
   */
  private async project(org: OrgView, facts: ProposalFacts[], errors: string[]): Promise<Project> {
    const set = this.settingsProject();
    if (set.repo !== null) return set;
    const config = this.graphConfig();
    let remotes: Array<{ name: string; repo: string }> = [];
    try {
      remotes = await this.remotesOfDir(org.workspace);
    } catch (err) {
      errors.push(
        `shared workspace ${org.workspace}: remotes not read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const held = (repo: string): number => {
      const prefix = `${repo.toLowerCase()}#`;
      return facts.filter((p) =>
        (p.impl?.pr == null ? "" : (pullKey(p.impl.pr.url) ?? "")).startsWith(prefix),
      ).length;
    };
    let picked = remotes.find((r) => r.name === "origin") ?? remotes[0];
    for (const r of remotes)
      if (picked !== undefined && held(r.repo) > held(picked.repo)) picked = r;
    if (picked === undefined) {
      errors.push(
        `no delivery repository: none is set under Settings → Plugins → Company proposals and the shared workspace ${org.workspace} has no GitHub remote`,
      );
      return set;
    }
    const origins =
      config.origins.length > 0
        ? config.origins
        : remotes.filter((r) => r.repo.toLowerCase() !== picked.repo.toLowerCase());
    return {
      repo: picked.repo,
      base: config.base,
      baseDeclared: config.baseDeclared,
      origins,
      forge: "github",
    };
  }

  /** The skipped lines last reported, so a bad line is logged once per change, not on every read. */
  private reportedSkips = "";

  /** The declared test groups, in order — read from the settings group on every use, so a save applies at once. */
  testGroups(): ProposalTestGroup[] {
    const { groups, skipped } = testGroupsOf(this.deps.pluginConfig?.get(CONFIG_GROUP) ?? {});
    const key = skipped.join("\n");
    if (key !== this.reportedSkips) {
      this.reportedSkips = key;
      if (skipped.length > 0) {
        this.deps.log.line(
          `[company-proposals] test group lines skipped (want \`id: description\`, ids unique): ${skipped.join(" | ")}`,
        );
      }
    }
    return groups;
  }

  /** The declared test groups for a caller of the organization: what an author must pick from. */
  async listTestGroups(
    projectId: string,
    orgId: string,
    actor: OrgActor,
  ): Promise<ProposalTestGroupsResponse> {
    await this.open(projectId, orgId, actor);
    return { groups: this.testGroups() };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * An organization's stores, opened on first use. `seen` is the RetiredOrgs stamp taken before
   * the gateway found the organization: a retired organization opens again only for such a read.
   */
  private storesOf(projectId: string, orgId: string, seen?: number): OrgStores {
    const key = `${projectId}/${orgId}`;
    let s = this.stores.get(key);
    if (s === undefined) {
      if (!this.retired.admit(key, seen)) {
        throw new ProposalError(404, "org_not_found", `Organization does not exist: ${orgId}`);
      }
      const proposals = SqliteProposalStore.open(
        companyDbPath(this.deps.root, projectId, orgId),
        () => this.now(),
      );
      s = {
        proposals,
        graph: new SqliteGraphStore(proposals.db, () => this.now()),
        deployments: new DeploymentStore(deploymentsPath(this.deps.root, projectId, orgId), () =>
          this.now(),
        ),
      };
      this.stores.set(key, s);
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Access
  // ---------------------------------------------------------------------------

  /** The organization, with company mode on and the caller belonging to it; its stores open. */
  private async open(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<{ org: OrgView; store: SqliteProposalStore; stores: OrgStores; caller: Caller }> {
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new ProposalError(404, "company_mode_off", "Company mode is off.");
    }
    const seen = this.retired.stamp();
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) {
      throw new ProposalError(404, "org_not_found", `Organization does not exist: ${orgId}`);
    }
    const principal = await this.deps.gateway.principalOf(projectId, orgId, actor);
    const agentId = principal.startsWith("agent:") ? principal.slice("agent:".length) : null;
    if (agentId === null && !org.userIds.includes(actor.userId)) {
      throw new ProposalError(403, "project_access", "Not a member of this Project.");
    }
    const stores = this.storesOf(projectId, orgId, seen);
    return {
      org,
      // A run's writes go through a view that writes its start row in each transaction.
      store: stores.proposals.scoped(act?.inTx),
      stores,
      caller: {
        principal,
        agentId,
        userId: actor.userId,
        ...(actor.sessionId !== undefined ? { sessionId: actor.sessionId } : {}),
      },
    };
  }

  /** The organization and its store, for a write no caller makes over HTTP (createFromRoadmap). */
  private async openInternal(
    projectId: string,
    orgId: string,
  ): Promise<{ org: OrgView; store: SqliteProposalStore }> {
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new ProposalError(404, "company_mode_off", "Company mode is off.");
    }
    const seen = this.retired.stamp();
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) {
      throw new ProposalError(404, "org_not_found", `Organization does not exist: ${orgId}`);
    }
    return { org, store: this.storesOf(projectId, orgId, seen).proposals };
  }

  private requireProposal(store: SqliteProposalStore, number: number): Proposal {
    const p = store.get(number);
    if (p === null) {
      throw new ProposalError(404, "proposal_not_found", `Proposal #${number} does not exist.`);
    }
    return p;
  }

  private requireEmployee(org: OrgView, agentId: string, role: string): void {
    if (!org.employees.some((e) => e.agentId === agentId)) {
      throw badRequest(`${role} must be an employee of ${org.orgId}: ${agentId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private viewer(caller: Caller): Viewer {
    return { principal: caller.principal, reader: readerOf(caller) };
  }

  private unreadOf(store: SqliteProposalStore, p: Proposal, caller: Caller): number {
    const seen = store.readSeq(readerOf(caller), p.number);
    return p.events.filter((e) => e.seq > seen && e.by !== caller.principal).length;
  }

  /** Pending comments are the commenter's own until requested; an employee sees only batched ones. */
  private visibleComments(p: Proposal, caller: Caller): ProposalComment[] {
    return p.comments.filter((c) => c.batchId !== null || c.by === caller.principal);
  }

  private item(
    p: Pick<
      Proposal,
      | "number"
      | "title"
      | "status"
      | "revision"
      | "author"
      | "implementer"
      | "delegatedBy"
      | "createdAt"
      | "updatedAt"
      | "materials"
      | "impl"
    >,
    unread: number,
    pendingComments: number,
  ): ProposalItem {
    // The origins setting is an in-memory config read, so a list row costs no git and no request.
    const origins = p.impl === null ? [] : this.graphConfig().origins;
    return {
      number: p.number,
      title: p.title,
      status: p.status,
      revision: p.revision,
      author: p.author,
      implementer: p.implementer,
      delegatedBy: p.delegatedBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      unread,
      pendingComments,
      materials: withImplPr(p.materials, implPrOf(p.impl)),
      implPr: implPrOf(p.impl),
      impl:
        p.impl === null
          ? null
          : {
              // As declared, with each side's GitHub page: the stored repositories stay the plugin's.
              head: declaredSide(p.impl.head, origins),
              base: declaredSide(p.impl.base, origins),
              pr: p.impl.pr?.url ?? null,
              by: p.impl.by,
              at: p.impl.at,
            },
    };
  }

  private detail(store: SqliteProposalStore, p: Proposal, caller: Caller): ProposalDetail {
    return {
      ...this.item(
        p,
        this.unreadOf(store, p, caller),
        p.comments.filter((c) => c.batchId === null && c.by === caller.principal).length,
      ),
      brief: p.brief,
      root: p.root,
      scope: p.scope,
      tests: p.tests,
      sections: p.sections,
      comments: this.visibleComments(p, caller),
      events: p.events,
      sessions: p.sessions,
      discussions: p.discussions,
      approvedRevision: p.approvedRevision,
      seq: p.seq,
    };
  }

  /** Every revision published, oldest first — the head included. */
  async revisions(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalRevisionsResponse> {
    const { store } = await this.open(projectId, orgId, actor);
    this.requireExists(store, number);
    return { revisions: store.revisions(number) };
  }

  private requireExists(store: SqliteProposalStore, number: number): void {
    if (!store.exists(number)) {
      throw new ProposalError(404, "proposal_not_found", `Proposal #${number} does not exist.`);
    }
  }

  /** One revision as it was published — what the page diffs the head against. */
  async revision(
    projectId: string,
    orgId: string,
    number: number,
    rev: number,
    actor: OrgActor,
  ): Promise<ProposalRevision> {
    const { store } = await this.open(projectId, orgId, actor);
    this.requireExists(store, number);
    const found = store.revision(number, rev);
    if (found === null) {
      throw new ProposalError(
        404,
        "revision_not_found",
        `Proposal #${number} has no revision ${rev}.`,
      );
    }
    return found;
  }

  async list(projectId: string, orgId: string, actor: OrgActor): Promise<ProposalsResponse> {
    const { store, caller } = await this.open(projectId, orgId, actor);
    return {
      proposals: store
        .list(this.viewer(caller))
        .map((s) => this.item(s, s.unread, s.pendingComments)),
    };
  }

  async get(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, store, stores, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(store, number);
    const detail = await this.withScope(org, this.detail(store, p, caller));
    const implStat = this.implStatOf(org, p);
    return {
      ...detail,
      materials: this.withPrStatus(`${projectId}/${orgId}`, stores, detail.materials).materials,
      testGroups: this.testGroups(),
      ...(implStat !== undefined ? { implStat } : {}),
    };
  }

  /**
   * One file under the proposal's base (the shared workspace joined with the current
   * revision's root), read-only: what the page's file panel shows beside the proposal.
   */
  async file(
    projectId: string,
    orgId: string,
    number: number,
    rel: string,
    actor: OrgActor,
  ): Promise<ProposalFileResponse> {
    const { org, store } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(store, number);
    const read = await readBaseFile(scopeBase(org.workspace, p.root), rel);
    if ("code" in read) {
      const status = read.code === "bad_path" ? 400 : read.code === "path_outside" ? 403 : 404;
      throw new ProposalError(status, read.code, read.message);
    }
    return read;
  }

  /** The detail with where its scope resolves on this server, and each entry's state there. */
  private async withScope(org: OrgView, detail: ProposalDetail): Promise<ProposalDetail> {
    const base = scopeBase(org.workspace, detail.root);
    const states = await scopeStates(base, detail.scope);
    const tests = await testStates(base, detail.tests);
    return {
      ...detail,
      base,
      scope: detail.scope.map((e, i) => ({ ...e, state: states[i]! })),
      tests: detail.tests.map((t, i) => ({ ...t, state: tests[i]! })),
    };
  }

  /**
   * The `pr` materials with their cached status, the rest as they are. Never waits for the
   * forge: what is missing or stale is read in the background (`refreshed`).
   */
  private withPrStatus(
    orgKey: string,
    stores: OrgStores,
    materials: ProposalMaterial[],
  ): { materials: ProposalMaterial[]; refreshed: Promise<void> } {
    const urls = materials.filter((m) => m.kind === "pr").map((m) => m.url);
    const { statuses, refreshed } = this.prStatus.read(orgKey, stores.graph, urls);
    return {
      materials: materials.map((m) => {
        if (m.kind !== "pr") return m;
        const read = statuses.get(m.url);
        return read === undefined
          ? m
          : { ...m, status: read.status, statusCheckedAt: read.checkedAt };
      }),
      refreshed,
    };
  }

  /** Settles once the PR statuses a read of this proposal asked for are written (tests). */
  async prStatusSettled(projectId: string, orgId: string, number: number): Promise<void> {
    const stores = this.storesOf(projectId, orgId);
    const p = stores.proposals.get(number);
    if (p === null) return;
    await this.withPrStatus(
      `${projectId}/${orgId}`,
      stores,
      withImplPr(p.materials, implPrOf(p.impl)),
    ).refreshed;
  }

  // ---------------------------------------------------------------------------
  // Desk delivery: how the plugin speaks to employees
  // ---------------------------------------------------------------------------

  /** What one write's deliveries report back: the reasons a delivery failed, for the answer. */
  private delivery(): Delivery {
    return { hints: [] };
  }

  /** The write's answer, carrying any delivery that failed as a hint the page shows. */
  private answer(delivery: Delivery, detail: ProposalDetail): ProposalDetail {
    return delivery.hints.length > 0
      ? { ...detail, hints: [...(detail.hints ?? []), ...delivery.hints] }
      : detail;
  }

  /** The answer to a write: the proposal as it stands now, as the caller sees it. */
  private view(store: SqliteProposalStore, number: number, caller: Caller): ProposalDetail {
    return this.detail(store, this.requireProposal(store, number), caller);
  }

  /** What the built-in proposal notices deliver (notify-actions.ts): see ProposalDesk.deliver. */
  deliverNotice(
    projectId: string,
    orgId: string,
    number: number,
    to: readonly string[],
    line: string,
    caller: Pick<Caller, "principal">,
  ): Promise<NoticeResult> {
    return this.desk.deliver(projectId, orgId, number, to, line, caller);
  }

  private notify(
    org: OrgView,
    number: number,
    seq: number,
    kind: ProposalPluginEvent["kind"],
  ): void {
    const data: ProposalPluginEvent = {
      projectId: org.projectId,
      orgId: org.orgId,
      number,
      seq,
      kind,
    };
    this.deps.gateway.notifyProject(org.projectId, { type: "plugin", plugin: PLUGIN_NAME, data });
  }

  /**
   * The skills plugin reaches whoever writes or builds a proposal, on demand: nobody is hired
   * for it and nobody installs it by hand. A library without the plugin, or an install that
   * fails, is logged — the proposal stands either way.
   */
  private async ensureSkills(projectId: string, agentId: string): Promise<void> {
    try {
      const version = await this.deps.agents.pluginVersion(projectId, agentId, SKILLS_PLUGIN);
      if (version.library === null) return;
      // Missing, or older than the library's: the protocol changes (scope kinds, the ready
      // guard), and an author working from an old copy would write what the server refuses.
      if (
        version.installed !== null &&
        compareDatedVersions(version.installed, version.library) >= 0
      )
        return;
      await this.deps.agents.updatePlugin(projectId, agentId, SKILLS_PLUGIN);
    } catch (err) {
      this.deps.log.line(
        `[${PLUGIN_NAME}] ${SKILLS_PLUGIN} not installed on ${agentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * A person starts a proposal by delegating it to an employee, named as its author. An
   * employee does not: a new proposal comes from a roadmap item that a person and the
   * moderator approved, and company-roadmaps creates it then (createFromRoadmap). An
   * employee that wants a change of an existing proposal publishes a new revision of it.
   */
  async create(
    projectId: string,
    orgId: string,
    req: { author?: string; brief: string; title?: string },
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.create", caller, ORGANIZATION);
    a.check(null);
    const delivery = this.delivery();
    const brief = req.brief.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    const author = req.author;
    if (author === undefined) {
      throw badRequest("author is required: name the employee that writes it.");
    }
    this.requireEmployee(org, author, "author");
    const title = req.title?.trim() || brief.split("\n")[0]!.slice(0, 120);
    const { number, seq } = store.create(() => ({
      title,
      author,
      delegatedBy: caller.principal,
      brief,
    }));
    this.notify(org, number, seq, "created");
    await this.ensureSkills(projectId, author);
    await this.desk.tell(
      delivery,
      org,
      { number },
      caller,
      a,
      "created",
      [author],
      `${whoOf(caller)} asks you to write it: ${brief}\n\nWrite the proposal: \`penguin org proposal publish ${number} --file <markdown>\`, then \`penguin org proposal ready ${number}\` when a person can read it.`,
    );
    return this.answer(delivery, this.view(store, number, caller));
  }

  /**
   * The proposal of a roadmap item that has both approvals, created by company-roadmaps while
   * it records the second one — the one way an employee's proposal comes into being. It is
   * not a route: nobody reaches it over HTTP. The proposal records the item it came from; the
   * author is told by the roadmap (with the number), not here, so it hears of it once.
   *
   * Idempotent: the same item with the same brief answers the proposal it created before
   * instead of creating a second one (the default rule keys the creation by the brief's hash),
   * so a roadmap that retries an approval after a failure in between links the same proposal.
   */
  async createFromRoadmap(
    projectId: string,
    orgId: string,
    req: {
      author: string;
      title: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
  ): Promise<number> {
    const { org, store } = await this.openInternal(projectId, orgId);
    const brief = req.brief.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    this.requireEmployee(org, req.author, "author");
    const created = store.create(() => ({
      title: req.title.trim() || brief.split("\n")[0]!.slice(0, 120),
      author: req.author,
      delegatedBy: req.delegatedBy,
      brief,
      roadmap: {
        number: req.roadmap.number,
        key: req.roadmap.key,
        createKey: createKey(brief),
      },
    }));
    if (!created.created) return created.number;
    this.notify(org, created.number, created.seq, "created");
    await this.ensureSkills(projectId, req.author);
    return created.number;
  }

  /**
   * The brief of the proposal a roadmap item is linked to, rewritten when the item's changed
   * brief has both approvals again: company-roadmaps calls it, in place of creating a second
   * proposal, while it records the second approval (`delegatedBy`, whose name the rewrite is
   * recorded under). Not a route. The effect is editBrief's — only the brief moves, the
   * revisions, comments and approvals stand — except that the two approvals are the authority,
   * and the author is told whatever the status; not when it is the item's owner, whom the
   * roadmap tells with the approval, so it hears of it once.
   *
   * Answers false, writing nothing, when the proposal is merged or rejected (the default rule)
   * or there is no such proposal (a link by hand names any number):
   * the roadmap then creates a new proposal and links it instead. Idempotent: a proposal that
   * has the brief already answers true and is not written again, so a roadmap that retries the
   * approval after a failure in between does not record the rewrite twice.
   */
  async rebriefFromRoadmap(
    projectId: string,
    orgId: string,
    number: number,
    req: {
      owner: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
    notify?: WriteAct["notify"],
  ): Promise<boolean> {
    const { org, store } = await this.openInternal(projectId, orgId);
    const brief = req.brief.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    const before = store.get(number);
    if (before === null || !rebriefFromRoadmap(before)) return false;
    if (before.brief === brief) return true;
    const written = store.editBrief(number, (p) => {
      // Closed since the read above (another writer): the approval fails and, given again,
      // finds it closed and creates the new proposal.
      if (!rebriefFromRoadmap(p)) {
        throw new ProposalError(409, "proposal_status", `Proposal #${number} is ${p.status}.`);
      }
      return { brief, by: req.delegatedBy };
    });
    const p = written.proposal;
    this.notify(org, number, written.seq, "brief_edited");
    if (p.author !== req.owner) {
      const caller = callerOfPrincipal(req.delegatedBy);
      await this.desk.tell(
        this.delivery(),
        org,
        p,
        caller,
        notify !== undefined ? { notify } : undefined,
        "brief_edited",
        [p.author],
        `Item [${req.roadmap.key}] of roadmap #${req.roadmap.number} was approved again with a changed brief, so ${whoOf(caller)} rewrote this proposal's brief: ${brief}\n\nRead it with \`penguin org proposal show ${number}\` before the next revision.`,
      );
    }
    return true;
  }

  /**
   * The brief rewritten in place, by the author or a person: what the queue shows when the
   * one it was started with no longer says what is proposed. Only the brief moves — the
   * revisions, the comments, the events and any approval stand — so it is allowed in every
   * status. The author's desk is told only while it is still writing (drafting), and never
   * of its own rewrite.
   */
  async editBrief(
    projectId: string,
    orgId: string,
    number: number,
    text: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.brief", caller, proposalSubject(number));
    const delivery = this.delivery();
    const brief = text.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    a.check(this.requireProposal(store, number), { params: { brief } });
    const written = store.editBrief(number, (p, tx) => {
      a.check(p, { tx, params: { brief } });
      return { brief, by: caller.principal };
    });
    const p = written.proposal;
    this.notify(org, number, written.seq, "brief_edited");
    if (p.status === "drafting") {
      await this.desk.tell(
        delivery,
        org,
        p,
        caller,
        a,
        "brief_edited",
        [p.author],
        `${whoOf(caller)} rewrote the brief: ${brief}\n\nRead it with \`penguin org proposal show ${number}\` before the next revision.`,
      );
    }
    return this.answer(delivery, this.view(store, number, caller));
  }

  /** `proposal.author`: the proposal handed to another author (author.ts). */
  changeAuthor(
    projectId: string,
    orgId: string,
    number: number,
    author: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const host: AuthorHost = {
      open: this.open.bind(this),
      moderatorOf: () => this.moderatorOf,
      notify: this.notify.bind(this),
      ensureSkills: this.ensureSkills.bind(this),
      view: this.view.bind(this),
    };
    return changeAuthor(host, projectId, orgId, number, author, actor, act);
  }

  /**
   * The roadmaps plugin's moderators, provided while its App runs (RoadmapModeratorOf); answers
   * how to withdraw them, which leaves a later provider in place.
   */
  provideRoadmapModerators(moderatorOf: RoadmapModeratorOf): () => void {
    this.moderatorOf = moderatorOf;
    return () => {
      if (this.moderatorOf === moderatorOf) this.moderatorOf = null;
    };
  }

  async publish(
    projectId: string,
    orgId: string,
    number: number,
    markdown: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.publish", caller, proposalSubject(number));
    const delivery = this.delivery();
    const before = this.requireProposal(store, number);
    a.check(before);
    let doc;
    try {
      doc = parseProposalDocument(markdown, { sections: before.sections });
    } catch (err) {
      if (err instanceof ProposalDocumentError) throw new ProposalError(400, err.code, err.message);
      throw err;
    }
    // Only declared test groups. A revision already stored keeps whatever group it was
    // published with (the page shows it under Undeclared); it is this publish that must move it.
    const declared = this.testGroups();
    const undeclared = [...new Set(doc.tests.map((t) => t.group))].filter(
      (g) => !declared.some((d) => d.id === g),
    );
    if (undeclared.length > 0) {
      throw new ProposalError(
        400,
        "tests_group_undeclared",
        undeclaredGroupsMessage(undeclared, declared),
      );
    }
    // The scope against the working tree: what the change edits, deletes or renames from must
    // be there. A merged proposal is history — its tree has moved on — so it is not checked.
    let hints: string[] = [];
    if (before.status !== "merged") {
      const check = await checkScope(scopeBase(org.workspace, doc.root), doc.scope);
      if (check.rootMissing) {
        throw new ProposalError(
          400,
          "scope_root_missing",
          `\`root: ${doc.root}\` is not a directory of the shared workspace (${org.workspace}).`,
        );
      }
      if (check.missing.length > 0) {
        throw new ProposalError(400, "scope_missing", missingMessage(doc.root, check.missing));
      }
      const tests = await checkTests(scopeBase(org.workspace, doc.root), doc.tests);
      if (tests.missing.length > 0) {
        throw new ProposalError(400, "tests_missing", missingTestsMessage(doc.root, tests.missing));
      }
      hints = [...check.hints, ...tests.hints];
    }
    // The revision this publish makes is the one after what was read; a publish that landed in
    // between makes it the wrong number, which the default rule refuses.
    const revision = before.revision + 1;
    let approvedRevision: number | null = null;
    const written = store.publish(number, (p, tx) => {
      a.check(p, { tx, params: { revision } });
      const next = afterPublish(p);
      approvedRevision =
        p.status === "approved" && next.status !== "approved" ? p.approvedRevision : null;
      return {
        revision,
        title: doc.title,
        root: doc.root,
        scope: doc.scope,
        tests: doc.tests,
        sections: doc.sections,
        status: next.status,
        reason: next.reason,
        by: caller.principal,
      };
    });
    const p = written.proposal;
    this.notify(org, number, written.seq, approvedRevision !== null ? "ready" : "revised");
    if (approvedRevision !== null && p.implementer !== null) {
      // The person learns through the unread event; the one who must not merge yet is told.
      await this.desk.tell(
        delivery,
        org,
        p,
        caller,
        a,
        "revised_after_approval",
        [p.implementer],
        `revised after approval (revision ${approvedRevision} → ${p.revision}) — wait for a new approval before merging.`,
      );
    }
    const detail = await this.withScope(org, this.view(store, number, caller));
    return this.answer(delivery, hints.length > 0 ? { ...detail, hints } : detail);
  }

  async ready(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.ready", caller, proposalSubject(number));
    this.requireProposal(store, number);
    const written = store.setStatus(number, (p, tx) => {
      a.check(p, { tx });
      return { status: "ready", by: caller.principal };
    });
    this.notify(org, number, written.seq, "ready");
    return this.view(store, number, caller);
  }

  async approve(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.approve", caller, proposalSubject(number));
    const delivery = this.delivery();
    this.requireProposal(store, number);
    const written = store.setStatus(number, (p, tx) => {
      a.check(p, { tx });
      // The approval covers the revision it was given on.
      return { status: "approved", approvedRevision: p.revision, by: caller.principal };
    });
    this.notify(org, number, written.seq, "approved");
    const p = written.proposal;
    const to = p.implementer ?? p.author;
    await this.desk.tell(
      delivery,
      org,
      p,
      caller,
      a,
      "approved",
      [to],
      p.implementer !== null
        ? `approved by ${whoOf(caller)} — merge the PR and run \`penguin org proposal merged ${number}\`.`
        : `approved by ${whoOf(caller)} with nobody building it yet — build it with \`penguin org proposal implement ${number}\` (or \`--agent <id>\` to hand it to a colleague); once ${p.impl?.pr != null ? `its impl PR ${p.impl.pr.label}` : `its impl PR (register it: \`penguin org proposal impl ${number} <url>\`)`} is merged into the default branch, run \`penguin org proposal merged ${number}\`.`,
    );
    return this.answer(delivery, this.view(store, number, caller));
  }

  /**
   * Anybody in the organization closes a proposal that is not closed yet, with a reason: a
   * person, or an employee — the author dropping its own, or whoever a person told to take it
   * off the queue. The event records who (`by`), so an employee's rejection reads apart from a
   * person's; the author and any implementer are told, never the one who rejected.
   */
  async reject(
    projectId: string,
    orgId: string,
    number: number,
    reason: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.reject", caller, proposalSubject(number));
    const delivery = this.delivery();
    this.requireProposal(store, number);
    if (reason.trim() === "") throw badRequest("reason must not be empty.");
    const written = store.setStatus(number, (p, tx) => {
      a.check(p, { tx });
      return { status: "rejected", reason: reason.trim(), by: caller.principal };
    });
    this.notify(org, number, written.seq, "rejected");
    const p = written.proposal;
    await this.desk.tell(
      delivery,
      org,
      p,
      caller,
      a,
      "rejected",
      [p.author, ...(p.implementer !== null ? [p.implementer] : [])],
      `rejected by ${whoOf(caller)}: ${reason.trim()} — stop work on it, and close its PR if one is open.`,
    );
    return this.answer(delivery, this.view(store, number, caller));
  }

  async merged(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, stores, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.merged", caller, proposalSubject(number));
    const before = this.requireProposal(store, number);
    a.check(before);
    // The implementer and whoever approved the revision report on their word. Anybody else in
    // the organization reports on the forge's: the impl PR merged into its repository's default
    // branch, asked now.
    if (!mergedOnWord(before, caller)) await this.requireLanded(stores, before);
    const written = store.setStatus(number, (p, tx) => {
      a.check(p, { tx });
      return { status: "merged", by: caller.principal };
    });
    this.notify(org, number, written.seq, "merged");
    return this.view(store, number, caller);
  }

  /** The proposal's impl PR merged into its repository's default branch, read from the forge now; else 409. */
  private async requireLanded(stores: OrgStores, p: Proposal): Promise<void> {
    const n = p.number;
    const implPr = p.impl?.pr ?? null;
    if (implPr === null) {
      throw new ProposalError(
        409,
        "impl_pr_missing",
        `Proposal #${n} has no impl PR to check the merge against — register the PR opened for its impl branch (\`penguin org proposal impl ${n} <url>\`), or ask the implementer (${p.implementer ?? "none yet"}) or a person to report it.`,
      );
    }
    const read = await this.prStatus.landing(stores.graph, implPr.url);
    if (read === null) {
      throw new ProposalError(
        409,
        "impl_pr_not_merged",
        `Proposal #${n}'s impl PR ${implPr.label} could not be read from GitHub, so its merge cannot be confirmed — try again, or ask the implementer (${p.implementer ?? "none yet"}) or a person to report it.`,
      );
    }
    if (!read.landed) {
      const where =
        read.status === "merged"
          ? `merged into ${read.base ?? "?"}, not the default branch ${read.defaultBranch ?? "?"}`
          : read.status;
      throw new ProposalError(
        409,
        "impl_pr_not_merged",
        `Proposal #${n}'s impl PR ${implPr.label} is ${where} — report the merge once it is merged into the default branch, or ask the implementer (${p.implementer ?? "none yet"}) or a person.`,
      );
    }
  }

  async implement(
    projectId: string,
    orgId: string,
    number: number,
    req: { agentId?: string; message?: string; workspace?: string },
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail & { sessionId: string }> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.implement", caller, proposalSubject(number));
    const delivery = this.delivery();
    const p = this.requireProposal(store, number);
    // Nobody is hired to build: the author builds its own proposal unless it names a colleague.
    const implementer = req.agentId ?? p.author;
    a.check(p);
    this.requireEmployee(org, implementer, "implementer");
    const body = this.implementationBrief(org, p, req.message);
    const opened = await this.deps.gateway.openEmployeeSession({
      projectId,
      orgId,
      agentId: implementer,
      title: `Proposal #${number}: ${p.title}`,
      body,
      ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
    });
    const written = store.startImplementation(number, (now, tx) => {
      a.check(now, { tx });
      return { implementer, sessionId: opened.sessionId, by: caller.principal };
    });
    this.notify(org, number, written.seq, "implementation_started");
    await this.ensureSkills(projectId, implementer);
    return {
      ...this.answer(delivery, this.view(store, number, caller)),
      sessionId: opened.sessionId,
    };
  }

  /** The first message of an implementation session: where it stands, the rules, the proposal, the note. */
  private implementationBrief(org: OrgView, p: Proposal, message: string | undefined): string {
    const n = p.number;
    const note = message?.trim() ?? "";
    return [
      `This session implements proposal #${n} of organization ${org.orgId} ("${p.title}"). The organization is at \`<app_data_dir>/organizations/${org.orgId}/\`; the shared workspace is ${org.workspace}. Read the organization handbook's index first, then the proposal below.`,
      [
        "Rules:",
        `- Work on a branch named \`proposal/${n}-${slugOf(p.title)}\` in the repository of the shared workspace; open a pull request against the dev branch (the handbook names it; \`dev\` otherwise).`,
        `- Record the pull request: \`penguin org proposal material ${n} add pr=<url>\`.`,
        `- Stay inside the proposal's scope. Anything the proposal did not foresee — a file it does not list, an interface that has to change differently — goes back to its author: \`penguin org proposal feedback ${n} -m "<what and why>"\`. Do not widen the change silently.`,
        "- Merge into the dev branch as soon as the implementation is usable, before anyone approves the proposal: the test team checks the dev branch in batches.",
        `- When the proposal is approved (a \`[proposal #${n}]\` line on your desk says so), merge the pull request and run \`penguin org proposal merged ${n}\`.`,
      ].join("\n"),
      ...(note !== "" ? [`Note from the author: ${note}`] : []),
      `The proposal, revision ${p.revision}:\n\n${renderProposalDocument({ title: p.title, root: p.root, scope: p.scope, tests: p.tests, sections: p.sections }).trimEnd()}`,
    ].join("\n\n");
  }

  /**
   * A person opens a discussion of the proposal with its owner: a session of the owner's
   * Agent, opened the way an implementation session is (the owner's model, its desk
   * Workspace, the organization's approval mode), started on where it stands and the
   * proposal itself. It is not the desk: the desk hears of it only when it concludes.
   */
  async discuss(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail & { sessionId: string }> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.discuss", caller, proposalSubject(number));
    const p = this.requireProposal(store, number);
    a.check(p);
    // The session itself would open, but its conclusion could not reach a paused desk.
    if (org.status === "paused") {
      throw new ProposalError(
        409,
        "org_paused",
        `${org.orgId} is paused; resume it before opening a discussion.`,
      );
    }
    const owner = ownerOf(p);
    if (!org.employees.some((e) => e.agentId === owner)) {
      throw new ProposalError(
        409,
        "owner_unavailable",
        `Proposal #${number}'s ${p.implementer !== null ? "implementer" : "author"} (${owner}) is no longer an employee of ${org.orgId}; nobody can hold the discussion.`,
      );
    }
    const opened = await this.deps.gateway.openEmployeeSession({
      projectId,
      orgId,
      agentId: owner,
      title: `Discussion: proposal #${number} — ${p.title}`,
      body: this.discussionBrief(org, p, caller),
    });
    const written = store.openDiscussion(number, (now, tx) => {
      a.check(now, { tx });
      return { agentId: owner, sessionId: opened.sessionId, by: caller.principal };
    });
    this.notify(org, number, written.seq, "discussion_started");
    return { ...this.view(store, number, caller), sessionId: opened.sessionId };
  }

  /** The first message of a discussion: whose it is and what it is not, how it ends, the proposal. */
  private discussionBrief(org: OrgView, p: Proposal, caller: Caller): string {
    const n = p.number;
    const role = p.implementer !== null ? "implementer" : "author";
    const proposal =
      p.revision === 0
        ? `No revision is published yet. The brief:\n\n${p.brief}`
        : `The proposal, revision ${p.revision}:\n\n${renderProposalDocument({ title: p.title, root: p.root, scope: p.scope, tests: p.tests, sections: p.sections }).trimEnd()}`;
    return [
      `This session is a discussion of proposal #${n} (\`proposal:${n}\`) of organization ${org.orgId} ("${p.title}", ${p.status}) with ${whoOf(caller)}, a person of the Project. You are its ${role}. The organization is at \`<app_data_dir>/organizations/${org.orgId}/\`; the shared workspace is ${org.workspace}.`,
      [
        "This is not your desk:",
        "- Talk the proposal over — answer, ask, propose. Do not start work here: no revision, no branch, no file changed. That is your desk's, once the conclusion reaches it.",
        "- Keep what is said here out of your memory; the conclusion is what your desk receives, and the desk decides what to keep.",
        `- When the person agrees on a conclusion, or asks you to wrap up, send it to your desk once: \`penguin org proposal conclude ${n} --org-id ${org.orgId} -m "<what was decided, what changes in the proposal or the implementation, what stays open>"\`. If it is refused (the organization or you paused), tell the person; do not retry in a loop.`,
      ].join("\n"),
      proposal,
    ].join("\n\n");
  }

  /**
   * The discussion's conclusion goes to the owner's desk, once: from a person, or from the
   * discussion's own session — not from the owner's desk, nor a colleague. It is recorded
   * only after the desk took it, so a desk that cannot (the organization or the owner paused,
   * no desk) is answered with its reason, recorded as `notify_failed`, and the discussion
   * stays open to be concluded again.
   */
  async conclude(
    projectId: string,
    orgId: string,
    number: number,
    sessionId: string,
    text: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.conclude", caller, discussionSubject(number, sessionId));
    const p = this.requireProposal(store, number);
    a.check(p);
    const conclusion = text.trim();
    if (conclusion === "") throw badRequest("text must not be empty.");
    const discussion = p.discussions.find((x) => x.sessionId === sessionId)!;
    const key = `${projectId}/${orgId}/${sessionId}`;
    if (this.concluding.has(key)) {
      throw new ProposalError(
        409,
        "discussion_concluded",
        `Discussion ${sessionId} of proposal #${number} is already concluded.`,
      );
    }
    this.concluding.add(key);
    try {
      // The conclusion is the discussion's one product: its notice goes before the record,
      // and one that did not reach the desk leaves the discussion open to be concluded again.
      const sent = await this.desk.tell(
        this.delivery(),
        org,
        p,
        // The owner's own discussion session may conclude: its desk is told all the same.
        { ...caller, agentId: null },
        a,
        "discussion_concluded",
        [discussion.agentId],
        `the discussion with ${discussion.by.replace(/^user:/, "")} concluded (session ${sessionId}):\n\n${conclusion}\n\nRead it against the proposal (\`penguin org proposal show ${number}\`); if it changes what is proposed, revise the proposal or the branch.`,
        discussionSubject(number, sessionId).text,
      );
      const failed = sent.ok ? noticeFailures(sent.result)[0] : undefined;
      if (!sent.ok || failed !== undefined) {
        throw new ProposalError(
          failed?.status ?? 409,
          failed?.code ?? "notify_failed",
          `The conclusion did not reach ${discussion.agentId}'s desk: ${
            sent.ok ? failed!.error : sent.error
          } The discussion stays open; conclude it again once that is resolved.`,
        );
      }
      const written = store.concludeDiscussion(number, (now, tx) => {
        a.check(now, { tx });
        return { sessionId, text: conclusion, by: caller.principal };
      });
      this.notify(org, number, written.seq, "discussion_concluded");
    } finally {
      this.concluding.delete(key);
    }
    return this.view(store, number, caller);
  }

  async addMaterial(
    projectId: string,
    orgId: string,
    number: number,
    req: { kind: ProposalMaterialKind; url: string; label?: string },
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.material", caller, proposalSubject(number));
    this.requireProposal(store, number);
    if (!MATERIAL_KINDS.includes(req.kind))
      throw badRequest(`kind must be one of ${MATERIAL_KINDS.join(", ")}.`);
    const url = req.url.trim();
    if (url === "") throw badRequest("url must not be empty.");
    const label = req.label?.trim() || defaultLabel(req.kind, url);
    const written = store.addMaterial(number, (p, tx) => {
      a.check(p, { tx });
      return { kind: req.kind, label, url, by: caller.principal };
    });
    this.notify(org, number, written.seq, "material_added");
    return this.view(store, number, caller);
  }

  /**
   * Registers the proposal's impl — anybody in the organization, a person or an employee, since
   * a branch and a PR are facts the forge can confirm and the event records who (`by`). One per
   * proposal, replacing the one before:
   *
   * - `head` and `base` together declare the impl branch; each remote must name a GitHub
   *   repository, and a head that is already another proposal's is refused. The PR registered
   *   before stays only while the head is the same.
   * - `url` registers the PR; one that is already another proposal's is refused. On a declared
   *   head (this request's or the standing one) GitHub is asked for the PR: its head must be
   *   that head, and its base becomes the impl's base — a PR is its head and its base. Without
   *   a declared head the impl is named by the PR alone.
   * - A base the request names must be on the PR graph, and a merged PR may not take a branch
   *   other proposals still stack on off it (impl-on-graph.ts): judged inside the write, over the
   *   graph and PR statuses as cached; with no graph laid out yet, the answer's `hints` say the
   *   open PRs were not consulted.
   *
   * A registration refreshes the PR graph at once.
   */
  async setImpl(
    projectId: string,
    orgId: string,
    number: number,
    req: ProposalImplRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, stores, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.impl", caller, proposalSubject(number));
    const p = this.requireProposal(store, number);
    a.check(p);
    if ((req.head === undefined) !== (req.base === undefined)) {
      throw badRequest("head and base go together: name both, or neither.");
    }
    const url = req.url?.trim() ?? "";
    if (req.head === undefined && url === "") {
      throw badRequest("Name the impl: a branch pair (head and base), a PR (url), or both.");
    }
    let pr: { url: string; label: string } | null = null;
    let prKey: string | null = null;
    if (url !== "") {
      const ref = parsePullUrl(url);
      prKey = pullKey(url);
      if (ref === null || prKey === null) throw badRequest(`Not a GitHub pull request URL: ${url}`);
      pr = { url, label: `${ref.owner}/${ref.repo}#${ref.number}` };
    }
    const standing = p.impl;
    let head = req.head ?? standing?.head ?? null;
    let base = req.base ?? standing?.base ?? null;
    // A new head drops the PR of the old one; the same head keeps it. A PR registered alone
    // (no declared head) is kept only when GitHub confirms its head is the one declared now.
    let confirmCarried = false;
    // Whether the PR is merged, as this write's own read of it answered (impl-on-graph.ts).
    let merged: boolean | undefined;
    if (pr === null && standing?.pr != null) {
      if (req.head === undefined || (standing.head !== null && sameRef(standing.head, req.head))) {
        pr = standing.pr;
      } else if (standing.head === null) {
        pr = standing.pr;
        confirmCarried = true;
      }
      prKey = pr === null ? null : pullKey(pr.url);
    }
    // Each side's repository is resolved here, once, and stored with it: reads use the stored one.
    let remotes: Array<{ name: string; repo: string }> = [];
    if (head !== null && base !== null) {
      remotes = await this.remotesFor(org, p);
      const resolvedHead = lift(() => resolveRef(head!, remotes, "head"));
      lift(() => resolveRef(base!, remotes, "base"));
      if (sameRef(head, base)) {
        throw badRequest(`head and base are the same branch, ${refLabel(head)}.`);
      }
      if (confirmCarried && pr !== null) {
        const carried = pr;
        const pull = await readPullBranches(this.gh(), carried.url).catch(() => null);
        const matches =
          pull !== null &&
          pull.head.repo.toLowerCase() === resolvedHead.repo.toLowerCase() &&
          pull.head.branch === resolvedHead.branch;
        if (!matches) {
          pr = null;
          prKey = null;
        } else merged = pull.merged;
      }
      // A PR named in this request is checked against the head; a carried one was checked when it was named.
      if (pr !== null && url !== "") {
        const pull = await liftAsync(() => readPullBranches(this.gh(), pr!.url));
        merged = pull.merged;
        if (
          pull.head.repo.toLowerCase() !== resolvedHead.repo.toLowerCase() ||
          pull.head.branch !== resolvedHead.branch
        ) {
          throw new ProposalError(
            409,
            "impl_pr_mismatch",
            `${pr.label}'s head is ${pull.head.repo}:${pull.head.branch}, not the impl branch's head ${refLabel(head)} (${resolvedHead.repo}:${resolvedHead.branch}): open the PR from that head, or register the PR's head with --head.`,
          );
        }
        const prBase = {
          remote: remoteFor(pull.base.repo, remotes, base.remote),
          branch: pull.base.branch,
        };
        if (req.base !== undefined) {
          const declared = lift(() => resolveRef(req.base!, remotes, "base"));
          if (
            declared.repo.toLowerCase() !== pull.base.repo.toLowerCase() ||
            declared.branch !== pull.base.branch
          ) {
            throw new ProposalError(
              409,
              "impl_pr_mismatch",
              `${pr.label} is based on ${pull.base.repo}:${pull.base.branch}, not ${refLabel(req.base)} (${declared.repo}:${declared.branch}): a PR registers its own base — leave --base out, or name that one.`,
            );
          }
        }
        base = req.base ?? prBase;
      }
    } else {
      head = null;
      base = null;
    }
    const side = (ref: ProposalBranchRef | null, what: string): ProposalImplSide | null => {
      if (ref === null) return null;
      const resolved = lift(() => resolveRef(ref, remotes, what));
      return { remote: ref.remote, repo: resolved.repo, branch: ref.branch };
    };
    const plan = {
      head: side(head, "head"),
      base: side(base, "base"),
      pr: pr === null || prKey === null ? null : { ...pr, key: prKey },
      by: caller.principal,
    };
    const cached = this.graphs.cached(this.graphContext(projectId, orgId, org, stores));
    const declaredBase = req.base !== undefined;
    const facts = implGraphFacts({
      cached,
      store: stores.graph,
      planned: plan,
      declaredBase,
      ...(merged !== undefined ? { merged } : {}),
    });
    const written = store.setImpl(number, (now, tx) => {
      const current = now.impl;
      const unchanged =
        current !== null &&
        (current.pr === null) === (plan.pr === null) &&
        (plan.pr === null || pullKey(current.pr!.url) === plan.pr.key) &&
        sameSide(current.head, plan.head) &&
        sameSide(current.base, plan.base);
      if (unchanged) return null;
      a.check(now, { tx, params: { planned: plan, facts } });
      return plan;
    });
    if (written === null) return this.view(store, number, caller);
    this.notify(org, number, written.seq, "material_added");
    void this.graphs.kick(this.graphContext(projectId, orgId, org, stores));
    // The note only where a base was judged without the open PRs (impl-on-graph.ts).
    const skipped =
      declaredBase && !sameSide(standing?.base ?? null, plan.base) && facts.openHeads === null;
    const detail = this.view(store, number, caller);
    return skipped ? { ...detail, hints: [OPEN_PRS_UNCHECKED] } : detail;
  }

  /** The impl branch's patch — the merge base of base and head, up to head — read from GitHub now. */
  async implDiff(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalImplDiff> {
    const { org, store } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(store, number);
    const resolved = await this.resolvedImpl(p);
    if (resolved === null) throw noImpl(number);
    return liftAsync(() => compareBranches(this.gh(), resolved.base, resolved.head, resolved.pr));
  }

  /**
   * The impl branch's diff file by file, with hunks (impl-diff.ts): read from the base
   * repository's mirror, or parsed from GitHub's comparison when the mirror cannot answer.
   */
  async implChanges(
    projectId: string,
    orgId: string,
    number: number,
    opts: { ignoreWhitespace: boolean },
    actor: OrgActor,
  ): Promise<ProposalImplChanges> {
    const { store } = await this.open(projectId, orgId, actor);
    return this.changesOf(projectId, orgId, this.requireProposal(store, number), opts);
  }

  /** The impl's structured diff, through the cache the diff view and `+N/−M` share. */
  private async changesOf(
    projectId: string,
    orgId: string,
    p: Proposal,
    opts: { ignoreWhitespace: boolean },
  ): Promise<ProposalImplChanges> {
    const resolved = await this.resolvedImpl(p);
    if (resolved === null) throw noImpl(p.number);
    const orgDir = path.join(this.deps.root, projectId, "organizations", orgId);
    const repo = resolved.base.repo;
    const mirror =
      this.deps.diffMirrorFor?.(orgDir, repo) ??
      new LocalGitMirror({ dir: mirrorDir(orgDir, repo), url: githubUrl(repo) });
    return liftAsync(() =>
      implChanges(
        {
          gh: this.gh(),
          mirror,
          cache: this.changes,
          log: (line) => this.deps.log.line(line),
        },
        { ...resolved, ignoreWhitespace: opts.ignoreWhitespace },
      ),
    );
  }

  /**
   * The impl's `+N/−M` as known now (impl-stat.ts): never waits — a missing or stale answer is
   * computed in the background, and a changed one is announced with an `impl_stat` event.
   */
  private implStatOf(org: OrgView, p: Proposal): ProposalImplStat | undefined {
    if (p.impl === null) return undefined;
    const i = p.impl;
    const side = (r: { remote: string; repo: string; branch: string } | null) =>
      r === null ? "" : `${r.repo}:${r.branch}`;
    return this.stats.read(
      `${org.projectId}/${org.orgId}#${p.number}`,
      `${side(i.head)}|${side(i.base)}|${i.pr?.url ?? ""}`,
      async () =>
        statOf(await this.changesOf(org.projectId, org.orgId, p, { ignoreWhitespace: false })),
      () => this.notify(org, p.number, p.seq, "impl_stat"),
    );
  }

  /**
   * The proposal's impl as GitHub names it: the declared pair with the repositories stored at
   * registration, or — registered as a PR alone — that PR's head and base, read from GitHub now.
   */
  private async resolvedImpl(p: Proposal): Promise<{
    head: ProposalResolvedBranch;
    base: ProposalResolvedBranch;
    pr: string | null;
  } | null> {
    const impl = p.impl;
    if (impl === null) return null;
    const pr = impl.pr?.url ?? null;
    if (impl.head !== null && impl.base !== null) {
      // The repositories resolved at registration, not the remotes as they read now.
      return { head: impl.head, base: impl.base, pr };
    }
    const pull = await liftAsync(() => readPullBranches(this.gh(), pr!));
    return {
      head: { remote: null, repo: pull.head.repo, branch: pull.head.branch },
      base: { remote: null, repo: pull.base.repo, branch: pull.base.branch },
      pr,
    };
  }

  /** A directory's GitHub remotes (`git remote -v`, local: no network). */
  private async remotesOfDir(dir: string): Promise<Array<{ name: string; repo: string }>> {
    return remotesOf(await (this.deps.git ?? gitRunner())(dir, ["remote", "-v"]));
  }

  /** The GitHub remotes of the proposal's repository (its `root` in the shared workspace); none when git cannot say. */
  private async remotesFor(
    org: OrgView,
    p: Pick<Proposal, "root">,
  ): Promise<Array<{ name: string; repo: string }>> {
    const dir = scopeBase(org.workspace, p.root);
    try {
      return await this.remotesOfDir(dir);
    } catch (err) {
      this.deps.log.line(
        `[company-proposals] remotes of ${dir} not read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private gh(): RunGh {
    return this.deps.gh ?? ghRunner();
  }

  /**
   * The one-time adoption for proposals with PR materials and no impl — anybody in the
   * organization, each impl recording who (`by`): each proposal without one (and not rejected)
   * takes its latest `pr` material on the delivery repository.
   */
  async adoptImpl(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalAdoptImplResponse> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.impl.adopt", caller, ORGANIZATION);
    a.check(null);
    const facts = store.facts();
    const { repo } = await this.project(org, facts, []);
    if (repo === null) throw graphOff();
    const prefix = `${repo.toLowerCase()}#`;
    const taken = new Set(
      facts
        .map((p) => (p.impl?.pr == null ? null : pullKey(p.impl.pr.url)))
        .filter((k): k is string => k !== null),
    );
    const out: ProposalAdoptImplResponse = { adopted: [], ambiguous: [], skipped: [] };
    for (const p of facts) {
      if (p.impl !== null || p.status === "rejected") continue;
      const urls = p.prMaterials.filter((u) => (pullKey(u) ?? "").startsWith(prefix));
      const url = urls.at(-1);
      if (url === undefined) {
        out.skipped.push({ number: p.number, reason: `no pr material on ${repo}` });
        continue;
      }
      const key = pullKey(url)!;
      if (taken.has(key)) {
        out.skipped.push({ number: p.number, reason: `${url} is already another proposal's` });
        continue;
      }
      taken.add(key);
      const ref = parsePullUrl(url)!;
      const plan = {
        head: null,
        base: null,
        pr: { url, label: `${ref.owner}/${ref.repo}#${ref.number}`, key },
        by: caller.principal,
      };
      const written = store.setImpl(p.number, (now, tx) => {
        if (now.impl !== null) return null;
        a.check(now, { tx, params: { planned: plan } });
        return plan;
      });
      if (written === null) continue;
      this.notify(org, p.number, written.seq, "material_added");
      out.adopted.push({ number: p.number, url });
      if (new Set(urls.map((u) => pullKey(u))).size > 1) {
        out.ambiguous.push({ number: p.number, urls });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Deployments (deployments.ts, deploy-store.ts)
  // ---------------------------------------------------------------------------

  private probe(): ProbeServer {
    return this.deps.probe ?? fetchProbe();
  }

  /** The registry: every registered deployment, in order; none is on it by default. */
  async deployments(
    projectId: string,
    orgId: string,
    actor: OrgActor,
  ): Promise<ProposalDeploymentsResponse> {
    const { stores } = await this.open(projectId, orgId, actor);
    return { deployments: registryOf(await stores.deployments.list()) };
  }

  /**
   * Registers a deployment, anyone in the organization: refused when it repeats a registered
   * deployment by id, by url, or by the install id a server deployment's url answers now.
   */
  async registerDeployment(
    projectId: string,
    orgId: string,
    req: ProposalDeploymentRegisterRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDeploymentsResponse> {
    const { org, stores, caller } = await this.open(projectId, orgId, actor, act);
    (act ?? defaultAct("target.register", caller, ORGANIZATION)).check(null);
    try {
      const id = deploymentIdOf(typeof req.id === "string" ? req.id : "");
      const url =
        typeof req.url === "string" && req.url.trim() !== "" ? normalizeServerUrl(req.url) : null;
      // Id and url first: a repeat of either is refused without asking the url.
      requireUnregistered(await stores.deployments.list(), { id, url, installId: null });
      let installId: string | null = null;
      if (url !== null) {
        try {
          installId = (await this.probe()(url)).installId;
        } catch (err) {
          throw new DeploymentRegistryError(
            422,
            "deployment_unreachable",
            `${url} was not read as a penguin server: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const candidate = { id, url, installId };
      const registered = await stores.deployments.append(
        { id, url, installId, by: caller.principal },
        (now) => requireUnregistered(now, candidate),
      );
      // The graph places it once its server is probed: at once, not at the next window.
      void this.graphs.kick(this.graphContext(projectId, orgId, org, stores), false);
      return { deployments: registryOf(registered) };
    } catch (err) {
      if (err instanceof DeploymentRegistryError) {
        throw new ProposalError(err.status, err.code, err.message);
      }
      throw err;
    }
  }

  /** What the graph refresher reads of an organization. */
  private graphContext(
    projectId: string,
    orgId: string,
    org: OrgView,
    stores: OrgStores,
  ): GraphContext {
    return {
      key: `${projectId}/${orgId}`,
      orgDir: path.join(this.deps.root, projectId, "organizations", orgId),
      store: stores.graph,
      deployments: stores.deployments,
      settings: () => this.settingsProject(),
      discover: async () => {
        const errors: string[] = [];
        const project = await this.project(org, stores.proposals.facts(), errors);
        return { project, errors };
      },
      proposals: () => {
        const facts = stores.proposals.facts();
        const heads = declaredHeads(facts);
        return facts.map((p): GraphProposal => ({
          number: p.number,
          title: p.title,
          status: p.status,
          implPr: p.impl?.pr?.url ?? null,
          implBranch: heads.get(p.number) ?? null,
        }));
      },
    };
  }

  /**
   * The PR graph of the delivery repository, annotated with the proposals and the origins, from
   * the store (graph-refresh.ts). Always drawn: with no delivery repository at all it is the
   * base branch alone, and `errors` says why. `refresh` waits for a forced refresh first.
   *
   * A read that was under way when the organization's delete began (a forced refresh waits
   * for git and the forge) fails once the retirement aborts the refresh and closes the store:
   * it answers 404 `org_not_found` like every request after the delete, not 500. Only a failure
   * of a read whose stores were retired meanwhile is answered so; any other failure stays.
   */
  async graph(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    opts: { refresh?: boolean } = {},
  ): Promise<ProposalGraphResponse> {
    const { org, stores } = await this.open(projectId, orgId, actor);
    try {
      return await this.graphs.read(this.graphContext(projectId, orgId, org, stores), opts);
    } catch (err) {
      const retired =
        err instanceof OrgRetiredError || this.stores.get(`${projectId}/${orgId}`) !== stores;
      if (retired) {
        throw new ProposalError(404, "org_not_found", `Organization does not exist: ${orgId}`);
      }
      throw err;
    }
  }

  /** A deploy run ended: what the deployments run is read again, and the graph with it. */
  deployFinished(projectId: string, orgId: string): void {
    const key = `${projectId}/${orgId}`;
    const stores = this.stores.get(key);
    if (stores === undefined) return;
    void this.deps.gateway.organization(projectId, orgId).then((org) => {
      if (org !== null)
        return this.graphs.kick(this.graphContext(projectId, orgId, org, stores), false);
    });
  }

  /** Settles once the organization's graph refresh in flight (if any) ends (tests). */
  async graphSettled(projectId: string, orgId: string): Promise<void> {
    while (this.graphs.refreshing(`${projectId}/${orgId}`)) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /**
   * What the subject resolver (builtin-actions.ts) reads of an organization the registry has
   * already let the caller into: a proposal as it stands, its impl's head, the remotes of the
   * shared workspace and the delivery repository.
   */
  async subjects(
    projectId: string,
    orgId: string,
  ): Promise<HeadScope & { proposal(number: number): Proposal; gh: RunGh }> {
    const { org, store } = await this.openInternal(projectId, orgId);
    return {
      gh: this.gh(),
      proposal: (number) => this.requireProposal(store, number),
      impl: async (number) => {
        const p = this.requireProposal(store, number);
        if (p.impl === null) return null;
        if (p.impl.head === null) return { pr: p.impl.pr!.url, head: null };
        const head = p.impl.head;
        return { pr: p.impl.pr?.url ?? null, head: { repo: head.repo, branch: head.branch } };
      },
      remotes: () => this.remotesFor(org, { root: "" }),
      deliveryRepo: async () => (await this.project(org, store.facts(), [])).repo,
    };
  }

  async feedback(
    projectId: string,
    orgId: string,
    number: number,
    req: { text: string; runtime?: boolean },
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.feedback", caller, proposalSubject(number));
    const delivery = this.delivery();
    this.requireProposal(store, number);
    const text = req.text.trim();
    if (text === "") throw badRequest("text must not be empty.");
    const runtime = req.runtime === true;
    const written = store.feedback(number, (p, tx) => {
      a.check(p, { tx });
      return { text, runtime, by: caller.principal };
    });
    this.notify(org, number, written.seq, runtime ? "runtime_feedback" : "feedback");
    const p = written.proposal;
    const to = [p.author];
    if (runtime && p.implementer !== null) to.push(p.implementer);
    await this.desk.tell(
      delivery,
      org,
      p,
      caller,
      a,
      "feedback",
      to,
      runtime
        ? `runtime feedback from ${whoOf(caller)}: ${text}\n\nRevise together — the author updates the proposal (\`penguin org proposal publish ${number} --file …\`), the implementer the branch.`
        : `feedback from ${whoOf(caller)}: ${text}\n\nRevise the proposal if it changes what is proposed: \`penguin org proposal publish ${number} --file …\`.`,
    );
    return this.answer(delivery, this.view(store, number, caller));
  }

  /**
   * The comments the caller may see, with the sections marked for an agent (see
   * comments.ts): `pending` narrows to the batched, unresolved ones — the author's work list.
   */
  async comments(
    projectId: string,
    orgId: string,
    number: number,
    opts: { pending: boolean },
    actor: OrgActor,
  ): Promise<ProposalCommentsResponse> {
    const { store, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(store, number);
    const visible = this.visibleComments(p, caller);
    const comments = opts.pending
      ? visible.filter((c) => c.batchId !== null && c.resolved === undefined)
      : visible;
    return {
      number: p.number,
      comments,
      text: renderForAgent(p, comments, {
        resolveCommand: (id) => `penguin org proposal resolve ${number} ${id} -m "<what changed>"`,
      }),
    };
  }

  /**
   * A comment on `[start, end)` of a section's source — the slice must be the quote, so a stale
   * page cannot anchor a comment to the wrong words — or on a target (comment-targets.ts), which
   * must stand in the current revision or the diff as it reads now.
   */
  async comment(
    projectId: string,
    orgId: string,
    number: number,
    req:
      | { sectionId: string; start: number; end: number; quote: string; text: string }
      | { target: ProposalCommentTarget; text: string },
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.comment", caller, proposalSubject(number));
    const current = this.requireProposal(store, number);
    a.check(current);
    const text = req.text.trim();
    if (text === "") throw badRequest("text must not be empty.");
    const target = "target" in req ? req.target : null;
    // The diff is read before the write: no await inside the transaction.
    const diffQuote =
      target === null || target.kind === "scope" || target.kind === "test"
        ? null
        : await diffTargetQuote(target, (ignoreWhitespace) =>
            this.changesOf(projectId, orgId, current, { ignoreWhitespace }),
          );
    const written = store.addComment(number, (p, tx) => {
      a.check(p, { tx });
      const id = `c${p.comments.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
      const common = { id, revision: p.revision, text, by: caller.principal };
      if (target !== null) {
        checkDocTarget(target, p);
        const quote =
          diffQuote ?? (target.kind === "scope" || target.kind === "test" ? target.file : "");
        return { ...common, target, sectionId: "", range: { start: 0, end: 0 }, quote };
      }
      const r = req as Exclude<typeof req, { target: ProposalCommentTarget }>;
      const section = p.sections.find((s) => s.id === r.sectionId);
      if (section === undefined) {
        throw badRequest(`No section ${r.sectionId} in revision ${p.revision}.`);
      }
      const source = sectionSource(section);
      const inRange =
        Number.isInteger(r.start) &&
        Number.isInteger(r.end) &&
        r.start >= 0 &&
        r.start < r.end &&
        r.end <= source.length;
      if (!inRange || source.slice(r.start, r.end) !== r.quote) {
        throw new ProposalError(
          400,
          "comment_range",
          `The range [${r.start}, ${r.end}) of section ${r.sectionId} does not read as quoted in revision ${p.revision}; reload the proposal and select again.`,
        );
      }
      const paragraphId = paragraphAtOffset(section, r.start);
      return {
        ...common,
        sectionId: r.sectionId,
        range: { start: r.start, end: r.end },
        quote: r.quote,
        ...(paragraphId !== null ? { paragraphId } : {}),
      };
    });
    this.notify(org, number, written.seq, "comment");
    return this.view(store, number, caller);
  }

  async requestChanges(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.requestChanges", caller, proposalSubject(number));
    const delivery = this.delivery();
    this.requireProposal(store, number);
    let sent = 0;
    const written = store.requestChanges(number, (p, tx) => {
      a.check(p, { tx });
      const batch = batchOf(p, caller);
      sent = batch.commentIds.length;
      return {
        id: batch.batchId,
        commentIds: batch.commentIds,
        revision: p.revision,
        status: batch.status,
        by: caller.principal,
      };
    });
    this.notify(org, number, written.seq, "changes_requested");
    const p = written.proposal;
    await this.desk.tell(
      delivery,
      org,
      p,
      caller,
      a,
      "changes_requested",
      [p.author],
      `${whoOf(caller)} requested changes: a batch of ${sent} comment${sent === 1 ? "" : "s"} — read it with \`penguin org proposal comments ${number} --pending\`, resolve each (\`penguin org proposal resolve ${number} <commentId> -m …\`), then publish the revision and mark it ready again.`,
    );
    return this.answer(delivery, this.view(store, number, caller));
  }

  async resolve(
    projectId: string,
    orgId: string,
    number: number,
    commentId: string,
    text: string | undefined,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.resolve", caller, commentSubject(number, commentId));
    this.requireProposal(store, number);
    const written = store.resolveComment(number, (p, tx) => {
      a.check(p, { tx });
      return { id: commentId, text: text?.trim() ?? "", by: caller.principal };
    });
    this.notify(org, number, written.seq, "resolved");
    return this.view(store, number, caller);
  }

  async editComment(
    projectId: string,
    orgId: string,
    number: number,
    commentId: string,
    text: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("proposal.comment.edit", caller, commentSubject(number, commentId));
    a.check(this.requireProposal(store, number));
    const next = text.trim();
    if (next === "") throw badRequest("text must not be empty.");
    const written = store.editComment(number, (p, tx) => {
      a.check(p, { tx });
      return { id: commentId, text: next };
    });
    this.notify(org, number, written.seq, "comment");
    return this.view(store, number, caller);
  }

  async deleteComment(
    projectId: string,
    orgId: string,
    number: number,
    commentId: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<ProposalDetail> {
    const { org, store, caller } = await this.open(projectId, orgId, actor, act);
    const a =
      act ?? defaultAct("proposal.comment.withdraw", caller, commentSubject(number, commentId));
    this.requireProposal(store, number);
    const written = store.deleteComment(number, (p, tx) => {
      a.check(p, { tx });
      return { id: commentId };
    });
    this.notify(org, number, written.seq, "comment");
    return this.view(store, number, caller);
  }

  /** Moves the caller's read position forward (never back) — a person's or an employee's. */
  async read(
    projectId: string,
    orgId: string,
    number: number,
    upTo: number,
    actor: OrgActor,
  ): Promise<void> {
    const { store, caller } = await this.open(projectId, orgId, actor);
    this.requireExists(store, number);
    store.markRead(readerOf(caller), number, upTo);
  }
}

/** Whose read position a caller moves: a person's user id, an employee's principal. */
function readerOf(caller: Caller): string {
  return caller.agentId === null ? caller.userId : caller.principal;
}

/** The subjects of a use case called directly, for the default guard of its Action. */
const ORGANIZATION: Subject = parseSubject("organization");
const proposalSubject = (number: number): Subject => parseSubject(`proposal:${number}`);
const commentSubject = (number: number, id: string): Subject => ({
  kind: "comment",
  id: `${number}/${id}`,
  text: `comment:${number}/${id}`,
});
const discussionSubject = (number: number, sessionId: string): Subject => ({
  kind: "discussion",
  id: `${number}/${sessionId}`,
  text: `discussion:${number}/${sessionId}`,
});

function defaultLabel(kind: ProposalMaterialKind, url: string): string {
  const pr = /\/pull\/(\d+)/.exec(url);
  if (kind === "pr" && pr !== null) return `PR #${pr[1]}`;
  const issue = /\/issues\/(\d+)/.exec(url);
  if (kind === "issue" && issue !== null) return `issue #${issue[1]}`;
  if (kind === "ticket") return `ticket ${url}`;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Orders two dated plugin versions (`YYYY.MM.DD.N`, or the legacy `YYYY-MM-DD.N`): by date,
 * then numerically by sequence. What is not a version sorts first, so the library wins.
 */
export function compareDatedVersions(a: string, b: string): number {
  const parse = (v: string): [string, number] | null => {
    const m = /^(\d{4})[.-](\d{2})[.-](\d{2})\.(\d+)$/.exec(v.trim());
    return m === null ? null : [`${m[1]}${m[2]}${m[3]}`, Number(m[4])];
  };
  const va = parse(a);
  const vb = parse(b);
  if (va === null || vb === null) return Number(va !== null) - Number(vb !== null);
  if (va[0] !== vb[0]) return va[0] < vb[0] ? -1 : 1;
  return va[1] - vb[1];
}

/**
 * A proposal's materials with its impl PR among them. An impl PR set directly (`setImpl`, the
 * admin's override, or a restack re-pointing one) is an impl of its own and not a material, so
 * the Materials list read "no materials yet" beside a proposal that has its PR. When no `pr`
 * material is that pull request, it is listed first, as the PR it is.
 */
export function withImplPr(
  materials: readonly ProposalMaterial[],
  implPr: { url: string; label: string; by: string; at: string } | null,
): ProposalMaterial[] {
  if (implPr === null) return [...materials];
  const key = pullKey(implPr.url);
  const held = materials.some(
    (m) => m.kind === "pr" && (key === null ? m.url === implPr.url : pullKey(m.url) === key),
  );
  if (held) return [...materials];
  return [
    { kind: "pr", label: implPr.label, url: implPr.url, by: implPr.by, at: implPr.at },
    ...materials,
  ];
}

/** The impl PR as the API lists it: the PR on the impl branch, with who registered the impl and when. */
function implPrOf(
  impl: ProposalImpl | null,
): { url: string; label: string; by: string; at: string } | null {
  return impl?.pr == null ? null : { ...impl.pr, by: impl.by, at: impl.at };
}

/**
 * A stored side as the API shows it, with its branch page. The workspace remote it is looked up
 * in is the one registration read (`git remote -v` of the proposal's repository, stored as
 * `repo`), so a view never runs git; an `origins` line of the same name answers only when
 * registration recorded no repository, so the link and the patch view name the same one.
 */
function declaredSide(
  side: ProposalImplSide | null,
  origins: ReadonlyArray<{ name: string; repo: string }>,
): ProposalImplBranchSide | null {
  if (side === null) return null;
  const ref = { remote: side.remote, branch: side.branch };
  const remotes = side.repo === "" ? [] : [{ name: side.remote, repo: side.repo }];
  return { ...ref, ...branchLinkOf(ref, origins, remotes) };
}

/** Two stored sides are the same: the same branch, resolved to the same repository. */
function sameSide(a: ProposalImplSide | null, b: ProposalImplSide | null): boolean {
  return a === null || b === null
    ? a === b
    : sameRef(a, b) && a.repo.toLowerCase() === b.repo.toLowerCase();
}

const noImpl = (number: number): ProposalError =>
  new ProposalError(
    409,
    "no_impl",
    `Proposal #${number} has no impl: register its branch (\`penguin org proposal impl ${number} --head <remote> <branch> --base <remote> <branch>\`) or its PR first.`,
  );

/** impl-branch.ts's refusals, as the service's own. */
function lift<T>(f: () => T): T {
  try {
    return f();
  } catch (err) {
    if (err instanceof ImplBranchError) throw new ProposalError(err.status, err.code, err.message);
    throw err;
  }
}

async function liftAsync<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    if (err instanceof ImplBranchError) throw new ProposalError(err.status, err.code, err.message);
    throw err;
  }
}
