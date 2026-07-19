/**
 * Draft cache (localStorage; one entry per "user × Project" for new conversations, one per
 * "user × Session" for existing sessions): reads validate field-by-field — storage may have been
 * corrupted externally, so bad fields are dropped rather than crashing the page; writes are
 * best-effort (silently fail under quota limits/private browsing). Pure functions + injectable
 * storage: vitest runs in a Node environment (no localStorage), so unit tests inject an in-memory
 * implementation.
 *
 * The key must include userId (#68): if the same browser logs into different accounts in
 * succession and the key only contains the Project/Session ID, the later user would recover the
 * previous user's text, Workspace, model selection, and @ target — a cross-account information leak.
 */
import type { ApprovalMode } from "@prismshadow/penguin-server/api";

const APPROVAL_MODES: ApprovalMode[] = ["always-ask", "read-only", "allow-all", "deny-all"];

export interface DraftCache {
  text?: string;
  agentId?: string;
  workspace?: string;
  approvalMode?: ApprovalMode;
  /**
   * The model selected in the draft (a paired reference; (provider, modelId) is the unique key):
   * load validates the object shape; the old string-typed modelId field is simply dropped
   * (product hasn't shipped, so no migration is done).
   */
  modelRef?: { provider: string; modelId: string };
  /** The @ handoff target (chip) at the front of the input box: resolved again by id on restore, dropped if no longer valid. */
  handoffAgentId?: string;
  /**
   * Preselected skill names (written by the quick-invoke action on the Skill library page):
   * used as the initial selection when ChatInput mounts, then trimmed to remove names not in the
   * installed list once it's ready; cleared along with the entire draft on successful send.
   */
  skills?: string[];
}

/** Minimal storage interface (a subset of localStorage). */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Cache key for a new conversation (draft page): one per "user × Project". */
export const draftKey = (userId: string, projectId: string): string =>
  `penguin.chatDraft.${userId}.${projectId}`;

/** Cache key for an existing session's input area: one per "user × Session" (only stores text and @ target; everything else is locked to the Session). */
export const sessionDraftKey = (userId: string, sessionId: string): string =>
  `penguin.chatDraft.session.${userId}.${sessionId}`;

/** Parses and validates raw JSON field-by-field: null / malformed JSON / non-object / invalid fields are all dropped. */
export function parseDraft(raw: string | null): DraftCache {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const o = parsed as Record<string, unknown>;
    const out: DraftCache = {};
    if (typeof o.text === "string") out.text = o.text;
    if (typeof o.agentId === "string") out.agentId = o.agentId;
    if (typeof o.workspace === "string") out.workspace = o.workspace;
    // The model reference must be a paired { provider, modelId } object; the old string-typed
    // modelId and any malformed shape are dropped.
    if (typeof o.modelRef === "object" && o.modelRef !== null) {
      const r = o.modelRef as Record<string, unknown>;
      if (typeof r.provider === "string" && typeof r.modelId === "string") {
        out.modelRef = { provider: r.provider, modelId: r.modelId };
      }
    }
    if (typeof o.handoffAgentId === "string") out.handoffAgentId = o.handoffAgentId;
    if (Array.isArray(o.skills)) {
      // Elements are validated one by one: non-string items are filtered out; if empty after
      // filtering, the whole field is omitted.
      const skills = o.skills.filter((s): s is string => typeof s === "string");
      if (skills.length > 0) out.skills = skills;
    }
    if (
      typeof o.approvalMode === "string" &&
      APPROVAL_MODES.includes(o.approvalMode as ApprovalMode)
    ) {
      out.approvalMode = o.approvalMode as ApprovalMode;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadDraft(key: string, storage: DraftStorage = localStorage): DraftCache {
  try {
    return parseDraft(storage.getItem(key));
  } catch {
    return {};
  }
}

export function saveDraft(
  key: string,
  draft: DraftCache,
  storage: DraftStorage = localStorage,
): void {
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    /* Write fails under quota limits/private browsing: draft cache is best-effort */
  }
}

export function clearDraft(key: string, storage: DraftStorage = localStorage): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}
