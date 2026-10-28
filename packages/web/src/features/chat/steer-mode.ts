/**
 * Mid-run send mode: steer (delivered mid-run as a [user_steering] input) vs follow-up (queued
 * server-side until the run ends). A preference of the account, cached in this browser under
 * `penguin.steerMode` for the composer's first render (lib/account-sync); configurable from the
 * composer's "+" menu in draft state and active sessions alike.
 */
import { writeCached } from "../../lib/account-sync/cache";

export type SteerMode = "steer" | "followup";

export const STEER_MODE_KEY = "penguin.steerMode";

/** The cached mode; anything but an explicit follow-up — absent, unknown, unreadable — is steer, the default. */
export function readSteerMode(storage?: Pick<Storage, "getItem">): SteerMode {
  try {
    return (storage ?? localStorage).getItem(STEER_MODE_KEY) === "followup" ? "followup" : "steer";
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
