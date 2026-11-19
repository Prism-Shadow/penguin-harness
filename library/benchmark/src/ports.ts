/**
 * The ports the benchmark domain's service needs from the server's assembly. The server binds
 * them to its own mechanisms (see the Provider in packages/server); the package defines the
 * shapes so it never imports the server.
 */

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
export interface BenchmarkPaths {
  readonly root: string;
}
