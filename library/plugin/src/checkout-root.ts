/**
 * The root of the checkout `fromDir` lies in — the directory holding `pnpm-workspace.yaml` —
 * or null outside one.
 *
 * Walks up rather than counting `..` segments, because the depth differs between a `tsx` run
 * (`packages/server/src/…`), a built one (`packages/server/dist/…`), the desktop shell's
 * single-file bundle, and a copy pnpm injected into another package's `node_modules`. Outside
 * a checkout (an npm install, a packaged app) the walk reaches the filesystem root.
 */
import fs from "node:fs";
import path from "node:path";

export function checkoutRoot(fromDir: string): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
