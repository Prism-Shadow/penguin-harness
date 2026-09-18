import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ProjectActivityWork, Projects } from "../mechanisms/projects.js";
import { HttpError } from "../http/errors.js";

/** Shared admission boundary for activity writes and every Project destruction path. */
@Component()
export class ProjectActivityWorkService implements ProjectActivityWork {
  @Use() private readonly projects!: Projects;
  private readonly pending = new Map<string, Set<Promise<unknown>>>();
  private readonly deletions = new Map<string, Promise<void>>();

  run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (this.deletions.has(projectId))
      return Promise.reject(new HttpError(409, "project_deleting", "Project is being deleted."));
    if (!this.projects.findById(projectId))
      return Promise.reject(new HttpError(404, "project_not_found", "Project not found."));
    const pending = this.pending.get(projectId) ?? new Set<Promise<unknown>>();
    this.pending.set(projectId, pending);
    const result = Promise.resolve().then(operation);
    pending.add(result);
    void result
      .finally(() => {
        pending.delete(result);
        if (!pending.size) this.pending.delete(projectId);
      })
      .catch(() => {});
    return result;
  }

  destroy(projectId: string, operation: () => Promise<void>): Promise<void> {
    const existing = this.deletions.get(projectId);
    if (existing) return existing;
    // Seal admission before yielding, including starts that haven't created a Session yet.
    const result = Promise.allSettled([...(this.pending.get(projectId) ?? [])])
      .then(operation)
      .finally(() => this.deletions.delete(projectId));
    this.deletions.set(projectId, result);
    return result;
  }
}
