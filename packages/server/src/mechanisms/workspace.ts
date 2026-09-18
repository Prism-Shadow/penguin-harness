/**
 * The workspace mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  WorkspaceFileContent,
  WorkspaceFileReadOptions,
  WorkspaceFileStat,
} from "../services/workspace-files-service.js";
import type { WorkspaceFilesResponse, WorkspaceSearchResponse } from "../api/types.js";

/** WorkspaceFiles: the mechanism WorkspaceFilesService implements. */
@Interface()
export abstract class WorkspaceFiles {
  abstract statExisting(workspace: string, rels: string[]): Promise<string[]>;
  abstract statExistingWithMtime(workspace: string, rels: string[]): Promise<WorkspaceFileStat[]>;
  abstract list(workspace: string, rel: string): Promise<WorkspaceFilesResponse>;
  abstract read(
    workspace: string,
    rel: string,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
  abstract write(
    workspace: string,
    rel: string,
    data: Buffer<ArrayBufferLike>,
    ifVersion?: string,
  ): Promise<void>;
  abstract move(workspace: string, from: string, to: string, ifVersion?: string): Promise<void>;
  abstract remove(workspace: string, rel: string, ifVersion?: string): Promise<void>;
  abstract search(workspace: string, q: string): Promise<WorkspaceSearchResponse>;
  abstract resolvePath(workspace: string, rel: string): Promise<string>;
}

/** FileReveal: opening a path in the machine's file manager, as RevealService implements it. */
@Interface()
export abstract class FileReveal {
  abstract reveal(filePath: string): Promise<void>;
}
