/**
 * The proposals pages' endpoint wrappers over the face's `apiFetch`, so they run on the Web
 * App's transport (and its test and gallery stand-ins) without importing the Web App. The
 * requests, the routes and the shapes are the ones the app's own `api/endpoints.ts` carries for
 * the same plugin face — this half reads the same plugin's routes, only through the bridge.
 *
 * The Action-write helpers run one Action and answer its result typed as the write it replaces
 * answered (`actionResult` here, the app's own helper of the same name): every write to the
 * organization's proposals is an Action run through company-proposals' registry.
 */
import type {
  ActionRunAnswer,
  ActionRunResponse,
  ActionRunsResponse,
  ActionsResponse,
  OrganizationSummary,
  OrganizationsResponse,
  ProposalCommentEditRequest,
  ProposalCommentRequest,
  ProposalCreateRequest,
  ProposalDetail,
  ProposalFeedbackRequest,
  ProposalFileResponse,
  ProposalGraphResponse,
  ProposalImplChanges,
  ProposalImplementRequest,
  ProposalItem,
  ProposalMaterialRequest,
  ProposalPublishRequest,
  ProposalReadRequest,
  ProposalRejectRequest,
  ProposalResolveRequest,
  ProposalRevision,
  ProposalsResponse,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "@prismshadow/penguin-web-plugin";

const orgBase = (projectId: string, orgId?: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/organizations${
    orgId === undefined ? "" : `/${encodeURIComponent(orgId)}`
  }`;

const proposalsBase = (projectId: string, orgId: string) =>
  `${orgBase(projectId, orgId)}/proposals`;

const proposalBase = (projectId: string, orgId: string, number: number) =>
  `${proposalsBase(projectId, orgId)}/${number}`;

const actionsBase = (projectId: string, orgId: string) => `${orgBase(projectId, orgId)}/actions`;

// ---------------------------------------------------------------------------
// The organization's own reads the pages need beside the plugin face
// ---------------------------------------------------------------------------

/** The organizations the caller can see, for the routed page's summary. */
export const listOrganizations = (projectId: string) =>
  apiFetch<OrganizationsResponse>(orgBase(projectId));

/** One organization's chart: its employees, with the names and avatar revisions the page names people by. */
export interface OrgChartEntry {
  agentId: string;
  name: string;
  avatarRev?: string;
}

export interface OrgChart {
  employees: OrgChartEntry[];
}

export const getOrgChart = (projectId: string, orgId: string) =>
  apiFetch<OrgChart>(`${orgBase(projectId, orgId)}/chart`);

/** The signed-in user, for the viewer identity the page's read marks carry. */
export interface MeUser {
  userId: string;
}

export const getMe = () => apiFetch<{ user: MeUser }>("/api/me");

/** An employee's avatar picture (the organization's own `avatars/`), its revision in the URL. */
export const orgEmployeeAvatarUrl = (
  projectId: string,
  orgId: string,
  agentId: string,
  rev: string,
): string =>
  `${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}/avatar?rev=${encodeURIComponent(rev)}`;

// ---------------------------------------------------------------------------
// Roadmaps (the graph's roadmap columns; the plugin answers more)
// ---------------------------------------------------------------------------

/** What the web app reads of one roadmap (the plugin answers more). */
export interface OrgRoadmapItem {
  number: number;
  name: string;
  status: string;
  channelId: string | null;
  createdAt: string;
  events?: ReadonlyArray<{ at: string }>;
}

/** One item of a roadmap's draft: a proposal it delegates, or a roadmap it derives. */
export type OrgRoadmapDraftItem =
  | {
      key: string;
      kind: "proposal";
      title: string;
      brief: string;
      owner: string;
      /** An existing proposal the roadmap took in as it is (adopted). */
      proposal?: number;
    }
  | { key: string; kind: "roadmap"; title: string; brief: string; employees: string[] };

/** Who gave one of a proposal item's approvals, and when. */
export interface OrgRoadmapApproval {
  by: string;
  at: string;
}

/** What an establishment did with one item (the plugin's delegation record, as far as the room's column reads it). */
export interface OrgRoadmapDelegation {
  key: string;
  owner: string;
  /** The derived roadmap's number (a roadmap item). */
  child: number | null;
  /** The proposal linked back (a proposal item). */
  proposal?: number;
  /** A brief waits for its two approvals; absent on lines written before that gate, which read as delegated. */
  stage?: "brief" | "delegated";
  /** The approvals given, by role (`moderator` and `member` unless the organization binds other roles). */
  approvals?: Record<string, OrgRoadmapApproval>;
}

/** One roadmap as the room's column reads it: the list row plus its moderator, body and items. */
export interface OrgRoadmapDetail extends OrgRoadmapItem {
  moderator: string | null;
  body: string;
  items: OrgRoadmapDraftItem[];
  delegations: Record<string, OrgRoadmapDelegation>;
}

export const listOrgRoadmaps = (
  projectId: string,
  orgId: string,
  filter: { channel?: string; status?: string; items?: boolean } = {},
) => {
  const q = new URLSearchParams();
  if (filter.channel !== undefined) q.set("channel", filter.channel);
  if (filter.status !== undefined) q.set("status", filter.status);
  // A list read for its rows asks for no items: the sidebar and a room's column never look at
  // them, and an organization's every brief in one answer is what a hub kept re-reading.
  if (filter.items === false) q.set("items", "0");
  const qs = q.toString();
  return apiFetch<{ roadmaps: OrgRoadmapItem[] }>(
    `${orgBase(projectId, orgId)}/roadmaps${qs === "" ? "" : `?${qs}`}`,
  );
};

export const getOrgRoadmap = (projectId: string, orgId: string, number: number) =>
  apiFetch<OrgRoadmapDetail>(
    `${orgBase(projectId, orgId)}/roadmaps/${number}?items=1`,
  );

// ---------------------------------------------------------------------------
// Actions (the writes, and the Activity behind every one of them)
// ---------------------------------------------------------------------------

export const runOrgAction = (
  projectId: string,
  orgId: string,
  key: string,
  subject: string,
  params: Record<string, unknown> = {},
) =>
  apiFetch<ActionRunAnswer>(`${actionsBase(projectId, orgId)}/${encodeURIComponent(key)}/runs`, {
    method: "POST",
    body: { subject, params, via: "web" },
  });

/** Runs an Action and answers its result, typed as the write it replaces answered. */
const actionResult = async <T>(
  projectId: string,
  orgId: string,
  key: string,
  subject: string,
  params: Record<string, unknown> = {},
): Promise<T> => (await runOrgAction(projectId, orgId, key, subject, params)).result as T;

/** The Actions bound in the organization; with a subject, those acting on it and whether the caller may run each now. */
export const listOrgActions = (projectId: string, orgId: string, subject?: string) =>
  apiFetch<ActionsResponse>(
    `${actionsBase(projectId, orgId)}${subject === undefined ? "" : `?subject=${encodeURIComponent(subject)}`}`,
  );

/** What the Activity is narrowed by; `before` is the previous page's `next`. */
export interface ActionRunsFilter {
  subject?: string;
  by?: string;
  key?: string;
  before?: string;
  limit?: number;
}

/** One page of the Activity, newest first. */
export const listOrgActionRuns = (
  projectId: string,
  orgId: string,
  filter: ActionRunsFilter = {},
) => {
  const q = new URLSearchParams();
  if (filter.subject) q.set("subject", filter.subject);
  if (filter.by) q.set("by", filter.by);
  if (filter.key) q.set("key", filter.key);
  if (filter.before) q.set("before", filter.before);
  if (filter.limit !== undefined) q.set("limit", String(filter.limit));
  const qs = q.toString();
  return apiFetch<ActionRunsResponse>(
    `${actionsBase(projectId, orgId)}/runs${qs === "" ? "" : `?${qs}`}`,
  );
};

/** One run, and its process output from `from`. */
export const getOrgActionRun = (projectId: string, orgId: string, id: string, from: number) =>
  apiFetch<ActionRunResponse>(
    `${actionsBase(projectId, orgId)}/runs/${encodeURIComponent(id)}?from=${from}`,
  );

// ---------------------------------------------------------------------------
// The proposals face
// ---------------------------------------------------------------------------

const proposalSubject = (number: number) => `proposal:${number}`;
const commentSubject = (number: number, id: string) => `comment:${number}/${id}`;

export const listOrgProposals = (projectId: string, orgId: string) =>
  apiFetch<ProposalsResponse>(proposalsBase(projectId, orgId));

/** The PR graph as the server stores it; `refresh` waits for the server to read the repository again first. */
export const getOrgProposalGraph = (
  projectId: string,
  orgId: string,
  opts: { refresh?: boolean } = {},
) =>
  apiFetch<ProposalGraphResponse>(
    `${proposalsBase(projectId, orgId)}/graph${opts.refresh === true ? "?refresh=1" : ""}`,
  );

export const createOrgProposal = (projectId: string, orgId: string, body: ProposalCreateRequest) =>
  actionResult<ProposalItem>(projectId, orgId, "proposal.create", "organization", {
    ...(body.author !== undefined ? { author: body.author } : {}),
    brief: body.brief,
    ...(body.title !== undefined ? { title: body.title } : {}),
  });

export const getOrgProposal = (projectId: string, orgId: string, number: number) =>
  apiFetch<ProposalDetail>(proposalBase(projectId, orgId, number));

/** The impl branch's diff file by file with hunks; `ignoreWhitespace` is git's `-w`. */
export const getOrgProposalImplChanges = (
  projectId: string,
  orgId: string,
  number: number,
  ignoreWhitespace: boolean,
) =>
  apiFetch<ProposalImplChanges>(
    `${proposalBase(projectId, orgId, number)}/impl/changes${ignoreWhitespace ? "?w=1" : ""}`,
  );

/** One revision as it was published — what the page diffs the head against after an approval. */
export const getOrgProposalRevision = (
  projectId: string,
  orgId: string,
  number: number,
  revision: number,
) => apiFetch<ProposalRevision>(`${proposalBase(projectId, orgId, number)}/revisions/${revision}`);

/** One file under the proposal's base, read-only (`path` relative to it). */
export const getOrgProposalFile = (
  projectId: string,
  orgId: string,
  number: number,
  path: string,
) =>
  apiFetch<ProposalFileResponse>(
    `${proposalBase(projectId, orgId, number)}/file?path=${encodeURIComponent(path)}`,
  );

export const publishOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalPublishRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.publish", proposalSubject(number), {
    markdown: body.markdown,
  });

export const readyOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.ready", proposalSubject(number));

export const approveOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.approve", proposalSubject(number));

export const rejectOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalRejectRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.reject", proposalSubject(number), {
    reason: body.reason,
  });

export const mergedOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.merged", proposalSubject(number));

export const implementOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalImplementRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.implement", proposalSubject(number), {
    ...(body.agentId !== undefined ? { agent: body.agentId } : {}),
    ...(body.message !== undefined ? { message: body.message } : {}),
    ...(body.workspace !== undefined ? { workspace: body.workspace } : {}),
  });

/** A discussion with the owner (the implementer, else the author): the answer names its session. */
export const discussOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail & { sessionId: string }>(
    projectId,
    orgId,
    "proposal.discuss",
    proposalSubject(number),
  );

export const addOrgProposalMaterial = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalMaterialRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.material", proposalSubject(number), {
    kind: body.kind,
    url: body.url,
    ...(body.label !== undefined ? { label: body.label } : {}),
  });

export const sendOrgProposalFeedback = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalFeedbackRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.feedback", proposalSubject(number), {
    text: body.text,
    ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
  });

/**
 * A comment on a passage of a section, or on a target (a scope or test entry, a changed file,
 * changed lines); pending (the commenter's own) until `requestOrgProposalChanges` batches it.
 */
export const commentOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalCommentRequest,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.comment",
    proposalSubject(number),
    "target" in body
      ? { target: body.target, text: body.text }
      : {
          sectionId: body.sectionId,
          start: body.start,
          end: body.end,
          quote: body.quote,
          text: body.text,
        },
  );

/** Every pending comment of the caller becomes one batch, and the author is told. */
export const requestOrgProposalChanges = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.requestChanges",
    proposalSubject(number),
  );

export const editOrgProposalComment = (
  projectId: string,
  orgId: string,
  number: number,
  commentId: string,
  body: ProposalCommentEditRequest,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.comment.edit",
    commentSubject(number, commentId),
    { text: body.text },
  );

export const deleteOrgProposalComment = (
  projectId: string,
  orgId: string,
  number: number,
  commentId: string,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.comment.withdraw",
    commentSubject(number, commentId),
  );

export const resolveOrgProposalComment = (
  projectId: string,
  orgId: string,
  number: number,
  commentId: string,
  body: ProposalResolveRequest,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.resolve",
    commentSubject(number, commentId),
    body.text !== undefined ? { text: body.text } : {},
  );

export const readOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalReadRequest,
) => apiFetch<void>(`${proposalBase(projectId, orgId, number)}/read`, { method: "POST", body });
