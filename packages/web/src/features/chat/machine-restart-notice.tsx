/**
 * The line above a conversation's composer while the machine it runs on needs a restart: its
 * history loads, and the replies it writes from now on do not arrive until that machine's server
 * is restarted — the stream behind them keeps asking, and opens once it is. Its action opens the
 * Machines page, where the machine's card says the same and its dialog offers the Restart.
 *
 * Its own component, reading the machines account itself: the chat page does not re-render on
 * every change to the machines list, a running job's log lines among them.
 */
import { useNavigate } from "react-router";
import { Notice } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useMachines } from "../../state/machines";
import { machineRestartNeeded } from "./machine-away";

export function MachineRestartNotice({ machineId }: { machineId: string }) {
  const machines = useMachines();
  const navigate = useNavigate();
  const machine = machineRestartNeeded(machines.state, machineId);
  if (machine === null) return null;
  const words = S.chat.machineRestartNeeded;
  return (
    <Notice
      tone="attention"
      role="status"
      className="mb-2"
      action={{ label: words.open, onClick: () => navigate("/machines") }}
    >
      {words.body(machine.alias)}
    </Notice>
  );
}
