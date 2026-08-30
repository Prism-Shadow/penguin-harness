/**
 * The workspace mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  WorkspaceFileContent,
  WorkspaceFileReadOptions,
  WorkspaceFileStat,
} from "../services/workspace-files-service.js";
import type { WorkspaceFilesResponse } from "../api/types.js";

/** WorkspaceFiles: the mechanism WorkspaceFilesService implements. */
export abstract class WorkspaceFiles extends Interface<{
  statExisting(workspace: string, rels: string[]): Promise<string[]>;
  statExistingWithMtime(workspace: string, rels: string[]): Promise<WorkspaceFileStat[]>;
  list(workspace: string, rel: string): Promise<WorkspaceFilesResponse>;
  read(
    workspace: string,
    rel: string,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
  write(workspace: string, rel: string, data: Buffer<ArrayBufferLike>): Promise<void>;
}>() {}
