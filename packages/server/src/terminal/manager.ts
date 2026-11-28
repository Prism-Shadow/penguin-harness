/**
 * Terminal registry: create / look up / list / kill, plus the lifetime rules.
 *
 * The registry itself moved to the terminals domain package
 * (@prismshadow/penguin-library-terminal/manager, terminals restack S17) and is re-exported
 * below so the server's existing importers keep their spelling. What stays here is the
 * TerminalModule: the assembly that binds the manager to this server's own capabilities —
 * the hmr assets, the Session environment's PATH shims, the settings' limit, the machine
 * relay and the routes.
 */
import type { ClassCtx, Json } from "@prismshadow/penguin-core/kernel";
import { Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import { TerminalManager, type Terminals } from "@prismshadow/penguin-library-terminal/manager";
import type { TerminalSession } from "@prismshadow/penguin-library-terminal/session";
import { terminalRoutes } from "@prismshadow/penguin-library-terminal/routes";
import { identityFrom } from "@prismshadow/penguin-library-terminal/identity";
import { shellStartupDir } from "@prismshadow/penguin-library-terminal/shell-startup";
import {
  shimNamesDataRoot,
  terminalCliNotice,
} from "@prismshadow/penguin-library-terminal/cli-notice";
import { readResourceLimit } from "@prismshadow/penguin-library-setting/resource-limits";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { Auth } from "@prismshadow/penguin-library-auth";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { RemoteTerminals } from "@prismshadow/penguin-library-machine/terminal-relay";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import type { Config, Hmr, ResourceGroups } from "../hmr/capabilities.js";
import type { SessionEnv } from "../runtime/session-manager.js";

export * from "@prismshadow/penguin-library-terminal/manager";

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "TerminalModule.routes",
        prefix: "/",
        auth: "none",
        order: 0,
      },
    ],
  },
  context: {
    version: 1,
    schema: {
      "terminals?": "string[]",
    },
  },
})
export class TerminalModule {
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly config!: Config;
  /** The directories every Agent command finds first on PATH; a terminal gets the same. */
  @Use() private readonly sessionEnv!: SessionEnv;
  @Use() private readonly resourceGroups!: ResourceGroups;
  @Use() private readonly auth!: Auth;
  @Use() private readonly access!: Access;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly settings!: Settings;
  /** Answers `get` for a pty on a machine (the machines domain's terminal relay). */
  @Use() private readonly remote!: RemoteTerminals;
  @Provide() terminals!: Terminals;
  @Bind("TerminalModule.routes") routes!: ReturnType<typeof terminalRoutes>;
  setup({ resources, effect }: ClassCtx, context: Json) {
    const terminals = new TerminalManager(resources, {
      // A pushed bundle's node-pty binaries live where the host materialized them.
      assets: () => this.hmr.assetsDir() ?? null,
      unpackAssets: unpackedAssetsDir,
      maxOpen: () => readResourceLimit(this.settings, "terminalMaxOpen"),
      beyond: (id) => this.remote.get(id) as TerminalSession | undefined,
      // `penguin` in a terminal is the one the Agent's commands get: this harness's own.
      pathFirst: () => {
        const dirs = this.sessionEnv.pathPrepend();
        return dirs.length === 0 ? null : { dirs, startupDir: shellStartupDir(this.config.root) };
      },
      // And the terminal says which one that is on a development instance, or why it is not.
      notice: () => terminalCliNotice(this.config, this.sessionEnv.pathPrepend()),
      // The shell keeps the server's data root only where no shim names it for `penguin`.
      inheritDataRoot: () => !shimNamesDataRoot(this.config, this.sessionEnv.pathPrepend()),
    });
    // Shells started before this App existed are still running in the registry: claim
    // them back so a push is invisible to whoever was typing in one — unless their group
    // is doomed, in which case this build cannot speak the contract behind those handles.
    const parked = (context as { terminals?: string[] } | null)?.terminals ?? [];
    terminals.adopt(this.resourceGroups.adoptable("TerminalModule") ? parked : []);
    // Deliberately NOT disposing the terminals at swap: the shells are resources, and
    // outliving a swap is the whole point. Only the reap timers stop with this App.
    effect(() => terminals.quiesce());
    this.terminals = terminals;
    this.routes = terminalRoutes(terminals, identityFrom(this.auth), {
      access: this.access,
      sessions: this.sessions,
    });
  }

  park(): Json {
    return { terminals: this.terminals.handleIds() };
  }
}
