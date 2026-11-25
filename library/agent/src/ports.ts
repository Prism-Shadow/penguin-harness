/**
 * The ports the agent domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Provider in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
@Interface()
export abstract class AgentPaths {
  abstract root: string;
}

/** The snapshots service's log surface: one line at a time (the server's `Log` satisfies it). */
@Interface()
export abstract class SnapshotLog {
  abstract line(text: string): void;
}

/** The snapshots service's clock (the server's `Clock` satisfies it). */
@Interface()
export abstract class SnapshotClock {
  abstract now(): Date;
}

/** Where the harness root is, for the snapshots service (the server's `Paths` satisfies it). */
@Interface()
export abstract class SnapshotPaths {
  abstract root: string;
}
