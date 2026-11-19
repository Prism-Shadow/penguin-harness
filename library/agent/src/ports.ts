/**
 * The ports the agent domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Provider in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
export abstract class AgentPaths extends Interface<{ readonly root: string }>() {}
