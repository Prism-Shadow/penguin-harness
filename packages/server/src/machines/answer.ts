/**
 * Reading what a machine answered.
 *
 * Every command this side runs over ssh is now a `penguin` subcommand that prints one line of
 * JSON, so there is one way to read one: find the line that is the answer, and ignore the
 * rest. The rest is real — sshd runs the command in a shell that may greet, warn about
 * pending updates, or print an MOTD, and none of that belongs to the machine's reply.
 *
 * `key` is what distinguishes the answer from any other object a shell might print. It is
 * also why "no answer at all" is a distinct outcome rather than a default: a build too old
 * for the subcommand prints an error, and reading that as a well-formed "no" would turn every
 * such machine into a silently wrong one.
 */

/** The machine's answer, or null when nothing it printed is one. */
export function jsonAnswer<T>(stdout: string, key: string): T | null {
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && key in parsed) return parsed as T;
    } catch {
      // Not this line.
    }
  }
  return null;
}
