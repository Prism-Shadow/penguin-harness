/**
 * The main app's PWA manifest: it is generated, not shipped — the vite plugin
 * (`scripts/penguin-manifest.ts`) builds it from this package's `package.json` at build time
 * and answers it from the dev server, so the only source of `name`/`description`/`version` is
 * the package itself, and `index.html` links it. The assertions run the generator against the
 * real package.json: were the manifest ever hand-written beside the package, or the generator
 * lose a field, one of these fails.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appManifest, MANIFEST_FILE, manifestMiddleware } from "../scripts/penguin-manifest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");

describe("the main app's manifest", () => {
  it("is generated from the web package's package.json", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      description: string;
    };
    const manifest = appManifest(pkg);
    // Bump the package version and the manifest follows — no second hand-written copy.
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description).toBe(pkg.description);
    expect(manifest.name).toBe("PenguinHarness");
    expect(manifest.short_name).toBe("PenguinHarness");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    // One SVG icon, the penguin logo — no raster PNGs, the file is an asset of public/.
    expect(manifest.icons).toEqual([
      { src: "/penguin-logo.svg", sizes: "any", type: "image/svg+xml" },
    ]);
    await expect(fs.stat(path.join(pkgDir, "public", "penguin-logo.svg"))).resolves.toBeTruthy();
    for (const png of ["penguin-logo-192.png", "penguin-logo-512.png"]) {
      await expect(fs.stat(path.join(pkgDir, "public", png))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it("is not a committed file, and is answered by the dev middleware", async () => {
    await expect(fs.stat(path.join(pkgDir, "public", MANIFEST_FILE))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8")) as {
      version: string;
    };
    const middleware = manifestMiddleware(appManifest(pkg));
    const chunks: string[] = [];
    const res = { statusCode: 0, setHeader() {}, end: (b: string) => chunks.push(b) };
    middleware({ url: `/${MANIFEST_FILE}` }, res as never, () => {
      throw new Error("the middleware must answer, not pass on");
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(chunks.join(""))).toMatchObject({ version: pkg.version });
  });

  it("is linked from index.html", async () => {
    const html = await fs.readFile(path.join(pkgDir, "index.html"), "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
  });
});
