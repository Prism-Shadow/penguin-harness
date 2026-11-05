/**
 * A Web App's files carrying a page runtime in the shape the Web App build gives it
 * (`workbench-runtime/`): a manifest, the ES modules and stylesheet the routes serve, and
 * declarations laid out as a node_modules root — a component with typed props, and just enough
 * of React for JSX, small enough to read.
 *
 * git and the test host's sync both skip any directory named node_modules, so the declarations
 * are kept under `types/modules/` and laid out under `types/node_modules/` in the copy.
 */
import fs from "node:fs/promises";
import path from "node:path";

const FIXTURE = path.join(import.meta.dirname, "workbench-runtime");

/** Writes the Web App's files under `root` and returns their directory (a `webDist`). */
export async function webDistWithUiRuntime(root: string): Promise<string> {
  const web = path.join(root, "web-dist");
  const runtime = path.join(web, "workbench-runtime");
  await fs.cp(FIXTURE, runtime, { recursive: true });
  await fs.rename(
    path.join(runtime, "types", "modules"),
    path.join(runtime, "types", "node_modules"),
  );
  return web;
}
