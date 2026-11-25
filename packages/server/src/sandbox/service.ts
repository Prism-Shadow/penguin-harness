/**
 * The sandbox capability: the service that routes each spawn's policy to whatever backend
 * implements it. Reached from hmr/platform.ts, so it rides the platform bundle — a
 * deployment changes it by one hot push.
 *
 * The vocabulary it routes ON is not here. `SandboxPolicy`, `SandboxProvider`,
 * `ConfinedArgv` and the mode/dimension unions belong to the plugin contract in
 * `@prismshadow/penguin-core/plugin`, because a backend is written against those names
 * and nothing else. What this directory holds is the embedder's half: which policy reaches
 * which backend, the settings behind it, and the fail-closed behaviour when nothing covers
 * the request.
 *
 * The service itself and its capability interface are `@prismshadow/penguin-library-sandbox` —
 * what stays here is the MODULE half: the assembly that collects the backends the plugins
 * registered and reads the plugin host by them, which only the harness's plugin machinery can do.
 *
 * No backend is part of it. Backends are PLUGIN PACKAGES a deployment configures
 * (../plugin/loader.ts), which is why nothing here imports one and why the harness does
 * not depend on the DSH ecosystem at all:
 *
 *   sandbox service  ←  registered backends  ←  the Projects' plugin lists
 *
 * The backends shipped in this repo:
 *
 *   plugin                            platform   fs-write  network  mask-paths
 *   @penguinharness/sandbox-bwrap     Linux      yes       yes      yes
 *   @penguinharness/sandbox-seatbelt  macOS      yes       yes      yes
 *   @penguinharness/sandbox-wsl       Windows    yes       yes      yes
 *   @penguinharness/sandbox-dsh       all three  yes       —        —
 *
 * The DSH adaptor is the portable floor covering file effects only (its own chain picks
 * bwrap/Landlock, Seatbelt or the Windows ACL runner per host); the three native
 * backends add the other two dimensions, one per platform, and serve every policy they cover
 * when the adaptor is mounted beside them. On Linux the adaptor is the floor where bubblewrap
 * is refused (Ubuntu 23.10 and later restrict unprivileged user namespaces to AppArmor-profiled
 * programs): it confines files through Landlock, which needs neither. Windows is served by bubblewrap
 * inside a dedicated WSL2 distro, so commands there run in Linux (see sandbox-wsl's README).
 * Where none implements a requested dimension, the service fails closed naming what each
 * covers rather than quietly confining less than was asked.
 */
import { Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Json } from "@prismshadow/penguin-core/kernel";
import type { SandboxProviderSource, SandboxSettings } from "@prismshadow/penguin-core/plugin";
import { SandboxService } from "@prismshadow/penguin-library-sandbox/service";
import type { Sandbox, SandboxSlots } from "@prismshadow/penguin-library-sandbox/service";
import { pluginHostFrom, pluginPackageOf } from "../plugin/host.js";

export { SandboxService } from "@prismshadow/penguin-library-sandbox/service";
export type { Sandbox, SandboxSlots } from "@prismshadow/penguin-library-sandbox/service";

@Module({
  context: {
    version: 1,
    schema: {
      "settings?": {
        mode: "'read-only'|'workspace-write'|'danger-full-access'",
        "network?": "'none'|'local'",
        "maskPaths?": "string[]",
        "writableTemp?": "boolean",
      },
    },
  },
})
export class SandboxModule {
  @Provide() sandbox!: Sandbox;
  setup({ contributions, resources }: ClassCtx, context: Json) {
    const providers = (contributions.providers ?? []).map(
      (c) =>
        [c.data.name as string, c.code as SandboxProviderSource] as [string, SandboxProviderSource],
    );
    const contributor = new Map(
      (contributions.providers ?? []).map((c) => [c.data.name as string, c.from]),
    );
    // The plugin host is claimed per read: what this generation loaded is recorded on it.
    const sandbox = new SandboxService(providers, (name) => {
      const from = contributor.get(name);
      return from === undefined ? undefined : pluginPackageOf(pluginHostFrom(resources), from);
    });
    // Parked settings ride the swap: without this every push would construct a fresh
    // service on defaults and silently un-confine a confining deployment.
    const parked = (context as { settings?: SandboxSettings } | null)?.settings;
    if (parked !== undefined) sandbox.configure(parked);
    this.sandbox = sandbox;
  }

  park(): Json {
    const settings = this.sandbox.parkedSettings();
    return settings === undefined ? null : { settings };
  }
}
