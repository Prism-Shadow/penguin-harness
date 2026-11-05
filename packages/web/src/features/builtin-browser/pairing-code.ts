/**
 * The pairing code this window shows, shared by the pairing dialog and the Browser panel's
 * inline pairing steps. One per window, because the server keeps one live code per user and a
 * new one replaces the last: two surfaces each asking for their own would leave one of them
 * showing a dead code.
 *
 * A code is asked for when a surface shows and none is held, or the one held has under a
 * minute left; "New code" replaces it outright. The Chrome connecting uses it up, and the next
 * surface to show asks again.
 */
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

export type PairingCodeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; code: string; expiresAt: string }
  | { status: "failed"; error: string };

/** A code with less than this left is not shown: it could lapse while it is being pasted. */
const FRESH_FOR_MS = 60_000;

let current: PairingCodeState = { status: "idle" };
const listeners = new Set<() => void>();

function set(next: PairingCodeState): void {
  current = next;
  for (const listener of [...listeners]) listener();
}

/** The code as it stands (the useSyncExternalStore snapshot). */
export function pairingCode(): PairingCodeState {
  return current;
}

export function subscribePairingCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a ready code has lapsed at `now`. */
export function pairingCodeExpired(state: PairingCodeState, now: number): boolean {
  return state.status === "ready" && Date.parse(state.expiresAt) <= now;
}

/**
 * Asks the server for a code unless one is on its way or a fresh one is held; `replace` asks
 * for a new one whatever is held. A failure is kept, with the reason, until the next ask.
 */
export async function ensurePairingCode(replace = false, now = Date.now()): Promise<void> {
  if (!replace) {
    if (current.status === "loading") return;
    if (current.status === "ready" && Date.parse(current.expiresAt) - now > FRESH_FOR_MS) return;
  }
  set({ status: "loading" });
  try {
    const { code, expiresAt } = await api.createBrowserPairingCode();
    set({ status: "ready", code, expiresAt });
  } catch (err) {
    set({ status: "failed", error: apiErrorText(err) });
  }
}

/** The Chrome connected: the code is spent, and the next pairing asks for a new one. */
export function forgetPairingCode(): void {
  if (current.status !== "idle") set({ status: "idle" });
}
