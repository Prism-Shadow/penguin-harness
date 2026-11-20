/**
 * The data root's deleting folders: a folder is moved aside in one rename and removed from there
 * in the background, a few filesystem calls at a time (tree-purge.ts), so a large one never
 * stalls the requests the server answers meanwhile. A Project's folders wait in its Agents
 * folder's `.deleting/`, which the Agent service removes again at every start; a folder outside
 * every Project waits in a `.deleting/` beside it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Log } from "../hmr/capabilities.js";
import { DataLayout } from "../mechanisms/data-layout.js";
import type { DeletingFolders, DeletingPlace } from "../mechanisms/deleting-folders.js";
import { DELETING_DIR } from "./agent-service.js";
import { FsLimiter, purgeTree } from "./tree-purge.js";

/**
 * Filesystem calls the removals keep in flight together. libuv gives file I/O four threads by
 * default; two leave the rest to the requests the server is answering meanwhile.
 */
const PURGE_SLOTS = 2;

/** A label kept to the id alphabet, so the moved folder's name is one the start-time sweep takes. */
function tidy(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "folder";
}

@Component()
export class DeletingFoldersService implements DeletingFolders {
  @Use() private readonly layout!: DataLayout;
  @Use() private readonly log!: Log;
  private readonly limiter = new FsLimiter(PURGE_SLOTS);
  /** Ends this generation's removals when it is disposed; what is left waits for a resume. */
  private readonly stopping = new AbortController();

  setup(ctx: ClassCtx) {
    ctx.effect(() => this.stopping.abort());
  }

  deletingDirIn(within: string): string {
    return path.join(within, DELETING_DIR);
  }

  moveAside(abs: string, place: DeletingPlace, label: string): string | null {
    const dir =
      "projectId" in place
        ? this.layout.deletingDir(place.projectId)
        : this.deletingDirIn(place.within);
    // Ends in a timestamp like an Agent deletion's name, and is unique.
    const name = `${tidy(label)}-${randomBytes(4).toString("hex")}-${Date.now()}`;
    const target = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.renameSync(abs, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return target;
  }

  async purge(moved: readonly string[]): Promise<void> {
    for (const folder of moved) {
      if (this.stopping.signal.aborted) return;
      const failure = await purgeTree(folder, {
        limiter: this.limiter,
        signal: this.stopping.signal,
      }).catch((err: unknown) => ({ failed: 1, error: (err as Error).message }));
      if (failure !== null) this.log.line(`[deleting] ${folder}: ${failure.error}`);
    }
  }

  async resume(within: string): Promise<void> {
    const dir = this.deletingDirIn(within);
    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    await this.purge(names.map((name) => path.join(dir, name)));
  }
}
