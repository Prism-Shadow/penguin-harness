/**
 * Module collection and variant picks — pure, so the glob wiring (registry.ts) stays a thin shell
 * and every rule here is unit-tested.
 *
 * The gallery renders exactly the modules `MODULE_IDS` names, in that order, one file each:
 * `packages/ui/src/modules/<id>.module.tsx`, or `packages/ui-gallery/src/modules/<id>.module.tsx` for
 * the two the gallery owns (Foundations reads the token probe; Screens frames the gallery's own
 * `/screens` routes). A problem in one file is reported and that module skipped, so one broken
 * module never blanks the page.
 */
import type { ComponentSection } from "../../../ui/src/catalog";
import { MODULE_IDS } from "../../../ui/src/module";
import type { Module, ModuleVariant } from "../../../ui/src/module";

/** Variant keys double as URL and file-name segments. */
export const VARIANT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CollectedModule {
  module: Module;
  /** The glob path the module came from, for the code drawer and problem reports. */
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

/** The key to store for a pick: `null` for the default, so a default view keeps a short URL. */
export function storedVariantKey(module: Module, key: string): string | null {
  return key === module.variants[0]?.key ? null : key;
}
