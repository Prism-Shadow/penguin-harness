import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AudioTarget, AudioResult } from "../activities/audio.js";
import type { ImageRequest } from "../activities/image.js";
import type {
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  CollectionManifest,
} from "../activities/domain.js";

export abstract class ActivityGeneration extends Interface<{
  shutdown(): Promise<void>;
  start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    module?: { wafRoot?: string; audio?: { language: string; assetKey: string; voice: string } },
  ): Promise<ActivityRun>;
  list(projectId: string, activityId: string): Promise<ActivityRunSummary[]>;
  candidate(projectId: string, activityId: string, runId: string): Promise<string | null>;
  cancel(projectId: string, activityId: string, runId: string): Promise<ActivityRun>;
  acceptAudio(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  audioContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array>;
}>() {}

export abstract class ActivityAuthoring extends Interface<{
  imageContent(
    projectId: string,
    activityId: string,
    input: ImageRequest,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
  storeAudio(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<AudioResult>;
  readAudio(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array>;
  applyAudio(
    projectId: string,
    activityId: string,
    target: AudioTarget,
    result: AudioResult,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  prepareAudioMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void>;
  planMedia(
    projectId: string,
    activityId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  applyMedia(
    projectId: string,
    activityId: string,
    manifest: unknown,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  ensureCollection(projectId: string, collectionId?: string): Promise<CollectionManifest>;
  listActivities(projectId: string, collectionId?: string): Promise<ActivityRecord[]>;
  createActivity(
    projectId: string,
    input: {
      collectionId?: string;
      productCode: unknown;
      refNum: unknown;
      title: string;
      activityType?: "standard" | "book";
    },
  ): Promise<ActivityRecord & { draft: ActivityDraft }>;
  getActivity(
    projectId: string,
    activityId: string,
  ): Promise<ActivityRecord & { draft: ActivityDraft }>;
  updateDescription(
    projectId: string,
    activityId: string,
    description: string,
    expectedRevision?: string,
  ): Promise<ActivityDraft>;
  applySpec(
    projectId: string,
    activityId: string,
    spec: unknown,
    expectedRevision?: string,
  ): Promise<ActivityDraft>;
  draftWorkspace(
    projectId: string,
    collectionId: string,
    activityId: string,
    draftId: string,
  ): string;
}>() {}
