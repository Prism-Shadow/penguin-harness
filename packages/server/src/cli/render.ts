/**
 * Terminal color for the server-backed commands' shared helpers (server-session, org):
 * the same palette the CLI's renderer uses, decided once per process from stdout.
 */

export interface Palette {
  readonly dim: string;
  readonly green: string;
  readonly red: string;
  readonly cyan: string;
  readonly magenta: string;
  readonly reset: string;
}

const ANSI_PALETTE: Palette = {
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  reset: "\x1b[0m",
};

const PLAIN_PALETTE: Palette = { dim: "", green: "", red: "", cyan: "", magenta: "", reset: "" };

/**
 * Whether ANSI color should be emitted on `stream`: requires a TTY with `NO_COLOR`
 * unset/empty and `TERM` other than `dumb`; a non-empty `FORCE_COLOR` overrides all of that —
 * `"0"` forces plain, anything else forces color (Node's own semantics, where `FORCE_COLOR`
 * defeats `NO_COLOR`). Keeps a piped nested CLI — `penguin run` driven through
 * `exec_command` — from leaking escapes into tool output (#102).
 */
export function supportsColor(
  stream: { isTTY?: boolean | undefined },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== "") return force !== "0";
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return stream.isTTY === true;
}

/** The palette for one output stream, decided once per renderer rather than per write. */
function paletteFor(stream: NodeJS.WritableStream): Palette {
  return supportsColor(stream as { isTTY?: boolean }) ? ANSI_PALETTE : PLAIN_PALETTE;
}

/** stdout's palette, decided at startup: the default for the standalone helpers below (hosts write their own notices to stdout). */
const STDOUT_PALETTE = paletteFor(process.stdout);

export function dim(text: string, c: Palette = STDOUT_PALETTE): string {
  return `${c.dim}${text}${c.reset}`;
}
