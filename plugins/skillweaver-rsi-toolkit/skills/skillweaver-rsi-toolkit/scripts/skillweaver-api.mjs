// Runtime for SkillWeaver API scripts, shipped by skillweaver-rsi-toolkit. Every API in a Target's
// skill library imports it as `./skillweaver-api.mjs`; the controller copies this file there unchanged.
//
// An API is a Node ES module with `export const meta`, `export async function run(args)` and a last
// line `runApi(import.meta.url, meta, run);`. Called as `node <api>.mjs --args '<json>'`, it drives
// the agent browser through `penguin browser … --json` and prints exactly one JSON line:
// {"ok":true,"result":…} or {"ok":false,"error":"…"} (exit code 1). Imported, it does nothing,
// so the checker can read `meta` without touching the browser.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PARAM_TYPES = ["string", "number", "boolean"];

/** The `penguin` executable; overridable for tests. */
function penguinBin() {
  return process.env.SKILLWEAVER_PENGUIN || "penguin";
}

function call(args, { timeoutMs } = {}) {
  let out;
  try {
    out = execFileSync(penguinBin(), ["browser", ...args, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs ?? 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    // A failed exec/click/type still prints its JSON result before exiting 1.
    out = typeof err.stdout === "string" ? err.stdout : "";
    if (!out.trim()) {
      const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
      throw new Error(`penguin browser ${args[0]} failed: ${stderr || err.message}`);
    }
  }
  let res;
  try {
    res = JSON.parse(out);
  } catch {
    throw new Error(`penguin browser ${args[0]} printed no JSON: ${out.slice(0, 200)}`);
  }
  if (res && res.status === "failed") {
    throw new Error(`penguin browser ${args[0]} failed: ${res.error ?? "unknown error"}`);
  }
  return res;
}

/** The site this library was learned on: `library.json` beside the API files. */
export function librarySite(dir) {
  const lib = JSON.parse(readFileSync(path.join(dir, "library.json"), "utf8"));
  if (typeof lib.site !== "string" || !/^https?:\/\//.test(lib.site)) {
    throw new Error("library.json has no http(s) `site`");
  }
  return lib.site;
}

/** Resolve a site-relative path ("/search?q=x") against the library's site. */
export function resolveOnSite(site, rel) {
  if (typeof rel !== "string" || !rel.startsWith("/")) {
    throw new Error(
      `browser.open takes a site-relative path starting with "/", got ${JSON.stringify(rel)}`,
    );
  }
  const base = new URL(site);
  const basePath = base.pathname.replace(/\/+$/, "");
  return new URL(basePath + rel, base.origin).toString();
}

let currentSite = null;

/** Thin wrappers over `penguin browser`; each throws on a failed call. */
export const browser = {
  /** Navigate the active tab to a site-relative path. Returns the tab ({id, url, title}). */
  open(rel) {
    if (currentSite === null) throw new Error("browser.open called outside runApi");
    return call(["open", resolveOnSite(currentSite, rel)]).tab;
  },
  /** Run JavaScript in the page; returns its `return` value. Use JSON.stringify for arguments. */
  exec(script, { timeout = "30s" } = {}) {
    return call(["exec", script, "--timeout", timeout], { timeoutMs: 180_000 }).value;
  },
  /** A trusted click on the first (or `index`-th) element matching a CSS selector. */
  click(selector, { index } = {}) {
    const args = ["click", selector];
    if (index !== undefined) args.push("--index", String(index));
    return call(args);
  },
  /** Trusted typing into the focused element or `selector`; `submit` presses Enter. */
  type(text, { selector, submit = false } = {}) {
    const args = ["type", text];
    if (selector !== undefined) args.push("--selector", selector);
    if (submit) args.push("--submit");
    return call(args);
  },
  /** The page as plain text (costly: prefer a targeted exec). */
  text({ maxChars = 8000 } = {}) {
    return call(["scan", "--text", "--max-chars", String(maxChars)]);
  },
  /** Wait until `predicate` (a JS expression) is truthy in the page, polling inside it. */
  waitFor(predicate, { timeoutMs = 10_000 } = {}) {
    return this.exec(
      `const end = Date.now() + ${Number(timeoutMs)};
while (Date.now() < end) {
  if (${predicate}) return true;
  await new Promise((r) => setTimeout(r, 250));
}
return false;`,
      { timeout: `${Math.ceil(timeoutMs / 1000) + 5}s` },
    );
  },
};

/** Parse `--args '<json>'` (default `{}`) from argv. */
export function parseArgs(argv) {
  const i = argv.indexOf("--args");
  if (i === -1) return {};
  const raw = argv[i + 1];
  if (raw === undefined) throw new Error("--args needs a JSON object");
  const value = JSON.parse(raw);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--args must be a JSON object");
  }
  return value;
}

/** Check call arguments against `meta.params`: every param present, typed, nothing extra. */
export function checkCallArgs(meta, args) {
  const params = meta.params ?? {};
  for (const [name, spec] of Object.entries(params)) {
    if (!(name in args)) {
      if (spec.optional === true) continue;
      throw new Error(`missing argument "${name}"`);
    }
    if (typeof args[name] !== spec.type) {
      throw new Error(`argument "${name}" must be a ${spec.type}`);
    }
  }
  for (const name of Object.keys(args)) {
    if (!(name in params)) throw new Error(`unknown argument "${name}"`);
  }
}

function isMain(moduleUrl) {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(moduleUrl);
}

/** The API's entry point: runs `run(args)` only when the file is executed directly. */
export async function runApi(moduleUrl, meta, run) {
  if (!isMain(moduleUrl)) return;
  try {
    const args = parseArgs(process.argv);
    checkCallArgs(meta, args);
    currentSite = librarySite(path.dirname(fileURLToPath(moduleUrl)));
    const result = await run(args);
    process.stdout.write(`${JSON.stringify({ ok: true, result: result ?? null })}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: String(err?.message ?? err) })}\n`);
    process.exitCode = 1;
  }
}
