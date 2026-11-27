/** The English half of the org command's messages. */

import type { OrgText } from "./org.messages.js";

export const orgEn: OrgText = {
  org: {
    desc: "Company mode: manage an organization (employees, desks, calendar, tickets, channels, finance)",
    lsDesc: "List the project's organizations",
    createDesc:
      "Create an organization: its CEO Agent, the CEO's desk session and the initialization run",
    showDesc:
      "Overview: employees and their states, board counts, spend against budget, pending items",
    chartDesc: "The employee tree with titles, states, spend and budgets",
    hireDesc:
      "Employ an Agent: an existing one (--agent-id) or a new one (--new-agent), under --reports-to",
    employeeDesc: "Manage employees",
    employeeSetDesc: "Update an employee's entry in the tree (only the given fields change)",
    employeeAvatarDesc:
      "Set or clear an employee's avatar (the employee defaults to PENGUIN_AGENT_ID, so an employee can set its own)",
    avatarFile: "Image file to use: PNG, JPEG or WebP, at most about 96 KiB",
    avatarClear: "Remove the avatar",
    leaveDesc: "Remove an employee from the organization (not the CEO); the Agent itself stays",
    deskDesc: "Desk sessions (one standing session per employee)",
    deskShowDesc: "The employee's desk session id and Workspace (opens the desk if it has none)",
    deskRenewDesc: "Open a fresh desk session for the employee (resets its context)",
    calendarDesc: "Calendar events (schedules that fire into the employee's desk session)",
    calendarLsDesc: "List the organization's calendar events (one employee's with --agent-id)",
    calendarAddDesc:
      "Create a calendar event (writes the event file through the API; enabled by default — use --disabled to opt out)",
    calendarUpdateDesc:
      "Update a calendar event (read-modify-write: unspecified fields keep their stored values)",
    calendarRmDesc: "Delete a calendar event (no prompt)",
    ticketDesc: "Tickets on the kanban board",
    ticketLsDesc: "List the board's tickets (filtered locally by --status / --owner / --blocked)",
    ticketShowDesc: "Show a ticket: the derived figures, then the ticket file",
    ticketCreateDesc: "Create a ticket in the proposed column",
    ticketMoveDesc: "Move a ticket to another column (a reason is required for rejected)",
    ticketAssignDesc: "Set a ticket's owner",
    ticketBlockDesc: "Mark a ticket blocked (it stays in its column)",
    ticketUnblockDesc: "Clear a ticket's blocked state",
    ticketProgressDesc: "Append a progress entry (attributed to the calling session)",
    ticketStartDesc:
      "Open a ticket session that works on the ticket in the background; prints the session id. Only the ticket's owner (its desk) or a person may start one — assign the ticket to move it to another employee",
    ticketAttachDesc:
      "Attach an existing session as a contributor (defaults to the calling session)",
    channelDesc:
      "The organization's channels (default_channel is the all-hands one everybody is in)",
    channelLsDesc: "List the channels: every one of them for a person, its own for an employee",
    channelCreateDesc:
      "Open a channel; only its creator is in it, everyone else arrives by invitation",
    channelShowDesc: "Show a channel and its members",
    channelInviteDesc: "Invite principals into a channel (any member may)",
    channelJoinDesc: "Join a channel yourself (people only; an employee waits to be invited)",
    channelLeaveDesc: "Leave a channel",
    channelRemoveDesc: "Remove another member from a channel (people only)",
    channelNotifyDesc:
      "Set a channel's default recipients: members a message with no @ counts as mentioning (an employee's desk is triggered, a person sees it under @me)",
    channelNotifyNone: "Clear the default recipients",
    channelNotifyNeedsList: "Give the principals to notify, or --none to clear the list.",
    channelArchiveDesc: "Archive a channel: read-only until it is unarchived (people only)",
    channelUnarchiveDesc: "Unarchive a channel (people only)",
    channelTailDesc: "Print a channel's last messages of a day (20 unless -n is given)",
    channelSendDesc:
      "Send a message to a channel (@agent:<id> / @all mention its members and trigger their desks)",
    handbookDesc:
      "The organization handbook: the knowledge base under handbook/, whose README.md is the index every run reads first",
    handbookListDesc: "List the handbook files (path, size, updated), the index first",
    handbookShowDesc: "Print a handbook document (the index when no path is given)",
    handbookWriteDesc: "Create or replace a handbook document from -m or --file",
    handbookRmDesc: "Delete a handbook document (the index cannot be deleted)",
    financeDesc: "Spend per employee (along the reporting line) and per ticket, against budgets",
    orgId:
      "Organization id (defaults to PENGUIN_ORG_ID, set inside desk and ticket sessions; no other default)",
    newOrgId:
      "Id of the organization to create (letters, digits, underscores; also its directory name)",
    mission: "The organization's mission",
    orgName: "Display name (defaults to the id)",
    orgLanguageOption:
      "Working language of everything the organization writes: zh or en (defaults to the mission's own language)",
    hireAgentId: "Employ this existing Agent (mutually exclusive with --new-agent)",
    newAgent: "Create an Agent with this id and employ it (mutually exclusive with --agent-id)",
    newAgentName: "Display name of the new Agent",
    newAgentDescription: "Description of the new Agent",
    skills:
      "Extra library plugins for the new Agent, comma-separated (added to agent-company,agent-development)",
    title: "Job title",
    reportsTo: "Agent id of the manager",
    employeeName:
      "What the organization calls the employee — any language, works after @ like the id; an empty value clears it",
    employeeWorkspace:
      "Workspace: a sub-directory of the shared workspace (. = all of it) or an absolute path, written as given",
    hireWorkspace:
      "Workspace: a sub-directory of the shared workspace or an absolute path, written as given (defaults to a sub-directory named after the employee)",
    budget: "Monthly budget in USD for the employee plus everyone below it",
    ceoBudget:
      "The CEO's monthly budget in USD, which is the whole company's (budgets accumulate along the reporting line)",
    duties: "Duties, in prose",
    calendarAgentId:
      "Employee the event belongs to (defaults to PENGUIN_AGENT_ID); on ls, list only this employee's events",
    calendarTitle: "Event title",
    statusFilter: "Only this column: proposed, in_progress, review, done or rejected",
    ownerFilter: "Only tickets owned by this principal (agent:<id> / user:<id>)",
    blockedFilter: "Only blocked tickets",
    ticketTitle: "Ticket title",
    ticketSlug: "The ticket id's words: lowercase English words joined by hyphens",
    goal: "The goal, naming every input it relies on by full path (mutually exclusive with --body-file)",
    criteria: "Acceptance criteria, naming the expected deliverables by full path (with --goal)",
    bodyFile:
      "Read the whole Markdown body from this file (the header is still generated): its ## Goal, ## Acceptance criteria, ## Progress and ## Result sections become the ticket's, nothing may stand above the first ## heading, and a file with no ## heading is all goal",
    owner: "The responsible principal (agent:<id> / user:<id>); defaults to you on create",
    parent: "Parent ticket id",
    notify: "Principals notified when the ticket ends, comma-separated",
    priority: "Priority: P0, P1 or P2",
    due: "Due date (yyyy-mm-dd)",
    moveTo: "Target column: proposed, in_progress, review, done or rejected",
    moveReason: "Why (required when moving into rejected; recorded under Result)",
    blockReason: "Why the ticket is blocked",
    blockedBy: "Who or which ticket it waits for (a principal or a ticket id)",
    progressText: "The progress entry, naming the files it refers to by full path",
    startMessage: "A note appended to the ticket text the session opens with",
    startWorkspace:
      "Another directory inside the shared workspace (defaults to the employee's desk workspace)",
    startAgentId:
      "Which employee the session runs as: a colleague you enlist on your own ticket (defaults to you inside a session, otherwise the ticket's owner)",
    attachSession:
      "The session to attach, full id or unique fragment (defaults to PENGUIN_SESSION_ID)",
    channelOpt: "Channel to read or write in (default: default_channel, the all-hands channel)",
    channelName: "Display name (defaults to the id)",
    channelPurpose: "What the channel is for",
    channelDate: "Day to read (yyyy-mm-dd in the organization's timezone; defaults to today)",
    channelCount: "Number of messages to print (default 20)",
    channelText: "Message text (@agent:<id> or @all to mention, inside the channel's membership)",
    handbookPath:
      "Path relative to handbook/ (plain segments, e.g. decisions/2026-09-02-hire-plan.md)",
    handbookText: "Document text",
    handbookFile: "Read the document text from a local file",
    handbookOneSource: "Give exactly one of -m <text> or --file <file>.",
    refTicket: "Ticket the message refers to",
    refSession: "Session the message refers to",
    period: "Month to report (yyyy-mm; defaults to the current month)",
    orgIdMissing: () =>
      "No organization given: pass --org-id <id>, or set PENGUIN_ORG_ID (desk and ticket sessions carry it in their environment).",
    hireTargetConflict: () =>
      "Pass exactly one of --agent-id (an existing Agent) and --new-agent (create one).",
    newAgentFieldsOnly: () => "--name, --description and --skills describe --new-agent only.",
    budgetInvalid: (flag, value) =>
      `Invalid ${flag} value "${value}": expected a non-negative amount in USD.`,
    nothingToSet: () => "Nothing to update: pass at least one field.",
    languageInvalid: (value) => `Invalid --language value "${value}": expected zh or en.`,
    statusInvalid: (value) =>
      `Invalid column "${value}": expected proposed, in_progress, review, done or rejected.`,
    priorityInvalid: (value) => `Invalid --priority value "${value}": expected P0, P1 or P2.`,
    ticketBodyConflict: () => "Pass exactly one of --goal and --body-file.",
    criteriaNeedsGoal: () => "--criteria goes with --goal.",
    bodyFileUnreadable: (file) => `Cannot read --body-file ${file}.`,
    countInvalid: (value) => `Invalid -n value "${value}": expected a positive integer.`,
    pathSegmentInvalid: (value) =>
      `Invalid name "${value}": "." and ".." are neither an id nor a handbook path.`,
    attachSessionMissing: () =>
      "No session to attach: pass --session <id>, or run inside a session (PENGUIN_SESSION_ID).",
    created: (orgId, ceoDeskSessionId) =>
      `Organization ${orgId} created${ceoDeskSessionId !== undefined ? ` (CEO desk session ${ceoDeskSessionId})` : ""}.`,
    hired: (agentId, title, reportsTo) =>
      `Employee ${agentId} hired as ${title}${reportsTo !== null ? `, reporting to ${reportsTo}` : ""}.`,
    employeeUpdated: (agentId) => `Employee ${agentId} updated.`,
    avatarNeedsOne: () => "Give exactly one of --file <path> and --clear.",
    avatarNoAgent: () =>
      "Name the employee: pass <agent_id>, or run inside a desk or ticket session (PENGUIN_AGENT_ID).",
    avatarUnreadable: (file, reason) => `Cannot read ${file}: ${reason}`,
    avatarFormat: (file) => `${file} is not a PNG, JPEG or WebP image.`,
    avatarTooLarge: (file, kib, maxKib) =>
      `${file} is ${kib} KiB; an avatar is at most ${maxKib} KiB. Scale it down (256×256 is plenty) and try again.`,
    avatarSet: (agentId) => `Avatar of ${agentId} set.`,
    avatarCleared: (agentId) => `Avatar of ${agentId} removed.`,
    left: (agentId) => `Employee ${agentId} left the organization.`,
    desk: (agentId, sessionId, workspace, openedAt, created) =>
      `Desk of ${agentId}: session ${sessionId} (workspace ${workspace}, opened ${openedAt})${created ? " — opened just now" : ""}`,
    deskRenewed: (agentId, sessionId) => `Desk of ${agentId} renewed: session ${sessionId}.`,
    calendarWritten: (agentId, name, enabledText, nextFireAt) =>
      `Calendar event ${agentId}/${name} written (${enabledText}${nextFireAt !== undefined ? `, next fire ${nextFireAt}` : ""}).`,
    calendarWarning: (warning) => `Rota notice: ${warning}`,
    calendarRemoved: (agentId, name) => `Calendar event ${agentId}/${name} removed.`,
    ticketCreated: (ticketId, status) => `Ticket ${ticketId} created (${status}).`,
    ticketMoved: (ticketId, status) => `Ticket ${ticketId} moved to ${status}.`,
    ticketAssigned: (ticketId, owner) => `Ticket ${ticketId} assigned to ${owner}.`,
    ticketBlocked: (ticketId) => `Ticket ${ticketId} marked blocked.`,
    ticketUnblocked: (ticketId) => `Ticket ${ticketId} unblocked.`,
    progressRecorded: (ticketId) => `Progress recorded on ticket ${ticketId}.`,
    ticketAttached: (ticketId, sessionId) => `Session ${sessionId} attached to ticket ${ticketId}.`,
    channelCreated: (channelId) => `Channel ${channelId} created.`,
    channelInvited: (channelId, principal) => `${principal} invited to ${channelId}.`,
    channelJoined: (channelId) => `Joined ${channelId}.`,
    channelLeft: (channelId) => `Left ${channelId}.`,
    channelMemberRemoved: (channelId, principal) => `${principal} removed from ${channelId}.`,
    channelNotifySet: (channelId, principals) =>
      `Messages in ${channelId} with no @ now count as mentioning ${principals}.`,
    channelNotifyCleared: (channelId) => `${channelId} has no default recipients now.`,
    channelArchived: (channelId) => `Channel ${channelId} archived.`,
    channelUnarchived: (channelId) => `Channel ${channelId} unarchived.`,
    messageSent: (id) => `Message ${id} sent.`,
    handbookWritten: (path) => `Handbook document ${path} written.`,
    handbookRemoved: (path) => `Handbook document ${path} removed.`,
    empty: (projectId) => `No organizations in project ${projectId}.`,
    calendarEmpty: () => "No calendar events.",
    ticketsEmpty: () => "No tickets match.",
    channelsEmpty: () => "No channels.",
    channelEmpty: (channelId, date) => `No messages in ${channelId} on ${date}.`,
    showHead: (name, orgId, status) => `${name} (${orgId}) — ${status}`,
    showMission: (mission) => `Mission: ${mission}`,
    showLanguage: (language) => `Working language: ${language}`,
    showEmployees: (count, running, paused) =>
      `Employees: ${count} (${running} running, ${paused} paused)`,
    showBoard: (counts, blocked) => `Board: ${counts} (${blocked} blocked)`,
    showSpend: (period, spend) => `Spend (${period}): ${spend}`,
    showPending: (mentions, review, blockedByMe) =>
      `Pending: ${mentions} mentions, ${review} tickets to review, ${blockedByMe} blocked by me`,
    invalid: (reason) => `invalid: ${reason}`,
    ticketHead: (ticketId, status, running, blocked) =>
      `Ticket ${ticketId}: ${status}${running ? ", running" : ""}${blocked !== undefined ? `, blocked (${blocked})` : ""}`,
    ticketFigures: (cost, rolledUp, sessions, children) =>
      `Cost ${cost} (rolled up ${rolledUp}), ${sessions} sessions, ${children} child tickets`,
    ticketFields: () => ({
      title: "Title",
      owner: "Owner",
      parent: "Parent",
      notify: "Notify",
      priority: "Priority",
      due: "Due",
      blocked: "Blocked",
      blockedBy: "Blocked by",
      sessions: "Sessions",
    }),
    ticketHistory: () => "History:",
    notices: {
      employee_joined: (p) => `${p.agent} joined as ${p.title}, reporting to ${p.reportsTo}.`,
      employee_left: (p) => `${p.agent} left the organization; reports now go to ${p.reportsTo}.`,
      channel_created: (p) => `${p.by} created the channel.`,
      channel_archived: (p) => `${p.by} archived the channel.`,
      channel_unarchived: (p) => `${p.by} unarchived the channel.`,
      channel_joined: (p) => `${p.principal} joined the channel.`,
      channel_invited: (p) => `${p.by} invited ${p.principal} to the channel.`,
      channel_left: (p) => `${p.principal} left the channel.`,
      channel_removed: (p) => `${p.by} removed ${p.principal} from the channel.`,
      budget_warned: (p) =>
        `Budget warning: ${p.agent} has used ${p.percent}% of its ${p.period} budget (${p.cost} / ${p.budget} USD).`,
      budget_paused: (p) =>
        `Budget pause: ${p.agent} reached ${p.percent}% of its ${p.period} budget (${p.cost} / ${p.budget} USD); its calendar and its subordinates' are paused.`,
      ticket_blocked: (p) => `Ticket ${p.ticket} (${p.title}) is now blocked.`,
      ticket_done: (p) => `Ticket ${p.ticket} (${p.title}) is now done.`,
      ticket_rejected: (p) => `Ticket ${p.ticket} (${p.title}) is now rejected.`,
    },
    allHands: () => "All hands",
    channelHeader: (channelId) => `[channel ${channelId}]`,
    channelHead: (name, channelId, members, archived) =>
      `${name} (${channelId}) — ${members} members${archived ? ", archived" : ""}`,
    channelPurposeLine: (purpose) => `Purpose: ${purpose}`,
    channelNotifyLine: (principals) => `Default recipients (a message with no @): ${principals}`,
    channelCreatedBy: (principal, createdAt) => `Created by ${principal} on ${createdAt}`,
    channelLastMessage: (time) => `Last message: ${time}`,
    financeTotal: (period, total) => `Total (${period}): ${total}`,
    unpriced: () =>
      "[unpriced] some usage ran on a model without pricing: the figures are a lower bound",
    proposalDesc:
      "Proposals (the company-proposals plugin): a change written for a person to read while an employee builds it",
    proposalLsDesc: "List the organization's proposals (filtered locally by --status)",
    proposalShowDesc:
      "Show a proposal: its head, scope, materials, the sections, the comments and the events",
    proposalCreateDesc:
      "Start a proposal and hand it to an employee to write (a person; an employee's new proposals come from approved roadmap items)",
    proposalPublishDesc:
      "Publish a revision from a Markdown file (frontmatter title and scope, then the sections)",
    proposalBriefDesc:
      "Rewrite a proposal's brief (the author or a person); the revisions, comments and approval stay",
    proposalReadyDesc: "Mark a proposal ready for reading (the author or a person)",
    proposalApproveDesc: "Approve a proposal and request its merge (a person)",
    proposalMergedDesc:
      "Report the implementation merged (the implementer or a person; anybody else once the impl PR is merged into its default branch)",
    proposalRejectDesc: "Reject a proposal with a reason (a person or any employee)",
    proposalImplementDesc:
      "Open an implementation session for an employee on the proposal; prints the session id",
    proposalMaterialDesc: "Related material: the PR, an issue, a branch, a document, a ticket",
    proposalMaterialAddDesc:
      "Attach material as <kind>=<url> (pr, issue, branch, doc, ticket, url)",
    proposalImplDesc:
      "Register the proposal's impl — a branch pair (--head and --base), its PR, or both; one per proposal, replacing the one before (--adopt: the one-time adoption from the pr materials)",
    proposalImplAdopt:
      "Give every proposal without an impl PR its latest pr material on the delivery repository",
    proposalImplHeadOpt:
      "The impl branch's head: a git remote of the proposal's repository (or owner/repo) and a branch",
    proposalImplBaseOpt:
      "The base the head is measured against: a remote (or owner/repo) and a branch; required with --head",
    proposalDiffDesc:
      "Print the impl branch's patch: the merge base of base and head, up to head (read from GitHub)",
    proposalDiffStatOpt: "Only the changed files with their added and deleted lines",
    proposalGraphDesc:
      "Show the delivery repository's open PRs as a commit graph, with each PR's proposal and the origins' PRs on the same branch",
    proposalGraphAllOpt:
      "Draw every open PR, not only the organization's proposals and the PRs they are stacked on",
    proposalDeployDesc:
      "Run the organization's deploy Action deploy.<id> on the proposal's impl head (or a PR's with --pr), on the server that holds the organization; arguments after -- go to the deploy",
    proposalDeployTo: "The deploy's id: the Action deploy.<id> (penguin org action ls lists them)",
    proposalDeployPr: "Deploy this PR of the delivery repository instead of a proposal's impl",
    proposalDeployHead:
      "The head you looked at: the run is refused when the subject has moved past it",
    proposalDeployDryRun:
      "Print which Action would run on which subject and whether you may run it, without running it",
    proposalDeployUsage: "Name a proposal number or --pr <n>, one of the two.",
    proposalDeployPlanned: (key, subject, allowed, why) =>
      `${key} would run on ${subject} (dry run): ${allowed === null ? "not in this organization" : allowed ? "allowed" : `refused — ${why}`}`,
    proposalDeployStarted: (run, key, subject, head) =>
      `Deploy ${run}: ${key} on ${subject} at ${head}. Ctrl-C stops following; the run goes on.`,
    proposalDeploySucceeded: (run, head) => `Deploy ${run} succeeded (${head}).`,
    proposalDeployFailed: (run, outcome, exitCode, message) =>
      `Deploy ${run} ${outcome}${exitCode === null ? "" : ` (exit ${exitCode})`}${message === null || message === "" ? "" : `: ${message}`}.`,
    actionDesc:
      "The organization's Actions: every write to its proposals and roadmaps, and their runs (the Activity)",
    actionLsDesc: "List the Actions in force in the organization (--all: every contribution)",
    actionLsSubject:
      "Only the Actions acting on this subject, each with whether you may run it now",
    actionLsAll:
      "Every contribution — actions, guards, hooks, subject resolvers — built in or a company workflow's",
    actionRunDesc: "Run the Action a key names on a subject (e.g. proposal:12)",
    actionExecDesc:
      "Run one contribution exactly, by its id (what an ambiguous key asks for): an action's id runs it; a guard's runs its key's Action, judged by that guard alone",
    actionParam:
      "A parameter, name=value (the value as JSON when it parses, else a string); repeatable",
    actionParams: "The parameters as one JSON object (--param flags override it)",
    actionRequestId: "A retry with the same id answers the first run instead of running again",
    actionParamInvalid: (value) => `Not a parameter (name=value) or a JSON object: ${value}`,
    actionRunsDesc: "The Activity: the organization's runs, newest first",
    actionRunsSubject: "Only the runs on this subject",
    actionRunsBy: "Only the runs by this principal (user:<id> or agent:<id>)",
    actionRunsKey: "Only the runs of this Action key",
    actionRunsBefore: "The page before this cursor (what the last page printed as next)",
    actionRunsLimit: "At most this many runs (1–200, default 50)",
    actionLimitInvalid: (value) => `--limit must be 1–200: ${value}`,
    actionCheckDesc: "List the keys two contributions of one standing answer (ambiguous when run)",
    actionsNone: "This organization has no Actions.",
    actionsHeader: ["KEY", "CONTRIBUTION", "SUBJECTS", "ALLOWED"],
    contributionsHeader: ["ID", "KIND", "KEY", "WORKFLOW", "REPLACED", "FROM"],
    actionRunsNone: "No runs.",
    actionRunsHeader: ["STARTED", "KEY", "SUBJECT", "BY", "VIA", "OUTCOME"],
    actionRunsNext: (cursor) => `More: --before '${cursor}'`,
    actionCheckNone: "No conflicts.",
    actionConflict: (key, kind, contributions) => `${key} (${kind}): ${contributions}`,
    actionRunStarted: (run, key, subject) =>
      `Run ${run}: ${key} on ${subject}. Ctrl-C stops following; the run goes on.`,
    actionRunEnded: (run, outcome, message) =>
      `Run ${run} ${outcome}${message === null || message === "" ? "" : `: ${message}`}.`,
    actionExecForm: (cli) => `  ${cli}`,
    roadmapDesc:
      "The organization's roadmaps: one item of a discussing draft, added or removed without rewriting the rest",
    roadmapItemDesc: "One item of a discussing roadmap's draft",
    roadmapItemAddDesc:
      "Add one item to a discussing roadmap's draft (the roadmap.item.add Action), leaving every other item, the record and the body as they are",
    roadmapItemRemoveDesc:
      "Remove one item from a discussing roadmap's draft (the roadmap.item.remove Action), unless it stands for a proposal",
    roadmapItemKey: "The item's key, 1–40 lowercase letters, digits or dashes",
    roadmapItemKind: "The item's kind: proposal or roadmap",
    roadmapItemTitle: "The item's title",
    roadmapItemBrief: "The item's brief, one or two sentences",
    roadmapItemOwner: "A proposal item's owner, an employee id",
    roadmapItemEmployees: "A roadmap item's employees, comma-separated (the first one moderates)",
    roadmapItemCites: "The body sections the brief draws on, comma-separated",
    roadmapItemStackedOn:
      "The earlier proposal item this one stacks on; `null` for none (without the flag it stacks on the previous proposal item)",
    roadmapItemProposal: "An adopted proposal number the item stands for",
    roadmapNumberInvalid: (value) => `Roadmap number "${value}" is invalid: a positive integer.`,
    roadmapItemProposalInvalid: (value) => `--proposal must be a proposal number: ${value}`,
    workflowDesc:
      "The organization's company workflows: packages whose Actions, guards and hooks take effect in it once loaded",
    workflowLsDesc: "List the company workflows, the revision serving and whether the files load",
    workflowPutDesc:
      "Write a local directory as company workflow <id> and load it (the workflow.write Action)",
    workflowPutKeep: "Keep the workflow's files the directory lacks (default: delete them)",
    workflowRmDesc: "Delete a company workflow and its versions",
    workflowReloadDesc: "Load a company workflow again after its files were changed in place",
    workflowHistoryDesc: "List a company workflow's recorded versions, newest first",
    workflowRollbackDesc: "Restore a recorded version of a company workflow and load it",
    workflowsNone: "This organization has no company workflows.",
    workflowsHeader: ["ID", "SERVING", "ON DISK", "CONTRIBUTIONS", "STATE"],
    workflowVersionsNone: "No versions recorded.",
    workflowVersionsHeader: ["REVISION", "SAVED", "FILES"],
    workflowDirInvalid: (dir, why) => `Cannot send ${dir} as a workflow: ${why}.`,
    workflowLoaded: (id, revision) => `Workflow ${id} loaded (revision ${revision}).`,
    workflowNotLoaded: (id, error) =>
      `Workflow ${id} did not load; what served before keeps serving:\n${error}`,
    workflowSkipped: (id, reason) => `  left out: ${id} — ${reason}`,
    workflowRemoved: (id) => `Workflow ${id} removed.`,
    proposalDeploymentDesc:
      "The deployments somebody registered, which the PR graph places at the commit each one runs",
    proposalDeploymentAddDesc:
      "Register a deployment by its id; a deployment already on the registry is refused",
    proposalDeploymentUrlOpt:
      "The deployment is a penguin server at this url; the graph reads the commit it runs from there",
    proposalDeploymentLsDesc: "List the registered deployments",
    proposalFeedbackDesc:
      "Send the author feedback from the implementation (or, with --runtime, from testing the dev branch)",
    proposalConcludeDesc:
      "Send a discussion's conclusion to the owner's desk, once (from inside the discussion, or as a person with --discussion)",
    proposalCommentsDesc:
      "Print the proposal's text with each commented passage marked ⟦<id>⟧…⟦/<id>⟧, then the comments by id",
    proposalResolveDesc: "Resolve one comment, with a note on what changed",
    proposalStatusFilter:
      "Only proposals in this state (drafting, ready, approved, merged, rejected)",
    proposalAuthor: "The employee that writes the proposal (its Agent id)",
    proposalBrief_: "The delegation, in one sentence",
    proposalTitle: "A working title (the published document's own title replaces it)",
    proposalFile: "The proposal as one Markdown document",
    proposalBriefText: "The new brief",
    proposalBriefFile: "Read the new brief from a local file",
    proposalBriefOneSource: "Give exactly one of -m <text> or --file <file>.",
    proposalImplementer: "The employee that builds it (its Agent id); default: the author itself",
    proposalMessage: "A note appended to the proposal text the session opens with",
    proposalWorkspace:
      "Another directory inside the shared workspace (default: the employee's desk workspace)",
    proposalMaterialLabel: "How the material is listed (default: derived from the URL)",
    proposalFeedbackText: "What the implementation found",
    proposalConclusionText: "The conclusion: what was decided, what changes, what stays open",
    proposalDiscussion: "The discussion's session id (default: the session you run in)",
    proposalDiscussionMissing:
      "Name the discussion: run this inside the discussion's session, or pass --discussion <session_id>.",
    proposalRuntime: "The feedback comes from the test team's run of the dev branch",
    proposalPending: "Only the batched, unresolved comments — what the author has to work through",
    proposalResolveText: "What was changed for it",
    proposalRejectReason: "Why the proposal is rejected",
    proposalsPluginMissing: () =>
      "The organization has no proposals plugin: install company-proposals on this Project.",
    proposalNumberInvalid: (value) =>
      `Invalid proposal number "${value}": expected a positive integer.`,
    proposalStatusInvalid: (value) =>
      `Invalid status "${value}": expected drafting, ready, approved, merged or rejected.`,
    proposalMaterialInvalid: (value) =>
      `Invalid material "${value}": expected <kind>=<url> with kind pr, issue, branch, doc, ticket or url.`,
    proposalsEmpty: () => "No proposals.",
    proposalCommentsEmpty: (number) => `No comments on proposal #${number}.`,
    proposalCreated: (number, title) => `Created proposal #${number}: ${title}`,
    proposalPublished: (number, revision) => `Published proposal #${number}, revision ${revision}.`,
    proposalBriefRewritten: (number) => `Rewrote the brief of proposal #${number}.`,
    proposalStatusSet: (number, status) => `Proposal #${number} is now ${status}.`,
    proposalImplementing: (number, implementer, sessionId) =>
      `Proposal #${number}: ${implementer} is implementing it in session ${sessionId}.`,
    proposalMaterialAdded: (number, kind) => `Attached ${kind} to proposal #${number}.`,
    proposalImplPr: (label, url) => `Impl PR: ${label} ${url}`,
    proposalImplSet: (number, url) => `Proposal #${number}'s impl PR is ${url}.`,
    proposalImplBranch: (head, base, pr) =>
      `Impl branch: ${head} ← ${base}${pr === null ? " (no PR yet)" : `  PR ${pr}`}`,
    proposalImplBranchSet: (number, head, base, pr) =>
      `Proposal #${number}'s impl branch is ${head} ← ${base}${pr === null ? "" : `, with PR ${pr}`}.`,
    proposalImplPairUsage: () =>
      "--head and --base each take two values, a remote and a branch: --head origin feat/x --base origin main.",
    proposalDiffHead: (head, base, ahead, behind, url) =>
      `${head} ← ${base}: ${ahead} commit${ahead === 1 ? "" : "s"} ahead, ${behind} behind  ${url}`,
    proposalDiffStat: (files, additions, deletions) =>
      `${files} file${files === 1 ? "" : "s"} changed, +${additions} −${deletions}`,
    proposalDiffTruncated: (limit) =>
      `GitHub lists at most ${limit} files of a comparison; the rest are not shown.`,
    proposalImplAmbiguous: (number, urls) =>
      `Proposal #${number} had several pr materials there (${urls}); the latest was taken.`,
    proposalImplSkipped: (number, reason) => `Proposal #${number} skipped: ${reason}.`,
    proposalImplUsage: () =>
      "Give the proposal and its impl: impl <number> <url>, impl <number> --head <remote> <branch> --base <remote> <branch> (with or without the url), or --adopt.",
    graphNoProposal: () => "no proposal",
    graphOffChain: () => "Off the chain:",
    graphOffReason: (reason, at, relation, base) =>
      ({
        "old-line": `old line: ${relation} against ${at}`,
        unread: `not compared with ${at}`,
        "no-base": `base ${base} is the branch of no open, merged or closed PR`,
        "not-taken": `not taken at the fork at ${at}`,
        above: `on off-chain ${at}`,
        cycle: "its declared bases form a cycle",
      })[reason] ?? reason,
    graphUnplaced: () => "Proposals whose impl is not on the graph:",
    graphUnplacedReason: (reason, at, into, base) =>
      ({
        counterpart: `${at} carries its branch`,
        merged: `merged into ${into}`,
        "in-base": `already in ${base}`,
        closed: "closed",
        "open-elsewhere": "open on another repository",
        unread: "not read",
      })[reason] ?? reason,
    graphErrors: () => "Not read from GitHub:",
    graphDeploymentsOff: () => "Deployments on no layer:",
    graphBaseBehind: (n) => `(behind ${n})`,
    graphOthersHidden: (n) => `(${n} other PR${n === 1 ? "" : "s"} not drawn; --all draws them)`,
    deploymentRegistered: (id, url) =>
      url === null
        ? `Registered deployment ${id}.`
        : `Registered deployment ${id}, a server at ${url}.`,
    proposalFeedbackRecorded: (number) => `Feedback recorded on proposal #${number}.`,
    proposalConcluded: (number, owner) =>
      `Sent the discussion's conclusion to ${owner}'s desk (proposal #${number}).`,
    proposalCommentResolved: (number, commentId) =>
      `Resolved comment ${commentId} on proposal #${number}.`,
    proposalHead: (number, title, status, revision) =>
      `Proposal #${number}: ${title} — ${status}, revision ${revision}`,
    proposalApproved: (revision) => `Approved: r${revision}`,
    proposalRevisedAfterApproval: (approved, head) =>
      `Revised after approval (r${approved} → r${head}): needs approving again`,
    proposalPeople: (author, implementer, delegatedBy) =>
      `Author ${author}, implementer ${implementer ?? "-"}, delegated by ${delegatedBy}`,
    proposalBrief: (brief) => `Brief: ${brief}`,
    proposalSessions: (sessions) => `Implementation sessions: ${sessions}`,
    proposalScope: (root) =>
      `Scope under ${root === "" ? "the shared workspace" : `root ${root}`} (kind, file, state, name pattern):`,
    proposalHint: (hint) => `Hint: ${hint}`,
    proposalTests: () => "Tests (kind, file, [name pattern], what it tests, state):",
    proposalGroupUndeclared: () => "(undeclared — the next publish must move these)",
    proposalGroupsDesc:
      "List the test groups a proposal may use, in order (declared under Settings → Plugins → Company proposals)",
    proposalGroupsEmpty: () =>
      "No test groups are declared. An admin declares them under Settings → Plugins → Company proposals.",
    proposalMaterials: () => "Materials:",
    proposalComments: () => "Comments:",
    proposalEvents: () => "Events:",
    colNumber: () => "#",
    colRevision: () => "REV",
    colAuthor: () => "AUTHOR",
    colImplementer: () => "IMPLEMENTER",
    colEmployees: () => "EMPLOYEES",
    colRunning: () => "RUNNING",
    colOpen: () => "OPEN",
    colBlocked: () => "BLOCKED",
    colSpend: () => "SPEND",
    colNote: () => "NOTE",
    colJobTitle: () => "TITLE",
    colTitle: () => "TITLE",
    colState: () => "STATE",
    colOwn: () => "OWN",
    colCumulative: () => "CUMULATIVE",
    colBudget: () => "BUDGET",
    colNext: () => "NEXT",
    colPriority: () => "PRIORITY",
    colOwner: () => "OWNER",
    colTicket: () => "TICKET",
    colRolledUp: () => "ROLLED UP",
    colMembers: () => "MEMBERS",
    colArchived: () => "ARCHIVED",
    colUnread: () => "UNREAD",
    colMentions: () => "@ME",
    colPrincipal: () => "PRINCIPAL",
  },
};
