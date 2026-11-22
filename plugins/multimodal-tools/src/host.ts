/**
 * What this plugin's server module requires of the host, each declared here as the plugin sees it
 * (the kernel matches a requirement to the host interface that structurally satisfies it, so a
 * plugin names only the members it calls and never imports the server package).
 *
 *   ModelRequests   ProjectModelRequests: one request to a Project model, with its usage recorded
 *   ModelBindings   ToolModelBindings: which model a `[tools]` key names in a Project
 *   ProjectModels   the Project's model table: the default and vision models, each row's client type
 *   ProjectAccess   who may see and who may configure a Project
 *   SessionLookup   the Session index: whose Session an id is, and whether it still exists
 *   DataLayout      the data root's layout: the folder every Project directory lies in
 */
import { Interface } from "@prismshadow/penguin-core/plugin";
import type { Opaque } from "@prismshadow/penguin-core/plugin";
import type { ProjectModelRequest } from "@prismshadow/penguin-core";
import type { UniEvent } from "@prismshadow/mmsp";

/** A configured model, by its pair. */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/** Whom a model request is for and what it is for (`<package>:<operation>`). */
export interface ModelRequestScope {
  projectId: string;
  sessionId?: string;
  purpose: string;
}

@Interface()
export abstract class ModelRequests {
  abstract stream(
    scope: ModelRequestScope,
    model: ModelRef,
    request: Opaque<"ProjectModelRequest", ProjectModelRequest>,
  ): AsyncIterable<Opaque<"UniEvent", UniEvent>>;
}

/** One binding as the host lists it: a plugin's declaration joined with the Project's choice. */
export interface BindingView {
  key: string;
  title: { en: string; zh: string };
  package: string;
  model?: ModelRef;
  candidates: ModelRef[];
}

@Interface()
export abstract class ModelBindings {
  abstract list(projectId: string): Promise<BindingView[]>;
  abstract get(projectId: string, key: string): Promise<ModelRef | undefined>;
}

/** The part of a Project's model table this plugin reads. */
export interface ProjectModelTable {
  /** The Project's default chat model: text generation runs on it while `t2t` names none. */
  defaultModel?: ModelRef;
  /** The model that reads images for a text-only model (`vision_model`): image understanding uses it. */
  visionModel?: ModelRef;
  models: { provider: string; modelId: string; effective: { clientType?: string } }[];
}

@Interface()
export abstract class ProjectModels {
  abstract getModels(projectId: string): Promise<ProjectModelTable>;
}

@Interface()
export abstract class ProjectAccess {
  /** Throws the host's 404 unless the user can see the Project. */
  abstract requireProjectAccess(userId: string, projectId: string): void;
  /** Throws the host's 403 unless the user owns the Project. */
  abstract requireProjectOwner(userId: string, projectId: string): void;
}

@Interface()
export abstract class SessionLookup {
  abstract findById(sessionId: string): { projectId: string } | null;
  abstract listByProject(projectId: string): { sessionId: string }[];
}

/** The data root's layout: where the host keeps the Projects' folders, which may move. */
@Interface()
export abstract class DataLayout {
  /** The folder every Project's folder sits in, one per id. */
  abstract projectsDir(): string;
}
