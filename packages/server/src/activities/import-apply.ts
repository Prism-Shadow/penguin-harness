/**
 * Carrying out an import.
 *
 * #63 decides what Penguin would make of a Loom activity. This performs it: the product,
 * its refs, and each ref's draft actually come into existence.
 *
 * Two rules shape the whole thing, and both come from how Penguin already behaves rather
 * than from anything invented here.
 *
 * The canonical ref goes first. Penguin makes the product's FIRST ref its canonical one,
 * and the canonical ref is the only one allowed to change the shared module — three
 * generation stages are gated on it. Importing refs in numeric order would hand module
 * ownership to whichever ref happened to sort lowest, which for three real products is not
 * the ref Loom named. The first ref also carries the module folder; later refs join what
 * exists.
 *
 * A ref that is already there is skipped rather than refused. An import that cannot be run
 * twice is an import nobody dares run once, and a half-finished import — a network drop, a
 * bad spec in ref seven — has to be resumable.
 */
import type { CarriedBinding, ImportMapping, MappedActivity } from "./import-mapping.js";

/** A product Penguin already holds under this code. */
export interface ExistingProduct {
  /** Its live refs. */
  refNums: number[];
  /**
   * Its deleted (archived) refs. A deleted ref keeps its number, so it cannot be created
   * again, and it is not "already there" either: nobody can see it.
   */
  archivedRefNums: number[];
  canonicalRefNum: number | null;
}

/** What an import needs of the store. Narrow on purpose: everything here is already a service call. */
export interface ImportTarget {
  /** What Penguin already holds under this product code, or null if nothing does. */
  existingProduct(productCode: string): Promise<ExistingProduct | null>;
  createRef(input: {
    productCode: string;
    refNum: number;
    title: string;
    activityType: "standard" | "book";
    /** Read only when this ref creates the product. */
    moduleFolder?: string;
  }): Promise<{ activityId: string; revision: string }>;
  /** The ref's own name and its stability flag, neither of which creation accepts. */
  setRefIdentity(
    activityId: string,
    identity: { displayName: string | null; stable: boolean },
  ): Promise<void>;
  setDescription(activityId: string, description: string, revision: string): Promise<string>;
  setSpec(activityId: string, spec: Record<string, unknown>, revision: string): Promise<string>;
  setBookMode(productCode: string, mode: "decodable" | "readAlong"): Promise<void>;
  setImplementationFeatures(activityId: string, selectedIds: string[]): Promise<void>;
  /** Plan media from the saved specification and bind it as Loom had it. */
  setMedia(
    activityId: string,
    media: Record<string, CarriedBinding[]>,
    revision: string,
  ): Promise<string>;
}

export interface ImportOutcome {
  /** Refs brought into existence by this run. */
  created: number[];
  /** Refs that were already there, left untouched. */
  skipped: number[];
  /** Refs deleted here earlier. Their numbers stay taken, so they were not recreated. */
  archived: number[];
  /** Refs that could not be imported, and why. Named, never swallowed. */
  failed: { refNum: number; reason: string }[];
  /**
   * Refs that exist but whose draft could not be finished. They are NOT failures — the ref
   * is there, and a later run will skip it — so an author has to be told which ones are
   * empty rather than left to find an activity that loads and does nothing.
   */
  partial: { refNum: number; reason: string }[];
  /** True when the canonical ref could not be created and the rest were not attempted. */
  abandoned: boolean;
  /**
   * Set when the imported refs joined a product that already owns its module through a
   * different canonical ref. The import is complete; the module ownership is not what Loom
   * recorded, and only an author can decide whether to move it.
   */
  canonicalConflict: { loom: number; penguin: number } | null;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The canonical ref first, then the rest in numeric order. */
function importOrder(mapping: ImportMapping): MappedActivity[] {
  const ordered = [...mapping.activities].sort((a, b) => a.refNum - b.refNum);
  const canonical = ordered.findIndex((ref) => ref.refNum === mapping.product.canonicalRefNum);
  if (canonical <= 0) return ordered;
  return [ordered[canonical]!, ...ordered.filter((_, index) => index !== canonical)];
}

/**
 * Create everything the mapping describes.
 *
 * One ref failing does not lose the others: nine good refs are worth importing even when
 * the tenth has a spec Penguin rejects. The exception is the canonical ref of a product
 * that does not yet exist — importing the rest would promote a different ref to canonical
 * and hand it the module, so the product is abandoned and reported instead.
 */
export async function applyImport(
  mapping: ImportMapping,
  target: ImportTarget,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    created: [],
    skipped: [],
    archived: [],
    failed: [],
    partial: [],
    abandoned: false,
    canonicalConflict: null,
  };
  const existing = await target.existingProduct(mapping.product.productCode);
  const present = new Set(existing?.refNums ?? []);
  const deleted = new Set(existing?.archivedRefNums ?? []);
  // Joining a product Penguin already has means its canonical ref is already settled, and
  // creating the ref Loom called canonical will not move it. Reported rather than forced:
  // moving module ownership is an author's decision, not an importer's.
  if (
    existing &&
    existing.canonicalRefNum !== null &&
    existing.canonicalRefNum !== mapping.product.canonicalRefNum
  )
    outcome.canonicalConflict = {
      loom: mapping.product.canonicalRefNum,
      penguin: existing.canonicalRefNum,
    };

  for (const ref of importOrder(mapping)) {
    const isCanonical = ref.refNum === mapping.product.canonicalRefNum;
    if (present.has(ref.refNum)) {
      outcome.skipped.push(ref.refNum);
      continue;
    }
    if (deleted.has(ref.refNum)) {
      outcome.archived.push(ref.refNum);
      continue;
    }
    try {
      const incomplete = await importRef(mapping, ref, target);
      outcome.created.push(ref.refNum);
      if (incomplete) outcome.partial.push({ refNum: ref.refNum, reason: incomplete });
    } catch (error) {
      outcome.failed.push({ refNum: ref.refNum, reason: reason(error) });
      // Only the canonical ref of a brand-new product stops the run: without it the next
      // ref created would silently become the owner of the shared module.
      if (isCanonical && !existing) {
        outcome.abandoned = true;
        return outcome;
      }
    }
  }

  if (mapping.product.bookMode && outcome.created.length)
    await target.setBookMode(mapping.product.productCode, mapping.product.bookMode);
  return outcome;
}

/**
 * One ref, with its draft.
 *
 * The revision is threaded through each edit because Penguin refuses a draft change that
 * does not carry the current one; writing them in a fixed order keeps a partly written
 * draft predictable rather than depending on which call happened to win.
 */
async function importRef(
  mapping: ImportMapping,
  ref: MappedActivity,
  target: ImportTarget,
): Promise<string | null> {
  const created = await target.createRef({
    productCode: mapping.product.productCode,
    refNum: ref.refNum,
    title: ref.title,
    activityType: mapping.product.activityType,
    moduleFolder: mapping.product.moduleFolder,
  });
  // Past this point the ref EXISTS. A later failure cannot be reported as if nothing
  // happened, and a re-run will skip it, so it is reported as an unfinished ref instead.
  try {
    if (ref.displayName !== null || ref.stable)
      await target.setRefIdentity(created.activityId, {
        displayName: ref.displayName,
        stable: ref.stable,
      });
    let revision = created.revision;
    if (ref.description.trim())
      revision = await target.setDescription(created.activityId, ref.description, revision);
    // A ref with no specification was already reported as a loss by the mapping; there is
    // nothing here to write, and inventing an empty one would make it look imported.
    if (ref.spec) {
      revision = await target.setSpec(created.activityId, ref.spec, revision);
      // Media is planned from the specification, so it can only follow one.
      if (Object.keys(ref.media).length)
        revision = await target.setMedia(created.activityId, ref.media, revision);
    }
    if (ref.implementationFeatures.length)
      await target.setImplementationFeatures(created.activityId, ref.implementationFeatures);
    return null;
  } catch (error) {
    return reason(error);
  }
}

/** One line about what an import run did. */
export function describeOutcome(outcome: ImportOutcome, productCode: string): string {
  if (outcome.abandoned)
    return `${productCode} was not imported: its canonical ref ${outcome.failed[0]?.refNum} could not be created, and importing the rest would give the module to a different ref. ${outcome.failed[0]?.reason}`;
  const parts: string[] = [];
  parts.push(
    outcome.created.length
      ? `Imported ${outcome.created.length} ${outcome.created.length === 1 ? "ref" : "refs"} of ${productCode}.`
      : `${productCode} had nothing left to import.`,
  );
  if (outcome.skipped.length)
    parts.push(
      `${outcome.skipped.length} ${outcome.skipped.length === 1 ? "ref was" : "refs were"} already there and left alone.`,
    );
  if (outcome.archived.length)
    parts.push(
      `${outcome.archived.length === 1 ? "Ref" : "Refs"} ${outcome.archived.join(", ")} ${outcome.archived.length === 1 ? "was" : "were"} deleted here earlier and ${outcome.archived.length === 1 ? "was" : "were"} not imported again; ${outcome.archived.length === 1 ? "its number stays" : "their numbers stay"} taken.`,
    );
  if (outcome.failed.length)
    parts.push(
      `${outcome.failed.length} failed: ${outcome.failed.map((failure) => `ref ${failure.refNum} (${failure.reason})`).join(", ")}.`,
    );
  if (outcome.partial.length)
    parts.push(
      `${outcome.partial.length} ${outcome.partial.length === 1 ? "ref exists but was" : "refs exist but were"} not finished: ${outcome.partial.map((entry) => `ref ${entry.refNum} (${entry.reason})`).join(", ")}.`,
    );
  if (outcome.canonicalConflict)
    parts.push(
      `Loom gives the module to ref ${outcome.canonicalConflict.loom}, but this product already gives it to ref ${outcome.canonicalConflict.penguin}; it was left where it is.`,
    );
  return parts.join(" ");
}
