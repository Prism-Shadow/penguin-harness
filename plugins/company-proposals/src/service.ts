/**
 * The proposal service: the state machine over the ledger, the views a caller gets of it,
 * and the one way it speaks to employees — a message in the organization's `proposals`
 * channel, in the delegating person's name, which reaches the employee it @-mentions as an
 * ordinary `mention` run. No trigger kind of its own, no second drive chain.
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
  OrgActor,
  OrgGateway,
  OrgView,
  Log,
  Settings,
} from "@prismshadow/penguin-server/plugin";
import type {
  ProposalComment,
  ProposalDetail,
  ProposalItem,
  ProposalMaterialKind,
  ProposalPluginEvent,
  ProposalStatus,
  ProposalsResponse,
} from "@prismshadow/penguin-server/api";
import { Ledger, ledgerPath, type Proposal } from "./ledger.js";
import {
  ProposalDocumentError,
  parseProposalDocument,
  renderProposalDocument,
} from "./markdown.js";

/** The plugin's name in the `plugin` server event and in the settings keys. */
export const PLUGIN_NAME = "company-proposals";
/** The channel authors, implementers, testers and the delegating person talk in. */
export const PROPOSALS_CHANNEL = "proposals";
export const PROPOSALS_CHANNEL_NAME = "Proposals";
export const PROPOSALS_CHANNEL_PURPOSE = "Proposals: authors, implementers and testers talk here";

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
  /** The data root (Paths.root). */
  root: string;
  settings: Pick<Settings, "get" | "set">;
  log: Pick<Log, "line">;
  now?: () => number;
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

export class ProposalService {
  private readonly ledgers = new Map<string, Ledger>();

  constructor(private readonly deps: ServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private ledger(projectId: string, orgId: string): Ledger {
    const key = `${projectId}/${orgId}`;
    let ledger = this.ledgers.get(key);
    if (ledger === undefined) {
      ledger = new Ledger(ledgerPath(this.deps.root, projectId, orgId), () => this.now());
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
      scope: p.scope,
      sections: p.sections,
      comments: this.visibleComments(p, caller),
      events: p.events,
      sessions: p.sessions,
      seq: p.seq,
    };
  }

  async list(projectId: string, orgId: string, actor: OrgActor): Promise<ProposalsResponse> {
    const { ledger, caller } = await this.open(projectId, orgId, actor);
    const reads = this.readPositions(projectId, orgId, caller.userId);
    const proposals = ledger
      .proposals()
      .sort((a, b) => b.number - a.number)
      .map((p) => this.item(p, caller, reads));
    return { proposals, channelId: ledger.proposals().length > 0 ? PROPOSALS_CHANNEL : null };
  }

  async get(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  // ---------------------------------------------------------------------------
  // The channel: how the plugin speaks to employees
  // ---------------------------------------------------------------------------

  /** A message in the delegating person's name; a failure is logged, never raised — the ledger write already stands. */
  private async say(
    org: OrgView,
    p: Proposal,
    principals: readonly string[],
    text: string,
  ): Promise<void> {
    try {
      await this.deps.gateway.ensureChannel(
        org.projectId,
        org.orgId,
        PROPOSALS_CHANNEL,
        { name: PROPOSALS_CHANNEL_NAME, purpose: PROPOSALS_CHANNEL_PURPOSE },
        p.delegatedBy,
        principals,
      );
      await this.deps.gateway.sendChannelMessage(
        org.projectId,
        org.orgId,
        p.delegatedBy,
        PROPOSALS_CHANNEL,
        text,
      );
    } catch (err) {
      this.deps.log.line(
        `[${PLUGIN_NAME}] proposal #${p.number}: channel message not sent: ${
          err instanceof Error ? err.message : String(err)
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

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async create(
    projectId: string,
    orgId: string,
    req: { author: string; brief: string; title?: string },
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    this.requirePerson(caller, "delegate a proposal");
    const brief = req.brief.trim();
    if (brief === "") throw badRequest("brief must not be empty.");
    this.requireEmployee(org, req.author, "author");
    const number = ledger.nextNumber();
    const title = req.title?.trim() || brief.split("\n")[0]!.slice(0, 120);
    const line = await ledger.append({
      kind: "created",
      number,
      title,
      author: req.author,
      delegatedBy: caller.userId,
      brief,
    });
    const p = this.requireProposal(ledger, number);
    this.notify(org, number, line.seq, "created");
    await this.say(
      org,
      p,
      [agentPrincipal(req.author)],
      `@agent:${req.author} proposal:${number} — ${brief}\n\nWrite the proposal: \`penguin org proposal publish ${number} --file <markdown>\`, then \`penguin org proposal ready ${number}\` when a person can read it.`,
    );
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async publish(
    projectId: string,
    orgId: string,
    number: number,
    markdown: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "publish a revision");
    if (p.status === "rejected") {
      throw new ProposalError(409, "proposal_closed", `Proposal #${number} is rejected.`);
    }
    let doc;
    try {
      doc = parseProposalDocument(markdown, { sections: p.sections });
    } catch (err) {
      if (err instanceof ProposalDocumentError) throw new ProposalError(400, err.code, err.message);
      throw err;
    }
    const line = await ledger.append({
      kind: "revised",
      number,
      revision: p.revision + 1,
      title: doc.title,
      scope: doc.scope,
      sections: doc.sections,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "revised");
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
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
    await this.say(
      org,
      p,
      [agentPrincipal(to)],
      p.implementer !== null
        ? `@agent:${to} proposal:${number} is approved — merge it and run \`penguin org proposal merged ${number}\`.`
        : `@agent:${to} proposal:${number} is approved with nobody building it yet — name an implementer with \`penguin org proposal implement ${number} --agent <id>\`, or merge it yourself and run \`penguin org proposal merged ${number}\`.`,
    );
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async reject(
    projectId: string,
    orgId: string,
    number: number,
    reason: string,
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "reject a proposal");
    if (reason.trim() === "") throw badRequest("reason must not be empty.");
    if (p.status === "merged" || p.status === "rejected") {
      throw new ProposalError(409, "proposal_status", `Proposal #${number} is ${p.status}.`);
    }
    await this.setStatus(org, ledger, p, "rejected", caller, reason.trim());
    await this.say(
      org,
      p,
      [
        agentPrincipal(p.author),
        ...(p.implementer !== null ? [agentPrincipal(p.implementer)] : []),
      ],
      `@agent:${p.author}${p.implementer !== null ? ` @agent:${p.implementer}` : ""} proposal:${number} is rejected: ${reason.trim()}`,
    );
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
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
    req: { agentId: string; message?: string; workspace?: string },
    actor: OrgActor,
  ): Promise<ProposalDetail & { sessionId: string }> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requireAuthorOrPerson(p, caller, "ask for an implementation");
    this.requireEmployee(org, req.agentId, "implementer");
    if (p.status === "merged" || p.status === "rejected") {
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
      agentId: req.agentId,
      title: `Proposal #${number}: ${p.title}`,
      body,
      ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
    });
    const line = await ledger.append({
      kind: "implementation",
      number,
      implementer: req.agentId,
      sessionId: opened.sessionId,
      by: caller.principal,
    });
    this.notify(org, number, line.seq, "implementation_started");
    // The implementer joins the channel now, so the messages that follow can reach it.
    try {
      await this.deps.gateway.ensureChannel(
        projectId,
        orgId,
        PROPOSALS_CHANNEL,
        { name: PROPOSALS_CHANNEL_NAME, purpose: PROPOSALS_CHANNEL_PURPOSE },
        p.delegatedBy,
        [agentPrincipal(p.author), agentPrincipal(req.agentId)],
      );
    } catch (err) {
      this.deps.log.line(
        `[${PLUGIN_NAME}] proposal #${number}: channel not prepared: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      ...this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId)),
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
        `- When the proposal is approved (you are @-mentioned in the proposals channel), merge the pull request and run \`penguin org proposal merged ${n}\`.`,
      ].join("\n"),
      ...(note !== "" ? [`Note from the author: ${note}`] : []),
      `The proposal, revision ${p.revision}:\n\n${renderProposalDocument({ title: p.title, scope: p.scope, sections: p.sections }).trimEnd()}`,
    ].join("\n\n");
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
    const to = [agentPrincipal(p.author)];
    if (runtime && p.implementer !== null && p.implementer !== p.author)
      to.push(agentPrincipal(p.implementer));
    const mentions = to.map((x) => `@${x}`).join(" ");
    await this.say(
      org,
      p,
      to,
      runtime
        ? `${mentions} proposal:${number} runtime feedback from ${caller.principal}: ${text}\n\nRevise together — the author updates the proposal (\`penguin org proposal publish ${number} --file …\`), the implementer the branch.`
        : `${mentions} proposal:${number} feedback from ${caller.principal}: ${text}\n\nRevise the proposal if it changes what is proposed: \`penguin org proposal publish ${number} --file …\`.`,
    );
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
  }

  async comment(
    projectId: string,
    orgId: string,
    number: number,
    req: { paragraphId: string; text: string },
    actor: OrgActor,
  ): Promise<ProposalDetail> {
    const { org, ledger, caller } = await this.open(projectId, orgId, actor);
    const p = this.requireProposal(ledger, number);
    this.requirePerson(caller, "comment on a proposal");
    const text = req.text.trim();
    if (text === "") throw badRequest("text must not be empty.");
    if (!p.sections.some((s) => s.paragraphs.some((x) => x.id === req.paragraphId))) {
      throw badRequest(`No paragraph ${req.paragraphId} in revision ${p.revision}.`);
    }
    const id = `c${p.comments.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const line = await ledger.append({
      kind: "comment",
      number,
      id,
      paragraphId: req.paragraphId,
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
    });
    this.notify(org, number, line.seq, "changes_requested");
    await this.say(
      org,
      p,
      [agentPrincipal(p.author)],
      `@agent:${p.author} proposal:${number} has a batch of ${pending.length} comment${pending.length === 1 ? "" : "s"}: \`penguin org proposal comments ${number} --pending\`, resolve each (\`penguin org proposal resolve ${number} <commentId> -m …\`), then publish the revision and mark it ready again.`,
    );
    return this.detail(p, caller, this.readPositions(projectId, orgId, caller.userId));
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
