/**
 * An activity ref's files in its module, in Loom's layout:
 *
 *     <wafRoot>/modules/<moduleFolder>/generated/<pc>/
 *       spec/activity_metadata.json        the product: code, module, type, canonical ref, tags
 *       spec/penguin.json                  Penguin's own: which project owns the product
 *       refs/<pc>-<ref>/spec/
 *         activity_metadata.json           the ref: number, title, display name, stability
 *         activity_spec.json               the specification (absent until one is saved)
 *         activity_description.txt         what the author wrote
 *         asset_manifest.json              the media plan's manifest (absent until planned)
 *         implementation_features.json     `{ selectedIds }`
 *         penguin.json                     Penguin's bookkeeping for the draft
 *
 * Penguin is the only writer, so its own fields may sit inside Loom's files; what Loom's
 * files have no place for (the draft's status and revision, which specification the media
 * plan was made from, module document edits, a pinned build) is `penguin.json`, committed
 * with the module like the rest. `penguin.json` is written last: a draft whose other files
 * changed after it reads as "draft" until it is saved again, as `draft.json` did before.
 *
 * Pure paths and file I/O; the service owns locking, validation and the index.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ActivityDraft, ModuleDocumentOverrides } from "./domain.js";
import type { AssetManifest } from "./media.js";

export const REF_METADATA_FILE = "activity_metadata.json";
export const REF_SPEC_FILE = "activity_spec.json";
export const REF_DESCRIPTION_FILE = "activity_description.txt";
export const REF_MANIFEST_FILE = "asset_manifest.json";
export const REF_FEATURES_FILE = "implementation_features.json";
export const PENGUIN_FILE = "penguin.json";

/** `<wafRoot>/modules/<moduleFolder>/generated/<pc>`. */
export function productDir(wafRoot: string, moduleFolder: string, productCode: string): string {
  return path.join(wafRoot, "modules", moduleFolder, "generated", productCode);
}

/** Loom's folder name for one ref: `<pc>-<ref>`. */
export function refFolderName(productCode: string, refNum: number): string {
  return `${productCode}-${refNum}`;
}

/** `<product>/refs/<pc>-<ref>`: the ref's folder, which its number names. */
export function refDir(
  wafRoot: string,
  moduleFolder: string,
  productCode: string,
  refNum: number,
): string {
  return path.join(
    productDir(wafRoot, moduleFolder, productCode),
    "refs",
    refFolderName(productCode, refNum),
  );
}

/** `<ref>/spec`, where every file of the ref's draft is. */
export function refSpecDir(
  wafRoot: string,
  moduleFolder: string,
  productCode: string,
  refNum: number,
): string {
  return path.join(refDir(wafRoot, moduleFolder, productCode, refNum), "spec");
}

/** What `penguin.json` holds for a ref: the draft less what Loom's files carry. */
export interface PenguinRefState {
  schemaVersion: 1;
  draftId: string;
  activityId: string;
  baseVersionId: string | null;
  /** The revision the draft had when it was saved; a mismatch on read means "draft". */
  contentRevision: string;
  status: ActivityDraft["status"];
  /** The media plan's bookkeeping; its manifest is `asset_manifest.json`. */
  mediaPlan?: { specRevision: string; requirements: Record<string, string> };
  moduleDocuments?: ModuleDocumentOverrides;
  pinnedModuleRunId?: string;
  updatedAt: string;
}

/** The ref's identity, as `activity_metadata.json` records it. */
export interface RefMetadata {
  productCode: string;
  refNum: number;
  title: string;
  moduleFolder: string;
  displayName: string | null;
  stable: boolean;
  runtime?: unknown;
}

/** The product's identity, as its `activity_metadata.json` records it. */
export interface ProductMetadata {
  productCode: string;
  title: string;
  moduleFolder: string;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
  canonicalRefNum: number | null;
  tags: string[];
  runtime?: unknown;
}

/** Which Penguin project owns a product, as the product's `penguin.json` records it. */
export interface PenguinProductState {
  schemaVersion: 1;
  projectId: string;
  productId: string;
  collectionId: string;
}

/** Written whole to a sibling temporary file, then renamed over the target. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, text, "utf8");
  await fs.rename(temp, file);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text) as unknown;
}

/**
 * The draft the ref's files make, or null when the ref has no `penguin.json` (a ref Penguin
 * never saved). A file that does not parse is an error: the caller reports the draft corrupt.
 */
export async function readRefDraft(specDir: string): Promise<ActivityDraft | null> {
  const state = (await readJson(path.join(specDir, PENGUIN_FILE))) as PenguinRefState | undefined;
  if (state === undefined) return null;
  if (!state || typeof state !== "object" || state.schemaVersion !== 1)
    throw new Error("penguin.json is corrupt.");
  const spec = await readJson(path.join(specDir, REF_SPEC_FILE));
  const manifest = await readJson(path.join(specDir, REF_MANIFEST_FILE));
  const description = await fs
    .readFile(path.join(specDir, REF_DESCRIPTION_FILE), "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  const draft: ActivityDraft = {
    draftId: state.draftId,
    activityId: state.activityId,
    baseVersionId: state.baseVersionId ?? null,
    contentRevision: state.contentRevision,
    status: state.status,
    description,
    spec: spec === undefined ? null : (spec as Record<string, unknown>),
    updatedAt: state.updatedAt,
  };
  // A plan is its bookkeeping and its manifest together; either alone is no plan.
  if (state.mediaPlan && manifest !== undefined)
    draft.mediaPlan = { ...state.mediaPlan, manifest: manifest as AssetManifest };
  if (state.moduleDocuments) draft.moduleDocuments = state.moduleDocuments;
  if (state.pinnedModuleRunId) draft.pinnedModuleRunId = state.pinnedModuleRunId;
  return draft;
}

/**
 * Writes the draft into the ref's files, `penguin.json` last. A part the draft lacks (no
 * specification yet, no media plan) is removed, so the files never hold a stale one.
 */
export async function writeRefDraft(specDir: string, draft: ActivityDraft): Promise<void> {
  await fs.mkdir(specDir, { recursive: true });
  const specFile = path.join(specDir, REF_SPEC_FILE);
  const manifestFile = path.join(specDir, REF_MANIFEST_FILE);
  if (draft.spec !== null) await writeFileAtomic(specFile, json(draft.spec));
  else await fs.rm(specFile, { force: true });
  if (draft.mediaPlan) await writeFileAtomic(manifestFile, json(draft.mediaPlan.manifest));
  else await fs.rm(manifestFile, { force: true });
  await writeFileAtomic(path.join(specDir, REF_DESCRIPTION_FILE), draft.description);
  const state: PenguinRefState = {
    schemaVersion: 1,
    draftId: draft.draftId,
    activityId: draft.activityId,
    baseVersionId: draft.baseVersionId,
    contentRevision: draft.contentRevision,
    status: draft.status,
    ...(draft.mediaPlan
      ? {
          mediaPlan: {
            specRevision: draft.mediaPlan.specRevision,
            requirements: draft.mediaPlan.requirements,
          },
        }
      : {}),
    ...(draft.moduleDocuments ? { moduleDocuments: draft.moduleDocuments } : {}),
    ...(draft.pinnedModuleRunId ? { pinnedModuleRunId: draft.pinnedModuleRunId } : {}),
    updatedAt: draft.updatedAt,
  };
  await writeFileAtomic(path.join(specDir, PENGUIN_FILE), json(state));
}

/** Loom's ref metadata: its product's code as `id`, and the ref's own identity. */
export async function writeRefMetadata(specDir: string, ref: RefMetadata): Promise<void> {
  await writeFileAtomic(
    path.join(specDir, REF_METADATA_FILE),
    json({
      id: ref.productCode,
      title: ref.title,
      moduleFolder: ref.moduleFolder,
      ...(ref.runtime !== undefined ? { runtime: ref.runtime } : {}),
      refNum: ref.refNum,
      ...(ref.displayName !== null ? { displayName: ref.displayName } : {}),
      stable: ref.stable,
    }),
  );
}

/** Loom's product metadata, and which project owns the product. */
export async function writeProductFiles(
  dir: string,
  product: ProductMetadata,
  owner: PenguinProductState,
): Promise<void> {
  const spec = path.join(dir, "spec");
  await writeFileAtomic(
    path.join(spec, REF_METADATA_FILE),
    json({
      id: product.productCode,
      title: product.title,
      moduleFolder: product.moduleFolder,
      activityType: product.activityType,
      ...(product.activityType === "book" && product.bookMode
        ? { bookMode: product.bookMode }
        : {}),
      ...(product.runtime !== undefined ? { runtime: product.runtime } : {}),
      ...(product.canonicalRefNum !== null ? { canonicalRefNum: product.canonicalRefNum } : {}),
      tags: product.tags,
    }),
  );
  await writeFileAtomic(path.join(spec, PENGUIN_FILE), json(owner));
}

/** The product's owner, or null when no Penguin project owns it yet. */
export async function readProductOwner(dir: string): Promise<PenguinProductState | null> {
  const state = (await readJson(path.join(dir, "spec", PENGUIN_FILE))) as
    PenguinProductState | undefined;
  return state && typeof state === "object" && state.schemaVersion === 1 ? state : null;
}

/** The selected implementation features, or null when none are (or the file is unreadable). */
export async function readFeatureFile(specDir: string): Promise<unknown> {
  return readJson(path.join(specDir, REF_FEATURES_FILE)).catch(() => null);
}

export async function writeFeatureFile(specDir: string, selectedIds: string[]): Promise<void> {
  await writeFileAtomic(path.join(specDir, REF_FEATURES_FILE), json({ selectedIds }));
}
