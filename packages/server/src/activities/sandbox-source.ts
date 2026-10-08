/**
 * Where a preview's module comes from.
 *
 * Two places, and the difference is who may write there. A module Penguin assembled lives
 * in one of its own run workspaces; it is built in place, because that workspace is
 * Penguin's. A module Loom generated lives in the WAF checkout under `modules/<folder>`,
 * which Penguin reads and never writes -- so its build goes to a directory of Penguin's own,
 * and a request for one of its files looks in that build first and in the checkout second.
 *
 * Penguin's own build wins when both exist: an author who assembled the module here is
 * looking at what they assembled, not at what Loom left behind.
 */
import path from "node:path";

export type ModuleSource =
  /** A module Penguin assembled, built in its own run workspace. */
  | { kind: "run"; root: string }
  /**
   * A module in the WAF checkout, read only. `output` is where Penguin builds it, since the
   * checkout is not Penguin's to write.
   */
  | { kind: "checkout"; root: string; output: string; moduleFolder: string };

/**
 * The media folders a module's definition loads from, as the sparse media checkout names
 * them: the folder of every `{{MEDIA}}/...` url it requires. The navbar's fonts, icons and
 * shared audio live in folders no activity's own `loom/<product>` folder covers.
 */
export function definitionMediaFolders(definition: unknown): string[] {
  const folders = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const match = /^\{\{MEDIA\}\}\/(.+)\/[^/]+$/.exec(value);
      if (match && !match[1]!.split("/").includes("..")) folders.add(match[1]!);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(definition);
  return [...folders].sort();
}

/** Where a run workspace's `buildDebug` writes the built module. */
export function runBuildOutput(moduleRoot: string): string {
  return path.join(moduleRoot, "dist", "debug");
}

/** The directory, under Penguin's root, that a checkout module is built into. */
export function checkoutOutputRoot(penguinRoot: string, moduleFolder: string): string {
  return path.join(penguinRoot, "activity-sandbox", "modules", moduleFolder);
}

/**
 * Directories of a checkout module that a preview never serves from.
 *
 * `generated` holds Loom's authoring files and reports; `.codex` an agent's notes;
 * `assessments` is read by the server to answer an assessment session, not fetched by the
 * learner runtime. None of it is the module.
 */
const CHECKOUT_CLOSED_DIRS = new Set(["generated", ".codex", "assessments"]);

/** Whether a checkout module may serve this module-relative path at all. */
export function checkoutServable(relative: string): boolean {
  const first = relative.split("/")[0] ?? "";
  return !CHECKOUT_CLOSED_DIRS.has(first);
}

/**
 * The roots a module file is looked for in, in order.
 *
 * Loom's order: the build output (`entry.js`, `style.css`), then the module's `res`
 * (`layout.html`, which a definition names as if it sat beside it), then the module
 * itself. A run workspace's build output is the scaffold's `dist/debug`, then the module,
 * where older assemblies laid their built files.
 */
export function moduleFileRoots(source: ModuleSource): string[] {
  if (source.kind === "run") return [runBuildOutput(source.root), source.root];
  return [source.output, path.join(source.root, "res"), source.root];
}

/** Directories whose files a build reads, relative to the module root. */
export function moduleSourceDirs(source: ModuleSource): string[] {
  return source.kind === "run"
    ? ["module/src", "module/res", "module/generated"].map((dir) =>
        path.join(path.dirname(source.root), dir),
      )
    : ["src", "res"].map((dir) => path.join(source.root, dir));
}
