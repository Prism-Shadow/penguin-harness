/**
 * Company-mode push types (pure store + pure event mapping; state/use-company-notifications.ts
 * delivers them as OS notifications).
 *
 * Five groups, one per company event family — except `org_channel`, which splits: a message
 * addressing the reader is a `mention`, any other message is `channel`. What each group does
 * when it fires is the hook's business; this file decides the group, the text, and whether
 * the user's preferences enable it.
 *
 * Storage follows lib/notification-pref.ts: a module-level version counter read through
 * `useSyncExternalStore`, but the value is a JSON object of per-group booleans rather than
 * one switch (`penguin.notifications.groups`). Absent, corrupt or hand-edited values fall
 * back per key to DEFAULTS, so a new group added later starts at its default for everyone.
 * These groups ride UNDER the master notifications switch: with the master off (or the OS
 * permission ungranted) nothing here can show, whatever the groups say. They gate OS
 * notifications only — in-app badges and the inbox keep their own rules, so flipping a
 * group never hides data that is already on screen.
 *
 * Defaults are deliberately quiet: `mention` and `budget` are rare and important, so they
 * start on; `channel`, `ticket` and `run` are streams (every message, every ticket write,
 * every desk start), so they start off and the user opts in.
 */
import type { CompanyServerEvent } from "@prismshadow/penguin-server/api";
import { S } from "./strings";
import { orgChannelPath, orgPagePath } from "../features/company/company-nav";

export type CompanyNotifyGroup = "mention" | "channel" | "ticket" | "run" | "budget";

export const COMPANY_NOTIFY_GROUPS: readonly CompanyNotifyGroup[] = [
  "mention",
  "channel",
  "ticket",
  "run",
  "budget",
];

/** localStorage key of the per-group JSON object. */
export const NOTIFY_GROUPS_KEY = "penguin.notifications.groups";

export const NOTIFY_GROUP_DEFAULTS: Record<CompanyNotifyGroup, boolean> = {
  mention: true,
  channel: false,
  ticket: false,
  run: false,
  budget: true,
};

/** The storage this preference reads and writes — localStorage, or a stub in tests. */
export type NotifyGroupsStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): NotifyGroupsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // the accessor itself throws where site data is blocked
  }
}

let version = 0;
const listeners = new Set<() => void>();
/**
 * The live value, read from storage once and kept in memory afterwards (see
 * lib/notification-pref.ts for why): a change made in another tab is not seen until
 * a reload.
 */
let cache: Record<CompanyNotifyGroup, boolean> | null = null;

export function subscribeNotifyGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function notifyGroupsVersion(): number {
  return version;
}

function groupsIn(storage: NotifyGroupsStorage | null): Record<CompanyNotifyGroup, boolean> {
  const out = { ...NOTIFY_GROUP_DEFAULTS };
  let raw: string | null = null;
  try {
    raw = storage?.getItem(NOTIFY_GROUPS_KEY) ?? null;
  } catch {
    return out;
  }
  if (raw === null) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
  for (const group of COMPANY_NOTIFY_GROUPS) {
    const value = (parsed as Record<string, unknown>)[group];
    if (typeof value === "boolean") out[group] = value;
  }
  return out;
}

/**
 * The enabled groups. An explicit storage bypasses the cache. Unknown keys in storage
 * are ignored (a newer client wrote them); non-boolean values fall back to the default.
 */
export function readNotifyGroups(
  storage?: NotifyGroupsStorage | null,
): Record<CompanyNotifyGroup, boolean> {
  if (storage !== undefined) return groupsIn(storage);
  if (cache === null) cache = groupsIn(defaultStorage());
  return cache;
}

/** Merges a patch into the stored groups and tells everything rendering from it. */
export function writeNotifyGroups(
  patch: Partial<Record<CompanyNotifyGroup, boolean>>,
  storage?: NotifyGroupsStorage | null,
): void {
  const next = { ...groupsIn(storage === undefined ? defaultStorage() : storage), ...patch };
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    target?.setItem(NOTIFY_GROUPS_KEY, JSON.stringify(next));
  } catch {
    // Private-mode storage failures only cost persistence; this session still updates.
  }
  if (storage === undefined) cache = next;
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Which group an event belongs to for notification purposes, or null when it is
 * addressed to nobody in particular and carries no notifiable payload. A channel
 * message naming the reader is a `mention` (the same addressed rule the badge
 * counters apply, so a muted mention mutes both together); any other message is
 * `channel`. Squad events never arrive here — the client's event filter passes only
 * run/channel/ticket/budget, and squad changes surface through their tickets.
 */
export function groupOfCompanyEvent(
  ev: CompanyServerEvent,
  userId: string | null,
): CompanyNotifyGroup | null {
  switch (ev.type) {
    case "org_channel": {
      const addressed = userId !== null && ev.message.mentions.includes(`user:${userId}`);
      return addressed ? "mention" : "channel";
    }
    case "org_ticket":
      return "ticket";
    case "org_run":
      return "run";
    case "org_budget":
      return "budget";
    default:
      return null;
  }
}

/** A principal shown in one word: the id behind `agent:`/`user:`, anything else verbatim. */
function shortPrincipal(principal: string): string {
  const m = /^(?:agent|user):(.+)$/.exec(principal);
  return m ? m[1]! : principal;
}

function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export interface CompanyNotificationContent {
  title: string;
  body: string;
  /** Replacement scope: a newer notification with the same tag replaces the stale one. */
  tag: string;
  /** Where a click lands. */
  path: string;
}

/**
 * What a notification for an event says and where it leads. Unknown enum values
 * (a ticket `change` or run `kind` this client predates) render raw rather than
 * blank — the event still happened and the row still leads somewhere.
 */
export function describeCompanyEvent(
  ev: CompanyServerEvent,
  group: CompanyNotifyGroup,
): CompanyNotificationContent {
  switch (ev.type) {
    case "org_channel": {
      const sender = shortPrincipal(ev.message.sender);
      const text = snippet(ev.message.text);
      if (group === "mention") {
        return {
          title: S.notify.companyMentionTitle(ev.channelId),
          body: S.notify.companyMentionBody(sender, text),
          tag: `penguin-mention-${ev.orgId}-${ev.channelId}`,
          path: orgChannelPath(ev.projectId, ev.orgId, ev.channelId),
        };
      }
      return {
        title: S.notify.companyChannelTitle(ev.channelId),
        body: text === "" ? sender : S.notify.companyChannelBody(sender, text),
        tag: `penguin-channel-${ev.orgId}-${ev.channelId}`,
        path: orgChannelPath(ev.projectId, ev.orgId, ev.channelId),
      };
    }
    case "org_ticket":
      return {
        title: S.notify.companyTicketTitle(ev.ticketId),
        body: S.notify.companyTicketBody(ev.change),
        tag: `penguin-ticket-${ev.orgId}-${ev.ticketId}`,
        path: orgPagePath(ev.projectId, ev.orgId, "tickets"),
      };
    case "org_run":
      return {
        title: S.notify.companyRunTitle(ev.agentId),
        body: S.notify.companyRunBody(ev.kind),
        tag: `penguin-run-${ev.orgId}-${ev.agentId}`,
        path: orgPagePath(ev.projectId, ev.orgId, "overview"),
      };
    case "org_budget":
      return {
        title: S.notify.companyBudgetTitle(ev.agentId),
        body: S.notify.companyBudgetBody(ev.state, ev.ratio),
        tag: `penguin-budget-${ev.orgId}-${ev.agentId}`,
        path: orgPagePath(ev.projectId, ev.orgId, "finance"),
      };
    default: {
      // Squad events never arrive: the socket layer filters with isCompanyEvent, and
      // squad changes surface through their tickets. A new family added there fails
      // here at compile time until it gets its own case.
      const _exhaustive: never = ev;
      throw new Error(`Unhandled company event for notification: ${_exhaustive}`);
    }
  }
}

export interface CompanyNotifyGate {
  /** The master notifications switch. */
  masterOn: boolean;
  /** The per-group preferences. */
  groups: Record<CompanyNotifyGroup, boolean>;
  /** Live OS permission (`notificationPermission()`), or "unsupported" without the API. */
  permission: NotificationPermission | "unsupported";
  /** The render loop's visibility; backgrounded windows notify, focused ones do not. */
  hidden: boolean;
  focused: boolean;
  /** The event's own author is the reader (channel messages only). */
  self: boolean;
}

/**
 * Whether an event of `group` may notify right now. Everything is a parameter so the
 * matrix is unit-testable; the hook reads the live values. Ticket, run and budget
 * events carry no actor, so `self` never applies to them — a limitation of the event
 * shape, not of this check: the server would have to ship who acted.
 */
export function shouldNotifyCompanyEvent(
  group: CompanyNotifyGroup | null,
  gate: CompanyNotifyGate,
): boolean {
  if (group === null) return false;
  if (!gate.masterOn) return false;
  if (!gate.groups[group]) return false;
  if (gate.permission !== "granted") return false;
  if (gate.self) return false;
  if (!gate.hidden && gate.focused) return false;
  return true;
}
