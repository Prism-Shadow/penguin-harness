/**
 * Module-code versions: the builds Penguin already keeps, one per succeeded assembly run.
 * Lists them with their file counts, compares two builds file by file, and pins the one the
 * preview plays ("Play this build") until it is unpinned.
 *
 * The pin is a field of the draft (`pinnedModuleRunId`), so it lasts across restarts; the
 * sandbox reads it to choose the module it serves. It is not part of the draft's revision, so
 * a pin never makes a candidate, a stage or a deploy out of date.
 */
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Config } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { ActivityDraft } from "./domain.js";
import type { ModuleBuild, ModuleBuildDiff, ModuleBuildList } from "./module-build-types.js";
import { compareModuleBuilds, moduleBuildFileCount, playingBuild } from "./module-builds.js";
import { sandboxModuleRoot } from "./sandbox-paths.js";

export type { ModuleBuild, ModuleBuildDiff, ModuleBuildList } from "./module-build-types.js";

export abstract class ActivityModuleBuilds extends Interface<{
  /** The activity's builds, newest first, with the pinned one and the one the preview plays. */
  list(projectId: string, activityId: string): Promise<ModuleBuildList>;
  /** What differs going from build `from` to build `to`, file by file. */
  diff(projectId: string, activityId: string, from: string, to: string): Promise<ModuleBuildDiff>;
  /** Make the preview play build `runId` until it is unpinned. Returns the draft. */
  pin(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  /** Make the preview play the newest build again. Returns the draft. */
  unpin(projectId: string, activityId: string, expectedRevision: string): Promise<ActivityDraft>;
}>() {}

@Component()
export class ActivityModuleBuildService implements ActivityModuleBuilds {
  @Use() private readonly authoring!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly config!: Config;

  async list(projectId: string, activityId: string): Promise<ModuleBuildList> {
    const activity = await this.authoring.getActivity(projectId, activityId);
    const builds = await this.generation.moduleBuilds(projectId, activityId);
    const listed: ModuleBuild[] = [];
    // Counted, not read: a build's files are only hashed when two builds are compared.
    for (const [index, run] of builds.entries())
      listed.push({
        runId: run.runId,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        files: await moduleBuildFileCount(this.root(run.runId)),
        newest: index === 0,
      });
    const pinned = activity.draft.pinnedModuleRunId ?? null;
    return {
      builds: listed,
      pinnedRunId: pinned,
      playingRunId: playingBuild(builds, pinned)?.runId ?? null,
    };
  }

  async diff(
    projectId: string,
    activityId: string,
    from: string,
    to: string,
  ): Promise<ModuleBuildDiff> {
    const builds = await this.generation.moduleBuilds(projectId, activityId);
    for (const runId of [from, to])
      if (!builds.some((run) => run.runId === runId)) throw notFound();
    return compareModuleBuilds(
      { runId: from, root: this.root(from) },
      { runId: to, root: this.root(to) },
    );
  }

  async pin(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    const builds = await this.generation.moduleBuilds(projectId, activityId);
    if (!builds.some((run) => run.runId === runId)) throw notFound();
    return this.authoring.pinModuleRun(projectId, activityId, runId, expectedRevision);
  }

  async unpin(
    projectId: string,
    activityId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.authoring.pinModuleRun(projectId, activityId, null, expectedRevision);
  }

  private root(runId: string): string {
    return sandboxModuleRoot(path.join(this.config.root, "activity-runs", runId));
  }
}

function notFound(): HttpError {
  return new HttpError(
    404,
    "module_build_not_found",
    "That run is not a module build of this activity.",
  );
}
