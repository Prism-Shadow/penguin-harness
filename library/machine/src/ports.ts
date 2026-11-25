/**
 * The shapes the machines domain carries across its own boundary but does not own: a pushed
 * build's body, as the upgrade hand-over and the install images pack and unpack it. The server
 * satisfies the writing and reading of one (its push seam, hmr/pushed-build.ts) through the
 * assembly; the shapes live here so nothing here imports the server.
 */

/**
 * A pushed build's body: the platform and CLI bundles, the web dist's file map, and the native
 * assets a platform resolves node-pty from (with the files that must keep their exec bit).
 */
export interface MachinePushedBuild {
  platform: string;
  cli: string;
  web: { files: Record<string, string> };
  assets?: { files: Record<string, string>; exec?: string[] };
  source?: { repo: string; revision: string };
}

/** Lays one pushed build's store down under `<staging>/hmr`, answering the harness.json's bytes. */
export type MachineBuildWriter = (
  hmrDir: string,
  build: MachinePushedBuild,
  at: Date,
) => Promise<string>;

/** Reads this server's own pushed build, or null when it runs its packaged build (nothing to hand on). */
export type MachineBuildReader = (dataRoot: string) => Buffer | null;
