/**
 * A machine's alias for its id — what a plug is labelled with. The machines list is the
 * Project's, so it is fetched once per mount and the id stands in until it answers (or when
 * the machine has dropped out of the ssh config, where the raw id is the honest label).
 */
import { useEffect, useState } from "react";
import { getMachines } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { useProject } from "../../state/project";

export function useMachineName(machineId: string): string {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    let live = true;
    void getMachines(projectId)
      .then((state) => {
        const found = state.machines.find((m) => m.machineId === machineId);
        if (live && found !== undefined) setName(found.alias);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId, machineId]);
  return name ?? (machineId === "" ? S.ports.machine : machineId);
}
