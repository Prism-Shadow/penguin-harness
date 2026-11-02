/**
 * What the chat page says for a link to a conversation the list does not hold while the servers
 * that could hold it are out of reach (route-reach.ts: `unanswered`). Only what is known is
 * said: with its machine on record, that the conversation is there and the machine is out of
 * reach; without one, that this server does not have it and which silent machines it may be on —
 * never that it exists. A machine is said to be not connected only when no connection is held to
 * it; one that is connected and did not answer in time is said not to be answering; with none to
 * name, only that it may be on a machine this server cannot reach. The aliases
 * are sorted, so the words change only when the set of silent machines, or which of them are
 * connected, does.
 */
import { EmptyState } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** At most this many silent machines are named. */
const NAMED = 3;

export function RouteOfflineNotice({
  owner,
  offline,
  disconnected,
  labels,
}: {
  /** The machine the Session is on record as living on, or null. */
  owner: string | null;
  /** The machines out of reach (no connection, or silent in the list's last round or the hub's). */
  offline: readonly string[];
  /** The machines no connection is held to; any other out of reach is connected and silent. */
  disconnected: readonly string[];
  /** machineId → its alias. */
  labels: ReadonlyMap<string, string>;
}) {
  const alias = (id: string) => labels.get(id) ?? id;
  const away = (id: string) => disconnected.includes(id);
  let title: string;
  let quiet = false;
  if (owner !== null) {
    quiet = !away(owner);
    title = quiet
      ? S.chat.sessionOnQuietMachine(alias(owner))
      : S.chat.sessionOnOfflineMachine(alias(owner));
  } else if (offline.length === 0) {
    title = S.chat.sessionOnOfflineMachineUnknown;
  } else {
    const aliases = [...new Set(offline.map(alias))].sort((a, b) => a.localeCompare(b));
    const gone = offline.filter(away).length;
    const state = gone === offline.length ? "disconnected" : gone === 0 ? "quiet" : "mixed";
    quiet = state === "quiet";
    title = S.chat.sessionMaybeOnMachines(aliases.slice(0, NAMED), aliases.length > NAMED, state);
  }
  return (
    <EmptyState
      title={title}
      description={quiet ? S.chat.sessionQuietHint : S.chat.sessionOfflineHint}
    />
  );
}
