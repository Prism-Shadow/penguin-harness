import { RetryStatus } from "@prismshadow/penguin-ui";
import type { RetryAction } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { toastApiError } from "../../lib/toast-api-error";
import { useMachines } from "../../state/machines";
import { retryStatus } from "@prismshadow/penguin-library-machine/web";
import type { MachineAway } from "./machine-away";

/**
 * The machine's own retry row, for a conversation on it: the server's attempt and the countdown
 * to the next, with Retry now and Stop retrying while it runs and Retry once it stopped. `rest`
 * is the quieter press the row offers in place of Stop retrying once nothing runs; `reason` keeps
 * the last failure after the sentence, which a compact surface leaves to the Machines page.
 */
export function HistoryMachineRetry({
  projectId,
  away,
  rest = null,
  reason = true,
  className = "justify-center text-left",
}: {
  projectId: string | null;
  away: MachineAway;
  rest?: RetryAction | null;
  reason?: boolean;
  className?: string;
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
  const row = retryStatus(away.retry, {
    onRetry: () => ask(api.reconnectMachine),
    onStop: () => ask(api.stopReconnectingMachine),
    held: false,
    size: "sm",
    ...(reason ? {} : { reason: null }),
  });
  return (
    <RetryStatus
      {...row}
      secondary={row.secondary ?? (away.retry.offers.stop ? null : rest)}
      className={className}
    />
  );
}
