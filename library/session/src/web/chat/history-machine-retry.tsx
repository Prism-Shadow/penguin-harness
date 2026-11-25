import { RetryStatus } from "@prismshadow/penguin-ui";
import { RetryStatus } from "@prismshadow/penguin-ui";
import type { RetryAction } from "@prismshadow/penguin-ui";
import { api, retryStatus, toastApiError, useMachines } from "@prismshadow/penguin-web/internal";
import type { MachineAway } from "./machine-away";

export function HistoryMachineRetry({
  projectId,
  away,
}: {
  projectId: string | null;
  away: MachineAway;
}) {
  const machines = useMachines();
  if (!away.retry || !away.machine || !projectId) return null;
  const entry = away.machine;
  const ask = async (send: typeof api.reconnectMachine) => {
    try {
      machines.accept(await send(projectId, entry.id));
    } catch (err) {
      toastApiError(err);
      throw err;
    }
  };
  return (
    <RetryStatus
      {...retryStatus(away.retry, {
        onRetry: () => ask(api.reconnectMachine),
        onStop: () => ask(api.stopReconnectingMachine),
        held: false,
        size: "sm",
      })}
      className="justify-center text-left"
    />
  );
}
