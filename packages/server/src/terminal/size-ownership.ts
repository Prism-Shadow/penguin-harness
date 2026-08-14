/**
 * Terminal size ownership (Paseo's `terminal-size-ownership.ts`).
 *
 * A pty has exactly one size, but a terminal can be attached from several places at once
 * (two browser tabs, a phone, a leftover background tab). If every attachment simply
 * applied its own geometry, the smallest idle viewport would keep squashing the one the
 * user is actually typing into.
 *
 * So size has a single claimant. Focusing or interacting sends `claim`, which transfers
 * ownership even when the dimensions are identical; subsequent geometry changes from that
 * same connection send `update`. An `update` from any other connection is ignored.
 */

export interface TerminalSizeState {
  ownerId: string | null;
  cols: number;
  rows: number;
}

export interface TerminalSizeRequest {
  connectionId: string;
  cols: number;
  rows: number;
  intent: "claim" | "update";
}

export interface TerminalSizeDecision {
  state: TerminalSizeState;
  /** Whether the pty should actually be resized. */
  apply: boolean;
}

export function applyTerminalSize(
  state: TerminalSizeState,
  request: TerminalSizeRequest,
): TerminalSizeDecision {
  if (request.intent === "update" && state.ownerId !== request.connectionId) {
    return { state, apply: false };
  }
  const nextState: TerminalSizeState = {
    ownerId: request.connectionId,
    cols: request.cols,
    rows: request.rows,
  };
  const unchanged = state.cols === request.cols && state.rows === request.rows;
  return { state: nextState, apply: !unchanged };
}

/** Ownership is released when the owning connection goes away, so the next claimant wins. */
export function releaseTerminalSize(
  state: TerminalSizeState,
  connectionId: string,
): TerminalSizeState {
  return state.ownerId === connectionId ? { ...state, ownerId: null } : state;
}
