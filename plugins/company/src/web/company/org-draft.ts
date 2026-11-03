/**
 * The create-organization dialog's draft: what was typed, kept in localStorage so an
 * accidental close, a reload or a switch back to development mode does not lose a mission
 * someone spent minutes on. It is a DRAFT, not a preference — it is written on every edit,
 * restored when the dialog reopens and dropped the moment the organization is created (or
 * the user clears it).
 *
 * Scoped by user and by Project: two people on one browser must not see each other's draft,
 * and a draft belongs to the Project it was aimed at (its Workspace and model are that
 * Project's). Storage is injectable (work-mode.ts convention: vitest runs in Node with no
 * localStorage) and every read degrades to "no draft" rather than throwing at a dialog open.
 */
import type { ModelRefDto } from "@prismshadow/penguin-server/api";

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The dialog's fields, exactly as typed — `ceoBudget` stays the raw text so a half-typed number survives. */
export interface OrgCreateDraft {
  orgId: string;
  name: string;
  mission: string;
  workspace: string;
  model: ModelRefDto | null;
  ceoBudget: string;
}

export const EMPTY_ORG_DRAFT: OrgCreateDraft = {
  orgId: "",
  name: "",
  mission: "",
  workspace: "",
  model: null,
  ceoBudget: "",
};

/** The draft's storage key. One key per (user, Project); a signed-out browser gets its own bucket. */
export function orgDraftKey(userId: string | null, projectId: string): string {
  return `penguin.orgCreateDraft.${userId ?? ""}.${projectId}`;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A stored model reference, or null for anything that is not one (a truncated write, an older shape). */
function parseModel(v: unknown): ModelRefDto | null {
  if (v === null || typeof v !== "object") return null;
  const { provider, modelId } = v as { provider?: unknown; modelId?: unknown };
  if (typeof provider !== "string" || typeof modelId !== "string") return null;
  if (provider === "" || modelId === "") return null;
  return { provider, modelId };
}

/**
 * A stored draft, field by field. Anything unexpected (not JSON, not an object, a field of
 * the wrong type) contributes its empty value instead of rejecting the whole draft: the
 * mission is the expensive field, and losing it because the model reference was mangled
 * would be the worst possible trade.
 */
export function parseOrgDraft(raw: string | null): OrgCreateDraft | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const d = parsed as Record<string, unknown>;
  const draft: OrgCreateDraft = {
    orgId: str(d.orgId),
    name: str(d.name),
    mission: str(d.mission),
    workspace: str(d.workspace),
    model: parseModel(d.model),
    ceoBudget: str(d.ceoBudget),
  };
  return hasContent(draft) ? draft : null;
}

/**
 * Whether a draft is worth storing or restoring at all. A form the user only opened and
 * closed has nothing in it, and offering to "clear" that would be noise; the CEO budget is
 * left out of the test because the dialog prefills it, so it is not something the user typed.
 */
export function hasContent(draft: OrgCreateDraft): boolean {
  return (
    draft.orgId.trim() !== "" ||
    draft.name.trim() !== "" ||
    draft.mission.trim() !== "" ||
    draft.workspace.trim() !== "" ||
    draft.model !== null
  );
}

export function serializeOrgDraft(draft: OrgCreateDraft): string {
  return JSON.stringify(draft);
}

export function loadOrgDraft(key: string, storage?: DraftStorage): OrgCreateDraft | null {
  try {
    return parseOrgDraft((storage ?? localStorage).getItem(key));
  } catch {
    return null;
  }
}

/** Writes the draft, or removes it when there is nothing left in it to keep. */
export function saveOrgDraft(key: string, draft: OrgCreateDraft, storage?: DraftStorage): void {
  try {
    const store = storage ?? localStorage;
    if (hasContent(draft)) store.setItem(key, serializeOrgDraft(draft));
    else store.removeItem(key);
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

export function clearOrgDraft(key: string, storage?: DraftStorage): void {
  try {
    (storage ?? localStorage).removeItem(key);
  } catch {
    /* best-effort */
  }
}
