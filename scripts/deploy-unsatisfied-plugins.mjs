/**
 * How deploy.mjs reads a push the target refused because the build cannot run every plugin
 * installed there, split out for the same reason as deploy-target-safety.mjs: deploy.mjs
 * runs on import, and these decisions are worth a test.
 *
 * The target refuses such a push with 409 `plugins_unsatisfied` and the list; sent again
 * with the header below, the push goes through and the target runs without them. The names
 * are the server's (packages/server/src/hmr/push-plugins.ts), restated because this script
 * runs before anything is built.
 */

/** The request header by which a pusher accepts running without those plugins, and its value. */
export const UNSATISFIED_PLUGINS_HEADER = "x-penguin-unsatisfied-plugins";
export const LEAVE_OUT = "leave-out";

const isPlugin = (p) =>
  typeof p === "object" &&
  p !== null &&
  typeof p.specifier === "string" &&
  typeof p.disabled === "boolean" &&
  typeof p.reason === "string";

/** The plugins a refused push names, or null when the answer is not that refusal. */
export function refusedPlugins(status, text) {
  if (status !== 409) return null;
  try {
    const error = JSON.parse(text)?.error;
    if (error?.code !== "plugins_unsatisfied" || !Array.isArray(error.plugins)) return null;
    return error.plugins.filter(isPlugin);
  } catch {
    return null;
  }
}

/** The plugins an accepted push ran without, as its outcome names them; empty when none. */
export function leftOutPlugins(outcome) {
  const list = outcome?.unsatisfiedPlugins;
  return Array.isArray(list) ? list.filter(isPlugin) : [];
}

/** One line per plugin: what becomes of it and why. `done` words it as having happened. */
export function pluginLines(plugins, done = false) {
  return plugins.map((p) => {
    const what = p.disabled
      ? done
        ? "disabled"
        : "would be disabled"
      : done
        ? "runs without part of itself"
        : "would run without part of itself";
    return `  - ${p.specifier}: ${what} — ${p.reason}`;
  });
}

/**
 * What a refusal leads to: a question where someone can answer it, otherwise a stop that
 * names the flag — a script must not decide this on a person's behalf.
 */
export function refusalStep(interactive) {
  return interactive ? "ask" : "needs-force";
}

/** Whether the answer to a [y/N] question is a yes. Anything else, a closed input included, is a no. */
export function saidYes(answer) {
  return /^(y|yes)$/i.test(String(answer ?? "").trim());
}
