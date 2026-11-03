/**
 * Who has a bot account enabled, across the servers this one can see: the fleet half of the
 * one-connection-per-account rule.
 *
 * A server already refuses a second enable of one account among its own Sessions (the state
 * route's 409 `account_enabled_elsewhere`). An account has one event stream wherever it is
 * polled from, so the same account enabled on this server and on a machine it connects, or on
 * two machines, races just the same: Telegram answers the second poller with 409, and Feishu and
 * QQ deliver each event twice. The Web App asks here before it turns a bot on, and refuses when
 * another server holds it; this module answers who that is.
 *
 * What a server holds is its enabled bindings whose Session still exists. That is the reading the
 * state route's guard makes: it releases a binding whose Session is gone instead of refusing on
 * it, so naming such a binding here would refuse with nothing left to turn off. An answer carries
 * the channel and the account id only, and both are public. A machine that cannot be asked is
 * listed apart with the reason and never guessed at; the caller decides what to do about it.
 */
import type {
  MessagingAccount,
  MessagingAccountHolder,
  MessagingAccountHoldersResponse,
  MessagingChannel,
  MessagingUnreachableMachine,
  MessagingUnreachableReason,
} from "../../api/types.js";
import type { MachineApi } from "../../machines/machine-api.js";
import type { MessagingBindings } from "../../mechanisms/messaging.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import { isMessagingChannel } from "./enabled-channel.js";

/** Where a server answers its enabled accounts (GET, admin only). */
export const MESSAGING_ACCOUNTS_PATH = "/api/messaging/accounts";

/** The bot accounts this server has enabled, once each, whatever Project their Sessions are in. */
export function enabledAccounts(
  bindings: Pick<MessagingBindings, "listAll">,
  sessions: Pick<SessionIndex, "findById">,
): MessagingAccount[] {
  const seen = new Set<string>();
  const out: MessagingAccount[] = [];
  for (const row of bindings.listAll()) {
    if (!row.enabled || !isMessagingChannel(row.channel)) continue;
    if (sessions.findById(row.sessionId) === null) continue;
    const key = `${row.channel}:${row.accountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ channel: row.channel, accountId: row.accountId });
  }
  return out;
}

/** Whether `accounts` names this channel's account. */
export function holdsAccount(
  accounts: readonly unknown[],
  channel: MessagingChannel,
  accountId: string,
): boolean {
  return accounts.some((item) => {
    const account = item as Partial<MessagingAccount> | null;
    return account?.channel === channel && account.accountId === accountId;
  });
}

/** A machine the Project uses, with a client to its API while it is connected (null otherwise). */
export interface FleetMachine {
  machineId: string;
  alias: string;
  api: Pick<MachineApi, "request"> | null;
}

/** What one machine said: whether it holds the account, or why it could not be asked. */
type MachineAnswer = { holds: boolean } | { unreachable: MessagingUnreachableReason };

/**
 * The accounts list out of a machine's answer, or null when the answer is not that shape. Items
 * are compared, not trusted: one this build cannot read simply never matches.
 */
function accountsOf(text: string): unknown[] | null {
  try {
    const accounts: unknown = (JSON.parse(text) as { accounts?: unknown } | null)?.accounts;
    return Array.isArray(accounts) ? accounts : null;
  } catch {
    return null;
  }
}

/**
 * One machine asked. A 404 is a build from before the accounts route existed: it is the one
 * answer a current build never gives an admin, and it is common for as long as a machine has not
 * been reconnected since this server upgraded (every connect brings the machine onto this build).
 */
async function askMachine(
  api: Pick<MachineApi, "request">,
  channel: MessagingChannel,
  accountId: string,
): Promise<MachineAnswer> {
  let answer: { status: number; text: string };
  try {
    answer = await api.request("GET", MESSAGING_ACCOUNTS_PATH);
  } catch {
    return { unreachable: "failed" };
  }
  if (answer.status === 404) return { unreachable: "older_build" };
  if (answer.status !== 200) return { unreachable: "failed" };
  const accounts = accountsOf(answer.text);
  if (accounts === null) return { unreachable: "failed" };
  return { holds: holdsAccount(accounts, channel, accountId) };
}

/**
 * The holders of one account: this server when `heldHere`, then each machine that says it holds
 * it, in the order given. The machines are asked at once; each request carries the machine API's
 * own deadline, so one silent machine costs at most that and holds no other answer back.
 */
export async function findAccountHolders(args: {
  heldHere: boolean;
  machines: readonly FleetMachine[];
  channel: MessagingChannel;
  accountId: string;
}): Promise<MessagingAccountHoldersResponse> {
  const answers = await Promise.all(
    args.machines.map((machine): Promise<MachineAnswer> =>
      machine.api === null
        ? Promise.resolve({ unreachable: "not_connected" })
        : askMachine(machine.api, args.channel, args.accountId),
    ),
  );
  const holders: MessagingAccountHolder[] = args.heldHere ? [{ machineId: null, alias: null }] : [];
  const unreachable: MessagingUnreachableMachine[] = [];
  args.machines.forEach(({ machineId, alias }, i) => {
    const answer = answers[i]!;
    if ("unreachable" in answer) unreachable.push({ machineId, alias, reason: answer.unreachable });
    else if (answer.holds) holders.push({ machineId, alias });
  });
  return { holders, unreachable };
}
