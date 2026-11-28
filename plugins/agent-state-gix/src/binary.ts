/**
 * The native half, loaded once per process.
 *
 * The build lays the addon at `native/index.node` (the platform's cdylib under the one name),
 * so the runtime needs no platform table — the package ships the addon built for the platform
 * it runs on.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface NativeIdentityInput {
  name: string;
  email: string;
  whenSeconds: number;
  whenOffsetMinutes: number;
}

export interface NativeTreeEntry {
  rel: string;
  oid: string;
  mode: string;
  size?: number;
}

export interface NativeHistoryEntry {
  commit: string;
  tree: string;
  committerTime: number;
}

export interface NativeExtractResult {
  files: string[];
  totalBytes: number;
}

export interface NativeRepoCommitFileInput {
  rel: string;
  filePath?: string;
  body?: Uint8Array;
  mode?: string;
}

export interface NativeRepoCommitInput {
  parent?: string;
  prefix: string;
  changeKind: "replace" | "patch";
  files?: NativeRepoCommitFileInput[];
  remove?: string[];
  message: string;
  author: NativeIdentityInput;
  committer: NativeIdentityInput;
}

export interface NativeRepo {
  resolveHead(): Promise<{ refName: string; commit?: string }>;
  listTree(commitOid: string, prefix: string, withSize: boolean): Promise<NativeTreeEntry[] | null>;
  walkHistory(
    fromCommit: string,
    prefix: string,
    limit: number,
    maxWalk: number,
  ): Promise<NativeHistoryEntry[]>;
  extractTree(
    commitOid: string,
    prefix: string,
    destDir: string,
    onlyPaths?: string[],
  ): Promise<NativeExtractResult>;
  prepareCommit(input: NativeRepoCommitInput): Promise<{ commit: string; tree: string }>;
  casRef(refName: string, newCommit: string, expectedParent?: string): Promise<void>;
  close(): void;
}

/** The addon's surface, as `native/src/lib.rs` declares it. */
export interface Native {
  engineVersion(): string;
  openRepo(gitdir: string): Promise<NativeRepo>;
  commit(input: {
    gitdir: string;
    refName: string;
    parent?: string;
    rel: string;
    files?: Array<{ rel: string; body: Uint8Array }>;
    message: string;
    author: NativeIdentityInput;
    committer: NativeIdentityInput;
  }): Promise<string>;
  readObjects(gitdir: string, oids: string[]): Promise<Array<Uint8Array | null>>;
}

export function loadNative(): Native {
  return require(path.join(root, "native", "index.node")) as Native;
}
