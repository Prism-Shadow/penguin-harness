/**
 * The drafts that follow the account, and how a cached draft's localStorage key maps to the key
 * the account files it under.
 *
 * Every draft the Web App keeps is here: the composer's new-conversation draft and each Session's
 * composer (draft-cache.ts), the parked draft conversations (draft-sessions.ts), a company-mode
 * channel's composer (channel-draft.ts), the create-organization form (org-draft.ts) and a
 * reply's form answers in progress (a2ui-drafts.ts). The cache keys carry the user (except the
 * form answers', which carry the Session); the account's keys do not — the server knows whose
 * they are — and name instead what the draft belongs to (`<kind>:<id>`), which is what lets the
 * server drop a draft with its Session or Project.
 *
 * Pure, like prefs.ts: sync.ts does the I/O.
 */
import type { DraftKind } from "@prismshadow/penguin-server/api";
import { DRAFT_VALUE_MAX_CHARS } from "@prismshadow/penguin-server/api";

interface DraftFamily {
  kind: DraftKind;
  /** The cache key prefix of this user's drafts of this kind; the id follows it. */
  prefix(userId: string): string;
}

/**
 * Most specific first: a Session composer's prefix extends the new-conversation one
 * (`penguin.chatDraft.session.<user>.` beside `penguin.chatDraft.<user>.`), and for a user named
 * `session` the shorter one would match a Session's key too.
 */
const FAMILIES: readonly DraftFamily[] = [
  { kind: "session", prefix: (u) => `penguin.chatDraft.session.${u}.` },
  { kind: "chat", prefix: (u) => `penguin.chatDraft.${u}.` },
  { kind: "parked", prefix: (u) => `penguin.chatDrafts.${u}.` },
  { kind: "channel", prefix: (u) => `penguin.channelDraft.${u}.` },
  { kind: "org", prefix: (u) => `penguin.orgCreateDraft.${u}.` },
  { kind: "a2ui", prefix: () => "penguin.a2uiDraft." },
];

/** The account's key for a cached draft of `userId`, or null when the key is not one of theirs. */
export function accountKeyOf(cacheKey: string, userId: string): string | null {
  for (const family of FAMILIES) {
    const prefix = family.prefix(userId);
    if (cacheKey.startsWith(prefix) && cacheKey.length > prefix.length) {
      return `${family.kind}:${cacheKey.slice(prefix.length)}`;
    }
  }
  return null;
}

/** The cache key a draft of the account's is kept under here, or null for a kind this build does not know. */
export function cacheKeyOf(accountKey: string, userId: string): string | null {
  const colon = accountKey.indexOf(":");
  if (colon <= 0) return null;
  const family = FAMILIES.find((f) => f.kind === accountKey.slice(0, colon));
  const id = accountKey.slice(colon + 1);
  return family === undefined || id === "" ? null : family.prefix(userId) + id;
}

/** A cached draft as the account takes it: its parsed JSON, or undefined when it is not JSON or too large. */
export function accountValueOf(cached: string): unknown {
  if (cached.length > DRAFT_VALUE_MAX_CHARS) return undefined;
  try {
    return JSON.parse(cached) as unknown;
  } catch {
    return undefined;
  }
}

export interface DraftsPlan {
  /** Cache writes: key → JSON text, null removes it. */
  cache: Array<[key: string, value: string | null]>;
  /** Account keys whose cached draft goes up: an import, or edits the account has not acknowledged. */
  upload: string[];
}

/**
 * Reconciles this browser's cached drafts of `userId` with the account's.
 *
 * - A draft with an edit the account has not acknowledged (`pending`) keeps the cached text and
 *   goes up again.
 * - Otherwise the account wins: its drafts are cached, and a cached draft it does not hold was
 *   sent or deleted elsewhere, so it goes — unless `importing` (this browser has never handed
 *   this account its drafts), in which case it goes up instead, once. Form answers are left out
 *   of that: their cache keys carry no user, so on a browser two accounts share the one signing
 *   in first would be handed the other's answers. They go like any draft the account lacks.
 */
export function planDrafts(
  account: Readonly<Record<string, unknown>>,
  cached: ReadonlyMap<string, string>,
  options: { userId: string; importing: boolean; pending: ReadonlySet<string> },
): DraftsPlan {
  const plan: DraftsPlan = { cache: [], upload: [] };
  const seen = new Set<string>();
  for (const [cacheKey, text] of cached) {
    const key = accountKeyOf(cacheKey, options.userId);
    if (key === null) continue;
    seen.add(key);
    if (options.pending.has(key)) {
      plan.upload.push(key);
    } else if (Object.hasOwn(account, key)) {
      const wanted = JSON.stringify(account[key]);
      if (wanted !== text) plan.cache.push([cacheKey, wanted]);
    } else if (options.importing && !key.startsWith("a2ui:")) {
      plan.upload.push(key);
    } else {
      plan.cache.push([cacheKey, null]);
    }
  }
  for (const [key, value] of Object.entries(account)) {
    if (seen.has(key)) continue;
    const cacheKey = cacheKeyOf(key, options.userId);
    if (cacheKey !== null) plan.cache.push([cacheKey, JSON.stringify(value)]);
  }
  // A pending removal: the draft was deleted here and the account still has it.
  for (const key of options.pending) {
    if (seen.has(key)) continue;
    const at = plan.cache.findIndex(([cacheKey]) => cacheKey === cacheKeyOf(key, options.userId));
    if (at >= 0) plan.cache.splice(at, 1);
    plan.upload.push(key);
  }
  return plan;
}
