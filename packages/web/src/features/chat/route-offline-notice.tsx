/**
 * What the chat page says for a link to a conversation the list does not hold while the servers
 * that could hold it are out of reach (route-reach.ts: `unanswered`). Only what is known is
 * said: with its machine on record, that the conversation is there and the machine is not
 * connected; without one, that this server does not have it and which silent machines it may be
 * on — never that it exists. The aliases are sorted, so the words change only when the set of
 * silent machines does.
 */
import { EmptyState } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** At most this many silent machines are named. */
const NAMED = 3;

export function RouteOfflineNotice({
  owner,
  offline,
  labels,
}: {
  /** The machine the Session is on record as living on, or null. */
  owner: string | null;
  /** The machines out of reach (no connection, or silent in the list's last round). */
  offline: readonly string[];
  /** machineId → its alias. */
  labels: ReadonlyMap<string, string>;
}) {
  const alias = (id: string) => labels.get(id) ?? id;
  let title: string;
  if (owner !== null) {
    title = S.chat.sessionOnOfflineMachine(alias(owner));
  } else if (offline.length === 0) {
    title = S.chat.sessionOnOfflineMachineUnknown;
  } else {
    const aliases = [...new Set(offline.map(alias))].sort((a, b) => a.localeCompare(b));
    title = S.chat.sessionMaybeOnMachines(aliases.slice(0, NAMED), aliases.length > NAMED);
  }
  return <EmptyState title={title} description={S.chat.sessionOfflineHint} />;
}
