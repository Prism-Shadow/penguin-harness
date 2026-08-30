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
  /** Where it came from, for display (a gist URL). */
  source: string;
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
  ): Promise<{ gistId: string; url: string; files: number; bytes: number }>;
  /** Reads a gist and validates it as a package, without writing anything. */
  preview(gist: string): Promise<PackagePreview>;
  /** Installs a gist's package as a new Agent in the Project. */
  install(projectId: string, gist: string, agentId: string): Promise<{ agentId: string }>;
  /** Whether a GitHub token is configured (publishing needs one; reading a public gist does not). */
  canPublish(): boolean;
}>() {}
