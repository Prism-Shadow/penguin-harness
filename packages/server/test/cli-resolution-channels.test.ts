/**
 * The six channel rows of the RFC's table, one test each: npm package, release tarball,
 * Docker image, desktop application, source checkout, and a machines-installed peer.
 *
 * Each fixture lays out the product the way that channel ships it — where its manifest, its
 * installed entry and its loader sit relative to one another — so the row is exercised by
 * the layout the channel really has, not by a name. Every answer must come from the
 * manifest the product carries. The desktop row is the exception that proves the rule: that
 * product carries no declaration and no loader, and the row says so.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_LOADER_NAME, loaderDeclarationFor, resolveCli } from "../src/cli-resolution.js";

const made: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Lays a CLI product down in `dir`: manifest, installed entry, loader beside it. */
async function layProduct(
  dir: string,
  options: { declare?: boolean } = {},
): Promise<{ entry: string; loader: string }> {
  const dist = path.join(dir, "dist");
  await fs.mkdir(dist, { recursive: true });
  const entry = path.join(dist, "penguin.js");
  const loader = path.join(dist, LEGACY_LOADER_NAME);
  await fs.writeFile(entry, "export const cli = async () => 0;\n");
  await fs.writeFile(loader, "export const cli = async () => 0;\n");
  const manifest: Record<string, unknown> = {
    name: "fixture-cli",
    version: "0.0.0",
    bin: { penguin: "./dist/penguin.js", "penguin-hmr": `./dist/${LEGACY_LOADER_NAME}` },
  };
  if (options.declare !== false) {
    manifest.penguin = { pushedCliLoader: `./dist/${LEGACY_LOADER_NAME}` };
  }
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return { entry, loader };
}

/** A data root holding a record for a CLI bundle the store still has. */
async function pushedRoot(): Promise<string> {
  const root = await tmp("penguin-channel-root-");
  const store = path.join(root, "hmr", "store", "cli");
  await fs.mkdir(store, { recursive: true });
  await fs.writeFile(path.join(store, "abc123.mjs"), "export const cli = async () => 0;\n");
  await fs.writeFile(
    path.join(root, "hmr", "harness.json"),
    JSON.stringify({ cli: { bundle: "store/cli/abc123.mjs" } }),
  );
  return root;
}

describe("each channel answers from the declaration its product carries", () => {
  it("npm package: the manifest beside the installed bin, reached through node_modules/.bin", async () => {
    const project = await tmp("penguin-channel-npm-");
    const pkg = path.join(project, "node_modules", "@prismshadow", "penguin-cli");
    const product = await layProduct(pkg);
    const bin = path.join(project, "node_modules", ".bin");
    await fs.mkdir(bin, { recursive: true });
    const linked = path.join(bin, "penguin");
    await fs.symlink(path.relative(bin, product.entry), linked);

    const resolved = await resolveCli({
      self: linked,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(linked),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });
  });

  it("release tarball: the deployed lib/, whose manifest pnpm deploy carries", async () => {
    const install = await tmp("penguin-channel-tarball-");
    const lib = path.join(install, "lib");
    const product = await layProduct(lib);
    // The launcher the payload ships beside lib/ is the installed entry; the CLI it execs
    // is what resolution answers for.
    await fs.mkdir(path.join(install, "bin"), { recursive: true });
    await fs.writeFile(
      path.join(install, "bin", "penguin"),
      '#!/bin/sh\nexec node ../lib/dist/penguin.js "$@"\n',
    );

    // `penguin server` runs through the launcher and tells the server its own entry, which
    // is the CLI the launcher execs.
    const resolved = await resolveCli({
      self: product.entry,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });
  });

  it("Docker image: the declaration travels inside lib/, and the PATH symlink resolves to it", async () => {
    const image = await tmp("penguin-channel-docker-");
    const product = await layProduct(path.join(image, "opt", "penguin", "lib"));
    const localBin = path.join(image, "usr", "local", "bin");
    await fs.mkdir(localBin, { recursive: true });
    const linked = path.join(localBin, "penguin");
    await fs.symlink(path.relative(localBin, product.entry), linked);

    // The image's PATH entry is extension-less today; the declaration is still found
    // through it, which is what a re-runnable entry shape would use. Until it is reshaped,
    // a consumer records `entry-not-respawnable` for that entry.
    expect(path.extname(linked)).toBe("");
    await expect(loaderDeclarationFor(linked)).resolves.toMatchObject({
      kind: "declared",
      declaration: { file: product.loader },
    });
    const resolved = await resolveCli({
      self: product.loader,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(product.loader),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });
  });

  it("desktop application: the app ships no loader today, so a pushed CLI answers `loader-absent`", async () => {
    const app = await tmp("penguin-channel-desktop-");
    // The app bundles the CLI and the server into its own dist/ and its manifest declares no
    // loader — the channel's gap, unchanged while the desktop package is untouched. Its data
    // root can receive a CLI push and has nothing to run it with, and the answer says so
    // instead of falling back to the bundled CLI.
    const dist = path.join(app, "dist");
    await fs.mkdir(dist, { recursive: true });
    const entry = path.join(dist, "penguin.js");
    await fs.writeFile(entry, "export const cli = async () => 0;\n");
    await fs.writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ name: "penguin-desktop", version: "0.0.0", main: "dist/main.js" }, null, 2),
    );

    await expect(loaderDeclarationFor(entry)).resolves.toMatchObject({ kind: "absent" });
    const resolved = await resolveCli({
      self: entry,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(entry),
    });
    expect(resolved).toMatchObject({ kind: "fault", fault: "loader-absent" });
  });

  it("source checkout: the built loader beside the built CLI; an unbuilt checkout names the gap", async () => {
    const checkout = await tmp("penguin-channel-source-");
    const cli = path.join(checkout, "packages", "cli");
    const product = await layProduct(cli);
    const source = path.join(cli, "src", "penguin.ts");
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, "export const cli = async () => 0;\n");

    const built = await resolveCli({
      self: source,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(source),
    });
    expect(built).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });

    // The same checkout with nothing built: the declaration names a loader that is not
    // there, and that is a named fault rather than a silent fallback.
    await fs.rm(path.join(cli, "dist"), { recursive: true, force: true });
    const unbuilt = await resolveCli({
      self: source,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(source),
    });
    expect(unbuilt).toMatchObject({ kind: "fault", fault: "loader-missing" });
  });

  it("machines peer: the loader is the peer's only CLI face, and its record decides", async () => {
    const peer = await tmp("penguin-channel-peer-");
    const program = path.join(peer, "program");
    const product = await layProduct(path.join(program, "lib"));

    // The loader is the peer's only CLI face: a caller that reaches the machine runs this
    // entry, and the peer's own record decides what it loads.
    const installed = await resolveCli({
      self: product.loader,
      root: await pushedRoot(),
      declaration: await loaderDeclarationFor(product.loader),
    });
    expect(installed).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });

    // A bare release never installed from a peer and never pushed to answers `no-record`
    // when its loader runs on that root — the loader's own test covers that report, since
    // resolution above has already answered with the loader itself.
  });
});
