import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { computeSamplesSourceHash } from "./doc-samples.js";
import { extractAll } from "./extract.js";
import { slugOf } from "./jsdoc.js";
import { kernelBadgeMeta, RenderContext } from "./render/context.js";
import { createKernelRenderer } from "./render/kernel.js";
import { createPagesRenderer } from "./render/pages.js";
import type { ExtractedData, VerifiedSample, VerifiedSamplesFile } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const REPO = process.env.PENGUIN_REFS_REPO || path.resolve(PKG_ROOT, "../../..");
const OUT = process.env.PENGUIN_REFS_OUT || path.join(PKG_ROOT, "dist");
const ALLOW_UNVERIFIED = process.argv.includes("--allow-unverified-samples");
const OWNED_MARKER = ".penguin-refs-generated";

interface SearchHit {
  t: string;
  sub: string;
  k: string;
  c: string;
  u: string;
}

function isPathInsideOrEqual(parentDir: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(parentDir), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function canonicalExisting(p: string): string {
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) return fs.realpathSync(abs);
  const parent = path.dirname(abs);
  if (parent === abs) return abs;
  return path.join(canonicalExisting(parent), path.basename(abs));
}

function assertNoSymlinkSegments(rootDir: string, targetPath: string): void {
  const rel = path.relative(rootDir, targetPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to access outside output root (${rootDir}): ${targetPath}`);
  }
  let cur = rootDir;
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg);
    if (fs.existsSync(cur) || isSymlink(cur)) {
      if (isSymlink(cur)) {
        throw new Error(`Refusing to traverse or overwrite symlink inside output root: ${cur}`);
      }
    }
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

const OWNED_MARKER_PREFIX = "generatedBy=@prismshadow/penguin-references\n";
const ROOT_INDEX_HTML =
  '<!doctype html><meta charset="utf-8"><title>PenguinHarness References</title><meta http-equiv="refresh" content="0; url=references/"><p><a href="references/">References</a></p>';

function hasValidOwnershipMarker(refsOutDir: string): boolean {
  const markerPath = path.join(refsOutDir, OWNED_MARKER);
  try {
    const stat = fs.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return fs.readFileSync(markerPath, "utf8").startsWith(OWNED_MARKER_PREFIX);
  } catch {
    return false;
  }
}

function assertSafeCleanDir(canonicalOut: string, refsOutDir: string, repoDir: string): void {
  const canonicalPkg = canonicalExisting(PKG_ROOT);
  const canonicalRepo = canonicalExisting(repoDir);
  const canonicalTarget = canonicalExisting(refsOutDir);

  if (
    isPathInsideOrEqual(canonicalTarget, canonicalPkg) ||
    isPathInsideOrEqual(path.join(canonicalPkg, "src"), canonicalTarget) ||
    isPathInsideOrEqual(canonicalTarget, canonicalRepo)
  ) {
    throw new Error(
      `Refusing destructive cleanup of ${canonicalTarget}: directory overlaps source package or repository.`,
    );
  }

  if (isSymlink(refsOutDir)) {
    throw new Error(`Refusing destructive cleanup of symlinked output directory: ${refsOutDir}`);
  }

  const markerValid = hasValidOwnershipMarker(refsOutDir);
  if (fs.existsSync(refsOutDir)) {
    const stat = fs.lstatSync(refsOutDir);
    if (!stat.isDirectory()) {
      throw new Error(`Refusing cleanup of non-directory path: ${refsOutDir}`);
    }
    const entries = fs.readdirSync(refsOutDir);
    if (entries.length > 0 && !markerValid) {
      throw new Error(
        `Refusing to delete pre-existing non-empty directory ${refsOutDir} without valid generator ownership marker (${OWNED_MARKER}). Choose an empty output directory or remove it manually.`,
      );
    }
  }

  // Preflight root index.html ownership before any cleanup
  const rootIndexPath = path.join(canonicalOut, "index.html");
  if (fs.existsSync(rootIndexPath) || isSymlink(rootIndexPath)) {
    const idxStat = fs.lstatSync(rootIndexPath);
    if (!idxStat.isFile() || idxStat.isSymbolicLink()) {
      throw new Error(
        `Refusing to overwrite non-regular or symlinked root index: ${rootIndexPath}`,
      );
    }
    const existingIdx = fs.readFileSync(rootIndexPath, "utf8");
    if (existingIdx !== ROOT_INDEX_HTML) {
      throw new Error(
        `Refusing to overwrite pre-existing non-generator homepage at ${rootIndexPath}.`,
      );
    }
  }

  assertNoSymlinkSegments(canonicalOut, refsOutDir);
}

function writeFileAtomically(
  canonicalOut: string,
  fullPath: string,
  content: string | Buffer,
): void {
  assertNoSymlinkSegments(canonicalOut, fullPath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  const canonicalDir = fs.realpathSync(dir);
  if (!isPathInsideOrEqual(canonicalOut, canonicalDir)) {
    throw new Error(`Canonical parent escaped output root (${canonicalOut}): ${canonicalDir}`);
  }
  const canonicalTarget = path.join(canonicalDir, path.basename(fullPath));
  if (isSymlink(canonicalTarget)) {
    throw new Error(`Refusing to overwrite symlink destination: ${canonicalTarget}`);
  }
  const tmpPath = path.join(
    canonicalDir,
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.writeFileSync(tmpPath, content);
  try {
    fs.renameSync(tmpPath, canonicalTarget);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

function loadTwoslashCss(): string {
  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve("@shikijs/twoslash/style-rich.css");
    return fs.readFileSync(resolved, "utf8");
  } catch {
    const fallback = path.join(PKG_ROOT, "node_modules/@shikijs/twoslash/style-rich.css");
    if (fs.existsSync(fallback)) return fs.readFileSync(fallback, "utf8");
    console.warn("Warning: @shikijs/twoslash/style-rich.css not found; Twoslash styles omitted.");
    return "";
  }
}

function loadVerifiedSamples(
  repoDir: string,
  allowUnverified: boolean,
): Record<string, VerifiedSample> {
  const verifiedPath = path.join(PKG_ROOT, "doc-samples/verified-samples.json");
  if (!fs.existsSync(verifiedPath)) {
    if (allowUnverified) return {};
    throw new Error(
      `Missing ${verifiedPath}. Run "npm run verify-samples" (or pass --allow-unverified-samples) before building.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(verifiedPath, "utf8")) as Partial<VerifiedSamplesFile>;
  const expectedHash = computeSamplesSourceHash(repoDir);
  if (!allowUnverified) {
    if (raw.allPassed !== true) {
      throw new Error(
        `Verified samples artifact ${verifiedPath} contains failures. Fix failing samples or pass --allow-unverified-samples.`,
      );
    }
    if (raw.sourceHash !== expectedHash) {
      throw new Error(
        `Verified samples artifact ${verifiedPath} is stale (sourceHash mismatch). Re-run "verify-samples" before building.`,
      );
    }
  }
  return raw.samples ?? {};
}

function buildSearchIndex(data: ExtractedData): SearchHit[] {
  return [
    {
      t: "@prismshadow/penguin-core/kernel",
      sub: `Kernel Package · ${data.kernel.exports.length} exports`,
      k: "decorator",
      c: "K",
      u: "kernel/index.html",
    },
    ...data.kernel.exports.map((k) => {
      const bm = kernelBadgeMeta(k.kind);
      return {
        t: k.kind === "decorator" ? `@${k.name}` : k.name,
        sub: `Kernel · ${k.sourceFile}`,
        k: bm.tKey,
        c: bm.ch,
        u: `kernel/${k.slug}/`,
      };
    }),
    ...data.modules.map((m) => ({
      t: m.name,
      sub: `Module · ${m.pkg}`,
      k: "ng_module",
      c: "M",
      u: `modules/${m.slug}/`,
    })),
    ...data.components.map((c) => ({
      t: c.name,
      sub: `Component · ${c.primaryParent ? c.primaryParent.name : c.pkg}`,
      k: "class",
      c: "C",
      u: c.href,
    })),
    ...data.ifaces.map((i) => ({
      t: i.name,
      sub: `Interface · ${i.pkg}`,
      k: "interface",
      c: "I",
      u: `interfaces/${i.slug}/`,
    })),
    ...data.httpContribs.map((g) => ({
      t: g.cls,
      sub: `HTTP · ${g.entries.map((e) => e.prefix).join(" ")}`,
      k: "pipe",
      c: "H",
      u: `apis/http/${g.slug}/`,
    })),
    ...data.cliCommands.map((c) => ({
      t: `penguin ${c.name}`,
      sub: `CLI · ${c.brief.slice(0, 48)}`,
      k: "function",
      c: "F",
      u: `apis/cli/${c.slug}/`,
    })),
    ...data.slots.map((s) => ({
      t: s.key,
      sub: `Slot · ${s.host} (${s.contributors.length} contributors)`,
      k: "directive",
      c: "S",
      u: `contributions/index.html#${slugOf(s.key)}`,
    })),
  ];
}

function buildClientBundle(searchIndex: readonly SearchHit[]): string {
  const clientPath = path.join(HERE, "client/app.ts");
  const clientSrc = fs.readFileSync(clientPath, "utf8");
  const transpiled = ts.transpileModule(clientSrc, {
    fileName: clientPath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      removeComments: true,
    },
  });
  const safeIndex = JSON.stringify(searchIndex).replace(/</g, "\\u003c");
  return `window.penguinSearchIndex=${safeIndex};\n${transpiled.outputText}`;
}

function buildStyleBundle(): string {
  const baseCss = fs.readFileSync(path.join(HERE, "styles/theme.css"), "utf8");
  const twoslashCss = loadTwoslashCss();
  const refsCss = fs.readFileSync(path.join(HERE, "styles/references.css"), "utf8");
  return [baseCss, twoslashCss, refsCss].filter(Boolean).join("\n");
}

export function buildSite(
  repoDir = REPO,
  outDir = OUT,
  opts: { allowUnverified?: boolean } = {},
): { pageCount: number; outDir: string } {
  const resolvedRepo = path.resolve(repoDir);
  const resolvedOut = path.resolve(outDir);
  if (isSymlink(resolvedOut)) {
    throw new Error(`Refusing to build into symlinked output root: ${resolvedOut}`);
  }
  fs.mkdirSync(resolvedOut, { recursive: true });
  const canonicalOut = fs.realpathSync(resolvedOut);
  const refsOutDir = path.join(canonicalOut, "references");
  assertSafeCleanDir(canonicalOut, refsOutDir, resolvedRepo);

  const data = extractAll(resolvedRepo);
  const verifiedSamples = loadVerifiedSamples(
    resolvedRepo,
    opts.allowUnverified ?? ALLOW_UNVERIFIED,
  );
  const styleBundle = buildStyleBundle();
  const appBundle = buildClientBundle(buildSearchIndex(data));
  const assetVer = createHash("sha256")
    .update(styleBundle)
    .update(appBundle)
    .digest("hex")
    .slice(0, 10);

  const ctx = new RenderContext(data, verifiedSamples, assetVer);
  const kernel = createKernelRenderer(ctx);
  const pages = createPagesRenderer(ctx);

  fs.rmSync(refsOutDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(refsOutDir, "assets"), { recursive: true });
  writeFileAtomically(
    canonicalOut,
    path.join(refsOutDir, OWNED_MARKER),
    `generatedBy=@prismshadow/penguin-references\ngitSha=${ctx.gitSha}\n`,
  );

  const logoPath = path.join(resolvedRepo, "packages/web/public/penguin-logo.svg");
  if (fs.existsSync(logoPath)) {
    writeFileAtomically(
      canonicalOut,
      path.join(refsOutDir, "assets/penguin-logo.svg"),
      fs.readFileSync(logoPath),
    );
  } else {
    console.warn(`Warning: logo not found at ${logoPath}`);
  }

  let pageCount = 0;
  const emittedLowerPaths = new Set<string>();
  const write = (relPath: string, content: string): void => {
    const normalized = relPath.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`Invalid relative output path: ${normalized}`);
    }
    const lower = normalized.toLowerCase();
    if (emittedLowerPaths.has(lower)) {
      throw new Error(`Case-insensitive static path collision: ${normalized}`);
    }
    emittedLowerPaths.add(lower);
    const fullPath = path.resolve(canonicalOut, normalized);
    if (!isPathInsideOrEqual(canonicalOut, fullPath) || fullPath === canonicalOut) {
      throw new Error(`Refusing to write outside output root (${canonicalOut}): ${normalized}`);
    }
    writeFileAtomically(canonicalOut, fullPath, content);
    if (normalized.endsWith(".html")) pageCount++;
  };

  write("index.html", ROOT_INDEX_HTML);
  write("references/index.html", pages.landing());
  write("references/assets/style.css", styleBundle);
  write("references/assets/app.js", appBundle);

  // @prismshadow/penguin-core/kernel showcase
  write("references/kernel/index.html", kernel.kernelOverviewPage());
  for (const k of data.kernel.exports) {
    write(`references/kernel/${k.slug}/index.html`, kernel.kernelSymbolPage(k));
  }

  // Modules & Components
  write("references/modules/index.html", pages.modulesIndex());
  for (const m of data.modules)
    write(`references/modules/${m.slug}/index.html`, pages.modulePage(m));
  for (const c of data.components) {
    write(`references/${c.href}index.html`, pages.componentPage(c));
  }

  // Interfaces
  write("references/interfaces/index.html", pages.ifacesIndex());
  for (const it of data.ifaces) {
    write(`references/interfaces/${it.slug}/index.html`, pages.ifacePage(it));
  }

  // External APIs (HTTP & CLI)
  write("references/apis/index.html", pages.apiIndex());
  for (const g of data.httpContribs) {
    write(`references/apis/http/${g.slug}/index.html`, pages.httpPage(g));
  }
  for (const c of data.cliCommands) {
    write(`references/apis/cli/${c.slug}/index.html`, pages.cliPage(c));
  }

  // Contribution Slots
  write("references/contributions/index.html", pages.contributionsPage());

  console.log(
    `Generated ${pageCount} HTML pages from ${ctx.gitSha} (${data.git.date.slice(0, 10)})`,
  );
  console.log(
    `Kernel: ${data.kernel.exports.length} | Modules: ${data.modules.length} | Components: ${data.components.length} | Interfaces: ${data.ifaces.length} | HTTP: ${data.httpContribs.length} | CLI: ${data.cliCommands.length} | Slots: ${data.slots.length}`,
  );
  console.log(`Output: ${canonicalOut}`);
  return { pageCount, outDir: canonicalOut };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite();
}
