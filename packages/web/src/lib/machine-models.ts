/**
 * The model configuration of a machine, for a page acting on one: a new chat whose workspace is
 * on a machine, or a conversation that lives there.
 *
 * Models are per server, like Agents. A machine runs what its own Project config holds — this
 * server's models as the last sync carried them, minus the ones keyed from this server's
 * environment, plus any of its own — and a Session created there must name one of THOSE: a
 * model only this server has is refused over there. So the picker offers the machine's list, and
 * its default is the machine's default.
 *
 * The machine is asked while it is connected, and again each time it becomes so: the one live
 * account of the machines says when (state/machines.tsx), so a page opened while the machine was
 * coming back fills in the moment it is back. Its last answer is kept in memory for as long as
 * the page lives, so going back and forth between a local and a machine workspace does not blank
 * the picker. Nothing is written to storage: the answer carries the groups' masked keys.
 */
import { useEffect, useState } from "react";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { machineLink } from "./machine-link";
import { useMachines } from "../state/machines";

/** What each machine last answered, by Project and machine. */
const answered = new Map<string, ModelsResponse>();

const keyOf = (projectId: string, machineId: string) => `${projectId}\0${machineId}`;

/**
 * The machine's models: its last answer while it is asked again, null while it has never
 * answered. Null for `machineId` null — the caller holds this server's own.
 */
export function useMachineModels(
  projectId: string | null,
  machineId: string | null,
): ModelsResponse | null {
  const machines = useMachines();
  const link = machineId === null ? null : machineLink(machines.state, machines.settled, machineId);
  const key = projectId === null || machineId === null ? null : keyOf(projectId, machineId);
  const [latest, setLatest] = useState<{ key: string; models: ModelsResponse } | null>(null);

  useEffect(() => {
    if (key === null || projectId === null || machineId === null || link !== "connected") return;
    let cancelled = false;
    api.getModels(projectId, machineId).then(
      (models) => {
        answered.set(key, models);
        if (!cancelled) setLatest({ key, models });
      },
      // A failed read leaves the last answer on offer: the Agent picker beside it says what is
      // the matter with the machine, in the machine's own words.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [key, projectId, machineId, link]);

  if (key === null) return null;
  return latest?.key === key ? latest.models : (answered.get(key) ?? null);
}
