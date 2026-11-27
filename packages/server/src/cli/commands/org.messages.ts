/**
 * The messages of the org command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

import type { OrgChannelNoticeKind } from "../../api/types.js";
export interface OrgText {
  /** `penguin org`: company mode — a thin client over the organization API (the organization's files stay the single source of truth; every DTO is a projection). */
  org: {
    desc: string;
    lsDesc: string;
    createDesc: string;
    showDesc: string;
    chartDesc: string;
    hireDesc: string;
    employeeDesc: string;
    employeeSetDesc: string;
    /** `employee avatar`: set or clear an employee's picture. */
    employeeAvatarDesc: string;
    /** `employee avatar --file`. */
    avatarFile: string;
    /** `employee avatar --clear`. */
    avatarClear: string;
    leaveDesc: string;
    deskDesc: string;
    deskShowDesc: string;
    deskRenewDesc: string;
    calendarDesc: string;
    calendarLsDesc: string;
    calendarAddDesc: string;
    calendarUpdateDesc: string;
    calendarRmDesc: string;
    ticketDesc: string;
    ticketLsDesc: string;
    ticketShowDesc: string;
    ticketCreateDesc: string;
    ticketMoveDesc: string;
    ticketAssignDesc: string;
    ticketBlockDesc: string;
    ticketUnblockDesc: string;
    ticketProgressDesc: string;
    ticketStartDesc: string;
    ticketAttachDesc: string;
    channelDesc: string;
    channelLsDesc: string;
    channelCreateDesc: string;
    channelShowDesc: string;
    channelInviteDesc: string;
    channelJoinDesc: string;
    channelLeaveDesc: string;
    channelRemoveDesc: string;
    channelNotifyDesc: string;
    /** --none: clear the default recipients. */
    channelNotifyNone: string;
    channelNotifyNeedsList: string;
    channelArchiveDesc: string;
    channelUnarchiveDesc: string;
    channelTailDesc: string;
    channelSendDesc: string;
    handbookDesc: string;
    handbookListDesc: string;
    handbookShowDesc: string;
    handbookWriteDesc: string;
    handbookRmDesc: string;
    financeDesc: string;
    /** --org-id: the organization (defaults to PENGUIN_ORG_ID, the control environment of desk and ticket sessions). */
    orgId: string;
    /** create's --org-id: the id to create (never taken from the environment). */
    newOrgId: string;
    mission: string;
    orgName: string;
    /** create's --language: the organization's working language (default: detected from the mission). */
    orgLanguageOption: string;
    /** hire's --agent-id: employ an existing Agent (XOR --new-agent). */
    hireAgentId: string;
    /** hire's --new-agent: create the Agent and employ it. */
    newAgent: string;
    newAgentName: string;
    newAgentDescription: string;
    /** --skills: extra library plugins for the new Agent, comma-separated (added to the required pair). */
    skills: string;
    title: string;
    reportsTo: string;
    /** Employee workspace: a sub-directory of the shared workspace (`.` = all of it) or an absolute path, written as given. */
    employeeName: string;
    employeeWorkspace: string;
    /** hire's --workspace: the same spec, with the default the employee's own sub-directory. */
    hireWorkspace: string;
    /** --budget: monthly USD for the employee plus every subordinate. */
    budget: string;
    /** create's --ceo-budget: the CEO's monthly USD, which is the whole company's. */
    ceoBudget: string;
    duties: string;
    /** calendar's --agent-id: the employee the event belongs to (defaults to PENGUIN_AGENT_ID); a filter on `ls`. */
    calendarAgentId: string;
    calendarTitle: string;
    /** ticket ls filters. */
    statusFilter: string;
    ownerFilter: string;
    blockedFilter: string;
    ticketTitle: string;
    /** create's --slug: the words of the ticket id, for a title that yields none. */
    ticketSlug: string;
    goal: string;
    criteria: string;
    /** --body-file: the whole Markdown body from a file (XOR --goal). */
    bodyFile: string;
    /** --owner: the ONE responsible principal; defaults to the caller on `create`. */
    owner: string;
    parent: string;
    /** --notify: principals told when the ticket ends, comma-separated. */
    notify: string;
    priority: string;
    due: string;
    /** move's --to: the target column. */
    moveTo: string;
    /** move's --reason: required when moving into rejected. */
    moveReason: string;
    blockReason: string;
    /** block's --by: who or which ticket the ticket waits for. */
    blockedBy: string;
    progressText: string;
    /** start's -m: a note appended to the ticket text the session opens with. */
    startMessage: string;
    /** start's --workspace: another directory inside the shared workspace (default: the employee's desk workspace). */
    startWorkspace: string;
    /** start's --agent-id: which employee the ticket session runs as (default: the caller inside a session, else the ticket's owner). */
    startAgentId: string;
    /** attach's --session: the session to attach (default: the calling session). */
    attachSession: string;
    /** tail / send's --channel: which channel to read or write in (default: the all-hands channel). */
    channelOpt: string;
    /** create's --name / --purpose. */
    channelName: string;
    channelPurpose: string;
    channelDate: string;
    channelCount: string;
    channelText: string;
    handbookPath: string;
    handbookText: string;
    handbookFile: string;
    handbookOneSource: string;
    refTicket: string;
    refSession: string;
    /** finance's --period: yyyy-mm (default: the current month). */
    period: string;
    /** No --org-id and no PENGUIN_ORG_ID: there is no default organization. */
    orgIdMissing(): string;
    /** hire: --agent-id XOR --new-agent. */
    hireTargetConflict(): string;
    /** hire: --name / --description / --skills describe the new Agent only. */
    newAgentFieldsOnly(): string;
    /** A non-numeric or negative budget on any of the budget flags (named, since there are several). */
    budgetInvalid(flag: string, value: string): string;
    /** employee set with no field to change. */
    nothingToSet(): string;
    /** A --language value that is neither zh nor en. */
    languageInvalid(value: string): string;
    /** A --status / --to value that is not a kanban column. */
    statusInvalid(value: string): string;
    priorityInvalid(value: string): string;
    /** ticket create: --goal XOR --body-file. */
    ticketBodyConflict(): string;
    criteriaNeedsGoal(): string;
    bodyFileUnreadable(file: string): string;
    countInvalid(value: string): string;
    /** An id or handbook path with a `.` / `..` segment: the URL would collapse onto another route. */
    pathSegmentInvalid(value: string): string;
    /** ticket attach outside a session and without --session. */
    attachSessionMissing(): string;
    /** Confirmations of the write commands. */
    created(orgId: string, ceoDeskSessionId: string | undefined): string;
    hired(agentId: string, title: string, reportsTo: string | null): string;
    employeeUpdated(agentId: string): string;
    /** `employee avatar` takes exactly one of --file and --clear. */
    avatarNeedsOne(): string;
    /** `employee avatar` without an id outside a desk or ticket session. */
    avatarNoAgent(): string;
    avatarUnreadable(file: string, reason: string): string;
    avatarFormat(file: string): string;
    avatarTooLarge(file: string, kib: number, maxKib: number): string;
    avatarSet(agentId: string): string;
    avatarCleared(agentId: string): string;
    left(agentId: string): string;
    desk(
      agentId: string,
      sessionId: string,
      workspace: string,
      openedAt: string,
      created: boolean,
    ): string;
    deskRenewed(agentId: string, sessionId: string): string;
    calendarWritten(
      agentId: string,
      name: string,
      enabledText: string,
      nextFireAt: string | undefined,
    ): string;
    /** One advisory rota line the server answered a calendar write with (its text stays English). */
    calendarWarning(warning: string): string;
    calendarRemoved(agentId: string, name: string): string;
    ticketCreated(ticketId: string, status: string): string;
    ticketMoved(ticketId: string, status: string): string;
    ticketAssigned(ticketId: string, owner: string): string;
    ticketBlocked(ticketId: string): string;
    ticketUnblocked(ticketId: string): string;
    progressRecorded(ticketId: string): string;
    ticketAttached(ticketId: string, sessionId: string): string;
    channelCreated(channelId: string): string;
    channelInvited(channelId: string, principal: string): string;
    channelJoined(channelId: string): string;
    channelLeft(channelId: string): string;
    channelMemberRemoved(channelId: string, principal: string): string;
    channelNotifySet(channelId: string, principals: string): string;
    channelNotifyCleared(channelId: string): string;
    channelArchived(channelId: string): string;
    channelUnarchived(channelId: string): string;
    messageSent(id: string): string;
    handbookWritten(path: string): string;
    handbookRemoved(path: string): string;
    /** Empty states. */
    empty(projectId: string): string;
    calendarEmpty(): string;
    ticketsEmpty(): string;
    channelsEmpty(): string;
    channelEmpty(channelId: string, date: string): string;
    /** `show`: one line per fact. */
    showHead(name: string, orgId: string, status: string): string;
    showMission(mission: string): string;
    showLanguage(language: string): string;
    showEmployees(count: number, running: number, paused: number): string;
    showBoard(counts: string, blocked: number): string;
    showSpend(period: string, spend: string): string;
    showPending(mentions: number, review: number, blockedByMe: number): string;
    /** An invalid organization / employee / ticket, with the reason (a line in `show`, a cell in tables). */
    invalid(reason: string): string;
    /** `ticket show`: the derived state above the file. */
    ticketHead(
      ticketId: string,
      status: string,
      running: boolean,
      blocked: string | undefined,
    ): string;
    ticketFigures(cost: string, rolledUp: string, sessions: number, children: number): string;
    /** `ticket show`: the labels of the ticket's frontmatter fields, above the prose sections. */
    ticketFields(): Record<
      | "title"
      | "owner"
      | "parent"
      | "notify"
      | "priority"
      | "due"
      | "blocked"
      | "blockedBy"
      | "sessions",
      string
    >;
    /** `ticket show`: the heading above the operation history; the actions themselves stay in English. */
    ticketHistory(): string;
    /**
     * A `system` line rendered from its structured notice, in the reader's language; a kind
     * this build does not know falls back to the message's English `text`.
     */
    notices: Record<OrgChannelNoticeKind, (p: Record<string, string>) => string>;
    /** The all-hands channel's label; its stored name is never shown. */
    allHands(): string;
    /** `channel tail` on any channel but the default one: a dim line naming it above the messages. */
    channelHeader(channelId: string): string;
    /** `channel show`: the head line, then the lines the channel actually has. */
    channelHead(name: string, channelId: string, members: number, archived: boolean): string;
    channelPurposeLine(purpose: string): string;
    channelNotifyLine(principals: string): string;
    channelCreatedBy(principal: string, createdAt: string): string;
    channelLastMessage(time: string): string;
    financeTotal(period: string, total: string): string;
    /** stderr note under `finance`: some usage had no pricing, so the total is a lower bound. */
    unpriced(): string;
    /** `penguin org proposal`: the company-proposals plugin's routes (a 404 without an organization code = the plugin is not installed). */
    proposalDesc: string;
    proposalLsDesc: string;
    proposalShowDesc: string;
    proposalCreateDesc: string;
    proposalPublishDesc: string;
    /** `proposal brief <n>`: rewrite the brief in place (the author or a person). */
    proposalBriefDesc: string;
    proposalReadyDesc: string;
    proposalApproveDesc: string;
    proposalMergedDesc: string;
    proposalRejectDesc: string;
    proposalImplementDesc: string;
    proposalMaterialDesc: string;
    proposalMaterialAddDesc: string;
    /** `proposal impl <n> <url>`: the impl PR; `--adopt`: the one-time adoption from the pr materials. */
    proposalImplDesc: string;
    proposalImplAdopt: string;
    proposalImplHeadOpt: string;
    proposalImplBaseOpt: string;
    proposalDiffDesc: string;
    proposalDiffStatOpt: string;
    /** `proposal graph`: the delivery repository's PR graph. */
    proposalGraphDesc: string;
    proposalGraphAllOpt: string;
    /** The graph's first line, when the default view leaves other people's PRs out. */
    graphOthersHidden(n: number): string;
    /** `proposal deploy <n> --to <id>`: run the deploy Action `deploy.<id>` on the impl head (or a PR's). */
    proposalDeployDesc: string;
    proposalDeployTo: string;
    proposalDeployPr: string;
    proposalDeployHead: string;
    proposalDeployDryRun: string;
    proposalDeployUsage: string;
    proposalDeployPlanned: (
      key: string,
      subject: string,
      allowed: boolean | null,
      why: string,
    ) => string;
    proposalDeployStarted: (run: string, key: string, subject: string, head: string) => string;
    proposalDeploySucceeded: (run: string, head: string) => string;
    proposalDeployFailed: (
      run: string,
      outcome: string,
      exitCode: number | null,
      message: string | null,
    ) => string;
    /** `org action …`: the organization's Actions, their runs and bindings. */
    actionDesc: string;
    actionLsDesc: string;
    actionLsSubject: string;
    actionLsAll: string;
    actionRunDesc: string;
    actionExecDesc: string;
    actionParam: string;
    actionParams: string;
    actionRequestId: string;
    actionParamInvalid: (value: string) => string;
    actionRunsDesc: string;
    actionRunsSubject: string;
    actionRunsBy: string;
    actionRunsKey: string;
    actionRunsBefore: string;
    actionRunsLimit: string;
    actionLimitInvalid: (value: string) => string;
    actionCheckDesc: string;
    actionsNone: string;
    actionsHeader: string[];
    contributionsHeader: string[];
    actionRunsNone: string;
    actionRunsHeader: string[];
    actionRunsNext: (cursor: string) => string;
    actionCheckNone: string;
    actionConflict: (key: string, kind: string, contributions: string) => string;
    actionRunStarted: (run: string, key: string, subject: string) => string;
    actionRunEnded: (run: string, outcome: string, message: string | null) => string;
    /** An ambiguous key's answer: each contribution's exact invocation. */
    actionExecForm: (cli: string) => string;
    /** `org roadmap item`: the company-roadmaps plugin's one-item writes. */
    roadmapDesc: string;
    roadmapItemDesc: string;
    roadmapItemAddDesc: string;
    roadmapItemRemoveDesc: string;
    roadmapItemKey: string;
    roadmapItemKind: string;
    roadmapItemTitle: string;
    roadmapItemBrief: string;
    roadmapItemOwner: string;
    roadmapItemEmployees: string;
    roadmapItemCites: string;
    roadmapItemStackedOn: string;
    roadmapItemProposal: string;
    roadmapNumberInvalid: (value: string) => string;
    roadmapItemProposalInvalid: (value: string) => string;
    /** `org workflow`: the organization's company workflows. */
    workflowDesc: string;
    workflowLsDesc: string;
    workflowPutDesc: string;
    workflowPutKeep: string;
    workflowRmDesc: string;
    workflowReloadDesc: string;
    workflowHistoryDesc: string;
    workflowRollbackDesc: string;
    workflowsNone: string;
    workflowsHeader: string[];
    workflowVersionsNone: string;
    workflowVersionsHeader: string[];
    workflowDirInvalid: (dir: string, why: string) => string;
    workflowLoaded: (id: string, revision: string) => string;
    workflowNotLoaded: (id: string, error: string) => string;
    workflowSkipped: (id: string, reason: string) => string;
    workflowRemoved: (id: string) => string;
    /** `proposal deployment add|ls`: the registry of deployments the graph places. */
    proposalDeploymentDesc: string;
    proposalDeploymentAddDesc: string;
    proposalDeploymentUrlOpt: string;
    proposalDeploymentLsDesc: string;
    proposalFeedbackDesc: string;
    /** `proposal conclude <n>`: a discussion's conclusion, to the owner's desk. */
    proposalConcludeDesc: string;
    proposalCommentsDesc: string;
    proposalResolveDesc: string;
    /** ls's --status: one lifecycle state. */
    proposalStatusFilter: string;
    /** create's --author: the employee that writes it. */
    proposalAuthor: string;
    /** create's --brief: the delegation, one sentence (named with a trailing underscore: `proposalBrief` is the `show` line). */
    proposalBrief_: string;
    proposalTitle: string;
    /** publish's --file: the whole proposal as one Markdown document. */
    proposalFile: string;
    /** brief's -m / --file: the new brief, inline or from a file; exactly one of them. */
    proposalBriefText: string;
    proposalBriefFile: string;
    proposalBriefOneSource: string;
    /** implement's --agent: the employee that builds it. */
    proposalImplementer: string;
    proposalMessage: string;
    proposalWorkspace: string;
    proposalMaterialLabel: string;
    proposalFeedbackText: string;
    /** conclude's -m and --discussion (default: the calling session). */
    proposalConclusionText: string;
    proposalDiscussion: string;
    /** conclude outside a session without --discussion. */
    proposalDiscussionMissing: string;
    /** feedback's --runtime: from the test team's run of the dev branch. */
    proposalRuntime: string;
    /** comments' --pending: the batched, unresolved ones — the author's worklist. */
    proposalPending: string;
    proposalResolveText: string;
    proposalRejectReason: string;
    /** A 404 with no organization code under `…/proposals`: the plugin is not on this Project. */
    proposalsPluginMissing(): string;
    proposalNumberInvalid(value: string): string;
    proposalStatusInvalid(value: string): string;
    /** `material add` without a `<kind>=<url>` of a known kind. */
    proposalMaterialInvalid(value: string): string;
    proposalsEmpty(): string;
    proposalCommentsEmpty(number: number): string;
    /** Confirmations of the proposal writes. */
    proposalCreated(number: number, title: string): string;
    proposalPublished(number: number, revision: number): string;
    proposalBriefRewritten(number: number): string;
    proposalStatusSet(number: number, status: string): string;
    proposalImplementing(number: number, implementer: string, sessionId: string): string;
    proposalMaterialAdded(number: number, kind: string): string;
    proposalImplPr(label: string, url: string): string;
    proposalImplSet(number: number, url: string): string;
    proposalImplBranch(head: string, base: string, pr: string | null): string;
    proposalImplBranchSet(number: number, head: string, base: string, pr: string | null): string;
    proposalImplPairUsage(): string;
    proposalDiffHead(
      head: string,
      base: string,
      ahead: number,
      behind: number,
      url: string,
    ): string;
    proposalDiffStat(files: number, additions: number, deletions: number): string;
    proposalDiffTruncated(limit: number): string;
    proposalImplAmbiguous(number: number, urls: string): string;
    proposalImplSkipped(number: number, reason: string): string;
    proposalImplUsage(): string;
    graphNoProposal(): string;
    graphOffChain(): string;
    /** Why a node is off the chain; `at` is `#n` or the base branch, `base` the declared base. */
    graphOffReason(reason: string, at: string, relation: string, base: string): string;
    graphUnplaced(): string;
    /** Why an impl PR is not on the graph; `at` is `#n`, `into` the branch merged into, `base` the base branch. */
    graphUnplacedReason(reason: string, at: string, into: string, base: string): string;
    graphErrors(): string;
    graphDeploymentsOff(): string;
    /** The base branch's row: the commits it gained since the first stack's bottom was built. */
    graphBaseBehind(n: number): string;
    deploymentRegistered(id: string, url: string | null): string;
    proposalFeedbackRecorded(number: number): string;
    proposalConcluded(number: number, owner: string): string;
    proposalCommentResolved(number: number, commentId: string): string;
    /** `proposal show`: the head lines above the document. */
    proposalHead(number: number, title: string, status: string, revision: number): string;
    proposalApproved(revision: number): string;
    proposalRevisedAfterApproval(approved: number, head: number): string;
    proposalPeople(author: string, implementer: string | null, delegatedBy: string): string;
    proposalBrief(brief: string): string;
    proposalSessions(sessions: string): string;
    proposalScope(root: string): string;
    proposalHint(hint: string): string;
    proposalTests(): string;
    proposalGroupUndeclared(): string;
    proposalGroupsDesc: string;
    proposalGroupsEmpty(): string;
    proposalMaterials(): string;
    proposalComments(): string;
    proposalEvents(): string;
    colNumber(): string;
    colRevision(): string;
    colAuthor(): string;
    colImplementer(): string;
    colEmployees(): string;
    colRunning(): string;
    colOpen(): string;
    colBlocked(): string;
    colSpend(): string;
    colNote(): string;
    /** Chart / finance: the employee's job title. */
    colJobTitle(): string;
    /** Tickets: the ticket title. */
    colTitle(): string;
    colState(): string;
    colOwn(): string;
    colCumulative(): string;
    colBudget(): string;
    colNext(): string;
    colPriority(): string;
    colOwner(): string;
    colTicket(): string;
    colRolledUp(): string;
    colMembers(): string;
    colArchived(): string;
    colUnread(): string;
    colMentions(): string;
    colPrincipal(): string;
  };
}
