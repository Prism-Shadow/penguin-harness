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
 * previous user's text, Workspace, model selection, and handoff target — a cross-account information leak.
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
  /** The `/agent` handoff target (chip) at the front of the input box: resolved again by id on restore, dropped if no longer valid. */
  handoffAgentId?: string;
  /**
   * The `/model` switch target (the other switch chip; a paired reference, same shape as
   * modelRef above): cached for exactly the same reason as handoffAgentId — the composer text
   * is cached and ChatInput remounts on every session switch, so a chip left in component state
   * would vanish while the text it belongs to came back, and the next Enter would post to the
   * current session on the old model. Resolved again against the model list on restore and
   * dropped when that model is no longer available.
   */
  switchModelRef?: { provider: string; modelId: string };
  /**
   * Preselected skill names (written by the quick-invoke action on the Skill library page):
   * used as the initial selection when ChatInput mounts, then trimmed to remove names not in the
   * installed list once it's ready; cleared along with the entire draft on successful send.
   */
  skills?: string[];
  /**
   * This text was composed by a "Create with AI" surface (features/ai-create/ai-bridge.ts), not
   * typed by anyone: it seeds exactly one draft and dies with it. The mark rides in the cache
   * because the draft page must survive a reload, and it makes the two owners of the slot treat
   * the prompt differently from user content — parkActiveDraft drops it instead of parking it as
   * a draft conversation, and the draft page clears the slot when it is left unedited and unsent.
   * Dropped by the first edit: from then on the text is the user's and is cached like any other.
   */
  aiPrefill?: true;
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

/** Cache key for an existing session's input area: one per "user × Session" (only stores text and the handoff target; everything else is locked to the Session). */
export const sessionDraftKey = (userId: string, sessionId: string): string =>
  `penguin.chatDraft.session.${userId}.${sessionId}`;

/**
 * A cached model reference must be a paired `{ provider, modelId }` object; anything else — the
 * old string-typed modelId, a half reference, a non-object — yields undefined and the field is
 * dropped. Shared by the two model fields (the draft's selection and the staged `/model` switch).
 */
function parseModelRef(value: unknown): { provider: string; modelId: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.provider !== "string" || typeof r.modelId !== "string") return undefined;
  return { provider: r.provider, modelId: r.modelId };
}

/** Parses and validates raw JSON field-by-field: null / malformed JSON / non-object / invalid fields are all dropped. */
export function parseDraft(raw: string | null): DraftCache {
  if (!raw) return {};
  try {
    return draftFromUnknown(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Field-by-field validation of an already-parsed value (shared with the parked-drafts store, whose entries embed a draft object). */
export function draftFromUnknown(parsed: unknown): DraftCache {
  if (typeof parsed !== "object" || parsed === null) return {};
  const o = parsed as Record<string, unknown>;
  const out: DraftCache = {};
  if (typeof o.text === "string") out.text = o.text;
  if (typeof o.agentId === "string") out.agentId = o.agentId;
  if (typeof o.workspace === "string") out.workspace = o.workspace;
  const modelRef = parseModelRef(o.modelRef);
  if (modelRef) out.modelRef = modelRef;
  if (typeof o.handoffAgentId === "string") out.handoffAgentId = o.handoffAgentId;
  const switchModelRef = parseModelRef(o.switchModelRef);
  if (switchModelRef) out.switchModelRef = switchModelRef;
  if (Array.isArray(o.skills)) {
    // Elements are validated one by one: non-string items are filtered out; if empty after
    // filtering, the whole field is omitted.
    const skills = o.skills.filter((s): s is string => typeof s === "string");
    if (skills.length > 0) out.skills = skills;
  }
  if (o.aiPrefill === true) out.aiPrefill = true;
  if (
    typeof o.approvalMode === "string" &&
    APPROVAL_MODES.includes(o.approvalMode as ApprovalMode)
  ) {
    out.approvalMode = o.approvalMode as ApprovalMode;
  }
  return out;
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

/**
 * Drops the draft-cached model selection for this user × Project, so an open draft follows
 * a just-changed Project default model instead of pinning the old pick forever. Shared by
 * the models page and the project-settings default-model control (single implementation —
 * both surfaces flip the SAME `default_model`, so they must release the draft pin the same
 * way). Everything else in the draft is preserved; a draft with no cached pick is a no-op.
 */
export function clearDraftModelRef(
  userId: string,
  projectId: string,
  storage: DraftStorage = localStorage,
): void {
  const key = draftKey(userId, projectId);
  const draft = loadDraft(key, storage);
  if (draft.modelRef) saveDraft(key, { ...draft, modelRef: undefined }, storage);
}

/**
 * Drops the draft-cached Agent / Workspace / approval-mode selections for this user ×
 * Project — the fields the `[default_chat]` block seeds — so the next new-conversation
 * draft re-seeds from the just-saved Project defaults instead of the values a previous
 * visit pinned into the cache (the draft page persists all selections on mount, so a
 * stale cache otherwise shadows a defaults change forever). Called by the
 * project-settings save when the block actually changed. Deliberately narrower than the
 * full seeded set: typed text and staged skills are user content; modelRef is the
 * "switch-becomes-default" carry-over released only by clearDraftModelRef when the
 * default MODEL itself changes (the model is not part of the `[default_chat]` block);
 * the handoff/switch chips are explicit user staging, never default-derived. A draft
 * with none of the three fields is a no-op, never an errant write.
 */
export function clearDraftChatDefaults(
  userId: string,
  projectId: string,
  storage: DraftStorage = localStorage,
): void {
  const key = draftKey(userId, projectId);
  const draft = loadDraft(key, storage);
  if (
    draft.agentId !== undefined ||
    draft.workspace !== undefined ||
    draft.approvalMode !== undefined
  ) {
    saveDraft(
      key,
      { ...draft, agentId: undefined, workspace: undefined, approvalMode: undefined },
      storage,
    );
  }
}
