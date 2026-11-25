/**
 * A draft's permission defaults: what the server that will run its Session says a new Session
 * starts with. Each server keeps its own Sandbox switch, presets and default preset, so a draft
 * on a machine reads them from that machine's new-chat defaults, never from this server's; the
 * Project's own approval mode rides the same block, which every machine holds a copy of.
 *
 * A create request names an approval mode only when it is a choice — the person's pick, or the
 * Project's — and leaves it out otherwise: the server then starts the Session from its own
 * default preset, which is exactly the default the menu shows here. Sending that default back
 * would pin whatever this page last read, from whichever server it read it, over the default of
 * the server the Session actually runs on.
 */
import { useCallback, useEffect, useState } from "react";
import type { ApprovalMode, ChatDefaultsDto } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";

/** One server's new-chat defaults, as far as a draft knows them. */
export interface TargetDefaults {
  /** The server they are for: null for this one. */
  machine: string | null;
  /** Its answer; null while it is being asked, cannot be reached, or did not answer. */
  answer: ChatDefaultsDto | null;
}

const unanswered = (machine: string | null): TargetDefaults => ({ machine, answer: null });

/**
 * The new-chat defaults of `machine`, asked while `reachable` and again on `reload` (after a
 * save changed them). Only the answer for the machine asked for now is ever returned: one that
 * lands after the draft moved to another machine is dropped.
 */
export function useTargetDefaults(
  projectId: string,
  machine: string | null,
  reachable: boolean,
): { defaults: TargetDefaults; reload: () => void } {
  const [held, setHeld] = useState<TargetDefaults>(() => unanswered(machine));
  const [round, setRound] = useState(0);
  useEffect(() => {
    setHeld((prev) => (prev.machine === machine ? prev : unanswered(machine)));
    if (!reachable) return;
    let cancelled = false;
    // A failed read leaves what was known: nothing yet, or this machine's previous answer.
    api.getChatDefaults(projectId, machine).then(
      (answer) => {
        if (!cancelled) setHeld({ machine, answer });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, machine, reachable, round]);
  // Asked again because what it said changed: until it answers, the old answer is no longer it.
  const reload = useCallback(() => {
    setHeld((prev) => unanswered(prev.machine));
    setRound((n) => n + 1);
  }, []);
  // The render that changes the machine still holds the previous machine's answer.
  return { defaults: held.machine === machine ? held : unanswered(machine), reload };
}

/**
 * The approval mode a draft's create request names: the person's pick, else the Project's (from
 * the target's block, or this server's copy while the target has not answered). Undefined lets
 * the server running the Session start it from its own default preset.
 */
export function requestedApproval(
  pick: ApprovalMode | null,
  target: TargetDefaults,
  localPin: ApprovalMode | undefined,
): ApprovalMode | undefined {
  if (pick !== null) return pick;
  return target.answer !== null ? target.answer.approvalMode : localPin;
}

/**
 * The approval mode the permission button shows: the request's, else the target's default
 * preset's, else the server's own fallback. Null until the target has answered, so the button
 * never draws a mode borrowed from another server.
 */
export function shownApproval(
  pick: ApprovalMode | null,
  target: TargetDefaults,
  localPin: ApprovalMode | undefined,
): ApprovalMode | null {
  if (target.answer === null) return null;
  return (
    requestedApproval(pick, target, localPin) ??
    target.answer.sandbox?.defaultApprovalMode ??
    "allow-all"
  );
}
