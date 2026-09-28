/**
 * The proposal service: the state machine over the ledger, the views a caller gets of it,
 * and the one way it speaks to employees — a line of work put straight on the employee's
 * desk, `[proposal #<n>] ` + what happened + the command to run, in nobody's name. No
 * channel, no trigger kind of its own.
 *
 * Who may do what follows the roles: the person delegates, comments, requests changes,
 * approves and rejects; the author publishes, marks ready, asks for an implementer and
 * resolves comments; the implementer reports merged; anybody in the organization gives
 * feedback. A person may also do what the author or the implementer may, so a stuck
 * proposal never waits on an employee that is not answering.
 *
 * Reads are per person: a read position (the last `seq` seen) per proposal, kept in the
 * server's settings store, and the counts the queue shows derive from it. An employee has
 * no read position — the page is for people.
 */
import type {
  AgentLifecycle,
  Log,
  OrgActor,
  OrgGateway,
  OrgView,
  PluginConfig,
  Settings,
} from "@prismshadow/penguin-server/plugin";
import type {
  ProposalComment,
  ProposalCommentsResponse,
  ProposalDetail,
  ProposalFileResponse,
  ProposalItem,
  ProposalMaterial,
  ProposalRevision,
  ProposalRevisionsResponse,
  ProposalMaterialKind,
  ProposalPluginEvent,
  ProposalStatus,
  ProposalTestGroup,
  ProposalTestGroupsResponse,
  ProposalsResponse,
} from "@prismshadow/penguin-server/api";
import { CONFIG_GROUP, testGroupsOf, undeclaredGroupsMessage } from "./config.js";
import { renderForAgent, sectionSource } from "./comments.js";
import { readBaseFile } from "./files.js";
import { PrStatusReader, type RunGh } from "./pr-status.js";
import { Ledger, ledgerPath, type Proposal } from "./ledger.js";
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

/** The plugin's name in the `plugin` server event and in the settings keys. */
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

/** What a refused operation answers; the route sends it as `{ error: { code, message } }`. */
export class ProposalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

export interface ServiceDeps {
  gateway: OrgGateway;
  /** The Agent lifecycle: what an employee carries of the skills plugin, and installing it. */
  agents: Pick<AgentLifecycle, "pluginVersion" | "updatePlugin">;
  /** The data root (Paths.root). */
  root: string;
  settings: Pick<Settings, "get" | "set">;
  log: Pick<Log, "line">;
  /** The plugin's settings group (config.ts); the declared defaults when absent (a test that does not care). */
  pluginConfig?: Pick<PluginConfig, "get">;
  now?: () => number;
  /** How the PR status lookup runs `gh`; the machine's own by default (a test feeds answers). */
  gh?: RunGh;
}

/** One write's desk deliveries: the ledger a failed delivery is recorded in, and the reasons collected for the answer. */
interface Delivery {
  ledger: Ledger;
  hints: string[];
}

/** The caller, resolved: the principal the write is recorded under, and the person behind it when there is one. */
interface Caller {
  principal: string;
  agentId: string | null;
  userId: string;
}

const badRequest = (message: string): ProposalError =>
  new ProposalError(400, "bad_request", message);
const forbidden = (code: string, message: string): ProposalError =>
  new ProposalError(403, code, message);

/**
 * A closed proposal: merged, rejected by a person, or withdrawn by its author. It takes no
 * more implementation sessions, discussions or rejections.
 */
function isClosed(status: ProposalStatus): boolean {
  return status === "merged" || status === "rejected" || status === "withdrawn";
}

/** Who acted, as a message names them: the employee's Agent id, else the person's user id. */
function whoOf(caller: Caller): string {
  return caller.agentId ?? caller.userId;
}

function userPrincipal(userId: string): string {
  return `user:${userId}`;
}
function agentPrincipal(agentId: string): string {
  return `agent:${agentId}`;
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
  private readonly ledgers = new Map<string, Ledger>();

  /** Conclusions being delivered (`<projectId>/<orgId>/<sessionId>`): a second one waits for nothing and is refused. */
  private readonly concluding = new Set<string>();

  /** GitHub's word on each `pr` material, read when a proposal is read (pr-status.ts). */
  private readonly prStatus: PrStatusReader;

  constructor(private readonly deps: ServiceDeps) {
    this.prStatus = new PrStatusReader({
      ...(deps.gh !== undefined ? { gh: deps.gh } : {}),
      log: (line) => deps.log.line(line),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
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

  private ledger(projectId: string, orgId: string): Ledger {
    const key = `${projectId}/${orgId}`;
    let ledger = this.ledgers.get(key);
    if (ledger === undefined) {
      ledger = new Ledger(
        ledgerPath(this.deps.root, projectId, orgId),
        () => this.now(),
        (line) => this.deps.log.line(line),
      );
      this.ledgers.set(key, ledger);
    }
    return ledger;
  }

  // ---------------------------------------------------------------------------
  // Access
  // ---------------------------------------------------------------------------

  /** The organization, with company mode on and the caller belonging to it; the ledger loaded. */
  private async open(
    projectId: string,
    orgId: string,
    actor: OrgActor,
  ): Promise<{ org: OrgView; ledger: Ledger; caller: Caller }> {
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new ProposalError(404, "company_mode_off", "Company mode is off.");
    }
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) {
      throw new ProposalError(404, "org_not_found", `Organization does not exist: ${orgId}`);
    }
    const principal = await this.deps.gateway.principalOf(projectId, orgId, actor);
    const agentId = principal.startsWith("agent:") ? principal.slice("agent:".length) : null;
    if (agentId === null && !org.userIds.includes(actor.userId)) {
      throw forbidden("project_access", "Not a member of this Project.");
    }
    const ledger = this.ledger(projectId, orgId);
    await ledger.load();
    return { org, ledger, caller: { principal, agentId, userId: actor.userId } };
  }

  private requireProposal(ledger: Ledger, number: number): Proposal {
    const p = ledger.get(number);
    if (p === undefined) {
      throw new ProposalError(404, "proposal_not_found", `Proposal #${number} does not exist.`);
    }
    return p;
  }

  private requireEmployee(org: OrgView, agentId: string, role: string): void {
    if (!org.employees.some((e) => e.agentId === agentId)) {
      throw badRequest(`${role} must be an employee of ${org.orgId}: ${agentId}`);
    }
  }

  private isPerson(caller: Caller): boolean {
    return caller.agentId === null;
  }

  private requirePerson(caller: Caller, what: string): void {
    if (!this.isPerson(caller)) {
      throw forbidden("person_required", `Only a person can ${what}.`);
    }
  }

  private requireAuthorOrPerson(p: Proposal, caller: Caller, what: string): void {
    if (this.isPerson(caller) || caller.agentId === p.author) return;
    throw forbidden("not_author", `Only the author (${p.author}) or a person can ${what}.`);
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private readsKey(projectId: string, orgId: string, userId: string): string {
    return `${PLUGIN_NAME}:reads:${projectId}/${orgId}/${userId}`;
  }

  private readPositions(projectId: string, orgId: string, userId: string): Record<string, number> {
    const raw = this.deps.settings.get(this.readsKey(projectId, orgId, userId));
    if (raw === null) return {};
    try {
      const value = JSON.parse(raw) as unknown;
      return typeof value === "object" && value !== null ? (value as Record<string, number>) : {};
    } catch {
      return {};
    }
  }

  private unreadOf(p: Proposal, caller: Caller, reads: Record<string, number>): number {
    if (!this.isPerson(caller)) return 0;
    const seen = reads[String(p.number)] ?? 0;
    return p.events.filter((e) => e.seq > seen && e.by !== caller.principal).length;
  }

  /** Pending comments are the commenter's own until requested; an employee sees only batched ones. */
  private visibleComments(p: Proposal, caller: Caller): ProposalComment[] {
    return p.comments.filter((c) => c.batchId !== null || c.by === caller.principal);
  }

  private item(p: Proposal, caller: Caller, reads: Record<string, number>): ProposalItem {
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
      unread: this.unreadOf(p, caller, reads),
      pendingComments: p.comments.filter((c) => c.batchId === null && c.by === caller.principal)
        .length,
      materials: p.materials,
    };
  }

  private detail(p: Proposal, caller: Caller, reads: Record<string, number>): ProposalDetail {
    return {
      ...this.item(p, caller, reads),
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
    const { ledger } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    return {
      revisions: [...p.revisions.values()]
        .sort((a, b) => a.revision - b.revision)
        .map((r) => ({ revision: r.revision, by: r.by, at: r.at })),
    };
  }

  /** One revision as it was published — what the page diffs the head against. */
  async revision(
    projectId: string,
    orgId: string,
    number: number,
    rev: number,
    actor: OrgActor,
  ): Promise<ProposalRevision> {
    const { ledger } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    const found = p.revisions.get(rev);
    if (found === undefined) {
      throw new ProposalError(
        404,
        "revision_not_found",
        `Proposal #${number} has no revision ${rev}.`,
      );
    }
    return found;
  }

  async list(projectId: string, orgId: string, actor: OrgActor): Promise<ProposalsResponse> {
    const { ledger, caller } = await this.open(projectId, orgId, actor);
    const reads = this.readPositions(projectId, orgId, caller.userId);
    const proposals = ledger
      .proposals()
      .sort((a, b) => b.number - a.number)
      .map((p) => this.item(p, caller, reads));
    return { proposals };
  }

  async get(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    const detail = await this.withScope(
      org,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
    return {
      ...detail,
      materials: await this.withPrStatus(detail.materials),
      testGroups: this.testGroups(),
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
    const { org, ledger } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
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

  /** The `pr` materials with GitHub's word on them, the rest as they are; nothing here fails the read. */
  private async withPrStatus(materials: ProposalMaterial[]): Promise<ProposalMaterial[]> {
    return Promise.all(
      materials.map(async (m) => {
        if (m.kind !== "pr") return m;
        const read = await this.prStatus.read(m.url);
        return read === null ? m : { ...m, status: read.status, statusCheckedAt: read.checkedAt };
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Desk delivery: how the plugin speaks to employees
  // ---------------------------------------------------------------------------

  /** What one write's deliveries report back: the ledger a failed delivery is recorded in, and the reasons, for the answer. */
  private delivery(ledger: Ledger): Delivery {
    return { ledger, hints: [] };
  }

  /** The write's answer, carrying any delivery that failed as a hint the page shows. */
  private answer(delivery: Delivery, detail: ProposalDetail): ProposalDetail {
    return delivery.hints.length > 0
      ? { ...detail, hints: [...(detail.hints ?? []), ...delivery.hints] }
      : detail;
  }

  /**
   * The plugin's one drive: a line of work on each employee's desk, in nobody's name —
   * `[proposal #<n>] ` + what happened + the command to run. The caller's own employee is
   * never told of its own act. A desk that cannot take it (the organization or the employee
   * paused, no desk) is recorded as a `notify_failed` event and returned as a hint, never
   * raised: the write it follows already stands.
   */
  private async tell(
    delivery: Delivery,
    org: OrgView,
    p: Proposal,
    caller: Caller,
    agentIds: readonly string[],
    text: string,
  ): Promise<void> {
    const line = `[proposal #${p.number}] ${text}`;
    for (const agentId of new Set(agentIds)) {
      if (agentId === caller.agentId) continue;
      try {
        await this.deps.gateway.deliverToDesk(org.projectId, org.orgId, agentId, line);
      } catch (err) {
        await this.deliveryFailed(delivery, org, p, caller, agentId, err);
      }
    }
  }

  /**
   * A delivery that failed is not silent: the desk is the only way the plugin reaches an
   * employee, so a failure is logged, recorded as a `notify_failed` event (the timeline and
   * the unread count show it) and handed back on the write's answer.
   */
  private async deliveryFailed(
    delivery: Delivery,
    org: OrgView,
    p: Proposal,
    caller: Caller,
    agentId: string,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const reason = `${agentPrincipal(agentId)} not notified: ${message}`;
    this.deps.log.line(`[${PLUGIN_NAME}] proposal #${p.number}: ${reason}`);
    delivery.hints.push(reason);
    try {
      const line = await delivery.ledger.append({
        kind: "notify_failed",
        number: p.number,
        reason,
        target: [agentPrincipal(agentId)],
        by: caller.principal,
      });
      this.notify(org, p.number, line.seq, "notify_failed");
    } catch (recordErr) {
      this.deps.log.line(
        `[${PLUGIN_NAME}] proposal #${p.number}: the failed delivery was not recorded: ${
          recordErr instanceof Error ? recordErr.message : String(recordErr)
        }`,
      );
    }
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
   * Anyone in the organization starts a proposal — a person delegating, an employee proposing
   * (the CEO to the board is the canonical case) or delegating to a colleague. The author is
   * the employee named, else the employee that asks; a person has to name one.
   */
  async create(
    projectId: string,
    orgId: string,
    req: { author?: string; brief: string; title?: string },
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const brief = req.brief.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    const author = req.author ?? caller.agentId;
    if (author === null) throw badRequest("author is required: name the employee that writes it.");
    this.requireEmployee(org, author, "author");
    const number = ledger.nextNumber();
    const title = req.title?.trim() || brief.split("\n")[0]!.slice(0, 120);
    const line = await ledger.append({
      kind: "created",
      number,
      title,
      author,
      delegatedBy: caller.principal,
      brief,
    });
    const p = this.requireProposal(ledger, number);
    this.notify(org, number, line.seq, "created");
    await this.ensureSkills(projectId, author);
    await this.tell(
      delivery,
      org,
      p,
      caller,
      [author],
      `${whoOf(caller)} asks you to write it: ${brief}\n\nWrite the proposal: \`penguin org proposal publish ${number} --file <markdown>\`, then \`penguin org proposal ready ${number}\` when a person can read it.`,
    );
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
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
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "rewrite the brief");
    const brief = text.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    if (brief === p.brief) {
      throw new ProposalError(
        409,
        "brief_unchanged",
        `Proposal #${number} already has this brief.`,
      );
    }
    const line = await ledger.append({ kind: "brief", number, brief, by: caller.principal });
    this.notify(org, number, line.seq, "brief_edited");
    if (p.status === "drafting") {
      await this.tell(
        delivery,
        org,
        p,
        caller,
        [p.author],
        `${whoOf(caller)} rewrote the brief: ${brief}\n\nRead it with \`penguin org proposal show ${number}\` before the next revision.`,
      );
    }
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
  }

  async publish(
    projectId: string,
    orgId: string,
    number: number,
    markdown: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "publish a revision");
    if (p.status === "rejected" || p.status === "withdrawn") {
      throw new ProposalError(409, "proposal_closed", `Proposal #${number} is ${p.status}.`);
    }
    let doc;
    try {
      doc = parseProposalDocument(markdown, { sections: p.sections });
    } catch (err) {
      if (err instanceof ProposalDocumentError) throw new ProposalError(400, err.code, err.message);
      throw err;
    }
    // Only declared test groups. A revision already in the ledger keeps whatever group it was
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
    // An approval covers ONE revision. Read before the append: the fold puts an approved
    // proposal back to ready as the line lands, and the record of which revision was
    // approved stays for the diff the page shows.
    // The scope against the working tree: what the change edits, deletes or renames from must
    // be there. A merged proposal is history — its tree has moved on — so it is not checked.
    let hints: string[] = [];
    if (p.status !== "merged") {
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
    const approvedRevision = p.status === "approved" ? p.approvedRevision : null;
    const line = await ledger.append({
      kind: "revised",
      number,
      revision: p.revision + 1,
      title: doc.title,
      ...(doc.root !== "" ? { root: doc.root } : {}),
      scope: doc.scope,
      ...(doc.tests.length > 0 ? { tests: doc.tests } : {}),
      sections: doc.sections,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "revised");
    if (approvedRevision !== null) {
      // The status line is what the timeline shows; the fold already moved the status.
      await this.setStatus(
        org,
        ledger,
        p,
        "ready",
        caller,
        `revision ${p.revision} — approval of revision ${approvedRevision} no longer covers it`,
      );
      // The person learns through the unread event; the one who must not merge yet is told.
      if (p.implementer !== null) {
        await this.tell(
          delivery,
          org,
          p,
          caller,
          [p.implementer],
          `revised after approval (revision ${approvedRevision} → ${p.revision}) — wait for a new approval before merging.`,
        );
      }
    }
    const detail = await this.withScope(
      org,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
    return this.answer(delivery, hints.length > 0 ? { ...detail, hints } : detail);
  }

  private async setStatus(
    org: OrgView,
    ledger: Ledger,
    p: Proposal,
    status: ProposalStatus,
    caller: Caller,
    reason?: string,
  ): Promise<number> {
    const line = await ledger.append({
      kind: "status",
      number: p.number,
      status,
      by: caller.principal,
      ...(reason !== undefined ? { reason } : {}),
      // An approval names the revision it covers; a later publish puts the proposal back
      // to ready and the page diffs the head against this one.
      ...(status === "approved" ? { revision: p.revision } : {}),
    });
    this.notify(org, p.number, line.seq, status === "drafting" ? "revised" : status);
    return line.seq;
  }

  async ready(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "mark a proposal ready");
    if (p.status !== "drafting") {
      throw new ProposalError(
        409,
        "proposal_status",
        `Proposal #${number} is ${p.status}, not drafting.`,
      );
    }
    if (p.revision === 0) {
      throw new ProposalError(
        409,
        "proposal_empty",
        `Proposal #${number} has no revision yet: publish it first.`,
      );
    }
    // The author's ready answers the requested changes: a revision after the batch, and every
    // comment of it resolved. A person may mark ready regardless.
    if (!this.isPerson(caller) && p.openBatches.length > 0) {
      const needRevision = Math.max(...p.openBatches.map((b) => b.revision));
      const unresolved = p.openBatches
        .flatMap((b) => b.commentIds)
        .filter((id) => p.comments.find((c) => c.id === id)?.resolved === undefined);
      if (p.revision <= needRevision || unresolved.length > 0) {
        const why = [
          ...(p.revision <= needRevision
            ? [`no revision has been published since the request (still revision ${p.revision})`]
            : []),
          ...(unresolved.length > 0 ? [`unresolved comments: ${unresolved.join(", ")}`] : []),
        ];
        throw new ProposalError(
          409,
          "changes_pending",
          `Proposal #${number} has requested changes not answered yet — ${why.join("; ")}. Read them, revise, resolve each, publish, then mark ready: \`penguin org proposal comments ${number} --pending\``,
        );
      }
    }
    await this.setStatus(org, ledger, p, "ready", caller);
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async approve(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "approve a proposal");
    if (p.status !== "ready" && p.status !== "drafting") {
      throw new ProposalError(409, "proposal_status", `Proposal #${number} is ${p.status}.`);
    }
    if (p.revision === 0) {
      throw new ProposalError(409, "proposal_empty", `Proposal #${number} has no revision yet.`);
    }
    await this.setStatus(org, ledger, p, "approved", caller);
    const to = p.implementer ?? p.author;
    await this.tell(
      delivery,
      org,
      p,
      caller,
      [to],
      p.implementer !== null
        ? `approved by ${whoOf(caller)} — merge the PR and run \`penguin org proposal merged ${number}\`.`
        : `approved by ${whoOf(caller)} with nobody building it yet — build it with \`penguin org proposal implement ${number}\` (or \`--agent <id>\` to hand it to a colleague), or merge it and run \`penguin org proposal merged ${number}\`.`,
    );
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
  }

  async reject(
    projectId: string,
    orgId: string,
    number: number,
    reason: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "reject a proposal");
    if (reason.trim() === "") throw badRequest("reason must not be empty.");
    if (isClosed(p.status)) {
      throw new ProposalError(409, "proposal_status", `Proposal #${number} is ${p.status}.`);
    }
    await this.setStatus(org, ledger, p, "rejected", caller, reason.trim());
    await this.tell(
      delivery,
      org,
      p,
      caller,
      [p.author, ...(p.implementer !== null ? [p.implementer] : [])],
      `rejected by ${whoOf(caller)}: ${reason.trim()} — stop work on it, and close its PR if one is open.`,
    );
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
  }

  /**
   * The author takes back a proposal that was never ready — or a person does it for them.
   * Only a drafting proposal: once ready, a person may be reading it and comments may be on
   * it, so taking it off the queue is a person's reject, not the author's withdrawal. The
   * reason is optional (a reject's is not): it says why the author stopped, not why the
   * change should not be made.
   */
  async withdraw(
    projectId: string,
    orgId: string,
    number: number,
    reason: string | undefined,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "withdraw a proposal");
    if (p.status !== "drafting") {
      throw new ProposalError(
        409,
        "proposal_status",
        `Proposal #${number} is ${p.status}: a proposal can be withdrawn only while drafting — once it is ready a person may be reading it and comments may be on it; ask a person to reject it instead.`,
      );
    }
    const why = reason?.trim() || undefined;
    await this.setStatus(org, ledger, p, "withdrawn", caller, why);
    await this.tell(
      delivery,
      org,
      p,
      caller,
      [p.author, ...(p.implementer !== null ? [p.implementer] : [])],
      `withdrawn by ${whoOf(caller)}${why !== undefined ? `: ${why}` : ""} — stop work on it, and close its PR if one is open.`,
    );
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
  }

  async merged(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    if (!this.isPerson(caller) && caller.agentId !== p.implementer) {
      throw forbidden(
        "not_implementer",
        `Only the implementer (${p.implementer ?? "none yet"}) or a person can report a merge.`,
      );
    }
    if (p.status !== "approved") {
      throw new ProposalError(
        409,
        "proposal_status",
        `Proposal #${number} is ${p.status}, not approved.`,
      );
    }
    await this.setStatus(org, ledger, p, "merged", caller);
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async implement(
    projectId: string,
    orgId: string,
    number: number,
    req: { agentId?: string; message?: string; workspace?: string },
    actor: OrgActor,
  ): Promise<ProposalDetail & { sessionId: string }> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "ask for an implementation");
    // Nobody is hired to build: the author builds its own proposal unless it names a colleague.
    const implementer = req.agentId ?? p.author;
    this.requireEmployee(org, implementer, "implementer");
    if (isClosed(p.status)) {
      throw new ProposalError(409, "proposal_status", `Proposal #${number} is ${p.status}.`);
    }
    if (p.revision === 0) {
      throw new ProposalError(
        409,
        "proposal_empty",
        `Proposal #${number} has no revision yet: publish it first.`,
      );
    }
    const body = this.implementationBrief(org, p, req.message);
    const opened = await this.deps.gateway.openEmployeeSession({
      projectId,
      orgId,
      agentId: implementer,
      title: `Proposal #${number}: ${p.title}`,
      body,
      ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
    });
    const line = await ledger.append({
      kind: "implementation",
      number,
      implementer,
      sessionId: opened.sessionId,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "implementation_started");
    await this.ensureSkills(projectId, implementer);
    return {
      ...this.answer(
        delivery,
        this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
      ),
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
  ): Promise<ProposalDetail & { sessionId: string }> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "open a discussion");
    if (isClosed(p.status)) {
      throw new ProposalError(409, "proposal_status", `Proposal #${number} is ${p.status}.`);
    }
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
    const line = await ledger.append({
      kind: "discussion",
      number,
      agentId: owner,
      sessionId: opened.sessionId,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "discussion_started");
    return {
      ...this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
      sessionId: opened.sessionId,
    };
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
   * discussion's own session — not from the owner's desk, nor a colleague. The line is
   * written only after the desk took it, so a desk that cannot (the organization or the
   * owner paused, no desk) is answered with its reason, recorded as `notify_failed`, and the
   * discussion stays open to be concluded again.
   */
  async conclude(
    projectId: string,
    orgId: string,
    number: number,
    sessionId: string,
    text: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    const d = p.discussions.find((x) => x.sessionId === sessionId);
    if (d === undefined) {
      throw new ProposalError(
        404,
        "discussion_not_found",
        `Proposal #${number} has no discussion ${sessionId}.`,
      );
    }
    if (
      !this.isPerson(caller) &&
      !(caller.agentId === d.agentId && actor.sessionId === sessionId)
    ) {
      throw forbidden(
        "not_discussion",
        `Only a person or the discussion's own session (${sessionId}) can conclude it.`,
      );
    }
    const conclusion = text.trim();
    if (conclusion === "") throw badRequest("text must not be empty.");
    const key = `${projectId}/${orgId}/${sessionId}`;
    if (d.concluded !== null || this.concluding.has(key)) {
      throw new ProposalError(
        409,
        "discussion_concluded",
        `Discussion ${sessionId} of proposal #${number} is already concluded.`,
      );
    }
    this.concluding.add(key);
    try {
      const line = `[proposal #${number}] the discussion with ${d.by.replace(/^user:/, "")} concluded (session ${sessionId}):\n\n${conclusion}\n\nRead it against the proposal (\`penguin org proposal show ${number}\`); if it changes what is proposed, revise the proposal or the branch.`;
      try {
        await this.deps.gateway.deliverToDesk(org.projectId, org.orgId, d.agentId, line);
      } catch (err) {
        await this.deliveryFailed(this.delivery(ledger), org, p, caller, d.agentId, err);
        const e = err as { status?: unknown; code?: unknown; message?: unknown };
        throw new ProposalError(
          typeof e.status === "number" ? e.status : 409,
          typeof e.code === "string" ? e.code : "notify_failed",
          `The conclusion did not reach ${d.agentId}'s desk: ${
            err instanceof Error ? err.message : String(err)
          } The discussion stays open; conclude it again once that is resolved.`,
        );
      }
      const written = await ledger.append({
        kind: "discussion_concluded",
        number,
        sessionId,
        text: conclusion,
        by: caller.principal,
      });
      this.notify(org, number, written.seq, "discussion_concluded");
    } finally {
      this.concluding.delete(key);
    }
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async addMaterial(
    projectId: string,
    orgId: string,
    number: number,
    req: { kind: ProposalMaterialKind; url: string; label?: string },
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    if (!MATERIAL_KINDS.includes(req.kind))
      throw badRequest(`kind must be one of ${MATERIAL_KINDS.join(", ")}.`);
    const url = req.url.trim();
    if (url === "") throw badRequest("url must not be empty.");
    const label = req.label?.trim() || defaultLabel(req.kind, url);
    const line = await ledger.append({
      kind: "material",
      number,
      material: { kind: req.kind, label, url },
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "material_added");
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async feedback(
    projectId: string,
    orgId: string,
    number: number,
    req: { text: string; runtime?: boolean },
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    const text = req.text.trim();
    if (text === "") throw badRequest("text must not be empty.");
    const runtime = req.runtime === true;
    const line = await ledger.append({
      kind: "feedback",
      number,
      text,
      runtime,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, runtime ? "runtime_feedback" : "feedback");
    const to = [p.author];
    if (runtime && p.implementer !== null) to.push(p.implementer);
    await this.tell(
      delivery,
      org,
      p,
      caller,
      to,
      runtime
        ? `runtime feedback from ${whoOf(caller)}: ${text}\n\nRevise together — the author updates the proposal (\`penguin org proposal publish ${number} --file …\`), the implementer the branch.`
        : `feedback from ${whoOf(caller)}: ${text}\n\nRevise the proposal if it changes what is proposed: \`penguin org proposal publish ${number} --file …\`.`,
    );
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
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
    const { ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
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

  /** A comment on `[start, end)` of a section's source: the slice must be the quote, so a stale page cannot anchor a comment to the wrong words. */
  async comment(
    projectId: string,
    orgId: string,
    number: number,
    req: { sectionId: string; start: number; end: number; quote: string; text: string },
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "comment on a proposal");
    const text = req.text.trim();
    if (text === "") throw badRequest("text must not be empty.");
    const section = p.sections.find((s) => s.id === req.sectionId);
    if (section === undefined) {
      throw badRequest(`No section ${req.sectionId} in revision ${p.revision}.`);
    }
    const source = sectionSource(section);
    const inRange =
      Number.isInteger(req.start) &&
      Number.isInteger(req.end) &&
      req.start >= 0 &&
      req.start < req.end &&
      req.end <= source.length;
    if (!inRange || source.slice(req.start, req.end) !== req.quote) {
      throw new ProposalError(
        400,
        "comment_range",
        `The range [${req.start}, ${req.end}) of section ${req.sectionId} does not read as quoted in revision ${p.revision}; reload the proposal and select again.`,
      );
    }
    const id = `c${p.comments.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const line = await ledger.append({
      kind: "comment",
      number,
      id,
      sectionId: req.sectionId,
      start: req.start,
      end: req.end,
      quote: req.quote,
      revision: p.revision,
      text,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "comment");
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async requestChanges(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const delivery = this.delivery(ledger);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "request changes");
    const pending = p.comments.filter((c) => c.batchId === null && c.by === caller.principal);
    if (pending.length === 0) throw badRequest("No pending comments to send.");
    const id = `b${p.events.filter((e) => e.kind === "changes_requested").length + 1}`;
    const line = await ledger.append({
      kind: "batch",
      number,
      id,
      commentIds: pending.map((c) => c.id),
      by: caller.principal,
      revision: p.revision,
    });
    this.notify(org, number, line.seq, "changes_requested");
    await this.tell(
      delivery,
      org,
      p,
      caller,
      [p.author],
      `${whoOf(caller)} requested changes: a batch of ${pending.length} comment${pending.length === 1 ? "" : "s"} — read it with \`penguin org proposal comments ${number} --pending\`, resolve each (\`penguin org proposal resolve ${number} <commentId> -m …\`), then publish the revision and mark it ready again.`,
    );
    return this.answer(
      delivery,
      this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
    );
  }

  async resolve(
    projectId: string,
    orgId: string,
    number: number,
    commentId: string,
    text: string | undefined,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "resolve a comment");
    const c = p.comments.find((x) => x.id === commentId);
    if (c === undefined || c.batchId === null) {
      throw new ProposalError(
        404,
        "comment_not_found",
        `No requested comment ${commentId} on proposal #${number}.`,
      );
    }
    if (c.resolved !== undefined) {
      throw new ProposalError(409, "comment_resolved", `Comment ${commentId} is already resolved.`);
    }
    const line = await ledger.append({
      kind: "resolved",
      number,
      commentId,
      text: text?.trim() ?? "",
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "resolved");
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  /**
   * A pending comment is the person's own until it is sent: reworded or withdrawn by the
   * one who wrote it, and by nobody else; once a batch names it, it stands as sent.
   */
  private requireOwnPending(
    p: Proposal,
    caller: Caller,
    commentId: string,
    what: string,
  ): ProposalComment {
    const c = p.comments.find((x) => x.id === commentId);
    if (c === undefined) {
      throw new ProposalError(
        404,
        "comment_not_found",
        `No comment ${commentId} on proposal #${p.number}.`,
      );
    }
    if (c.batchId !== null) {
      throw new ProposalError(
        409,
        "comment_sent",
        `Comment ${commentId} has been sent to the author; it can no longer be ${what}.`,
      );
    }
    if (c.by !== caller.principal) {
      throw new ProposalError(
        403,
        "not_commenter",
        `Only the one who wrote comment ${commentId} can have it ${what}.`,
      );
    }
    return c;
  }

  async editComment(
    projectId: string,
    orgId: string,
    number: number,
    commentId: string,
    text: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requireOwnPending(p, caller, commentId, "reworded");
    const next = text.trim();
    if (next === "") throw badRequest("text must not be empty.");
    const line = await ledger.append({
      kind: "comment_edited",
      number,
      commentId,
      text: next,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "comment");
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async deleteComment(
    projectId: string,
    orgId: string,
    number: number,
    commentId: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requireOwnPending(p, caller, commentId, "withdrawn");
    const line = await ledger.append({
      kind: "comment_deleted",
      number,
      commentId,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "comment");
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  /** Moves the person's read position forward (never back); an employee's call is a no-op. */
  async read(
    projectId: string,
    orgId: string,
    number: number,
    upTo: number,
    actor: OrgActor,
  ): Promise<void> {
    const { ledger, caller } = await this.open(projectId, orgId, actor);
    this.requireProposal(ledger, number);
    if (!this.isPerson(caller)) return;
    const key = this.readsKey(projectId, orgId, caller.userId);
    const reads = this.readPositions(projectId, orgId, caller.userId);
    const current = reads[String(number)] ?? 0;
    if (upTo <= current) return;
    reads[String(number)] = upTo;
    this.deps.settings.set(key, JSON.stringify(reads));
  }
}

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
