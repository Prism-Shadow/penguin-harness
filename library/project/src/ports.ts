/**
 * The ports the projects domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Providers in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
@Interface()
export abstract class ProjectPaths {
  abstract root: string;
}

/** The preinstalled built-in modules a new Project lists (PRFC-0030). The server's `PluginModules` satisfies this structurally. */
@Interface()
export abstract class ProjectPreinstall {
  /** Lists the Project's preinstalled built-in modules in its own plugin table, which may re-assemble the App. */
  abstract preinstall(projectId: string): Promise<void>;
}

/** The seeds built-in plugins ship for their system apps' data, written once at creation. The server's `AppSeeds` satisfies this structurally. */
@Interface()
export abstract class ProjectAppSeeds {
  abstract seedProject(projectId: string): Promise<void>;
}

/**
 * One user's open user-channel stream, as the notifier publishes to it — the same surface
 * the server's hub hands out (server `Channel`).
 */
export interface ProjectChannel {
  publish(data: unknown, event?: string): void;
}

/**
 * The user channels, as the Project events notifier reaches them: one open stream per user
 * key, peeked at — never opened — so publishing reaches only a user who has the event stream
 * open (the server's `Channels` hub satisfies it).
 */
export interface ProjectChannels {
  /** The user's open user-channel stream, or undefined when none is open. */
  peekUser(userId: string): ProjectChannel | undefined;
}
