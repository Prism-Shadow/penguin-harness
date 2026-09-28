/**
 * The App's half of the player's inspector bridge (the page's half is in the server's
 * `sandbox-player.ts`): the played activity reports each state it enters and what can be
 * tapped, and the App may ask for one tap target to be outlined.
 *
 * Everything that arrives is untrusted. The page runs a module's code, written by an agent
 * or by Loom, so a message counts only when it comes from the player's own frame, only in
 * the one shape the bridge sends, and only as plain text of bounded size. Nothing in it is
 * ever rendered as markup or used as a selector on the App's side.
 */

export const STATE_MESSAGE = "penguin-sandbox:activity-state";
export const HIGHLIGHT_MESSAGE = "penguin-sandbox:highlight-interactable";
export const PICK_MODE_MESSAGE = "penguin-sandbox:pick-mode";
export const PICKED_MESSAGE = "penguin-sandbox:picked";

/** The framework's report of where the activity is. */
export interface PlayerState {
  index: number;
  phase: string;
  sceneId: string;
  state: string;
}

export interface PlayerInteractable {
  id: string;
  inputType: "CLICK" | "SELECT" | "SELECT_CLICK" | "DRAG";
  event?: string;
  description?: string;
}

export interface PlayerReport {
  state: PlayerState;
  interactables: PlayerInteractable[];
}

/** Longer than any real id or state name; anything past it is not worth showing. */
const MAX_TEXT = 200;
/** A scene with more tap targets than this is not one an author reads as a list. */
const MAX_INTERACTABLES = 100;

const INPUT_TYPES = new Set(["CLICK", "SELECT", "SELECT_CLICK", "DRAG"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_TEXT ? value : null;
}

function interactable(value: unknown): PlayerInteractable | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const inputType = record.inputType;
  if (!id || typeof inputType !== "string" || !INPUT_TYPES.has(inputType)) return null;
  const event = text(record.event);
  const description = text(record.description);
  return {
    id,
    inputType: inputType as PlayerInteractable["inputType"],
    ...(event ? { event } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * The report a message carries, or null when it is not one: from anywhere but the
 * player's frame, of another type, or not in the bridge's shape.
 */
export function readPlayerReport(
  data: unknown,
  source: unknown,
  frame: unknown,
): PlayerReport | null {
  if (!frame || source !== frame) return null;
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type !== STATE_MESSAGE) return null;
  const detail = message.detail as Record<string, unknown> | null | undefined;
  if (!detail || typeof detail !== "object") return null;
  const phase = text(detail.phase);
  const sceneId = text(detail.sceneId);
  const state = text(detail.state);
  if (!Number.isInteger(detail.index) || phase === null || sceneId === null || state === null)
    return null;
  const listed = Array.isArray(message.interactables) ? message.interactables : [];
  const interactables = listed
    .slice(0, MAX_INTERACTABLES)
    .map(interactable)
    .filter((entry): entry is PlayerInteractable => entry !== null);
  return { state: { index: detail.index as number, phase, sceneId, state }, interactables };
}

/** The request to outline one tap target, or to clear the outline with null. */
export function highlightMessage(id: string | null): { type: string; id: string | null } {
  return { type: HIGHLIGHT_MESSAGE, id };
}

/**
 * What an author clicked while picking: the ids from the clicked element out to the
 * activity (nearest first, `id` being the nearest), and the tap target it belongs to.
 */
export interface PlayerPick {
  id: string | null;
  ids?: string[];
  interactableId: string | null;
}

/** The page reports at most this many ids for one click. */
const MAX_PICK_IDS = 8;

/** The pick a message carries, under the same rules as a state report. */
export function readPlayerPick(data: unknown, source: unknown, frame: unknown): PlayerPick | null {
  if (!frame || source !== frame) return null;
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type !== PICKED_MESSAGE) return null;
  const listed = Array.isArray(message.ids) ? message.ids : [];
  const ids = listed
    .slice(0, MAX_PICK_IDS)
    .map((value) => text(value))
    .filter((value): value is string => !!value);
  const id = text(message.id) || ids[0] || null;
  if (id && !ids.includes(id)) ids.unshift(id);
  const interactableId = text(message.interactableId) || null;
  return id || interactableId ? { id, ids, interactableId } : null;
}

/** Switch picking on or off in the player. */
export function pickModeMessage(on: boolean): { type: string; on: boolean } {
  return { type: PICK_MODE_MESSAGE, on };
}
