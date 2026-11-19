/**
 * The workspace mechanisms: what a node may require, declared apart from what implements it.
 * The WorkspaceFiles mechanism moved to the workspace domain library
 * (services+http+cli restack S4) and is re-exported here unchanged; FileReveal stays with
 * its server-side service.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

export { WorkspaceFiles } from "@prismshadow/penguin-library-workspace/contract";

/** FileReveal: opening a path in the machine's file manager, as RevealService implements it. */
@Interface()
export abstract class FileReveal {
  abstract reveal(filePath: string): Promise<void>;
}
