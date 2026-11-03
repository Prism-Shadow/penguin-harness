/**
 * Where a conversation's messaging binding runs, and what the editor may do about it from here.
 *
 * A binding belongs to the server that runs its Session: that server stores it, opens the
 * connection to the platform, starts the Task an inbound message asks for and sends the reply.
 * For a Session on a machine that is the machine, and it keeps doing all of that while this
 * server is away — so this browser edits it through the machine's proxy, and only while the
 * machine can be asked (the one live account of the machines says when, `lib/machine-link.ts`).
 * Out of reach, the editor asks nothing and shows what the machine last answered, read-only.
 *
 * Turning a bot on is checked against every server this one can see first: a bot connected in
 * two places fights itself (two Telegram pollers knock each other off; on the other channels one
 * message can reach both servers and be answered twice). The check is advisory on purpose — a
 * machine that cannot be asked does not block the enable, it is named afterwards.
 */
import type {
  MessagingAccountHolder,
  MessagingBindingInfo,
  MessagingUnreachableMachine,
} from "@prismshadow/penguin-server/api";
import type { MachineLink } from "../../lib/machine-link";
import { formatDateTime } from "../../lib/format";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";

/** The server a Session's binding lives on: a machine, or this server (null). */
export function bindingLocation(sessionId: string): { machineId: string | null } {
  return { machineId: machineForSession(sessionId) };
}

/** Whether the editor may ask the binding's server anything now, and if not, what it says. */
export interface EditorAccess {
  /** Calls may go out: this server's Session, or a machine's that is connected. */
  live: boolean;
  /**
   * The notice over a read-only editor; null while live, and while the machines list has not
   * answered yet — waiting says nothing, it only holds the first call back.
   */
  reason: string | null;
}

/**
 * The editor's access for a binding on `link`'s machine (null: this server, which always
 * answers). `alias` names the machine in the notice; `asOf` is when the state the editor shows
 * was last read from it (null: never, in this browser).
 */
export function editorAccess(
  link: MachineLink | null,
  alias: string,
  asOf: string | null,
): EditorAccess {
  if (link === null || link === "connected") return { live: true, reason: null };
  if (link === "unknown") return { live: false, reason: null };
  if (link === "missing") return { live: false, reason: S.messaging.machineMissing };
  return {
    live: false,
    reason: S.messaging.machineUnreachable(
      alias,
      link,
      asOf === null ? null : formatDateTime(asOf),
    ),
  };
}

/**
 * The holder that refuses an enable on `target` (a machine id, or null for this server): one on
 * any other server. A holder on the target itself refuses nothing here — that server's own
 * route decides between its own conversations, and says so itself.
 */
export function holderConflict(
  holders: readonly MessagingAccountHolder[],
  target: string | null,
): { alias: string | null } | null {
  const other = holders.find((holder) => holder.machineId !== target);
  return other === undefined ? null : { alias: other.alias };
}

/**
 * What an enable says about the machines that could not be asked, or null when every one was.
 * The target itself is left out: whatever it holds, its own route has already answered for.
 */
export function holdersNote(
  unreachable: readonly MessagingUnreachableMachine[],
  target: string | null,
): string | null {
  const others = unreachable.filter((machine) => machine.machineId !== target);
  return others.length === 0 ? null : S.messaging.holdersUnchecked(others);
}

/** The bot a binding signs in as: the channel's public account id, never a secret. */
export function accountIdOf(binding: MessagingBindingInfo): string {
  return binding.channel === "telegram" || binding.channel === "wechat"
    ? binding.botId
    : binding.appId;
}
