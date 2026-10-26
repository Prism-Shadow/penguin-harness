/**
 * What PATCH /api/me/drafts accepts: draft keys of a known kind, each naming what the draft
 * belongs to, and values that are JSON of a bounded size.
 *
 * A key is `<kind>:<id>` (api/types.ts DRAFT_KINDS). The kind tells the server which part of the
 * id is a Session or a Project, and that is the whole reason the kinds are a closed list: a draft
 * is dropped with the Session or Project it names, and a key the server cannot read would be a
 * draft that outlives everything it was written for.
 *
 * The per-user bound is enforced by the repo on every write (oldest out first): a draft is a
 * convenience, and a browser that saves one must never be refused because older ones piled up.
 */
import { DRAFT_KINDS, DRAFT_VALUE_MAX_CHARS, DRAFTS_PATCH_MAX_ENTRIES } from "../api/types.js";
import type { DraftKind } from "../api/types.js";
import { badRequest } from "../http/errors.js";
import type { DraftWrite } from "../mechanisms/account-data.js";

/** The most drafts one account keeps; past it, the least recently written go. */
export const DRAFTS_MAX_COUNT = 200;

/** The most characters of draft JSON one account keeps in all; past it, the least recently written go. */
export const DRAFTS_MAX_TOTAL_CHARS = 4 * 1024 * 1024;

/** The id after the kind: printable ASCII without spaces, as every id it can carry is. */
const DRAFT_ID = /^[\x21-\x7e]{1,256}$/;

/** What a draft key names: the Session or the Project it goes with. */
export interface DraftOwner {
  sessionId: string | null;
  projectId: string | null;
}

/** The owner a key names, or null when the key is not one of the known shapes. */
export function draftOwnerOf(key: string): DraftOwner | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const kind = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (!(DRAFT_KINDS as readonly string[]).includes(kind) || !DRAFT_ID.test(id)) return null;
  // The first segment of a compound id: channel ids run Project.org.channel, form answers
  // Session:block.
  const head = (separator: string): string => id.split(separator)[0]!;
  const owners: Record<DraftKind, () => DraftOwner> = {
    chat: () => ({ sessionId: null, projectId: id }),
    parked: () => ({ sessionId: null, projectId: id }),
    org: () => ({ sessionId: null, projectId: id }),
    channel: () => ({ sessionId: null, projectId: head(".") }),
    session: () => ({ sessionId: id, projectId: null }),
    a2ui: () => ({ sessionId: head(":"), projectId: null }),
  };
  return owners[kind as DraftKind]();
}

/**
 * The writes a PATCH body asks for, validated whole before anything is stored: an unknown key, a
 * value that is not JSON-serializable or is too large, or too many entries reject the patch with
 * nothing written.
 */
export function parseDraftsPatch(body: Record<string, unknown>): DraftWrite[] {
  const drafts = body.drafts;
  if (typeof drafts !== "object" || drafts === null || Array.isArray(drafts)) {
    throw badRequest("drafts must be an object of draft key to value (null removes it).");
  }
  const entries = Object.entries(drafts as Record<string, unknown>);
  if (entries.length === 0) throw badRequest("drafts must name at least one draft.");
  if (entries.length > DRAFTS_PATCH_MAX_ENTRIES) {
    throw badRequest(`drafts may carry at most ${DRAFTS_PATCH_MAX_ENTRIES} entries per request.`);
  }
  return entries.map(([key, value]) => {
    const owner = draftOwnerOf(key);
    if (owner === null) {
      throw badRequest(
        `Draft key "${key.slice(0, 80)}" is not <kind>:<id> with a kind of ${DRAFT_KINDS.join(", ")}.`,
      );
    }
    if (value === null) return { key, valueJson: null, ...owner };
    const valueJson = JSON.stringify(value);
    // undefined, a function or a symbol stringify to undefined: nothing a browser could read back.
    if (typeof valueJson !== "string") throw badRequest(`Draft "${key}" is not a JSON value.`);
    if (valueJson.length > DRAFT_VALUE_MAX_CHARS) {
      throw badRequest(`Draft "${key}" is over ${DRAFT_VALUE_MAX_CHARS} characters of JSON.`);
    }
    return { key, valueJson, ...owner };
  });
}
