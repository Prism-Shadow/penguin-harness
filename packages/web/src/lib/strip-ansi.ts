/**
 * ANSI escape stripping for raw command/tool output display.
 *
 * The command tools harden the child environment against color (`NO_COLOR=1`, `TERM=dumb`,
 * inherited `FORCE_COLOR` removed — see core's command session-manager), but traces recorded
 * before that fix and programs that force color unconditionally can still carry escape
 * sequences (#102). The chat surface therefore strips them defensively at RENDER time only —
 * stored trace/stream data is never mutated.
 */

/**
 * One complete ANSI escape sequence:
 * - CSI: `ESC [` + parameter bytes (0x30–0x3F) + intermediate bytes (0x20–0x2F) + one final
 *   byte (0x40–0x7E) — covers SGR color codes such as `\x1b[36m` and `\x1b[1;31m`.
 * - OSC: `ESC ]` + payload, terminated by BEL or ST (`ESC \`) — window titles, hyperlinks.
 * - Other Fe escapes: `ESC` + one byte in 0x40–0x5F (minus `[` / `]`, handled above).
 */
const ANSI_SEQUENCE = /\x1b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\^_])/g;

/**
 * An incomplete escape sequence at end-of-string: chunks reassemble into one aggregated
 * string before rendering, but live output can still pause mid-sequence, so a trailing bare
 * `ESC`, unfinished CSI (`ESC [ 3`) or unterminated OSC is dropped rather than shown as
 * garbage; once the tail arrives the whole sequence is removed by the pattern above.
 */
const ANSI_TRAILER = /\x1b(?:\[[0-9:;<=>?]*[ -/]*|\][^\x07]*)?$/;

/** Strips ANSI escape sequences for display. Fast path: input without an ESC byte is returned as-is (same reference). */
export function stripAnsi(text: string): string {
  if (!text.includes("\x1b")) return text;
  return text.replace(ANSI_SEQUENCE, "").replace(ANSI_TRAILER, "");
}
