/**
 * What this server last put on each machine — `<data root>/machines-models-sync.json`.
 *
 * The sync runs when a machine is connected, which used to mean it ran once and never again:
 * a tunnel deliberately outlives a hot push, so an App that boots with the machine already
 * connected does not reconnect it, and nothing else asked. A machine connected before a
 * credential was added here therefore never received it — which is not a state anybody can
 * see, because the machine looks connected and healthy the whole time.
 *
 * So the sync also runs on boot. That turns the opposite problem on: a push happens many
 * times an hour, and re-sending an unchanged table each time would re-write the Project
 * config on every machine and invalidate their cached runtimes for nothing.
 *
 * This file is what makes the boot pass cheap. It records a fingerprint of THIS side's
 * contribution — the models we would send and the pointers we would set — per machine and
 * Project. Matching fingerprints mean the sync would be a no-op, and it is skipped BEFORE
 * anything reaches for ssh, which is the saving that matters: signing in on a machine costs a
 * connection and an scp, and a boot must not spend those to discover there was nothing to do.
 *
 * It records what WE sent, not what the machine has. Somebody editing models over there is
 * drift this will not notice — the honest correction for that is connecting again, which
 * always syncs.
 */
import { createHash } from "node:crypto";
import type { LocalModels } from "./models-sync.js";

/** machine address → Project id → fingerprint of the last table sent. */
export type ModelSyncState = Record<string, Record<string, string>>;

/**
 * A fingerprint of THIS side's contribution — deliberately not of the merged table.
 *
 * The merged table depends on what the machine currently has, which cannot be known without
 * asking it, which cannot be done without ssh. Fingerprinting our half instead is what makes
 * the check answerable from local disk alone, and it is the right half anyway: the machine
 * gaining an entry of its own does not mean ours needs re-sending.
 *
 * Keys are inside it on purpose. A rotated credential is the change most worth catching, and
 * it is invisible in every other field.
 */
export function fingerprintLocal(local: LocalModels): string {
  return createHash("sha256").update(JSON.stringify(local)).digest("hex").slice(0, 32);
}

/** Parses the file. Damage reads as "nothing sent yet", which only costs one extra sync. */
export function parseModelSyncState(raw: string | null): ModelSyncState {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: ModelSyncState = {};
    for (const [address, projects] of Object.entries(parsed)) {
      if (typeof projects !== "object" || projects === null || Array.isArray(projects)) continue;
      const inner: Record<string, string> = {};
      for (const [projectId, print] of Object.entries(projects)) {
        if (typeof print === "string" && print !== "") inner[projectId] = print;
      }
      out[address] = inner;
    }
    return out;
  } catch {
    return {};
  }
}

/** The file's next text after recording what one machine received. */
export function withModelSyncState(
  raw: string | null,
  address: string,
  prints: Record<string, string>,
): string {
  const all = parseModelSyncState(raw);
  all[address] = { ...all[address], ...prints };
  return JSON.stringify(all, null, 2) + "\n";
}
