/**
 * Why the embedded server stopped while it was starting, in its own words: the last `Error:`
 * lines it printed. A server that refuses to start prints its reason as such a line — the data
 * root's layout migration does (a Project called `projects`, a folder that cannot be moved) — and
 * exits before it announces its port, so the start dialog would otherwise say only that it
 * exited. Read the way the server reads a machine's start log (machines/server-control.ts).
 */

/** The reason lines of `output`, the server's stderr; null when it printed none. */
export function startFailureReason(output: string): string | null {
  const errors = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:\w*Error|error)\b.*:/.test(line));
  return errors.length > 0 ? errors.slice(-2).join("\n") : null;
}

/**
 * A start that failed for a reason the server gave. Its stack is its message: the dialog shows
 * `stack`, and the shell's own frames say nothing about why the server stopped.
 */
export class ServerStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerStartError";
    this.stack = message;
  }
}
