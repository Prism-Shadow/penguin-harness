import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AudioTarget, AudioResult } from "../activities/audio.js";
import type { ImageRequest } from "../activities/image.js";
import type { ImageTarget, ImageResult } from "../activities/generated-image.js";
import type { MediaTextTarget } from "../activities/media-text.js";
import type { AssistFocus, AssistProposal, ProposalChange } from "../activities/assist.js";
import type { UploadedMedia } from "../activities/upload.js";
import type { BundleItem, ProjectMediaListing } from "../activities/media-library-types.js";
import type { ImportOutcome } from "../activities/import-apply.js";
import type { ImportedActivity } from "../activities/loom-import.js";
import type { ImplementationFeature } from "../activities/implementation-features.js";
import type { ReadinessCheck } from "../activities/readiness-types.js";
import type { ImportMapping } from "../activities/import-mapping.js";
import type { RefAssetDecision, RefNumberSuggestion } from "../activities/ref-template-types.js";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityProduct,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  CollectionManifest,
  DeterministicRunKind,
  ModuleDocumentKind,
  ModuleDocumentOverride,
} from "../activities/domain.js";
import type { AcceptanceStage } from "../activities/acceptance-types.js";

export abstract class ActivityGeneration extends Interface<{
  shutdown(): Promise<void>;
  start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    module?: {
      wafRoot?: string;
      bookMode?: string;
      audio?: { language: string; assetKey: string; voice: string };
      image?: { language: string; assetKey: string };
      mediaText?: { language: string; assetKey: string; translate?: boolean };
      /** An assist run: the author's first message and what they had open. */
      assist?: { message: string; focus: AssistFocus | null };
      /**
       * An assessment run on the canonical ref of a specification that uses one, given the
       * assessment in effect now (the author's edit, else the module's own; null for none).
       */
      assessment?: { current: Record<string, unknown> | null };
      /**
       * An acceptance test run, prepared by the acceptance service: what to test, where, and
       * an earlier run's tests when they fit the same criteria.
       */
      test?: AcceptanceStage;
    },
    /** Run on an external coding agent instead of the Penguin agent `agentId` names. */
    runtime?: { codingAgentId?: string },
  ): Promise<ActivityRun>;
  list(projectId: string, activityId: string): Promise<ActivityRunSummary[]>;
  candidate(projectId: string, activityId: string, runId: string): Promise<string | null>;
  /** An assist run's current proposal, read from its workspace. */
  proposal(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<{ proposal: AssistProposal | null; error: string | null }>;
  /**
   * Set an assist run's proposal aside, kept in its workspace for the trace, so the studio
   * stops offering it until the agent writes another.
   */
  discardProposal(projectId: string, activityId: string, runId: string): Promise<void>;
  cancel(projectId: string, activityId: string, runId: string): Promise<ActivityRun>;
  /**
   * Records a run the server does itself, with no Session or agent (a quality check), under
   * the same one-run-per-activity rule as every other run. The caller does the work in the
   * run's workspace (`activity-runs/<runId>`) and then settles it.
   */
  openDeterministic(
    projectId: string,
    activityId: string,
    kind: DeterministicRunKind,
  ): Promise<ActivityRun>;
  /**
   * Settles a run `openDeterministic` opened. False, and nothing changed, when it had already
   * ended: cancelled by the author, or interrupted when the server stopped.
   */
  settleDeterministic(
    projectId: string,
    activityId: string,
    runId: string,
    status: "succeeded" | "failed",
    error: string | null,
  ): Promise<boolean>;
  /** Whether a run is still going: false once it has settled, been cancelled or interrupted. */
  isRunning(projectId: string, activityId: string, runId: string): Promise<boolean>;
  /**
   * The activity's newest run of this kind that ended with this status, however many runs of
   * other kinds came after it; null when there is none.
   */
  latestRun(
    projectId: string,
    activityId: string,
    kind: ActivityRun["kind"],
    status: ActivityRun["status"],
  ): Promise<ActivityRunSummary | null>;
  acceptAudio(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  audioContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array>;
  imageCandidateContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array>;
  acceptImage(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  acceptMediaText(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  /** Keep a successful assessment run's candidate as the product's assessment edit. */
  acceptAssessment(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
}>() {}

export abstract class ActivityAuthoring extends Interface<{
  /** Every change of an agent's proposal as one draft change: all of it, or none. */
  applyProposal(
    projectId: string,
    activityId: string,
    changes: ProposalChange[],
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  applyMediaText(
    projectId: string,
    activityId: string,
    target: MediaTextTarget,
    text: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  storeImage(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<ImageResult>;
  readImage(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array>;
  applyImage(
    projectId: string,
    activityId: string,
    target: ImageTarget,
    result: ImageResult,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  prepareImageMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void>;
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
  /** Stage author-uploaded media into an assembly workspace, beside the generated media. */
  prepareUploadedMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void>;
  uploadMedia(
    projectId: string,
    activityId: string,
    name: string,
    bytes: Buffer,
  ): Promise<UploadedMedia>;
  listMedia(projectId: string, activityId: string): Promise<UploadedMedia[]>;
  uploadContent(
    projectId: string,
    activityId: string,
    reference: string,
  ): Promise<{ bytes: Buffer; mimeType: string }>;
  /** Every upload of the project's live activities, newest first, with the activity that owns it. */
  projectMedia(projectId: string): Promise<ProjectMediaListing>;
  /** Copy another activity's upload into this activity's own uploads. */
  copyUpload(
    projectId: string,
    activityId: string,
    fromActivityId: string,
    reference: string,
  ): Promise<UploadedMedia>;
  /** Several uploads of the project as one zip. */
  mediaBundle(projectId: string, items: BundleItem[]): Promise<Uint8Array>;
  planMedia(
    projectId: string,
    activityId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  /**
   * What stands between the draft and an assembled module, with this checkout, if given, and
   * the assessment in effect and the module's own file when the caller has read them (else
   * only an author's edit counts).
   */
  readiness(
    projectId: string,
    activityId: string,
    wafRoot: string,
    assessment?: { current: unknown; own: unknown },
  ): Promise<ReadinessCheck[]>;
  /** Loom's implementation features, and the ones this ref asks its assembly to reproduce. */
  implementationFeatures(
    projectId: string,
    activityId: string,
  ): Promise<{ features: ImplementationFeature[]; selectedIds: string[] }>;
  setImplementationFeatures(
    projectId: string,
    activityId: string,
    selectedIds: string[],
  ): Promise<{ features: ImplementationFeature[]; selectedIds: string[] }>;
  /** Add a language the activity can be translated into, with its media plan to fill in. */
  addLanguage(
    projectId: string,
    activityId: string,
    language: string,
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
  /** The product a ref belongs to, or null for a row predating the product level. */
  productOf(activity: ActivityRecord): ActivityProduct | null;
  /** Whether this ref owns the module code; only the canonical ref may change it. */
  isCanonicalRef(activity: ActivityRecord): boolean;
  /** What an author calls a ref, and whether others may build against it. */
  setRefIdentity(
    projectId: string,
    activityId: string,
    identity: { displayName?: unknown; stable?: boolean },
  ): Promise<ActivityRecord>;
  /**
   * Give a ref another number in its product; refused while it is stable, when the number is
   * taken (archived refs keep theirs), or when the draft changed since `expectedRevision`.
   */
  changeRefNum(
    projectId: string,
    activityId: string,
    refNum: unknown,
    expectedRevision: string,
  ): Promise<ActivityRecord & { draft: ActivityDraft }>;
  /**
   * The number a new ref of this ref's product would take, every number its refs hold, and
   * whether this ref is the template new refs are made from.
   */
  nextRefNumber(projectId: string, activityId: string): Promise<RefNumberSuggestion>;
  /**
   * A new ref made from the product's template (its canonical ref, marked stable): the
   * template's draft and files, with each asset kept, cleared for regeneration or bound to one
   * of the template's uploads. Nothing is left behind when it is refused.
   */
  createRefFromTemplate(
    projectId: string,
    templateId: string,
    input: { refNum: unknown; displayName?: unknown; decisions: RefAssetDecision[] },
  ): Promise<ActivityDetail>;
  /** Replace a product's tags through any of its refs; returns them as stored. */
  setProductTags(projectId: string, activityId: string, tags: unknown): Promise<string[]>;
  /** Delete an activity from every list by archiving it; nothing on disk is removed. */
  archiveActivity(projectId: string, activityId: string): Promise<void>;
  /** A book product's reading mode; it belongs to the product, not to a ref. */
  setProductBookMode(
    projectId: string,
    collectionId: string,
    productCode: string,
    mode: "decodable" | "readAlong",
  ): Promise<ActivityProduct>;
  /** Create everything a Loom product's mapping describes, and report what happened. */
  importProduct(
    projectId: string,
    collectionId: string | undefined,
    mapping: ImportMapping,
  ): Promise<ImportOutcome>;
  /** The Loom products a checkout offers. Reading only; nothing is imported by looking. */
  availableImports(): Promise<{ modulesDir: string | null; products: ImportedActivity[] }>;
  /** Read one Loom product, decide what Penguin would make of it, and make it. */
  importFromLoom(
    projectId: string,
    moduleFolder: string,
    productCode: string,
    collectionId?: string,
  ): Promise<{
    mapping: ImportMapping;
    outcome: ImportOutcome;
    message: string;
    problems: string[];
  }>;
  /**
   * Save an author's edit of the module's configuration or assessment in the draft; the
   * assessment only on the canonical ref, because every ref shares it. An assessment problem
   * `baseline` (the document the author was editing) already had does not refuse the save.
   */
  setModuleDocument(
    projectId: string,
    activityId: string,
    kind: ModuleDocumentKind,
    value: unknown,
    expectedRevision: string,
    baseline?: unknown,
  ): Promise<ActivityDraft>;
  /** Remove an author's edit of a module document. */
  discardModuleDocument(
    projectId: string,
    activityId: string,
    kind: ModuleDocumentKind,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  /** The edit this ref uses (the assessment's lives on the canonical ref), and whether it is stale. */
  effectiveModuleDocument(
    projectId: string,
    activity: ActivityDetail,
    kind: ModuleDocumentKind,
  ): Promise<(ModuleDocumentOverride & { stale: boolean }) | null>;
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
  /**
   * Run `operation` while no other change to this activity's draft or files can start, as the
   * project's activity work. A nested `exclusive` and a draft change that takes an expected
   * revision (such as `replaceDraft` or `applySpec`) join the run instead of waiting; any
   * other method that changes the same activity must not be called from `operation`.
   */
  exclusive<T>(projectId: string, activityId: string, operation: () => Promise<T>): Promise<T>;
  /**
   * Make the draft hold exactly `content`, as restoring a saved version does: the status is
   * worked out as saving a specification works it out, unless `staleSpec` says the script
   * was edited after the specification, which keeps the status "draft" as that edit did. A
   * part `content` lacks is removed. Compare-and-set on `expectedRevision`.
   */
  replaceDraft(
    projectId: string,
    activityId: string,
    content: Pick<ActivityDraft, "description" | "spec" | "mediaPlan" | "moduleDocuments">,
    expectedRevision: string,
    staleSpec?: boolean,
  ): Promise<ActivityDraft>;
}>() {}
