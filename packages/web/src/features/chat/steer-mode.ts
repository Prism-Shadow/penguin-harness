/**
 * Mid-run send mode: steer (delivered mid-run as a [user_steering] input), follow-up (queued
 * server-side until the run ends) or interrupt (the run is stopped and the message sent right
 * after the turn it cut). A preference of the account, cached in this browser under
 * `penguin.steerMode` for the composer's first render (lib/account-sync); configurable from the
 * composer's "+" menu in draft state and active sessions alike.
 */
import { writeCached } from "../../lib/account-sync/cache";

export type SteerMode = "steer" | "followup" | "interrupt";

export const STEER_MODE_KEY = "penguin.steerMode";

/** The cached mode; anything but an explicit follow-up or interrupt — absent, unknown, unreadable — is steer, the default. */
export function readSteerMode(storage?: Pick<Storage, "getItem">): SteerMode {
  try {
    const mode = (storage ?? localStorage).getItem(STEER_MODE_KEY);
    return mode === "followup" || mode === "interrupt" ? mode : "steer";
  } catch {
    return "steer";
  }
}

/** A user's choice: cached here and carried to the account. */
export function writeSteerMode(mode: SteerMode): void {
  try {
    writeCached(STEER_MODE_KEY, mode);
  } catch {
    // Storage refused: the choice holds for this composer and is not kept.
  }
}
