/**
 * Whether a command-policy pattern compiles on this runtime's engine, and if not, the
 * engine's reason in its own words without the pattern. Three places ask: the server's save
 * check (refuse it), the server's read of the policy (mark the rule on the settings page),
 * and the matcher (skip the rule). V8 spells a syntax error as
 * "Invalid regular expression: /<pattern>/<flags>: <reason>", which repeats a pattern of up
 * to 512 characters the caller already holds and buries the reason at its end; another
 * engine's wording passes through whole.
 */
export function commandPolicyPatternError(pattern: string): string | null {
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
