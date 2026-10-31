/**
 * The main app's PWA manifest: the shipped `manifest.webmanifest` matches the web package's
 * own `package.json` (its `version`; the user-facing `name` is the product's), and
 * `index.html` links it — the install surface ("add to home screen") would otherwise be
 * missing, or stale against the package.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");

describe("the main app's manifest", () => {
  it("matches the web package's name and version", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const manifest = JSON.parse(
      await fs.readFile(path.join(pkgDir, "public", "manifest.webmanifest"), "utf8"),
    ) as Record<string, unknown>;
    // `name` is the product's, not the npm scope's; `version` stays the package's own.
    expect(manifest.name).toBe("PenguinHarness");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    const icons = manifest.icons as { src: string; sizes: string; type: string }[];
    for (const src of icons.map((i) => i.src.replace(/^\//, ""))) {
      await expect(fs.stat(path.join(pkgDir, "public", src))).resolves.toBeTruthy();
    }
  });

  it("is linked from index.html", async () => {
    const html = await fs.readFile(path.join(pkgDir, "index.html"), "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
  });
});
