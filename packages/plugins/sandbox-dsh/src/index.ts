/**
 * @prismshadow/penguin-plugin-sandbox-dsh — the DeepSeek Harness sandbox ecosystem
 * behind this harness's own sandbox interface.
 *
 * A PLUGIN PACKAGE, not part of the platform: a deployment lists it in plugins.json and
 * the harness resolves it from the installation (see the server's plugin/loader.ts).
 * The DSH dependencies live HERE, in this package — the harness itself does not depend
 * on them, which is what "plugins are configuration, not built-in capability" means in
 * dependency terms.
 *
 * `@deepseek-ai/dsh-sandbox-local` carries the platform chain (dsh-bwrap → Landlock on
 * Linux, Seatbelt on macOS, the ACL restricted-token runner on Windows) and probes them
 * functionally; this file translates between its vocabulary and ours. Because DSH's
 * policy vocabulary governs file-write effects only, the adaptor declares exactly
 * `fs-write` — the service therefore never routes a network / mask-paths policy here,
 * and the adaptor never has to drop a dimension it cannot honor.
 *
 * Everything DSH loads behind the dynamic imports below, and that is load-bearing for
 * hot push (see scripts/deploy.mjs): the package reaches native-adjacent modules that a
 * pushed single-file bundle resolves from the installation, so an installation missing
 * them fails THIS load — reported fail-closed by the service — instead of failing the
 * whole platform bundle's import.
 */
import type {
  ConfinedArgv,
  PluginContext,
  SandboxProvider,
} from "@prismshadow/penguin-core/plugin";

/** Mount the stock DSH chain on a bare cordis Context — exactly how DSH's own tests mount it. */
export async function loadDshAdaptor(): Promise<SandboxProvider | null> {
  const { Context } = await import("@deepseek-ai/cordis");
  const { LocalSandboxProvider } = await import("@deepseek-ai/dsh-sandbox-local");
  const cordisCtx = new Context();
  // A cordis plugin, not a Penguin one: `Context.plugin` is cordis's own API, and the two
  // vocabularies share nothing but the word. Hence the name — `ctx` in this package is
  // the PluginContext `activate` receives, below.
  await cordisCtx.plugin(LocalSandboxProvider, {});
  const dsh = cordisCtx.sandbox;
  return {
    // DSH's own words: "Network and process visibility are outside this vocabulary."
    dimensions: ["fs-write"],
    confine(argv, policy): ConfinedArgv {
      const confined = dsh.confine(argv, {
        mode: policy.mode,
        workspaceRoot: policy.workspaceRoot,
      });
      return {
        argv: confined.argv,
        enforcement: confined.enforcement,
        denialSignatures: confined.denialSignatures,
        runnerFailureRules: confined.runnerFailureRules,
      };
    },
  };
}

/** The plugin: registered per App creation, so a hot swap re-registers it. Default export = the plugin. */
export function activate(ctx: PluginContext): void {
  // Backends register per App creation — a hot swap re-registers them into the fresh
  // registry — so the subscription is to the event, not a one-time registration here.
  ctx.on("initialize", (iface) => {
    iface.sandbox.registerProvider("dsh-local", loadDshAdaptor());
  });
}
