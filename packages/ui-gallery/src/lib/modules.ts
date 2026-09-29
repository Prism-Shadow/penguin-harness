/**
 * Module collection — pure, so the glob wiring (registry.ts) stays a thin shell and every rule
 * here is unit-tested.
 *
 * The gallery renders exactly the modules `MODULE_IDS` names, one page each, one file each:
 * `packages/ui-gallery/src/modules/<id>.module.tsx`. A problem in one file is reported and that
 * module skipped, so one broken module never blanks the site.
 */
import type { ComponentSection } from "../../../ui/src/catalog";
import { MODULE_IDS } from "../../../ui/src/module";
import type { Module, ModuleVariant } from "../../../ui/src/module";

/** Variant keys double as URL and file-name segments. */
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
    // Reported, not skipped: the page still renders with the address that shadows.
    for (const problem of addressProblems(module)) problems.push(`${path}: ${problem}`);
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

/** The variant a key selects; an unknown or missing key reads as the default, the first. */
export function pickVariant(module: Module, key: string | undefined): ModuleVariant {
  return module.variants.find((variant) => variant.key === key) ?? module.variants[0]!;
}
