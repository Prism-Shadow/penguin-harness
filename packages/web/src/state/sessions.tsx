/**
 * Session list context for all Agents in the current Project:
 * the sidebar groups by Agent, so all Agents' Sessions are loaded at once (fetched in parallel);
 * the chat page shares this same data for status sync / title events / self-healing reload.
 *
 * **The sidebar's rows only**: every fetch asks for the **active** category — the user's
 * conversations, the listing rule's other side of the archive (an archived Session, and one a
 * program opened that nobody kept, live on the archive page instead) — plus per-category
 * totals. Pages run per (Agent, Workspace group, source): each fetches SIDEBAR_PAGE_SIZE
 * sessions (requesting one extra to detect "has more" — see splitPage); `loadMoreFor` fetches a
 * stream's first page when unloaded and the next page otherwise. A reload resets each
 * **loaded** stream back to its first page (a group's rows must not blank on an
 * event-triggered refresh).
 *
 * **Rows the sidebar does not draw**: the chat page hands the store the row it shows (add,
 * replace) whatever list that row is in — an archived Session's stub, a subagent opened from
 * the Agent panel, an organization's desk — so the status, title and PATCH writes keep reaching
 * the page; no fetch returns such a row, so a reload carries them over, the totals never count
 * them, and the sidebar draws only the active ones (session-grouping.ts isSidebarRow).
 *
 * **Activity order, cursor paging**: every page is asked for in the sidebar's own display order
 * (`order=activity`: last activity first) and continues from the key of the last row read
 * (`before=`), never from an offset — activity reorders the list while it is read, and an
 * offset would skip a row that moved above it. A row that moves above a cursor is not served
 * again; a loaded one moves in place on its `session_state`, and an unloaded one is fetched
 * on it (adoptLiveSession), which is what keeps the pages complete. A list merged from several
 * streams (Agents, machines) shows only the rows above its watermark (watermarkFor; the
 * sidebar cuts at it), so a later page can only ever add rows below the ones on screen.
 *
 * **Own rows only**: every fetch asks the server for the user's own conversations
 * (`excludeOrg`), and no category holds a company Session anyway, so an organization's desk,
 * ticket and sub-sessions are in neither the rows nor the totals the sidebar builds its groups
 * from. Live statuses are remembered for EVERY `session_state` the user channel reports
 * (`liveStatuses`), row or no row — company mode's surfaces read them for the Sessions this
 * list deliberately does not fetch (useLiveSessionStatuses).
 *
 * **Deleted stays deleted**: an id this tab knows is deleted — it removed it, or the user channel
 * said so — is listed by no snapshot again: not by a reload or a next page that was read while
 * the Session still existed and answered after it was gone, nor by a machine's cache. A deletion
 * heard while a reload is in flight also drops that reload and asks again, since its totals still
 * count the Session. (A new conversation whose first Task is refused is deleted moments after the
 * creating tab's own reload read it; without this the reload put it back as a row that opens to
 * nothing.)
 *
 * **Sessions are not auto-created here**: a new conversation starts as a draft (chat page `/chat/new`),
 * and the Session is only actually created when the first message is sent — after landing, the user
 * may still switch models or configure an API key first, so persisting the Session early would both
 * lock in the model and fail outright when no credential is configured yet.
 *
 * State lives in a zustand vanilla store (one instance per Provider mount); the Provider is a
 * thin lifecycle component (initial fetch, refetch on Project/Agent-set/filter changes, the
 * user-event subscription) and republishes the store's state through the same context value
 * as before. Mutations read current values via store.getState() (the old refs' job).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  ServerEvent,
  SessionBackgroundTasks,
  SessionBatchResult,
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { ApiError } from "../api/client";
import { probeSession } from "../api/session-probe";
import { openMachineEvents, openUserEvents } from "../api/sse";
import { isCompanyEvent, publishCompanyEvent, publishCompanyResync } from "./company";
import { publishMachinesChanged, useMachines } from "./machines";
import {
  isBuiltinBrowserEvent,
  publishBuiltinBrowserEvent,
  publishBuiltinBrowserResync,
} from "../features/builtin-browser/browser-events";
import { WORKBENCH_UPDATED_EVENT } from "../lib/workbench-tabs";
import { publishUserEvent } from "../lib/amsp/user-events";
import { mergeCounts, mostRecentFirst } from "../lib/session-merge";
import {
  forgetSessionMachines,
  machineForSession,
  rememberSessionMachine,
} from "../lib/session-machines";
import {
  cachedMachineAgents,
  cachedMachineSessions,
  rememberMachineSessions,
} from "../lib/machine-cache";
import {
  machineAgentsOutOfReach,
  readMachineAgents,
  subscribeMachineAgentsChanged,
} from "../lib/machine-agent-lists";
import { setTerminalMachines } from "../lib/terminal-machines";
import { machineIdOf } from "../lib/workspace-machines";
import {
  SIDEBAR_PAGE_SIZE,
  activityKeyOf,
  activityWatermark,
  isOrgSession,
  sessionCategory,
  splitPage,
  workspaceGroupKey,
  workspaceGroupMachine,
  workspaceGroupQuery,
} from "../lib/session-grouping";
import type { ActivityKey, StreamPosition } from "../lib/session-grouping";
import { noteScheduleEvent } from "../features/schedules/schedule-store";
import {
  isCurrentProject,
  ofProject,
  scoped,
  scopedValue,
  type Scoped,
} from "../lib/project-scope";
import { useProject } from "./project";

/** A reload this server answered nothing to is tried again after this, doubling up to the ceiling. */
const RELOAD_RETRY_MIN_MS = 2_000;
const RELOAD_RETRY_MAX_MS = 30_000;
/**
 * A machine that answered none of a reload's questions rests this long, doubling up to the
 * ceiling (the reload retry's shape); then ONE question probes it (see `resting`).
 */
export const MACHINE_REST_MIN_MS = 2_000;
export const MACHINE_REST_MAX_MS = 30_000;

interface SessionsContextValue {
  /**
   * Loaded rows, most recently active first: the sidebar's pages (paged per Agent and Workspace
   * group) plus the rows the chat page handed in for the conversation it shows, whichever list
   * those are in — the sidebar draws only its own (isSidebarRow).
   */
  sessions: SessionInfo[];
  /** agentId → that Agent's loaded Session list, most recently active first (empty array if none). */
  byAgent: ReadonlyMap<string, SessionInfo[]>;
  /** agentId → per-category totals from the last list fetch (the sidebar reads `active`; kept in step locally on add / remove / archive toggles). */
  countsByAgent: ReadonlyMap<string, SessionCategoryCounts>;
  /** agentId → the same totals broken down by Workspace group — a path ON a machine, keyed by workspaceGroupKey (workspace-mode groups read their own share from it; maintained like countsByAgent). */
  workspaceCountsByAgent: ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>;
  /** agentId → each Workspace path's newest Session `createdAt` from the last list fetch, every category counted: the Workspace picker's "recently used". */
  workspaceLatestByAgent: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** agentId → each Workspace path's newest ACTIVE Session `createdAt` from the last list fetch: what places a workspace-mode group before any of its rows are loaded (an archived Session does not move a group it is not shown in). */
  workspaceLatestActiveByAgent: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** Every run status the user channel has reported this page's lifetime, by Session id — loaded row or not (see useLiveSessionStatuses). */
  liveStatuses: ReadonlyMap<string, SessionStatus>;
  /**
   * machineId → the ssh alias that reaches it, for naming what is not on this server. Empty
   * when the machine list could not be read (it is admin-only): a caller then shows the bare
   * name, which is what it showed before machines existed.
   */
  machineLabels: ReadonlyMap<string, string>;
  /**
   * The Project's machines this server holds a connection to — the ones whose API can be
   * reached through the proxy right now. Any page that has to ask "what does this Agent have
   * over there" fans out over this alongside this server, rather than fetching the
   * admin-only machine list of its own.
   */
  machineIds: string[];
  /**
   * Whether a stream's first page has been fetched (false = the group shows nothing because
   * nothing was asked for yet). `workspaceGroup` asks about ONE group's own stream, which
   * is paged separately from the Agent's whole one.
   */
  isLoadedFor: (agentId: string, workspaceGroup?: string) => boolean;
  /** Whether the server still holds unfetched active Sessions for an Agent (or for one of its Workspace groups) — an unloaded stream answers from the counts. */
  hasMoreFor: (agentId: string, workspaceGroup?: string) => boolean;
  /**
   * The watermark of a list fed by these Agents' streams — scoped to one Workspace group when
   * given — on every source: the key a sidebar list is cut at, so it shows a true prefix of its
   * activity order (see watermarkFor). Null = show every loaded row.
   */
  activityWatermarkFor: (
    agentIds: readonly string[],
    workspaceGroup?: string,
  ) => ActivityKey | null;
  /**
   * Whether the list has NOTHING to show yet — including the window where the Agent set it
   * is fetched for is itself being refetched (a Project switch clears it). Consumers gate
   * their "no sessions" empty state on this, so it must not read false while the answer is
   * merely not known yet.
   *
   * Emphatically not "a fetch is in flight". A refresh over rows already on screen leaves
   * this false: the chat page renders a skeleton IN PLACE OF the open conversation while it
   * is true, so a refresh that raised it would blank the conversation you are reading — and
   * the list refreshes whenever the machine set moves.
   */
  loading: boolean;
  /**
   * Whether a machine of this Project could not be asked this round — no connection is held
   * to it, or the server behind the connection did not answer.
   *
   * A Session missing from the list means "this server has not got it", which is only the
   * same as "it does not exist" when every server that could hold it answered. The chat page
   * reads this before deciding a routed id is gone: concluding that from a lookup against
   * THIS server, while the machine the Session lives on is out of reach, drops the reader
   * out of a conversation that is merely unreachable.
   */
  machinesUnreachable: boolean;
  /**
   * The Project's machines that did not answer this round, by machine id. Their rows on
   * screen come from the cache (lib/machine-cache.ts), so a caller that has to decide whether
   * a Session is REACHABLE — not merely whether it is listed — asks this.
   */
  offlineMachineIds: string[];
  reload: () => Promise<void>;
  /** Fetches the first page for each given unloaded Agent and the next page for each loaded one with more (no-op otherwise); `workspaceGroup` pages that group's own stream instead of the Agent's whole one. */
  loadMoreFor: (agentIds: string[], workspaceGroup?: string) => Promise<void>;
  /**
   * Puts a row in the list: a Session just created (a draft's first message), or the one the
   * chat page looked up for the conversation it shows — held, whatever list it is in, so the
   * page's writes reach it (the sidebar draws only its own rows).
   */
  add: (session: SessionInfo) => void;
  /** Remove from the list in place after deletion (also tombstones the id — see isDeleted). */
  remove: (sessionId: string) => void;
  /**
   * Whether this client deleted the Session during this page's lifetime. A row missing from
   * the paged list normally means "not fetched yet", which the chat page resolves with a
   * direct lookup; for an id we deleted ourselves that lookup is guaranteed to 404, so
   * callers consult this first and skip the request entirely.
   */
  isDeleted: (sessionId: string) => boolean;
  /**
   * Replace the whole entry with the PATCH result. An archive toggle moves the row between the
   * lists in place — out of the sidebar, still held for the page showing it — and keeps the
   * totals in step; a row not held yet is put in.
   */
  replace: (session: SessionInfo) => void;
  /**
   * Live run status of one row — from the open Session's own stream (`task_state`), and from
   * the user channel (`session_state`) for every row this tab is not subscribed to. `row` is
   * the server's own fields riding the user-channel event; the Session stream has none to give.
   */
  setStatus: (sessionId: string, status: SessionStatus, row?: LiveRowFields) => void;
  /** session_title server event → update the title in place. */
  setTitle: (sessionId: string, title: string) => void;
}

/**
 * The row fields a `session_state` event carries alongside the status, straight from the
 * server's row. Both are needed to draw the glyph without refetching the list: `lastActiveAt`
 * decides read vs unread against the seen marker, and `hasTrace` decides settled vs never-ran.
 */
export interface LiveRowFields {
  lastActiveAt: string;
  hasTrace: boolean;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

/**
 * Page-state key of one (Agent, Workspace-group, source) stream of active rows. The scope is
 * the server's query form of a group (workspaceGroupQuery) — a path or the temp sentinel — and
 * "" means the Agent's whole stream. The source is the machine whose Sessions that stream is
 * walked on (`null` = this server): each server pages its own rows with its own offsets, so
 * one shared cursor would ask machine B for rows only machine A had reached. "\0" appears in
 * none of the three (the merged temp group's own key does contain one, which is exactly why
 * the query form is what gets stored).
 */
const pageKey = (agentId: string, scope = "", source: string | null = null) =>
  `${agentId}\0${scope}\0${source ?? ""}`;

/** The stream a page key names, or null if it is not one (never, in practice — a guard for the reload scan). */
function parsePageKey(
  key: string,
): { agentId: string; scope: string; source: string | null } | null {
  const parts = key.split("\0");
  if (parts.length !== 3) return null;
  const [agentId, scope, source] = parts as [string, string, string];
  return { agentId, scope, source: source === "" ? null : source };
}

/** Scope string of a Workspace group (undefined / "" = the Agent's whole stream). */
const scopeOf = (workspaceGroup?: string) =>
  workspaceGroup === undefined || workspaceGroup === "" ? "" : workspaceGroupQuery(workspaceGroup);

/**
 * Which servers a scope is about: every one for the Agent's whole stream, and exactly the
 * one a Workspace group is ON for a group.
 *
 * A group is a directory on a machine, so the others hold nothing of it. Asking them is not
 * merely wasteful: their answers about a path that happens to have the same name would decide
 * this group's "load more" and its loaded-ness — a folder offering more rows that belong to
 * another machine's folder, and never arrive in this one.
 */
const sourcesFor = (
  allSources: readonly (string | null)[],
  workspaceGroup?: string,
): (string | null)[] =>
  workspaceGroup === undefined || workspaceGroup === ""
    ? [...allSources]
    : [workspaceGroupMachine(workspaceGroup)];

/**
 * One pair's paging cursor: whether the server still has rows below it, and the activity key
 * of the last row read from the stream (null when it has yielded none). The key is stored when
 * the page lands and never re-derived from the pool — a live event moves the row's own key, and
 * the stream still continues below where it was READ; `add()` slips in rows no page served.
 */
type PagePosition = StreamPosition;

/**
 * The watermark of the list fed by `agentIds`' streams — each Agent's whole stream, or one
 * Workspace group's own — on every source the scope is about: the most recent cursor among the
 * streams that still have more (session-grouping.ts's activityWatermark).
 *
 * A group's own stream that has not been read yet stands on the Agent's whole stream instead:
 * that stream's loaded prefix, cut by Workspace, is a prefix of the group's, so it bounds the
 * group's rows exactly as far as it reached. A pair nothing has been read from bounds nothing —
 * the rows a machine out of reach left in the cache keep showing.
 */
export function watermarkFor(
  state: { pageState: ReadonlyMap<string, PagePosition>; machineIds: readonly string[] },
  agentIds: readonly string[],
  workspaceGroup?: string,
): ActivityKey | null {
  const scope = scopeOf(workspaceGroup);
  const positions: PagePosition[] = [];
  for (const agentId of new Set(agentIds)) {
    for (const source of sourcesFor([null, ...state.machineIds], workspaceGroup)) {
      const position =
        state.pageState.get(pageKey(agentId, scope, source)) ??
        (scope === "" ? undefined : state.pageState.get(pageKey(agentId, "", source)));
      if (position !== undefined) positions.push(position);
    }
  }
  return activityWatermark(positions);
}

/** Store state: the context value's raw ingredients plus the mutation functions (byAgent / isLoadedFor / hasMoreFor are derived in the Provider). */
interface SessionsStoreState {
  /** Provider-synced fetch context: the current Project and its Agent set (what reload() targets). */
  projectId: string | null;
  agentIds: string[];
  /**
   * Machines whose Sessions are merged into this list, alongside this server's: the ones this
   * server holds a connection to. A Session lives on the server whose filesystem its
   * workspace is on, so a Project's list is not one server's answer — it is every one of
   * them, ordered together.
   */
  machineIds: string[];
  /**
   * The Project's machines this list could NOT ask — no connection held — by machine id.
   * It is the difference between "this server does not have that Session" and "nobody who
   * might have it answered", which is the whole question for a routed id that is missing
   * from the list (features/chat/chat-page.tsx). Their rows come from the cache.
   */
  offlineMachineIds: string[];
  /**
   * machineId → the Agents THAT machine runs, which are not this Project's.
   *
   * An Agent is per server: a machine has its own set, and the Agents page offers a new chat
   * on one of them (features/agents/agents-page.tsx). The Session that follows belongs to an
   * Agent this server has never heard of, so a list built from this server's Agent ids alone
   * would ask the machine the wrong question and drop the row on the next reload — and with
   * it the record of which machine holds that Session, which is what a deep link needs to
   * reach it at all.
   */
  agentIdsByMachine: Readonly<Record<string, string[]>>;

  sessions: SessionInfo[];
  /**
   * Ids this client deleted during the page's lifetime (see isDeleted). Deliberately kept
   * OUTSIDE the rendered state: it must not be read as "the list changed", and nothing
   * renders from it — consumers only ask whether a specific id is in it.
   */
  deletedSessionIds: ReadonlySet<string>;
  /** pageKey → that stream's paging cursor; a key is present iff its first page has been fetched. */
  pageState: ReadonlyMap<string, PagePosition>;
  countsByAgent: ReadonlyMap<string, SessionCategoryCounts>;
  workspaceCountsByAgent: ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>;
  workspaceLatestByAgent: ReadonlyMap<string, Readonly<Record<string, string>>>;
  workspaceLatestActiveByAgent: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /**
   * Run status by Session id as the user channel last reported it, for every `session_state`
   * received — the rows this store holds AND the ones it never fetches (an organization's
   * desks and ticket sessions, archived and subagent Sessions). The user channel is the
   * only source that reports a run ENDING, so company mode's surfaces read this for the
   * Sessions the development list deliberately leaves out. Not reset on a Project switch:
   * ids are globally unique and a status is a fact about the Session, not about the list.
   * Cleared on `resync_required`, which says flips were lost (see applyUserEvent).
   */
  liveStatuses: ReadonlyMap<string, SessionStatus>;
  loading: boolean;

  reload: () => Promise<void>;
  loadMoreFor: (agentIds: string[], workspaceGroup?: string) => Promise<void>;
  add: (session: SessionInfo) => void;
  remove: (sessionId: string) => void;
  replace: (session: SessionInfo) => void;
  /**
   * A Session's listing changed somewhere — archived, unarchived or deleted, by this tab or
   * another, or by the archive page's batches — as the user channel announces it. Changes are
   * gathered for a moment and applied in one update, since a batch announces up to 500 at once
   * and a render per announcement would stall the page.
   */
  noteListingChange: (change: ListingChange) => void;
  setStatus: (sessionId: string, status: SessionStatus, row?: LiveRowFields) => void;
  setTitle: (sessionId: string, title: string) => void;
  /**
   * A Session of this Project changed run state while no loaded page holds it — a conversation
   * resumed from the CLI, say. It is the most recently active row there is, so it belongs at the
   * top of the list, and no page will ever serve it: it moved above every cursor. One lookup on
   * `source` (where the event came from) fetches the row, and it joins the list when it is one
   * of the list's own — an active conversation of a listed Agent, not deleted here (an archived
   * or subagent Session running stays where it is listed: nowhere in the sidebar). Flips that
   * arrive while the lookup runs share it, and the newest of them is applied to the row it
   * returns. Settles once the lookup has; never rejects.
   */
  adoptLiveSession: (
    sessionId: string,
    source: string | null,
    status: SessionStatus,
    row: LiveRowFields,
  ) => Promise<void>;
  /**
   * Live background-task counts of one row, from the user channel's `session_background`;
   * undefined clears the field the way the server omits it at zero. The row's mark and the
   * chat header's count both read the field, so this is the one write that moves them.
   */
  setBackgroundTasks: (sessionId: string, tasks: SessionBackgroundTasks | undefined) => void;
  /**
   * Live count of tool calls waiting for approval on one row, from the user channel's
   * `session_approvals`. The row's approvals mark reads it, so a Session that starts waiting
   * while another one is open is marked at once instead of at the next list fetch.
   */
  setPendingApprovals: (sessionId: string, count: number) => void;
}

/**
 * Cap on remembered deleted ids. Session ids are never reused, so a tombstone never expires
 * on correctness grounds — this only keeps a very long-lived tab from growing the set without
 * bound. Evicts oldest-first (Sets iterate in insertion order); the only cost of dropping a
 * tombstone is that a re-visit of that dead id would fall back to the (404-ing) lookup again.
 */
const DELETED_IDS_MAX = 500;

/**
 * Cap on remembered live statuses, for the same reason as DELETED_IDS_MAX: a very long-lived
 * tab must not grow the map without bound. Evicts oldest-first; a Session that flips again is
 * re-inserted at the end, so what falls off is what has been quiet longest — and a dropped
 * entry only costs company mode a fallback to its own snapshot for that Session.
 */
const LIVE_STATUS_MAX = 1000;

/**
 * Cap on remembered declined ids — Sessions a live event named, that were looked up once and
 * found not to be this list's (an organization's desk or ticket session, an id that is gone).
 * Company mode flips its Sessions all day long, and each would otherwise cost a lookup per flip.
 * Same eviction as DELETED_IDS_MAX; a dropped entry costs one more lookup.
 */
const DECLINED_IDS_MAX = 1000;

/** One listing change the user channel announced (session_archived / session_deleted). */
export type ListingChange =
  | { kind: "archived" | "unarchived"; sessionId: string; projectId: string }
  | { kind: "deleted"; sessionId: string; projectId: string };

/**
 * How long listing changes gather before they are applied together: long enough for a batch's
 * announcements (one per Session, sent back to back) to land as one update, short enough to
 * read as immediate.
 */
export const LISTING_CHANGE_DELAY_MS = 60;

/** `live` with `sessionId` at `status` — the same map when nothing changed, so no render is spent on a repeat. */
function rememberStatus(
  live: ReadonlyMap<string, SessionStatus>,
  sessionId: string,
  status: SessionStatus,
): ReadonlyMap<string, SessionStatus> {
  if (live.get(sessionId) === status) return live;
  const next = new Map(live);
  next.delete(sessionId);
  next.set(sessionId, status);
  while (next.size > LIVE_STATUS_MAX) next.delete(next.keys().next().value!);
  return next;
}

/**
 * One stream's first page the sidebar's reload wants from a given source: the Agent's whole
 * stream of active rows (`scope` "", which also carries the totals) or one Workspace group's.
 */
type WantedPage = {
  agentId: string;
  scope: string;
};

/** What the reload merge consumes per answered page. */
type PageAnswer = {
  agentId: string;
  source: string | null;
  pages: Array<{
    scope: string;
    counts?: SessionCategoryCounts;
    workspaceCounts?: Record<string, SessionCategoryCounts>;
    workspaceLatest?: Record<string, string>;
    workspaceLatestActive?: Record<string, string>;
    items: SessionInfo[];
    hasMore: boolean;
  }>;
  answered: boolean;
};

/**
 * One batch entry → the answer shape the merge expects.
 *
 * `ok: false` is a real answer about THAT Agent, and the two reasons are not the same thing:
 * `absent` (this server does not host the Agent — its rows come from the machine that does)
 * is the ordinary case, while `error` is a failure to answer at all. Treating them alike is
 * what emptied the sidebar once already: an empty result standing in for a failure replaces
 * rows that are perfectly alive.
 */
function oneAnswer(
  want: WantedPage,
  source: string | null,
  result: SessionBatchResult | undefined,
): PageAnswer {
  if (result === undefined || !result.ok) {
    return {
      agentId: want.agentId,
      source,
      pages: [],
      answered: result?.reason === "absent",
    };
  }
  return {
    agentId: want.agentId,
    source,
    pages: [
      {
        scope: want.scope,
        counts: result.counts,
        workspaceCounts: result.workspaceCounts,
        workspaceLatest: result.workspaceLatest,
        // A server from before the split sends only the every-Session stamp, which is what
        // the groups were ordered by then: it stands in.
        workspaceLatestActive: result.workspaceLatestActive ?? result.workspaceLatest,
        ...splitPage(result.sessions, SIDEBAR_PAGE_SIZE),
      },
    ],
    answered: true,
  };
}

/**
 * Builds one Provider's store. Exported as a test seam: vitest runs this package in Node with
 * no DOM, so the list's own behaviour is exercised against the store directly rather than
 * through a React tree.
 */
export function createSessionsStore() {
  // Generation counter: invalidates any in-flight response once the Project/Agent set
  // changes or a reload happens.
  let gen = 0;
  /** Ids being looked up for adoption → the lookup, and the newest flip the channel reported meanwhile. */
  const adopting = new Map<
    string,
    { done: Promise<void>; latest: { status: SessionStatus; row: LiveRowFields } }
  >();
  /** Ids looked up and found not to be this list's — never asked about again (DECLINED_IDS_MAX). */
  const declined = new Set<string>();
  /**
   * Adoption order: each adopted id → its sequence number. A reload that STARTED before an
   * adoption may have been answered before that Session ran, so its pages can lack the row: it
   * carries over every row adopted since it started. Rows adopted earlier are the pages' to
   * decide — a reload that started after them read the server as it stands.
   */
  let adoptSeq = 0;
  const adoptedAt = new Map<string, number>();
  /** Listing changes gathered for the next flush, by Session id: the last word on an id wins. */
  const pendingListing = new Map<string, ListingChange>();
  let listingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Reloads started and not yet settled: a flush that invalidates one asks again. */
  let reloadsInFlight = 0;
  /** Consecutive reloads this server answered nothing to (the retry backs off on it). */
  let retries = 0;
  /**
   * Machines that answered none of a reload's questions. A reload asks a machine about EVERY
   * Agent at once, so asking a silent one again on each reload multiplies one outage by the
   * Agent count, reload after reload — two dozen calls per wave held on a machine whose relay
   * is down. A resting machine contributes its cached rows (as an offline one does); when its
   * rest is over the next reload asks it ONE question, and only an answer to that brings the
   * full round back. A silent machine therefore holds at most one call at a time.
   */
  const resting = new Map<
    string,
    { until: number; failures: number; probing: boolean; wake: ReturnType<typeof setTimeout> }
  >();

  return createStore<SessionsStoreState>((set, get) => {
    /**
     * A machine's showing in a finished reload (see `resting`): an answer ends its rest and
     * asks for the full round at once, while silence starts a rest, or doubles it when it was
     * the probe that went unanswered, with a reload booked for when the rest ends.
     */
    const noteMachineAnswer = (machineId: string, answered: boolean, wasProbe: boolean) => {
      const rest = resting.get(machineId);
      if (answered) {
        if (rest === undefined) return;
        clearTimeout(rest.wake);
        resting.delete(machineId);
        void get().reload();
        return;
      }
      // A round sent before the rest began, landing during it (even while a probe is out):
      // the silence is already counted, and only the probe's own answer decides what's next.
      if (rest !== undefined && !wasProbe) return;
      if (rest !== undefined) clearTimeout(rest.wake);
      const failures = (rest?.failures ?? 0) + 1;
      const delay = Math.min(MACHINE_REST_MAX_MS, MACHINE_REST_MIN_MS * 2 ** (failures - 1));
      console.warn(
        `[sessions] machine ${machineId} answered none of a reload's questions; ` +
          `its cached rows are shown and one question probes it in ${delay} ms`,
      );
      resting.set(machineId, {
        until: Date.now() + delay,
        failures,
        probing: false,
        wake: setTimeout(() => void get().reload(), delay),
      });
    };

    /**
     * Keeps an Agent's category totals — overall and per Workspace — in step with a local
     * list mutation of `session` (no-op while its counts are unknown). An organization's row
     * never moves them: the server's totals are the user's own rows only (`excludeOrg`), and a
     * subagent or company Session is in no category, so such a row — held for the page that
     * shows it — was never counted and must not be counted out.
     */
    const adjustCount = (session: SessionInfo, category: SessionCategory | null, delta: number) => {
      if (category === null || isOrgSession(session)) return;
      const { agentId, workspace } = session;
      const counts = get().countsByAgent;
      const cur = counts.get(agentId);
      if (cur) {
        const next = new Map(counts);
        next.set(agentId, { ...cur, [category]: Math.max(0, cur[category] + delta) });
        set({ countsByAgent: next });
      }
      const workspaceCounts = get().workspaceCountsByAgent;
      const wsCur = workspaceCounts.get(agentId);
      if (wsCur) {
        // Keyed by GROUP, as the fetch stores them: the badge belongs to the directory on
        // the machine this Session is on, not to every machine holding that path string.
        const key = workspaceGroupKey(workspace, machineForSession(session.sessionId));
        const ws = wsCur[key] ?? { active: 0, archived: 0 };
        const next = new Map(workspaceCounts);
        next.set(agentId, {
          ...wsCur,
          [key]: { ...ws, [category]: Math.max(0, ws[category] + delta) },
        });
        set({ workspaceCountsByAgent: next });
      }
    };

    /**
     * Puts one row in the list (replacing an entry with its id), keeping the totals in step.
     * Counts an active row only when its Agent's fetched pages provably held every active row
     * (loaded, no more): the row is then genuinely new to the server totals. Otherwise
     * (deep-link self-heal or a live adoption of an unfetched row) the counts already include
     * it — a possible one-off drift self-heals on the next reload. A row of no sidebar list
     * (archived, subagent, company) is held for the page showing it and never counted.
     */
    const insert = (session: SessionInfo) => {
      // Only this Project's rows: a row handed in for a conversation of the Project just left
      // (a lookup that settled after the switch, a notification clicked later) is not this
      // list's, and held here it would put that Project's Agent under this one.
      if (!ofProject(session, get().projectId)) return;
      const existed = get().sessions.some((s) => s.sessionId === session.sessionId);
      // Per SOURCE and stream: the row belongs to the machine it lives on, and the whole
      // stream (scope "") is the one the totals were fetched against.
      const source = machineForSession(session.sessionId);
      const category = sessionCategory(session);
      if (
        !existed &&
        category === "active" &&
        get().pageState.get(pageKey(session.agentId, "", source))?.hasMore === false
      ) {
        adjustCount(session, category, 1);
      }
      set({
        sessions: [session, ...get().sessions.filter((s) => s.sessionId !== session.sessionId)],
      });
    };

    /** Remembers an id as not this list's (DECLINED_IDS_MAX bounds the set, oldest out first). */
    const decline = (sessionId: string) => {
      declined.delete(sessionId);
      declined.add(sessionId);
      while (declined.size > DECLINED_IDS_MAX) declined.delete(declined.values().next().value!);
    };

    /** `deleted` with `ids` added, the oldest falling out past DELETED_IDS_MAX. */
    const withTombstones = (deleted: ReadonlySet<string>, ids: Iterable<string>) => {
      const next = new Set(deleted);
      for (const id of ids) {
        next.delete(id);
        next.add(id);
      }
      while (next.size > DELETED_IDS_MAX) next.delete(next.values().next().value!);
      return next;
    };

    /**
     * Applies the gathered listing changes in one update. An archive flip of a row this list
     * holds moves it between the lists in place — out of the sidebar but still held, so a page
     * showing it turns into the archived stub or back — with the totals in step. An unarchived
     * Session this list does not hold joins the sidebar where its activity puts it, which only
     * a fetch can tell: one reload for the whole batch. A deleted Session is dropped and
     * tombstoned, held or not, so a page routed at it stops asking for it.
     */
    const flushListing = () => {
      listingTimer = null;
      if (pendingListing.size === 0) return;
      const changes = [...pendingListing.values()];
      pendingListing.clear();
      const { projectId } = get();
      let rows = get().sessions;
      const gone: string[] = [];
      let fetchUnheld = false;
      for (const change of changes) {
        const row = rows.find((s) => s.sessionId === change.sessionId);
        if (change.kind === "deleted") {
          gone.push(change.sessionId);
          if (row !== undefined) {
            adjustCount(row, sessionCategory(row), -1);
            rows = rows.filter((s) => s.sessionId !== change.sessionId);
          }
          continue;
        }
        const archived = change.kind === "archived";
        // An unarchived id may have been looked up while it was archived and declined then.
        if (!archived) declined.delete(change.sessionId);
        if (row === undefined) {
          if (!archived && change.projectId === projectId) fetchUnheld = true;
          continue;
        }
        if (row.archived === archived) continue;
        const next = { ...row, archived };
        adjustCount(row, sessionCategory(row), -1);
        adjustCount(next, sessionCategory(next), 1);
        rows = rows.map((s) => (s.sessionId === change.sessionId ? next : s));
      }
      // A change must not be undone by a reload already in flight (remove()'s rule): that one is
      // dropped, and asked again so the list still lands. A deletion counts even when no held
      // row moved: the snapshot in flight may have read the Session before it went, and its
      // totals count it.
      if (rows !== get().sessions || (gone.length > 0 && reloadsInFlight > 0)) {
        gen += 1;
        if (reloadsInFlight > 0) fetchUnheld = true;
      }
      set({
        sessions: rows,
        ...(gone.length > 0
          ? { deletedSessionIds: withTombstones(get().deletedSessionIds, gone) }
          : {}),
      });
      if (fetchUnheld) void get().reload();
    };

    return {
      projectId: null,
      agentIds: [],
      machineIds: [],
      offlineMachineIds: [],
      agentIdsByMachine: {},

      sessions: [],
      deletedSessionIds: new Set(),
      pageState: new Map(),
      countsByAgent: new Map(),
      workspaceCountsByAgent: new Map(),
      workspaceLatestByAgent: new Map(),
      workspaceLatestActiveByAgent: new Map(),
      liveStatuses: new Map(),
      loading: true,

      reload: async () => {
        const { projectId, agentIds, machineIds, offlineMachineIds, agentIdsByMachine } = get();
        // No context to fetch against yet. `loading` is deliberately left alone rather than
        // cleared: nothing was loaded, so reporting "done" here would be a lie — and one the
        // empty state renders. The Provider's reset step raised it and a later reload,
        // once an Agent set exists, is what clears it.
        if (!projectId || agentIds.length === 0) return;
        const g = ++gen;
        const adoptMark = adoptSeq;
        // `loading` is not raised here. It means "no list of this context yet": it starts
        // raised, the Provider raises it again when the context (the Project, its Agent set)
        // changes, and the first applied list clears it. A re-read keeps what is shown — rows,
        // or "no Sessions yet" — because a machine appearing, dropping out or naming its Agents
        // changes which servers are asked, not whether what is shown is still so; raising it
        // for an empty list swapped that line for the sidebar's skeleton and back on every
        // machine tick. The chat page reads the same flag before drawing a skeleton over the
        // open conversation.
        let applied = false;
        reloadsInFlight += 1;
        // This server first, then every machine of the Project this server holds a
        // connection to — less the resting ones, but for the one whose rest is over, which
        // is probed. Order matters only as a tie-break for equal timestamps.
        const now = Date.now();
        const rested = new Set<string>();
        const probed = new Set<string>();
        for (const machineId of machineIds) {
          const rest = resting.get(machineId);
          if (rest === undefined) continue;
          rested.add(machineId);
          if (!rest.probing && rest.until <= now) {
            rest.probing = true;
            probed.add(machineId);
          }
        }
        const sources: (string | null)[] = [
          null,
          ...machineIds.filter((m) => !rested.has(m) || probed.has(m)),
        ];
        // One job per (Agent, source), asking each server about the Agents IT can answer for:
        // this server about the Project's, a machine about those plus its own. A machine-only
        // Agent's Sessions are listed by nobody otherwise. A probe is one Agent's question.
        const jobs = sources.flatMap((source) => {
          const ids =
            source === null
              ? agentIds
              : [...new Set([...agentIds, ...(agentIdsByMachine[source] ?? [])])];
          return (source !== null && probed.has(source) ? ids.slice(0, 1) : ids).map((agentId) => ({
            agentId,
            source,
          }));
        });
        // One request per SOURCE, carrying every (Agent, stream) first page that source owes
        // us. These were one GET each — with several Agents and machines that is dozens fired
        // at once, serialised by the browser's six-connections-per-host limit, and the
        // conversation pane's own message read queued behind all of them.
        const bySource = new Map<string | null, WantedPage[]>();
        for (const { agentId, source } of jobs) {
          // The Agent's whole-stream first page (with per-category totals) always; plus the
          // first page of every other stream already on screen — each Workspace group paging
          // its own — because a reload triggered by a server event must refresh them, not
          // blank them.
          const list = bySource.get(source) ?? [];
          list.push({ agentId, scope: "" });
          for (const key of get().pageState.keys()) {
            const parsed = parsePageKey(key);
            if (parsed === null || parsed.agentId !== agentId || parsed.source !== source) continue;
            if (parsed.scope !== "") list.push({ agentId, scope: parsed.scope });
          }
          bySource.set(source, list);
        }
        try {
          const results = (
            await Promise.all(
              [...bySource].map(async ([source, wanted]) => {
                let answered: PageAnswer[];
                try {
                  const res = await api.batchSessions(
                    projectId,
                    wanted.map((w) => ({
                      agentId: w.agentId,
                      limit: SIDEBAR_PAGE_SIZE + 1,
                      order: "activity",
                      category: "active",
                      excludeOrg: true,
                      ...(w.scope === "" ? { withCounts: true } : { workspaceGroup: w.scope }),
                    })),
                    source,
                  );
                  answered = wanted.map((w, i) => oneAnswer(w, source, res.results[i]));
                } catch {
                  // The whole SOURCE failed to answer — this server mid-swap, a connection
                  // held to a server that is not serving, the network. Nothing is applied
                  // for it below, which is the point: an empty result standing in for a
                  // failure replaces rows that are perfectly alive (see oneAnswer).
                  answered = wanted.map((w) => ({
                    agentId: w.agentId,
                    source,
                    pages: [],
                    answered: false,
                  }));
                }
                return answered;
              }),
            )
          ).flat();
          // Whether each machine answered is a fact about the machine, whichever reload is
          // current by now — recorded before a newer one discards this one's rows.
          const unansweredMachines = new Set(
            results.flatMap((r) => (r.source !== null && !r.answered ? [r.source] : [])),
          );
          for (const source of sources) {
            if (source === null) continue;
            noteMachineAnswer(
              source,
              results.some((r) => r.source === source && r.answered),
              probed.has(source),
            );
          }
          // Superseded, or asked for a Project the list has since left: the Provider's context
          // sync moves `projectId` before the next Agent set exists, and no reload runs to
          // supersede this one until it does — so the Project is compared, not only `gen`.
          if (g !== gen || !isCurrentProject(projectId, get().projectId)) return;
          // Agents this server did not answer about. Per Agent, not per server: a damaged
          // index or a 500 on ONE Agent is a different event from this server being
          // unreadable, and reading the first as the second is what leaves the page on a
          // skeleton — nothing is applied, so `loading` is never cleared, and on a quiet
          // server nothing asks again.
          const unanswered = new Set(
            results.flatMap((r) => (r.source === null && !r.answered ? [r.agentId] : [])),
          );
          // This server did not answer about ANY of them. It holds the Sessions every other
          // source is merged AROUND, so there is no list to build — and building one anyway
          // would replace everything on screen with a handful of remote rows, or with nothing
          // at all. A reload is a refresh, and a refresh that cannot read anything changes
          // nothing: the rows stand, `loading` is left as it was, and the next one tries
          // again. This is the ordinary state during a hot swap and for the moment after a
          // reconnect.
          if (unanswered.size === agentIds.length && agentIds.length > 0) {
            // Said out loud, and asked again on a timer: a page that opened during a swap or
            // a hiccup used to sit on the skeleton until some event happened to fire.
            const reasons = results
              .filter((r) => r.source === null && !r.answered)
              .map((r) => `${r.agentId}: no answer`);
            const delay = Math.min(RELOAD_RETRY_MAX_MS, RELOAD_RETRY_MIN_MS * 2 ** retries);
            retries += 1;
            console.warn(
              `[sessions] this server answered for none of the Agents (${reasons.join("; ")}); ` +
                `the list on screen is kept and asked again in ${delay} ms`,
            );
            setTimeout(() => {
              if (g === gen) void get().reload();
            }, delay);
            return;
          }
          retries = 0;
          // Machines that did not answer are treated exactly like machines that were never
          // asked: their rows come from the cache below, and their cache is left alone.
          // So are resting ones, and a probed one: one Agent's answer is not the machine's list.
          const silent = new Set([...unansweredMachines, ...rested]);
          const nextSessions: SessionInfo[] = [];
          const seen = new Set<string>();
          // Deleted stays deleted (see the header), read now: a deletion heard while the answers
          // were on their way counts.
          const deleted = get().deletedSessionIds;
          // What each machine answered, kept so it can be shown after the next restart while
          // the server re-holds its connection to that machine (lib/machine-cache.ts).
          const rowsByMachine = new Map<string, SessionInfo[]>();
          const nextPageState = new Map<string, PagePosition>();
          const nextCounts = new Map<string, SessionCategoryCounts>();
          const nextWorkspaceCounts = new Map<
            string,
            Readonly<Record<string, SessionCategoryCounts>>
          >();
          // Counts are SUMMED across sources, not overwritten: a group's count that counted
          // one machine would contradict the rows underneath it (mergeCounts).
          const countParts = new Map<string, SessionCategoryCounts[]>();
          // Each answer with the machine that gave it: a path means a directory only
          // together with the filesystem it was read from.
          const workspaceParts = new Map<
            string,
            Array<{
              source: string | null;
              counts: Readonly<Record<string, SessionCategoryCounts>>;
            }>
          >();
          // Newest-Session stamps per group, keyed the way the counts are (a path on a
          // machine); the newest answer for a group wins. Two of them: every Session's (the
          // Workspace picker's "recently used") and the active ones' (the groups' order).
          const nextWorkspaceLatest = new Map<string, Readonly<Record<string, string>>>();
          const nextWorkspaceLatestActive = new Map<string, Readonly<Record<string, string>>>();
          const foldStamps = (
            into: Map<string, Readonly<Record<string, string>>>,
            agentId: string,
            source: string | null,
            stamps: Readonly<Record<string, string>>,
          ) => {
            const latest: Record<string, string> = { ...(into.get(agentId) ?? {}) };
            for (const [path, stamp] of Object.entries(stamps)) {
              const groupKey = workspaceGroupKey(path, source);
              const held = latest[groupKey];
              if (held === undefined || held < stamp) latest[groupKey] = stamp;
            }
            into.set(agentId, latest);
          };
          for (const r of results) {
            for (const p of r.pages) {
              const last = p.items.at(-1);
              nextPageState.set(pageKey(r.agentId, p.scope, r.source), {
                hasMore: p.hasMore,
                cursor: last === undefined ? null : activityKeyOf(last),
              });
              if (p.counts)
                countParts.set(r.agentId, [...(countParts.get(r.agentId) ?? []), p.counts]);
              if (p.workspaceCounts) {
                workspaceParts.set(r.agentId, [
                  ...(workspaceParts.get(r.agentId) ?? []),
                  { source: r.source, counts: p.workspaceCounts },
                ]);
              }
              if (p.workspaceLatest) {
                foldStamps(nextWorkspaceLatest, r.agentId, r.source, p.workspaceLatest);
              }
              if (p.workspaceLatestActive) {
                foldStamps(nextWorkspaceLatestActive, r.agentId, r.source, p.workspaceLatestActive);
              }
              for (const s of p.items) {
                if (seen.has(s.sessionId) || deleted.has(s.sessionId)) continue;
                seen.add(s.sessionId);
                nextSessions.push(s);
                if (r.source !== null)
                  rowsByMachine.set(r.source, [...(rowsByMachine.get(r.source) ?? []), s]);
                // Where this row lives, so the two dozen Session-scoped calls about it reach
                // the machine that holds it. Rebuilt by the very list that displays them,
                // which is why the map is in memory and this is the only place it is filled.
                rememberSessionMachine(s.sessionId, r.source);
              }
            }
          }
          for (const [agentId, parts] of countParts) {
            const merged = mergeCounts(parts);
            if (merged) nextCounts.set(agentId, merged);
          }
          for (const [agentId, parts] of workspaceParts) {
            // Per GROUP, which is a path on a machine. Each machine answers about its own
            // filesystem, so two machines' counts for paths that are equal as strings belong
            // to two different directories: summing them would put both totals under both
            // folders, each one contradicting the rows beneath it.
            const byGroup = new Map<string, SessionCategoryCounts[]>();
            for (const { source, counts: byPath } of parts) {
              for (const [path, counts] of Object.entries(byPath)) {
                const groupKey = workspaceGroupKey(path, source);
                byGroup.set(groupKey, [...(byGroup.get(groupKey) ?? []), counts]);
              }
            }
            const out: Record<string, SessionCategoryCounts> = {};
            for (const [groupKey, list] of byGroup) {
              const merged = mergeCounts(list);
              if (merged) out[groupKey] = merged;
            }
            nextWorkspaceCounts.set(agentId, out);
          }
          // Only a machine that ANSWERED replaces what it is remembered as holding — including
          // with nothing, which is how a Session deleted over there stops coming back from
          // the cache. A machine that went quiet during the fetch keeps its cache: erasing it
          // would leave the fallback with nothing to fall back to.
          for (const machineId of machineIds) {
            if (silent.has(machineId)) continue;
            rememberMachineSessions(projectId, machineId, rowsByMachine.get(machineId) ?? []);
          }
          // And every machine this list could not read contributes what it last held — the
          // ones with no connection held, and the ones that went quiet during the fetch.
          // `seen` still guards, so a live answer always wins over a remembered one. Their
          // owner entries are recorded the same way, so opening such a Session addresses the
          // machine that has it rather than this server — which would answer 404 about
          // someone else's.
          //
          // Totals are NOT topped up from here: counts come from the servers that answered,
          // so an out-of-reach machine's rows show without being counted. Better than the
          // alternative — a count is a claim about what a server holds now, and the cache
          // cannot make that claim.
          for (const machineId of new Set([...offlineMachineIds, ...silent])) {
            for (const s of cachedMachineSessions(projectId, machineId)) {
              if (seen.has(s.sessionId) || deleted.has(s.sessionId)) continue;
              seen.add(s.sessionId);
              nextSessions.push(s);
              rememberSessionMachine(s.sessionId, machineId);
            }
          }
          // An Agent this server could not answer about keeps everything it already had: its
          // rows here, the page positions they were loaded at, and its badge counts. The list
          // is rebuilt wholesale, so without this one Agent's failed call erases it — and an
          // erased Agent is indistinguishable, on screen, from one that has no conversations.
          // Its counts are kept as last read rather than remerged from the machines that did
          // answer: a total missing this server's share would contradict the rows beneath it.
          if (unanswered.size > 0) {
            const held = get();
            for (const s of held.sessions) {
              if (!unanswered.has(s.agentId) || machineForSession(s.sessionId) !== null) continue;
              if (seen.has(s.sessionId)) continue;
              seen.add(s.sessionId);
              nextSessions.push(s);
            }
            for (const [key, position] of held.pageState) {
              const parsed = parsePageKey(key);
              if (parsed === null || parsed.source !== null) continue;
              if (!unanswered.has(parsed.agentId) || nextPageState.has(key)) continue;
              nextPageState.set(key, position);
            }
            for (const agentId of unanswered) {
              const counts = held.countsByAgent.get(agentId);
              if (counts) nextCounts.set(agentId, counts);
              const workspaceCounts = held.workspaceCountsByAgent.get(agentId);
              if (workspaceCounts) nextWorkspaceCounts.set(agentId, workspaceCounts);
              const latest = held.workspaceLatestByAgent.get(agentId);
              if (latest) nextWorkspaceLatest.set(agentId, latest);
              const latestActive = held.workspaceLatestActiveByAgent.get(agentId);
              if (latestActive) nextWorkspaceLatestActive.set(agentId, latestActive);
            }
          }
          // A Session adopted from a live event after this reload started may have run after
          // its page was read, and no page will serve it again: it is carried over. Older
          // adoptions are the pages' to decide — those were read with the Session already
          // there, and one that missed them sits below its stream's cursor.
          for (const s of get().sessions) {
            if ((adoptedAt.get(s.sessionId) ?? 0) <= adoptMark || seen.has(s.sessionId)) continue;
            seen.add(s.sessionId);
            nextSessions.push(s);
          }
          for (const [sessionId, at] of adoptedAt) if (at <= adoptMark) adoptedAt.delete(sessionId);
          // Most recently active first across every source: each answered sorted, and
          // concatenating sorted lists does not give a sorted list.
          nextSessions.sort(mostRecentFirst);
          // No fetch returns a row of no sidebar list — an organization's (`excludeOrg`), an
          // archived one, a subagent — so one held here entered through add() or replace()
          // for the page showing it (an open desk, an archived stub, a child opened from the
          // Agent panel) and no reload can bring it back: carry it over, or that page's writes
          // stop reaching it.
          const held = get().sessions.filter(
            (s) => !seen.has(s.sessionId) && (isOrgSession(s) || sessionCategory(s) !== "active"),
          );
          set({
            sessions: [...nextSessions, ...held],
            pageState: nextPageState,
            countsByAgent: nextCounts,
            workspaceCountsByAgent: nextWorkspaceCounts,
            workspaceLatestByAgent: nextWorkspaceLatest,
            workspaceLatestActiveByAgent: nextWorkspaceLatestActive,
          });
          applied = true;
        } finally {
          reloadsInFlight -= 1;
          // Only a reload that produced a list may report one. Abandoning above leaves the
          // flag exactly as it was — false with rows on screen, which is still true of them;
          // true with none, because none were fetched and saying otherwise is what paints an
          // empty state over a list that was merely unreadable this round.
          if (g === gen && applied) set({ loading: false });
        }
      },

      /**
       * Page fetch for each given Agent: the first page when the stream is unloaded (skipped
       * unless the counts say the Agent holds an active row), the next page when loaded with
       * more — the rows strictly below the stream's cursor, in activity order.
       * Appended rows are still deduplicated by sessionId: a row can reach the pool down two
       * streams (the Agent's whole one and a group's own), and `add()` slips rows in too.
       *
       * `workspaceGroup` pages ONE group's own server stream instead of the Agent's whole
       * one, under its own cursor: this is what keeps a Workspace group's "load more" from
       * consuming the page its siblings were about to read and moving their rows on screen.
       * Rows land in the same pool either way — a scope only decides which stream is being
       * walked, so the pool absorbs any overlap by sessionId.
       *
       * A group's FIRST page continues from the Agent's whole-stream cursor on that source:
       * the whole stream's loaded prefix, cut by Workspace, is a prefix of the group's, so the
       * group's rows above that cursor are already in the pool. Starting over would re-read
       * them and the click would appear to do nothing. When the whole stream is exhausted the
       * pool holds every row the group has there, and the stream is settled without a request.
       */
      loadMoreFor: async (agentIds, workspaceGroup) => {
        const { projectId, machineIds } = get();
        if (!projectId) return;
        const sources = sourcesFor([null, ...machineIds], workspaceGroup);
        const scope = scopeOf(workspaceGroup);
        // One target per (Agent, SOURCE): each server pages its own Sessions under its own
        // cursor, and a cursor one machine reached says nothing about another's rows.
        const targets: { agentId: string; source: string | null; before: ActivityKey | null }[] =
          [];
        /** Group pairs the whole stream already answers for (see above): loaded with nothing more to read. */
        const settled: { agentId: string; source: string | null; cursor: ActivityKey | null }[] =
          [];
        const { pageState, countsByAgent } = get();
        for (const agentId of new Set(agentIds)) {
          for (const source of sources) {
            const position = pageState.get(pageKey(agentId, scope, source));
            if (position !== undefined) {
              if (position.hasMore) targets.push({ agentId, source, before: position.cursor });
              continue;
            }
            // An unloaded whole stream: the Agent's own totals still decide whether asking is
            // worth a request — they are the SUM over sources, so a machine with none still
            // gets one first page, which is what discovers that it has none.
            if (scope === "") {
              if ((countsByAgent.get(agentId)?.active ?? 0) > 0)
                targets.push({ agentId, source, before: null });
              continue;
            }
            // An unloaded group stream: it continues from the whole stream (see above). The
            // counts cannot gate it (they are not broken down by group here); the caller only
            // asks for a group it has reason to believe holds rows.
            const whole = pageState.get(pageKey(agentId, "", source));
            if (whole !== undefined && !whole.hasMore) {
              settled.push({ agentId, source, cursor: whole.cursor });
              continue;
            }
            targets.push({ agentId, source, before: whole?.cursor ?? null });
          }
        }
        if (targets.length === 0 && settled.length === 0) return;
        const g = gen;
        // One request per SOURCE, carrying every (Agent, cursor) it owes that source — the
        // same fan-out as reload(), and for the same reason: workspace grouping asks for one
        // page per group per Agent on first paint, which as individual requests was a second
        // dozen-request wave behind the conversation.
        const pagesBySource = new Map<string | null, typeof targets>();
        for (const target of targets) {
          pagesBySource.set(target.source, [...(pagesBySource.get(target.source) ?? []), target]);
        }
        const results = (
          await Promise.all(
            [...pagesBySource].map(async ([source, wants]) => {
              let fetched: Array<{ target: (typeof targets)[number]; rows: SessionInfo[] } | null>;
              try {
                const res = await api.batchSessions(
                  projectId,
                  wants.map((w) => ({
                    agentId: w.agentId,
                    limit: SIDEBAR_PAGE_SIZE + 1,
                    order: "activity",
                    ...(w.before === null ? {} : { before: w.before }),
                    category: "active",
                    excludeOrg: true,
                    ...(scope === "" ? {} : { workspaceGroup: scope }),
                  })),
                  source,
                );
                fetched = wants.map((w, i) => {
                  const answer = res.results[i];
                  // An Agent this server does not host, or one that failed to answer, is
                  // nothing to append — the pair's own state is left untouched below, so the
                  // affordance stays and the user can retry.
                  if (answer === undefined || !answer.ok) return null;
                  return { target: w, rows: answer.sessions };
                });
              } catch {
                // Transient failure: same as above, for the whole source.
                fetched = wants.map(() => null);
              }
              return fetched.map((f) =>
                f === null
                  ? null
                  : {
                      agentId: f.target.agentId,
                      source,
                      before: f.target.before,
                      ...splitPage(f.rows, SIDEBAR_PAGE_SIZE),
                    },
              );
            }),
          )
        ).flat();
        // Project switch / reload raced this page: drop it.
        if (g !== gen || !isCurrentProject(projectId, get().projectId)) return;
        const ok = results.filter((r) => r !== null);
        const prev = get().sessions;
        const seen = new Set(prev.map((s) => s.sessionId));
        // Deleted stays deleted (see the header): the page may have been read before it went.
        const deleted = get().deletedSessionIds;
        const appended: SessionInfo[] = [];
        for (const r of ok) {
          for (const row of r.items) {
            if (seen.has(row.sessionId) || deleted.has(row.sessionId)) continue;
            seen.add(row.sessionId);
            appended.push(row);
            rememberSessionMachine(row.sessionId, r.source);
          }
        }
        const nextPageState = new Map(get().pageState);
        for (const r of ok) {
          const last = r.items.at(-1);
          nextPageState.set(pageKey(r.agentId, scope, r.source), {
            hasMore: r.hasMore,
            // An empty page leaves the stream where it was read from.
            cursor: last === undefined ? r.before : activityKeyOf(last),
          });
        }
        for (const { agentId, source, cursor } of settled) {
          nextPageState.set(pageKey(agentId, scope, source), { hasMore: false, cursor });
        }
        set({
          ...(appended.length > 0 ? { sessions: [...prev, ...appended] } : {}),
          pageState: nextPageState,
        });
      },

      add: (session) => {
        // Invalidate any in-flight reload: the newly created entry mustn't be wiped by a stale snapshot.
        gen += 1;
        insert(session);
      },

      adoptLiveSession: (sessionId, source, status, row) => {
        const running = adopting.get(sessionId);
        if (running !== undefined) {
          running.latest = { status, row };
          return running.done;
        }
        const state = get();
        const { projectId } = state;
        if (
          projectId === null ||
          declined.has(sessionId) ||
          state.deletedSessionIds.has(sessionId) ||
          state.sessions.some((s) => s.sessionId === sessionId)
        ) {
          return Promise.resolve();
        }
        const entry = { done: Promise.resolve(), latest: { status, row } };
        adopting.set(sessionId, entry);
        entry.done = (async () => {
          let fetched: SessionInfo | null = null;
          let gone = false;
          try {
            fetched = (await api.getSession(sessionId, source)).session;
          } catch (err) {
            // A 404 is an answer (the Session is gone, or was never this server's); anything
            // else may succeed on the next flip.
            gone = err instanceof ApiError && err.status === 404;
          }
          const { latest } = entry;
          adopting.delete(sessionId);
          const now = get();
          // The list moved on to another Project while this was asked: not its row.
          if (now.projectId !== projectId) return;
          // Only the sidebar's own rows join it: an archived Session that runs (a schedule, an
          // API caller, a kept Session archived again) and a subagent stay where they are listed.
          if (
            fetched === null ||
            isOrgSession(fetched) ||
            fetched.projectId !== projectId ||
            sessionCategory(fetched) !== "active"
          ) {
            if (fetched !== null || gone) decline(sessionId);
            return;
          }
          // An Agent no page of this list is asked about (reload's jobs) has no group to show
          // it in, and the next reload would drop it again. Not declined: the Agent set moves.
          const listed =
            now.agentIds.includes(fetched.agentId) ||
            (source !== null && (now.agentIdsByMachine[source] ?? []).includes(fetched.agentId));
          if (!listed) return;
          if (
            now.deletedSessionIds.has(sessionId) ||
            now.sessions.some((s) => s.sessionId === sessionId)
          ) {
            return;
          }
          rememberSessionMachine(sessionId, source);
          insert(fetched);
          adoptedAt.set(sessionId, ++adoptSeq);
          // The row is as the lookup read it; a flip reported after that read is newer.
          if (latest.row.lastActiveAt >= fetched.lastActiveAt) {
            get().setStatus(sessionId, latest.status, latest.row);
          }
        })();
        return entry.done;
      },

      remove: (sessionId) => {
        // Invalidate any in-flight reload: the deletion mustn't be undone by a stale snapshot.
        gen += 1;
        const row = get().sessions.find((s) => s.sessionId === sessionId);
        if (row) adjustCount(row, sessionCategory(row), -1);
        // Tombstone BEFORE pruning the list, in the same update: consumers re-render on the
        // pruned list, and any of them that reacts to the row's disappearance (the chat
        // page's deep-link lookup) must already be able to see that the id is dead rather
        // than merely unfetched — otherwise it fires a request that can only 404.
        set({
          deletedSessionIds: withTombstones(get().deletedSessionIds, [sessionId]),
          sessions: get().sessions.filter((s) => s.sessionId !== sessionId),
        });
      },

      replace: (session) => {
        const old = get().sessions.find((s) => s.sessionId === session.sessionId);
        // Not held (the page's row fell out of a reload, say): put it in, so the page that sent
        // the PATCH shows its result.
        if (old === undefined) {
          insert(session);
          return;
        }
        // An archive toggle moves the row between the lists, in place: keep the totals in step.
        if (sessionCategory(old) !== sessionCategory(session)) {
          adjustCount(session, sessionCategory(old), -1);
          adjustCount(session, sessionCategory(session), 1);
        }
        set({
          sessions: get().sessions.map((s) => (s.sessionId === session.sessionId ? session : s)),
        });
      },

      noteListingChange: (change) => {
        pendingListing.set(change.sessionId, change);
        listingTimer ??= setTimeout(flushListing, LISTING_CHANGE_DELAY_MS);
      },

      /**
       * A status flip changes more of the row than the status, because the glyph is drawn from
       * three fields, not one (see session-activity.ts). The user-channel `session_state` event
       * carries the other two from the server's own row; the open Session's stream calls this
       * with two arguments, having none to give.
       *
       * - `lastActiveAt` is what makes a background completion legible: the read/unread split
       *   compares it against the seen marker (session-seen.ts), so without the server's new
       *   stamp a Session that finished while the user was elsewhere would settle into the
       *   muted "already read" glyph — the exact case the user needs to notice.
       * - `hasTrace` is what keeps a FIRST run from settling into nothing at all. It separates
       *   "finished" from "never ran", and a Session running its first Task still has the
       *   `false` its list row was fetched with: the hourglass shows (status wins), and then
       *   the moment it stops the row would go blank.
       *
       * `hasTrace` is therefore treated as monotonic, and a live status is itself proof the
       * Session has run — server-side it is a one-way cache (`has_trace = 1`, never cleared)
       * set at run start, and a running Session has by definition started a Task. That second
       * half is what keeps the two callers consistent: the Session stream carries no flag, so
       * on its own it would settle a first run into a blank row until the next list fetch.
       *
       * An id no loaded page holds is not turned into a row here: the event names a Session, it
       * does not describe one, and a row invented from a status and a timestamp would have no
       * title, Agent or Workspace to render. The user channel fetches such a row instead when
       * it is this Project's (applyUserEvent → adoptLiveSession). The STATUS is remembered
       * either way (`liveStatuses`): the user channel is the one source that reports a run
       * ending, and company mode reads it for the Sessions this list never fetches.
       */
      setStatus: (sessionId, status, row) => {
        const remembered = rememberStatus(get().liveStatuses, sessionId, status);
        // The remembered half of the write, empty when this status was already on record.
        const patch = remembered === get().liveStatuses ? {} : { liveStatuses: remembered };
        const prev = get().sessions;
        const target = prev.find((s) => s.sessionId === sessionId);
        if (!target) {
          if ("liveStatuses" in patch) set(patch);
          return;
        }
        const lastActiveAt = row?.lastActiveAt ?? target.lastActiveAt;
        const live = status === "running" || status === "compacting";
        const hasTrace = target.hasTrace || row?.hasTrace === true || live;
        if (
          target.status === status &&
          target.lastActiveAt === lastActiveAt &&
          target.hasTrace === hasTrace
        ) {
          if ("liveStatuses" in patch) set(patch);
          return;
        }
        set({
          ...patch,
          sessions: prev.map((s) =>
            s.sessionId === sessionId ? { ...s, status, lastActiveAt, hasTrace } : s,
          ),
        });
      },

      /**
       * Same drop rule as `setStatus`: an id no loaded page holds is ignored rather than
       * turned into a row. The title now arrives on the user channel too, which carries every
       * Session of every Project this user can see — most of them absent from this list — and
       * both channels deliver the same title to a tab subscribed to both. Replacing the array
       * either way would re-render every row for nothing.
       */
      setTitle: (sessionId, title) => {
        const prev = get().sessions;
        const target = prev.find((s) => s.sessionId === sessionId);
        if (!target || target.title === title) return;
        set({
          sessions: prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s)),
        });
      },

      /**
       * Same drop rule as `setStatus` and `setTitle`: an unlisted id is ignored, and equal
       * counts leave the array untouched (a ping that changed nothing must not re-render every
       * row). Zero is stored as absence — the same shape a list fetch returns — so the
       * "has background work" test stays one `backgroundTasks !== undefined` check everywhere.
       */
      setBackgroundTasks: (sessionId, tasks) => {
        const prev = get().sessions;
        const target = prev.find((s) => s.sessionId === sessionId);
        if (!target) return;
        const cur = target.backgroundTasks;
        const same =
          cur === undefined || tasks === undefined
            ? cur === tasks
            : cur.processes === tasks.processes && cur.subagents === tasks.subagents;
        if (same) return;
        set({
          sessions: prev.map((s) => {
            if (s.sessionId !== sessionId) return s;
            const { backgroundTasks: _dropped, ...rest } = s;
            return tasks === undefined ? rest : { ...rest, backgroundTasks: tasks };
          }),
        });
      },

      /** Same drop rule as `setBackgroundTasks`: an unlisted id is ignored, an equal count is a no-op. */
      setPendingApprovals: (sessionId, count) => {
        const prev = get().sessions;
        const target = prev.find((s) => s.sessionId === sessionId);
        if (!target || target.pendingApprovalCount === count) return;
        set({
          sessions: prev.map((s) =>
            s.sessionId === sessionId ? { ...s, pendingApprovalCount: count } : s,
          ),
        });
      },
    };
  });
}

/** The vanilla store backing one Provider mount. */
export type SessionsStore = ReturnType<typeof createSessionsStore>;

/**
 * Routes one user-level server event (/api/events) into the list store.
 *
 * That connection is the only one that outlives every Project switch and every conversation
 * the user opens, which is why the list's cross-Session facts arrive on it rather than on a
 * Session channel. Split out from the subscription so this routing is testable without a React
 * tree or an EventSource, neither of which exists in this package's Node test environment.
 *
 * `onWebUpdated` is the escape hatch for the one event that is not a list update at all.
 */
export function applyUserEvent(
  store: SessionsStore,
  ev: ServerEvent,
  onWebUpdated: () => void,
  /** The machine the event came from; null for this server. */
  source: string | null = null,
): void {
  // The machines list changed — a job moved, a connection came or went: every surface reading
  // the machines reads them again (state/machines.tsx).
  if (ev.type === "machines_changed") {
    if (source === null) publishMachinesChanged();
    return;
  }
  // The served web assets were hot-swapped (dev watch-push / platform upgrade): reload so this
  // window runs the new code. Only this server's word counts: a machine's web being pushed is
  // that machine's affair, and this window is not running it.
  if (ev.type === "web_updated") {
    if (source === null) onWebUpdated();
    return;
  }
  // A Session now exists that this list did not create — `penguin chat`, another tab, on this
  // server or on a machine. Nothing short of a fetch can put the row in place with everything a
  // row needs (title, workspace, counts), so reload; the same answer schedule_fired gives below,
  // for the same reason. Only a person's conversation can land in this list: what a program
  // opens (the Agent API, a schedule, `penguin run`) is archived until kept, and a subagent or
  // company Session is in no list, so their creation leaves the list as it is.
  //
  // The Project is compared whatever the event came from. A machine's Projects carry THIS
  // server's ids — installing one creates the same Project over there, and every list call
  // below names it (machines/models-sync.ts) — so a machine's events are as unrelated to this
  // list as this server's are when the id differs. Reloading on all of them meant every
  // Session and every subagent started in any other Project on any connected machine refetched
  // the whole list, Agents × sources.
  if (ev.type === "session_created") {
    if (ev.source === "user" && ev.projectId === store.getState().projectId) {
      void store.getState().reload();
    }
    return;
  }
  // The user's listing decision on a Session changed, or the Session is gone — this tab's own
  // action echoed back, another tab's, or one of the archive page's batches (one event per
  // Session). The store gathers them and applies a batch as one update.
  if (ev.type === "session_archived" || ev.type === "session_deleted") {
    store.getState().noteListingChange(
      ev.type === "session_deleted"
        ? { kind: "deleted", sessionId: ev.sessionId, projectId: ev.projectId }
        : {
            kind: ev.archived ? "archived" : "unarchived",
            sessionId: ev.sessionId,
            projectId: ev.projectId,
          },
    );
    return;
  }
  // A Session changed run state. This is what keeps every row honest: a tab subscribes to the
  // ONE conversation it has open, so its `task_state` events can only ever move that row's
  // badge. Everything else — the Session the user just navigated away from, a run started from
  // another tab, a schedule, a subagent — would otherwise sit on whatever status the last list
  // fetch happened to return.
  //
  // A Session of THIS Project that no loaded page holds is the most recently active row there
  // is, and the activity-ordered pages will never serve it — it moved above every cursor — so
  // it is fetched from where the event came from and joins the list at the top. Another
  // Project's flip is only remembered.
  if (ev.type === "session_state") {
    const state = store.getState();
    const row = { lastActiveAt: ev.lastActiveAt, hasTrace: ev.hasTrace };
    state.setStatus(ev.sessionId, ev.state, row);
    if (
      ev.projectId === state.projectId &&
      !state.sessions.some((s) => s.sessionId === ev.sessionId)
    ) {
      void state.adoptLiveSession(ev.sessionId, source, ev.state, row);
    }
    return;
  }
  // A title landed. Titles generate at Task start, before the brand-new Session's own
  // channel has any subscriber (the tab is still navigating from the draft), so the user
  // channel is the delivery that reliably updates the list row — and rows this tab never
  // opens (another tab's session, a subagent) get their titles the same way.
  if (ev.type === "session_title") {
    store.getState().setTitle(ev.sessionId, ev.title);
    return;
  }
  // A Session's background work changed — a command promoted past its yield window, a
  // process that exited or was stopped, a background subagent starting or finishing a round.
  // The event carries the counts as they now stand, zeros included, so the row's mark can
  // appear and disappear without a list fetch; the pair collapses to "none" at zero.
  if (ev.type === "session_background") {
    const { processes, subagents } = ev;
    store
      .getState()
      .setBackgroundTasks(
        ev.sessionId,
        processes > 0 || subagents > 0 ? { processes, subagents } : undefined,
      );
    return;
  }
  // A Session's count of tool calls waiting for approval changed. Like the background counts,
  // the event carries the count as it now stands, so the row's mark follows without a fetch.
  if (ev.type === "session_approvals") {
    store.getState().setPendingApprovals(ev.sessionId, ev.count);
    return;
  }
  // The reconnect landed outside the channel's replay buffer, so an unknown number of the flips
  // above were lost — away long enough and a row sits on an hourglass that will never stop.
  // Refetch once, on the event that says so, rather than polling for it. The remembered
  // statuses go too: no fetch here refreshes them, and a stale entry beats every fresh snapshot
  // company mode reads, so those surfaces re-read their snapshots and fall back to them.
  if (ev.type === "resync_required") {
    store.setState({ liveStatuses: new Map() });
    void store.getState().reload();
    publishCompanyResync();
    if (source === null) publishBuiltinBrowserResync();
    return;
  }
  // The agent browser's tabs, page requests, agent activity, backend and Chrome connection go
  // to the browser layer in the app shell. Only this server's: the built-in pages live in the
  // desktop shell that spawned it, the user's Chrome is paired to it, and a machine's server
  // drives no browser on this screen.
  if (isBuiltinBrowserEvent(ev)) {
    if (source === null) publishBuiltinBrowserEvent(ev);
    return;
  }
  // Company-mode notifications fan out to the company store and any mounted organization page
  // (state/company.tsx); a work run additionally opened a desk or ticket Session this list has
  // not seen, so it refreshes like a schedule firing does.
  if (isCompanyEvent(ev)) {
    publishCompanyEvent(ev);
    if (ev.type === "org_run" && ev.projectId === store.getState().projectId) {
      void store.getState().reload();
    }
    return;
  }
  // A workbench of some Agent was (re)loaded: the chat page's tab strip owns that list and
  // listens on window (it is mounted per page, this provider per app).
  if (ev.type === "workbench_updated" || ev.type === "workbench_removed") {
    window.dispatchEvent(
      new CustomEvent(WORKBENCH_UPDATED_EVENT, {
        detail: { projectId: ev.projectId, agentId: ev.agentId },
      }),
    );
    return;
  }
  // A scheduled task firing may have created a new Session (new-session mode); reload the list
  // so it appears immediately. schedule_queued doesn't change the list (the target Session
  // already exists), so it is ignored, as is every other Session-scoped event.
  // Either schedule event moves a task's state — nextFireAt, lastFiredAt, the queued flag, or a
  // one-off going done — so the conversation's schedule list is stale from here. The store
  // decides for itself whether the Project is the one on screen.
  if (ev.type === "schedule_fired" || ev.type === "schedule_queued") {
    // A machine's event (relayed as `machine_event`) moves that machine's list.
    noteScheduleEvent(ev.projectId, source);
  }
  // A scheduled task firing may also have created a new Session (new-session mode); reload the
  // list so it appears immediately. schedule_queued doesn't change the list (the target Session
  // already exists), so it goes no further, as does every other Session-scoped event.
  if (ev.type !== "schedule_fired") return;
  // The event carries projectId: a trigger from another Project is unrelated to the current
  // list, wherever it fired (see session_created).
  if (ev.projectId === store.getState().projectId) void store.getState().reload();
}

/** The list's rows, pages and totals — everything in the store that is read for one Project. */
type ListedState = Pick<
  SessionsStoreState,
  | "sessions"
  | "pageState"
  | "countsByAgent"
  | "workspaceCountsByAgent"
  | "workspaceLatestByAgent"
  | "workspaceLatestActiveByAgent"
  | "loading"
>;

/** What the list holds for a Project it has not been read for yet: nothing, and still loading. */
const NOTHING_LISTED: ListedState = {
  sessions: [],
  pageState: new Map(),
  countsByAgent: new Map(),
  workspaceCountsByAgent: new Map(),
  workspaceLatestByAgent: new Map(),
  workspaceLatestActiveByAgent: new Map(),
  loading: true,
};

/**
 * The store's list as `projectId` may read it: the store's own when it holds that Project's,
 * else nothing and loading. The Provider publishes through this, so no consumer ever reads one
 * Project's rows — or the Agents they name — under another (see SessionsProvider).
 */
function sessionsListFor(
  state: ListedState & Pick<SessionsStoreState, "projectId">,
  projectId: string | null,
): ListedState {
  return isCurrentProject(projectId, state.projectId) ? state : NOTHING_LISTED;
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Stable key for the Agent set: the list object is a new reference on every reload,
  // so join the ids to avoid unnecessary reloads.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");

  const [store] = useState(createSessionsStore);
  const state = useStore(store);

  /**
   * The Project's machines, whose Sessions belong in this list too — the ones this server
   * holds a connection to, and the ones it does not, which contribute their cached rows and
   * mark the list as incomplete. Read from the one live account of the machines
   * (state/machines.tsx), which the server keeps current: a machine that comes back is listed
   * the moment the server says so. A machine being brought back (`reconnect`) is asked nothing
   * until it is: its connection may be up while its server is not. Nothing here connects.
   *
   * No account (not an admin, or the read failed) leaves both empty, which degrades to exactly
   * the old behaviour: this server's Sessions, listed. That is the right failure — a partial
   * list beats none.
   */
  const machines = useMachines();
  const machineFacts = useMemo(() => {
    const installed = (machines.state?.machines ?? []).filter(
      (machine) => !machine.local && machine.installed !== null && machine.machineId !== null,
    );
    const isHeld = (machine: (typeof installed)[number]) =>
      machine.connection !== null && machine.reconnect === undefined;
    const ids = (list: typeof installed) =>
      list.map(machineIdOf).filter((id): id is string => id !== null);
    return {
      held: ids(installed.filter(isHeld)),
      offline: ids(installed.filter((machine) => !isHeld(machine))),
      /**
       * machineId → its ssh alias. What the list is FOR: a Workspace group from another machine
       * is named with the alias that reaches it, and an alias is the only part of a machine a
       * person recognises.
       */
      labels: installed.map((machine) => [machine.machineId, machine.alias] as const),
    };
  }, [machines.state]);
  // Strings, so an unchanged answer keeps its identity and effects keyed on them stay put.
  const machineIdsKey = machineFacts.held.join(",");
  const offlineMachineIdsKey = machineFacts.offline.join(",");
  const machineLabelsJson = JSON.stringify(machineFacts.labels);
  // The terminal list asks the same machines, from a module-scope timer with no React context to
  // read them from (lib/terminal-machines.ts). Told "none" out loud when there is no account: it
  // waits for this word before it may drop a tab whose terminal is gone, and a user who can never
  // read the machine list would otherwise keep every dead tab in their dock forever
  // (features/terminal/terminal-list.ts).
  useEffect(() => {
    if (!machines.settled) return;
    setTerminalMachines(machineIdsKey === "" ? [] : machineIdsKey.split(","));
  }, [machines.settled, machineIdsKey]);
  /**
   * machineId → its own Agent ids, as JSON for the same reason the keys above are strings.
   * What the list is FOR: a Session started on a machine's own Agent is listed by nobody
   * unless that machine is asked about that Agent (see `agentIdsByMachine` in the store). A
   * machine that cannot answer contributes what it was last seen running — the same account
   * the composer offers a remote draft, and better than dropping its rows.
   */
  const [machineAgents, setMachineAgents] = useState<Scoped<string> | null>(null);
  /** Bumped when a page changed a machine's Agents (created, deleted one): its list is read again. */
  const [machineAgentsTick, setMachineAgentsTick] = useState(0);
  useEffect(() => subscribeMachineAgentsChanged(() => setMachineAgentsTick((n) => n + 1)), []);
  useEffect(() => {
    if (projectId === null) {
      setMachineAgents(null);
      return;
    }
    let cancelled = false;
    const held = machineIdsKey === "" ? [] : machineIdsKey.split(",");
    const offline = offlineMachineIdsKey === "" ? [] : offlineMachineIdsKey.split(",");
    const remembered = (machineId: string) =>
      cachedMachineAgents(projectId, machineId).map((agent) => agent.agentId);
    // A machine out of reach is asked again once it is back; one that stayed held and answered
    // in this page load is not asked again (lib/machine-agent-lists.ts `readMachineAgents`), and
    // a list a page is reading at the same moment is one request between them.
    for (const machineId of offline) machineAgentsOutOfReach(projectId, machineId);
    void (async () => {
      const answers = await Promise.all([
        ...offline.map(async (machineId) => [machineId, remembered(machineId)] as const),
        ...held.map(async (machineId) => {
          try {
            const listed = await readMachineAgents(projectId, machineId);
            return [machineId, listed.map((agent) => agent.agentId)] as const;
          } catch {
            return [machineId, remembered(machineId)] as const;
          }
        }),
      ]);
      if (!cancelled)
        setMachineAgents(scoped(projectId, JSON.stringify(Object.fromEntries(answers))));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, machineIdsKey, offlineMachineIdsKey, machineAgentsTick]);
  // The machines' Agents of THIS Project only: until the answer for it is in, none — the
  // previous Project's would ask its machines about Agents this Project does not have.
  const machineAgentIdsJson = scopedValue(machineAgents, projectId) ?? "{}";

  /**
   * The Project and its Agent set: what the list is OF. A change here invalidates every row
   * on screen, so it clears them. The machine set is deliberately not part of it — see below.
   */
  const contextKey = `${projectId ?? ""}\u0000${agentIdsKey}`;
  const appliedContext = useRef<string | null>(null);
  useEffect(() => {
    const contextChanged = appliedContext.current !== contextKey;
    appliedContext.current = contextKey;
    // Sync the fetch context and reset the loaded pages in the same synchronous step:
    // reload() picks the pages to refetch from pageState, so a Project switch can't carry
    // page state across via shared Agent ids (default_agent exists in every Project).
    // deletedSessionIds is deliberately NOT reset: session ids are globally unique and never
    // reused, so a Session deleted before a Project switch is still deleted after it — and
    // re-arming its lookup would just re-create the 404 this set exists to prevent.
    // liveStatuses stays for the same reason: a status is a fact about the Session.
    store.setState({
      projectId,
      agentIds: agentIdsKey === "" ? [] : agentIdsKey.split(","),
      machineIds: machineIdsKey === "" ? [] : machineIdsKey.split(","),
      offlineMachineIds: offlineMachineIdsKey === "" ? [] : offlineMachineIdsKey.split(","),
      agentIdsByMachine: JSON.parse(machineAgentIdsJson) as Record<string, string[]>,
      // Cleared only when the CONTEXT changed. A machine appearing, or dropping out, changes
      // which servers are asked — not whether what is already on screen is still true.
      // reload() below rebuilds the list wholesale from whatever answers, so a departed
      // machine's rows leave on their own; clearing first would instead blank the sidebar,
      // and with it the chat page, for as long as the fetch takes.
      ...(contextChanged
        ? {
            sessions: [],
            pageState: new Map(),
            countsByAgent: new Map(),
            workspaceCountsByAgent: new Map(),
            workspaceLatestByAgent: new Map(),
            workspaceLatestActiveByAgent: new Map(),
            // The pages were just cleared, so the list is loading from this instant —
            // including the window where the Agent set itself is still being refetched (a
            // Project switch empties it, which makes reload() below return without fetching
            // or clearing the flag). Raising it HERE, on fetch-context change, is what keeps
            // an unrelated reloadAgents() — same agent set, fired after every completed turn
            // — from flapping the app-wide flag.
            loading: true,
          }
        : {}),
    });
    // Which machine owns which Session is rebuilt by the very fetch below, so the old
    // answers are dropped with the rows they described: a stale entry would route a call at
    // a machine that may no longer hold — or no longer have — that Session. Only alongside
    // the rows themselves: dropped while they are still displayed, every one of them would
    // route at THIS server until the refetch lands.
    if (contextChanged) forgetSessionMachines();
    void store.getState().reload();
  }, [
    store,
    projectId,
    agentIdsKey,
    machineIdsKey,
    offlineMachineIdsKey,
    machineAgentIdsJson,
    contextKey,
  ]);

  // User-level event stream (/api/events); see applyUserEvent for what each event does. The
  // connection stays a single one for the whole login session and doesn't reconnect on Project
  // switches, so the handler reads current values through store.getState() rather than closing
  // over them.
  useEffect(() => {
    const conn = openUserEvents({
      onRecord: () => undefined,
      onServerEvent: (ev) => {
        applyUserEvent(store, ev, () => window.location.reload());
        // The surfaces that list this server's Sessions apart from the sidebar (the archive
        // page) follow the same channel.
        publishUserEvent(ev);
      },
      // This stream is the only thing an idle window has open, and the server ends it when
      // the session behind it is revoked — answered with a fatal status, which reads exactly
      // like a dead network from this side. Asking settles it: a session that is really gone
      // takes the window to the sign-in page instead of leaving it here listening to nothing
      // (api/session-probe.ts).
      onError: (closed) => {
        if (closed) void probeSession();
      },
    });
    return () => conn.close();
  }, [store]);

  // The machines aggregate (GET /api/projects/:projectId/machines/events): one stream for every
  // connected machine, each event routed as that machine's word — the routing the retired HTTP
  // relay once fed into this server's own stream — and re-published wrapped, so every subscriber
  // of this channel (the archive page) keeps seeing the shape it always did. The hub's own
  // events (resync_required after a replay the buffer could not honour) are this server's: the
  // list facts missed are this list's. Reconnects on Project switches; the stream is per Project.
  useEffect(() => {
    if (projectId === null) return;
    const conn = openMachineEvents(projectId, {
      onMachineEvent: (machineId, event) => {
        applyUserEvent(store, event, () => window.location.reload(), machineId);
        publishUserEvent({ type: "machine_event", machineId, event });
      },
      onHubEvent: (ev) => {
        applyUserEvent(store, ev, () => window.location.reload());
      },
    });
    return () => conn.close();
  }, [store, projectId]);

  // The store is told about a Project switch in the effect above, one commit after useProject()
  // reports it — and in that commit every descendant's effects run before this Provider's. So
  // the list is published only for the Project it was read for: under any other it is empty and
  // loading, never the previous Project's rows (their Agents paired with the new Project).
  const listed = sessionsListFor(state, projectId);
  const { pageState, countsByAgent } = listed;
  const { machineIds } = state;

  const sources = useMemo<(string | null)[]>(() => [null, ...machineIds], [machineIds]);

  // Loaded only when EVERY source has answered: one machine's first page arriving does not
  // make the group complete, and treating it as loaded would hide the rest behind a
  // "load more" that never appears.
  const isLoadedFor = useCallback(
    (agentId: string, workspaceGroup?: string) =>
      sourcesFor(sources, workspaceGroup).every((source) =>
        pageState.has(pageKey(agentId, scopeOf(workspaceGroup), source)),
      ),
    [pageState, sources],
  );

  // More if ANY source has more — or if a source has not been asked at all and the counts,
  // which are the sum over sources, say the Agent holds an active row. A group's own stream
  // not asked yet has nothing more on a source whose whole stream is exhausted: every row the
  // group has there is already in the pool (loadMoreFor settles such a stream without asking).
  const hasMoreFor = useCallback(
    (agentId: string, workspaceGroup?: string) => {
      const scope = scopeOf(workspaceGroup);
      let anyUnloaded = false;
      for (const source of sourcesFor(sources, workspaceGroup)) {
        const position = pageState.get(pageKey(agentId, scope, source));
        if (position !== undefined) {
          if (position.hasMore) return true;
          continue;
        }
        if (scope !== "" && pageState.get(pageKey(agentId, "", source))?.hasMore === false)
          continue;
        anyUnloaded = true;
      }
      if (!anyUnloaded) return false;
      // Unloaded: the counts are the sum over sources, so anything they report is by
      // definition still unfetched somewhere. A group's own stream is not in those counts,
      // so an unloaded scoped stream answers from the Agent's active total — the group's
      // share of it cannot exceed that.
      return (countsByAgent.get(agentId)?.active ?? 0) > 0;
    },
    [pageState, countsByAgent, sources],
  );

  const activityWatermarkFor = useCallback(
    (agentIds: readonly string[], workspaceGroup?: string) =>
      watermarkFor({ pageState, machineIds }, agentIds, workspaceGroup),
    [pageState, machineIds],
  );

  // Reads the store directly rather than the subscribed snapshot: this answers "is this id
  // already dead", and a caller asking that inside an effect must get the newest answer even
  // when it runs before its own re-render. Stable identity, so it never re-triggers effects.
  const isDeleted = useCallback(
    (sessionId: string) => store.getState().deletedSessionIds.has(sessionId),
    [store],
  );

  // Keyed on the rows alone: the outer value memo re-runs on every store change (status,
  // titles, page state), and rebuilding + re-sorting every Agent's bucket for those would be
  // pure waste.
  const byAgent = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const s of listed.sessions) {
      const list = map.get(s.agentId);
      if (list) list.push(s);
      else map.set(s.agentId, [s]);
    }
    // Encounter order is not reliable (add() prepends, a live event moves a row's key in
    // place): sort each Agent's list in activity order, the key the server pages by.
    for (const list of map.values()) list.sort(mostRecentFirst);
    return map;
  }, [listed.sessions]);

  const machineLabels = useMemo<ReadonlyMap<string, string>>(() => {
    const entries = JSON.parse(machineLabelsJson) as [string | null, string][];
    return new Map(
      entries.flatMap(([id, alias]) => (id === null ? [] : [[id, alias] as [string, string]])),
    );
  }, [machineLabelsJson]);

  const value = useMemo<SessionsContextValue>(() => {
    return {
      sessions: listed.sessions,
      byAgent,
      countsByAgent: listed.countsByAgent,
      workspaceCountsByAgent: listed.workspaceCountsByAgent,
      workspaceLatestByAgent: listed.workspaceLatestByAgent,
      workspaceLatestActiveByAgent: listed.workspaceLatestActiveByAgent,
      liveStatuses: state.liveStatuses,
      machineLabels,
      machineIds: state.machineIds,
      isLoadedFor,
      hasMoreFor,
      activityWatermarkFor,
      loading: listed.loading,
      machinesUnreachable: state.offlineMachineIds.length > 0,
      offlineMachineIds: state.offlineMachineIds,
      reload: state.reload,
      loadMoreFor: state.loadMoreFor,
      add: state.add,
      remove: state.remove,
      isDeleted,
      replace: state.replace,
      setStatus: state.setStatus,
      setTitle: state.setTitle,
    };
  }, [
    state,
    listed,
    byAgent,
    machineLabels,
    isLoadedFor,
    hasMoreFor,
    activityWatermarkFor,
    isDeleted,
  ]);

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within a SessionsProvider");
  return ctx;
}

/**
 * Run status by Session id as this page knows it: every status the user channel has reported
 * (`live`, loaded row or not), with a loaded row's own status winning — a row is written by
 * the same events AND by every list fetch, so it is never older than the remembered entry,
 * while an id the list does not hold has only the remembered one. An organization row held for
 * the page showing it is the exception: no list fetch refreshes it, so it speaks for nothing
 * and its Session has the remembered entry alone (which a resync clears). Pure, so the merge
 * the hook below publishes is testable without a React tree.
 */
export function liveSessionStatuses(
  sessions: readonly SessionInfo[],
  live: ReadonlyMap<string, SessionStatus>,
): ReadonlyMap<string, SessionStatus> {
  const out = new Map(live);
  for (const s of sessions) if (!isOrgSession(s)) out.set(s.sessionId, s.status);
  return out;
}

/**
 * Run status by Session id — the user event channel's view of it, which is the only one that
 * reports a run ENDING. Surfaces built on a server-side snapshot (company mode's desk and
 * ticket rows, the org chart's state dots, the overview's employee counts) read this first and
 * keep their snapshot for a Session no event has named yet: their snapshots are re-read on
 * organization events and on a resync, and no event announces that a run finished. The
 * development list never fetches an organization's Sessions, so for them this is the
 * remembered `session_state` alone — which reaches every one of them, not only the first page
 * of an employee's stream.
 *
 * Memoized on the rows and the remembered statuses, so a consumer re-shapes only when one
 * actually moves.
 */
export function useLiveSessionStatuses(): ReadonlyMap<string, SessionStatus> {
  const { sessions, liveStatuses } = useSessions();
  return useMemo(() => liveSessionStatuses(sessions, liveStatuses), [sessions, liveStatuses]);
}
