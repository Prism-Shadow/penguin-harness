/**
 * Whether a command-policy pattern compiles on this server's engine, and if not, the engine's
 * reason in its own words without the pattern. V8 spells a syntax error as
 * "Invalid regular expression: /<pattern>/<flags>: <reason>", which repeats a pattern of up to
 * 512 characters the caller already holds and buries the reason at its end. Another engine's
 * wording passes through whole.
 */
export function patternSyntaxError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const echoed = `Invalid regular expression: /${pattern}/`;
    if (!message.startsWith(echoed)) return message;
    const rest = message.slice(echoed.length);
    const colon = rest.indexOf(": ");
    return colon === -1 ? message : rest.slice(colon + 2);
  }
}
