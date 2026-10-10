/**
 * What ssh's own words mean, as one plain sentence a person can act on.
 *
 * Every connection to a machine runs in the background with BatchMode (commands.ts): ssh
 * never asks anything, so whatever it would have asked a person at a terminal comes back as
 * a refusal instead — an unknown host key, a key with a passphrase, a password login. Its
 * diagnostics are precise but written for someone who already knows that: "Host key
 * verification failed." does not say that the cure is to connect once by hand. This reads
 * the diagnostic and leads with the cause and the next step; ssh's own lines follow it,
 * never replaced, since they carry the detail (the address it tried, the key it loaded).
 *
 * Pure: the transport calls it with what ssh printed when a session died, and anything that
 * has such text in hand may call it again — the patterns match ssh's words wherever they sit.
 */

/** Why ssh could not get a session, as far as its words tell. */
export type SshFailureReason =
  /** BatchMode will not accept a host key it has never seen. */
  | "host-key-unknown"
  /** The host presented a different key from the one known_hosts remembers. */
  | "host-key-changed"
  /** The key file named for the host is missing, unreadable, or too open. */
  | "key-file"
  /** Signed in with nothing the host accepted (no key, a passphrase, a password login). */
  | "auth"
  /** The host name does not resolve. */
  | "host-not-found"
  /** Nothing accepts ssh at that address and port. */
  | "refused"
  /** No answer at all: wrong address, a firewall, no route, a jump host that is down. */
  | "timeout"
  /** The connection was dropped before signing in. */
  | "closed"
  /** ssh refused this computer's own config. */
  | "ssh-config";

export interface SshFailure {
  reason: SshFailureReason;
  /** The cause and the next step, in plain words. */
  sentence: string;
}

/** Lines ssh prints on every connection that are not the problem. */
const NOISE = [/^Warning: Permanently added/i, /^\*\*.*\*\*$/, /^@+$/];

/**
 * The lines that carry the diagnosis: non-empty, not ssh's routine notices, the last few.
 * A multi-line warning (a changed host key) is long; its first and last lines say it.
 */
export function sshWords(said: string, max = 3): string {
  const lines = said
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !NOISE.some((noise) => noise.test(line)));
  return lines.slice(-max).join(" ");
}

/**
 * The plain reading of ssh's words, or null when they are not one of the failures ssh has
 * a fixed diagnostic for (the session came up and the far side said something of its own,
 * say). `alias` is the name the person picked, which is what the sentence calls the machine.
 */
export function explainSshFailure(said: string, alias: string): SshFailure | null {
  const has = (pattern: RegExp) => pattern.test(said);
  // Changed before unknown: a changed key also ends in "Host key verification failed."
  if (has(/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for \S+ has changed/i)) {
    return {
      reason: "host-key-changed",
      sentence:
        `${alias} presented a different host key from the one this computer remembers, so ssh ` +
        `refuses to connect. If that machine was reinstalled, remove the old key with ` +
        `\`ssh-keygen -R <its host name>\` and connect once with \`ssh ${alias}\`, then try again.`,
    };
  }
  if (has(/Host key verification failed|No \S+ host key is known for|host key is not known/i)) {
    return {
      reason: "host-key-unknown",
      sentence:
        `This computer has never connected to ${alias}, and connections here cannot answer ` +
        `ssh's question about a new host key. Run \`ssh ${alias}\` once in a terminal on this ` +
        `computer and answer yes, then try again.`,
    };
  }
  if (has(/bad configuration option|bad owner or permissions on|terminating, \d+ bad config/i)) {
    return {
      reason: "ssh-config",
      sentence: `ssh cannot use this computer's ssh config as it is; fix the line it names.`,
    };
  }
  if (
    has(
      /Load key .*: (bad permissions|invalid format|error in libcrypto|No such file)|UNPROTECTED PRIVATE KEY FILE|no such identity/i,
    )
  ) {
    return {
      reason: "key-file",
      sentence:
        `The key file set for ${alias} cannot be used: it is missing, unreadable, or readable ` +
        `by other accounts (ssh wants it 600).`,
    };
  }
  if (has(/Permission denied \(|Too many authentication failures|No supported authentication/i)) {
    return {
      reason: "auth",
      sentence:
        `${alias} did not accept any key this computer offered. Connections here run in the ` +
        `background and cannot type a password or a key's passphrase: put this computer's ` +
        `public key in ${alias}'s ~/.ssh/authorized_keys, or load the key into ssh-agent.`,
    };
  }
  if (
    has(
      /Could not resolve hostname|nodename nor servname|Name or service not known|Temporary failure in name resolution|No address associated with hostname/i,
    )
  ) {
    return {
      reason: "host-not-found",
      sentence: `This computer cannot find ${alias}'s host name. Check its HostName in the ssh config.`,
    };
  }
  if (has(/Connection refused/i)) {
    return {
      reason: "refused",
      sentence: `${alias} refused the connection: nothing accepts ssh at that address and port.`,
    };
  }
  if (has(/timed out|No route to host|Network is unreachable|Host is unreachable/i)) {
    return {
      reason: "timeout",
      sentence:
        `${alias} did not answer. Check its address and port, and that this computer can reach ` +
        `it (a VPN, a firewall, a ProxyJump host).`,
    };
  }
  if (
    has(
      /kex_exchange_identification|Connection closed by .* port|Connection reset by|stdio forwarding failed/i,
    )
  ) {
    return {
      reason: "closed",
      sentence:
        `The connection to ${alias} was dropped before signing in — by that machine, or by ` +
        `something between the two (a jump host, a firewall, sshd's connection limit).`,
    };
  }
  return null;
}

/** The sentence followed by ssh's own lines — what a log line or a job message carries. */
export function sshFailureText(said: string, alias: string): string | null {
  const explained = explainSshFailure(said, alias);
  if (explained === null) return null;
  const words = sshWords(said);
  return words === "" ? explained.sentence : `${explained.sentence} (ssh: ${words})`;
}

/**
 * ssh's words as a person should read them, led by what they mean — whether or not the
 * transport led them already (transport/ssh-session.ts does, for a session that died) — or
 * null when they are not one of ssh's fixed diagnostics.
 */
export function sshRefusal(said: string, alias: string): string | null {
  const explained = explainSshFailure(said, alias);
  if (explained === null) return null;
  const text = said.trim();
  return text.startsWith(explained.sentence) ? text : (sshFailureText(text, alias) ?? text);
}
