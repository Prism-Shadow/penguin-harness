// Runtime for SkillWeaver API scripts, shipped by skillweaver-rsi-toolkit. Every API in a Target's
// skill library imports it as `./skillweaver-api.mjs`; the controller copies this file there unchanged.
//
// An API is a Node ES module with `export const meta`, `export async function run(args)` and a last
// line `runApi(import.meta.url, meta, run);`. Called as `node <api>.mjs --args '<json>'`, it drives
// the agent browser through `penguin browser … --json` and prints exactly one JSON line:
// {"ok":true,"result":…} or {"ok":false,"error":"…"} (exit code 1). Imported, it does nothing,
// so the checker can read `meta` without touching the browser.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PARAM_TYPES = ["string", "number", "boolean"];

/**
 * Read the PenguinHarness server's Windows shim (`penguin.cmd`): its launch line
 * `"<runtime>" ["<arg>" …] "<entry>" %*` and the variables it sets. Running that command
 * directly keeps cmd.exe out of the way: cmd cannot carry a newline in an argument and re-parses
 * quotes and `& | < >`, all of which a browser script holds. Returns null for a stub shim (no
 * launch line), whose message the caller reports.
 */
export function parseWindowsShim(text, env = process.env) {
  const unescape = (s) => s.replaceAll("%%", "%");
  const extra = {};
  let launch = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const cond = line.match(/^if not defined PENGUIN_HOME set "([A-Z_]+)=(.*)"$/);
    if (cond) {
      if (!env.PENGUIN_HOME) extra[cond[1]] = unescape(cond[2]);
      continue;
    }
    const set = line.match(/^set "([A-Z_]+)=(.*)"$/);
    if (set) {
      extra[set[1]] = unescape(set[2]);
      continue;
    }
    if (line.endsWith(" %*") && line.startsWith('"')) {
      launch = [...line.slice(0, -3).matchAll(/"([^"]*)"/g)].map((m) => unescape(m[1]));
    }
  }
  if (launch === null || launch.length < 2) return null;
  return { command: launch[0], args: launch.slice(1), env: extra };
}

let resolved = null;

/** How to start `penguin`: an override for tests, the Windows shim's command, else `penguin`. */
export function resolvePenguin(env = process.env, platform = process.platform) {
  const override = env.SKILLWEAVER_PENGUIN;
  if (override) {
    // A JavaScript stand-in runs on this Node, so tests need no executable bit or shebang.
    return /\.(c|m)?js$/.test(override)
      ? { command: process.execPath, args: [override], env: {} }
      : { command: override, args: [], env: {} };
  }
  if (platform !== "win32") return { command: "penguin", args: [], env: {} };
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const shim = path.join(dir, "penguin.cmd");
    if (!existsSync(shim)) continue;
    const text = readFileSync(shim, "utf8");
    const parsed = parseWindowsShim(text, env);
    if (parsed !== null) return parsed;
    const why =
      text
        .split(/\r?\n/)
        .map((l) => l.trim().match(/^(?:>&2\s+)?echo\s+(?!off$)(.*)$/)?.[1])
        .find((m) => m !== undefined)
        ?.replace(/\^(.)/g, "$1") ?? "it has no launch line";
    throw new Error(`${shim} cannot start the CLI: ${why}`);
  }
  throw new Error("no penguin.cmd on PATH: run this from a PenguinHarness Agent's shell");
}

function call(args, { timeoutMs } = {}) {
  resolved ??= resolvePenguin();
  let out;
  try {
    out = execFileSync(resolved.command, [...resolved.args, "browser", ...args, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs ?? 120_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...resolved.env },
      windowsHide: true,
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

/**
 * Parse `--args '<json>'`, or `--args-file <file>` holding that JSON (for a shell such as Windows
 * PowerShell 5.1, which strips the quotes inside an argument); `{}` when neither is given.
 */
export function parseArgs(argv) {
  const inline = argv.indexOf("--args");
  const file = argv.indexOf("--args-file");
  if (inline !== -1 && file !== -1) throw new Error("give --args or --args-file, not both");
  let raw;
  if (inline !== -1) raw = argv[inline + 1];
  else if (file !== -1) {
    if (argv[file + 1] === undefined) throw new Error("--args-file needs a file");
    raw = readFileSync(argv[file + 1], "utf8");
  } else return {};
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

/**
 * Whether two paths name the same file. Symlinks are resolved first: `import.meta.url` names the
 * real file while `process.argv[1]` keeps the path as typed (macOS's /var -> /private/var, a
 * symlinked home or data root). Windows paths compare without case.
 */
export function samePath(a, b, platform = process.platform) {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const norm = (p) =>
    platform === "win32" ? path.win32.resolve(real(p)).toLowerCase() : path.resolve(real(p));
  return norm(a) === norm(b);
}

function isMain(moduleUrl) {
  const entry = process.argv[1];
  return entry !== undefined && samePath(entry, fileURLToPath(moduleUrl));
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
