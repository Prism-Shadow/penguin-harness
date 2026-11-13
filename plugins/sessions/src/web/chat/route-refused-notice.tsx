/**
 * What the chat page says for a link to a conversation whose machine will not show it to this
 * server (403 `session_forbidden` from the lookup): the conversation is there, so it is neither
 * gone nor out of reach — the machine is named, from the machines list when it knows it, else as
 * the answer named it.
 */
import { EmptyState } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export function RouteRefusedNotice({
  machineId,
  alias,
  labels,
}: {
  /** The refusing machine, as the answer names it. */
  machineId: string | null;
  alias: string | null;
  /** machineId → its alias, from the machines list. */
  labels: ReadonlyMap<string, string>;
}) {
  const name = (machineId !== null ? labels.get(machineId) : undefined) ?? alias ?? machineId;
  return (
    <EmptyState
      title={S.chat.sessionRefused(name ?? null)}
      description={S.chat.sessionRefusedHint}
    />
  );
}
