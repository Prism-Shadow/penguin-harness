/**
 * Agent packages: an Agent's DEFINITION as a set of text files, publishable to a GitHub
 * gist and installable from one.
 *
 * A package is what makes the Agent what it is — its system config, prompt, skills, tools
 * and workflows — and deliberately not what it has become: memory, workspaces, scratchpad,
 * traces, benchmark results, a workflow's `state.json`, the version history, and never the
 * vault. Installing a package on another harness yields the same Agent with nothing lived
 * in it, which is what makes one shareable.
 *
 * A gist is a flat set of text files, so paths are flattened into file names (`a/b.md` →
 * `a--b.md`) and `penguin-agent.json` carries the manifest that maps them back. That keeps
 * a published Agent readable and diffable on the gist page — the reason to choose a gist
 * over an opaque archive at all.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** One packaged file: text as-is, anything else base64 (`encoding`). */
export interface PackageFile {
  /** Path inside the Agent directory, e.g. `agent_state/AGENTS.md`. */
  path: string;
  /** The gist file name this path flattens to. */
  file: string;
  encoding: "utf8" | "base64";
  content: string;
}

export interface PackageManifest {
  /** Package format version; 1 today. */
  format: number;
  agentId: string;
  name: string;
  description: string;
  /** Harness version that produced it (provenance only — never a gate). */
  packagedBy: string;
  packagedAt: string;
  files: Array<Pick<PackageFile, "path" | "file" | "encoding">>;
}

/** How this server can publish: through the machine's `gh` CLI, a stored token, or not at all. */
export type PublishMethod = "gh" | "token" | null;

/** The gist an Agent was published to, remembered next to the Agent itself. */
export interface PublishedGist {
  gistId: string;
  url: string;
  publishedAt: string;
  /** Hash of what was published; a republish of the same thing skips the API entirely. */
  digest?: string;
}

export interface AgentPackage {
  manifest: PackageManifest;
  files: PackageFile[];
  /** Total bytes of file content, for the size cap and for display. */
  bytes: number;
}

/** What a package looks like before it is installed: the manifest plus what it would write. */
export interface PackagePreview {
  manifest: PackageManifest;
  bytes: number;
  /** Where it came from, for display (`gist:<id>`, `npm:<name>@<version>`, `github:o/r#ref`, …). */
  source: string;
  /** How the source was read. */
  kind: "gist" | "npm" | "github-release" | "github" | "git" | "url";
  /** An id for the new Agent: the manifest's, or the source's name when there is no manifest. */
  suggestedId: string;
}

export abstract class AgentPackages extends Interface<{
  /** The Agent's definition as a package (never its state, never the vault). */
  pack(projectId: string, agentId: string): Promise<AgentPackage>;
  /**
   * Publishes the package as a gist; `gistId` updates that gist in place instead of
   * creating one (so an Agent keeps its URL across republishes).
   */
  publish(
    projectId: string,
    agentId: string,
    options: { gistId?: string; public: boolean },
  ): Promise<{
    gistId: string;
    url: string;
    files: number;
    bytes: number;
    /** True when the gist already held exactly this, so nothing was written. */
    unchanged: boolean;
  }>;
  /**
   * Reads a source and validates it as a package, without writing anything. A source is a
   * gist link or id, `npm:<name>[@version]`, a GitHub repository or release (URL or
   * `github:o/r[#ref]` / `github-release:o/r[#tag]`), a git URL, or an http(s) URL of a
   * tarball; `kind` forces one reading when the shape is ambiguous.
   */
  preview(source: string, kind?: string): Promise<PackagePreview>;
  /** Installs a source's package as a new Agent in the Project. */
  install(
    projectId: string,
    source: string,
    agentId: string,
    kind?: string,
  ): Promise<{ agentId: string }>;
  /**
   * How publishing would authenticate: `gh` when the machine's CLI is logged in, `token`
   * when one is stored, null when neither — reading a public gist needs neither.
   */
  publishMethod(): Promise<PublishMethod>;
  /** The gist this Agent was published to before, so a republish updates it. */
  publishedGist(projectId: string, agentId: string): Promise<PublishedGist | null>;
}>() {}
