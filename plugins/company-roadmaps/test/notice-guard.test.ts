/**
 * Every line company-proposals and company-roadmaps tell an employee is a notice: a notify
 * Action a company workflow may replace (notices.ts, company-proposals' notify-actions.ts). A
 * write never delivers by itself. This scans both plugins' sources for the ways a line reaches
 * an employee — a desk delivery (`deliverToDesk(`), and an input into a session through the
 * session runtime (`startTask(` / `steer(`) — and fails on a call outside the functions allowed
 * below, so a new direct delivery cannot slip past the notify Actions.
 *
 * Opening a session (`openEmployeeSession`, whose first message is the session's brief) is not a
 * line told to an existing desk or session, and is not scanned.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIR } from "./action-harness.js";

const PLUGINS = path.dirname(PLUGIN_DIR);

/** A call that delivers, by the pattern that finds it. */
const CALLS: Record<string, RegExp> = {
  deliverToDesk: /\bdeliverToDesk\(/,
  startTask: /\.startTask\(/,
  steer: /\.steer\(/,
};

/**
 * Where each call may appear: `<plugin>/src/<file>#<function>`, with the reason. Exactly these:
 * an entry no call needs any more fails the test too.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  deliverToDesk: {
    "company-proposals/src/desk.ts#deliver": "the built-in proposal notices",
    "company-roadmaps/src/notice-delivery.ts#desk": "the built-in roadmap notices",
  },
  // No plugin puts input into a session itself: a roadmap's room is a channel, which the
  // organization delivers.
  startTask: {},
  steer: {},
};

/** Every `.ts` file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

/** A line that declares a function or a class member (two spaces in): its name. */
const DECLARATION =
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^ {2}(?:(?:private|protected|public|static|readonly|async)\s+)*(?!(?:if|for|while|switch|return|catch|await|const|let|var|throw|try|else|do|new|typeof)\b)([A-Za-z_$][\w$]*)\s*[(<]/;

/** The function a line is in: the nearest declaration above it (or on it). */
function enclosing(lines: string[], at: number): string {
  for (let i = at; i >= 0; i--) {
    const m = DECLARATION.exec(lines[i]!);
    if (m !== null) return m[1] ?? m[2]!;
  }
  return "(top level)";
}

/** Each call of `call` in both plugins' sources, as `<plugin>/src/<file>#<function>`. */
function callSites(call: string): string[] {
  const out: string[] = [];
  for (const plugin of ["company-proposals", "company-roadmaps"]) {
    const src = path.join(PLUGINS, plugin, "src");
    for (const file of sources(src)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").trim();
        if (code.startsWith("*") || code.startsWith("/*")) return;
        if (!CALLS[call]!.test(code)) return;
        const rel = path.relative(PLUGINS, file).split(path.sep).join("/");
        out.push(`${rel}#${enclosing(lines, i)}`);
      });
    }
  }
  return out;
}

describe("notices are the only deliveries", () => {
  for (const call of Object.keys(CALLS)) {
    it(`${call} is called only where a notice delivers`, () => {
      const sites = callSites(call);
      const allowed = Object.keys(ALLOWED[call] ?? {});
      expect(sites.filter((s) => !allowed.includes(s))).toEqual([]);
      expect([...new Set(sites)].sort()).toEqual([...allowed].sort());
    });
  }
});
