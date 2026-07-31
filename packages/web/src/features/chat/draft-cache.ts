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
export interface DraftCache {
  text?: string;
  agentId?: string;
  workspace?: string;
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
    const parsed: unknown = JSON.parse(raw);
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
