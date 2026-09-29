/**
 * Module collection, variant kinds and picks — pure, so the glob wiring (registry.ts) stays a
 * thin shell and every rule here is unit-tested.
 *
 * The gallery renders exactly the modules `MODULE_IDS` names, one page each, one file each:
 * `packages/ui/src/modules/<id>.module.tsx`, or `packages/ui-gallery/src/modules/<id>.module.tsx` for
 * the two the gallery owns (Foundations reads the token probe; Screens frames the gallery's own
 * `/screens` routes). A problem in one file is reported and that module skipped, so one broken
 * module never blanks the site.
 */
import type { ComponentSection } from "../../../ui/src/catalog";
import { MODULE_IDS } from "../../../ui/src/module";
import type { Module, ModuleVariant, VariantKind } from "../../../ui/src/module";
import { naturalWidth } from "./fit";

/** Variant and frame keys double as URL and file-name segments. */
export const VARIANT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The ids a module page reserves for its own sections after the variants. A variant key or a
 * part id never takes one of these, so `#parts` always means the Parts section.
 */
export const PAGE_SECTION_IDS = ["parts", "tokens", "source"] as const;
export type PageSectionId = (typeof PAGE_SECTION_IDS)[number];

export interface CollectedModule {
  module: Module;
  /** The glob path the module came from, for the Source section and problem reports. */
  path: string;
}

export interface ModuleRegistry {
  /** Collected modules in `MODULE_IDS` order. */
  list: readonly CollectedModule[];
  byId: ReadonlyMap<string, CollectedModule>;
  /** Human-readable problems, shown above the modules. */
  problems: readonly string[];
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * What a variant is on its page: what it declares, else `animated` when it carries a scene and
 * `static` when it does not. The declaration wins over the scene, so a variant that says
 * `interactive` but still carries a scene is driven by the reader and never played.
 */
export function variantKind(variant: Pick<ModuleVariant, "kind" | "scene">): VariantKind {
  return variant.kind ?? (variant.scene ? "animated" : "static");
}

/**
 * What stops a variant's scene from playing or being addressed: fewer than two frames (nothing to
 * animate between), a frame key that cannot be a URL or file-name segment or repeats, or a hold
 * that is not a positive number of ms.
 */
function sceneProblems(variant: ModuleVariant): string[] {
  const frames = variant.scene?.frames;
  if (frames === undefined) return [];
  if (frames.length < 2) return [`scene of "${variant.key}" needs at least two frames`];
  const keys = frames.map((frame) => frame.key);
  const badKeys = keys.filter((key, i) => !VARIANT_KEY.test(key) || keys.indexOf(key) !== i);
  const badHolds = frames.filter((frame) => !(Number.isFinite(frame.hold) && frame.hold > 0));
  const found: string[] = [];
  if (badKeys.length > 0)
    found.push(
      `frame keys of "${variant.key}" must be unique lowercase words joined by "-": ${badKeys.join(", ")}`,
    );
  if (badHolds.length > 0)
    found.push(
      `frame holds of "${variant.key}" must be positive ms: ${badHolds.map((f) => f.key).join(", ")}`,
    );
  return found;
}

/**
 * The gallery's own two modules render gallery machinery — the Foundations boards and the Screens
 * thumbnails, which are frames of other routes — and have nothing to animate or drive.
 */
export const GALLERY_OWN: ReadonlySet<string> = new Set(["foundations", "screens"]);

/**
 * A kind that disagrees with what the variant carries: an animated variant with nothing to play,
 * an interactive one that still carries a scene (the reader drives it, so the scene is dead
 * weight), or a static default variant (a module opens on something that moves or answers).
 * Reported, not skipped — the page still renders the variant by its declared kind.
 */
function kindProblems(module: Module): string[] {
  const found: string[] = [];
  module.variants.forEach((variant, index) => {
    const kind = variantKind(variant);
    if (kind === "animated" && variant.scene === undefined)
      found.push(`variant "${variant.key}" is animated but carries no scene`);
    if (kind === "interactive" && variant.scene !== undefined)
      found.push(`variant "${variant.key}" is interactive and must not carry a scene`);
    if (index === 0 && kind === "static" && !GALLERY_OWN.has(module.id))
      found.push(`the default variant "${variant.key}" is static; a module opens on motion`);
  });
  return found;
}

/** A variant key or part id that would shadow a page section (`#parts`), or a part id a variant repeats. */
function addressProblems(module: Module): string[] {
  const reserved = new Set<string>(PAGE_SECTION_IDS);
  const found: string[] = [];
  for (const variant of module.variants) {
    if (reserved.has(variant.key))
      found.push(`variant "${variant.key}" takes a page section's address`);
    if (module.parts.includes(variant.key))
      found.push(`variant "${variant.key}" takes a part's address`);
  }
  for (const part of module.parts) {
    if (reserved.has(part)) found.push(`part "${part}" takes a page section's address`);
  }
  return found;
}

export function collectModules(
  files: Readonly<Record<string, { module?: Module }>>,
  catalog: readonly Pick<ComponentSection, "id">[],
): ModuleRegistry {
  const known = new Set(catalog.map((section) => section.id));
  const byId = new Map<string, CollectedModule>();
  const problems: string[] = [];
  /** Ids some file tried to define, valid or not: a rejected module is reported once, not twice. */
  const attempted = new Set<string>();

  for (const path of Object.keys(files).sort()) {
    const module = files[path]?.module;
    if (!module || typeof module.render !== "function" || typeof module.id !== "string") {
      problems.push(`${path}: no \`module\` export (export const module = defineModule({ … }))`);
      continue;
    }
    attempted.add(module.id);
    if (!(MODULE_IDS as readonly string[]).includes(module.id)) {
      problems.push(`${path}: "${module.id}" is not in MODULE_IDS (packages/ui/src/module.ts)`);
      continue;
    }
    if (fileName(path) !== `${module.id}.module.tsx`) {
      problems.push(`${path}: module "${module.id}" must live in ${module.id}.module.tsx`);
      continue;
    }
    const earlier = byId.get(module.id);
    if (earlier !== undefined) {
      problems.push(`${path}: module "${module.id}" is already defined by ${earlier.path}`);
      continue;
    }
    const keys = module.variants.map((variant) => variant.key);
    const badKeys = keys.filter((key, i) => !VARIANT_KEY.test(key) || keys.indexOf(key) !== i);
    if (keys.length === 0 || badKeys.length > 0) {
      problems.push(
        keys.length === 0
          ? `${path}: module "${module.id}" has no variants`
          : `${path}: variant keys must be unique lowercase words joined by "-": ${badKeys.join(", ")}`,
      );
      continue;
    }
    const badScenes = module.variants.flatMap((variant) => sceneProblems(variant));
    if (badScenes.length > 0) {
      for (const problem of badScenes) problems.push(`${path}: ${problem}`);
      continue;
    }
    // Reported, not skipped: the module still renders, just reflowed to the column as if undeclared.
    if (module.viewport !== undefined && naturalWidth(module) === null) {
      problems.push(`${path}: viewport of "${module.id}" must be a positive width in px`);
    }
    for (const problem of [...kindProblems(module), ...addressProblems(module)]) {
      problems.push(`${path}: ${problem}`);
    }
    const unknownParts = module.parts.filter((id) => !known.has(id));
    if (unknownParts.length > 0) {
      problems.push(`${path}: parts not in catalog.ts: ${unknownParts.join(", ")}`);
    }
    byId.set(module.id, { module, path });
  }
  for (const id of MODULE_IDS) {
    if (!attempted.has(id)) problems.push(`module "${id}" has no ${id}.module.tsx`);
  }
  const list = MODULE_IDS.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
  return { list, byId, problems };
}

/** The variant a key selects (`/embed?variant=`); an unknown or missing key reads as the default, the first. */
export function pickVariant(module: Module, key: string | undefined): ModuleVariant {
  return module.variants.find((variant) => variant.key === key) ?? module.variants[0]!;
}
