/**
 * The checker the a2ui skill ships: `node check.mjs [draft.md] [--lang zh|en|auto] [--json]
 * [--rubric]`. Reads a file or stdin, prints the report (or the JSON), and exits 1 on any error,
 * 0 otherwise, 2 on usage or I/O failure. This file is the only Node-dependent one in the
 * directory; scripts/build-a2ui-check.mjs bundles it into
 * plugins/a2ui/skills/a2ui/scripts/check.mjs, and it is not part of the package's exports.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkReply } from "./check.js";
import { formatReport } from "./report.js";
import type { A2uiLangOption } from "./types.js";

export const USAGE = `usage: node check.mjs [draft.md] [--lang zh|en|auto] [--json] [--rubric]

Checks a reply that carries a2ui or mermaid blocks: L1 validity per block, L2 heuristics across
blocks, the STE-lite prose lint, and a score. Reads the file, or stdin when no file is given.
  --lang      prose rules and rubric language; auto (default) picks zh when CJK dominates
  --json      print the report as JSON instead of text
  --rubric    append the self-review questions
exit code: 0 no errors · 1 at least one error · 2 usage or I/O failure`;

export interface CliIo {
  readStdin: () => string;
  stdinIsTTY: boolean;
  readFile: (file: string) => string;
  out: (text: string) => void;
  err: (text: string) => void;
}

const LANGS: ReadonlySet<string> = new Set(["zh", "en", "auto"]);

/** Runs the checker on argv (without node and the script path); returns the exit code. */
export function runCli(argv: string[], io: CliIo): number {
  let file: string | undefined;
  let lang: A2uiLangOption = "auto";
  let json = false;
  let rubric = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      io.out(USAGE);
      return 0;
    }
    if (arg === "--json") {
      json = true;
    } else if (arg === "--rubric") {
      rubric = true;
    } else if (arg === "--lang" || arg.startsWith("--lang=")) {
      const value = arg === "--lang" ? (argv[++i] ?? "") : arg.slice("--lang=".length);
      if (!LANGS.has(value)) {
        io.err(`--lang must be zh, en or auto (got "${value}")\n${USAGE}`);
        return 2;
      }
      lang = value as A2uiLangOption;
    } else if (arg.startsWith("-") && arg !== "-") {
      io.err(`unknown option ${arg}\n${USAGE}`);
      return 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      io.err(`only one file can be checked at a time\n${USAGE}`);
      return 2;
    }
  }
  let markdown: string;
  try {
    if (file === undefined || file === "-") {
      if (io.stdinIsTTY) {
        io.err(USAGE);
        return 2;
      }
      markdown = io.readStdin();
    } else {
      markdown = io.readFile(file);
    }
  } catch (err) {
    io.err(`cannot read ${file ?? "stdin"}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const report = checkReply(markdown, { lang });
  io.out(json ? JSON.stringify(report, null, 2) : formatReport(report, { rubric }));
  return report.ok ? 0 : 1;
}

const entry = process.argv[1] !== undefined ? path.resolve(process.argv[1]) : "";
if (entry !== "" && entry === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2), {
    readStdin: () => readFileSync(0, "utf8"),
    stdinIsTTY: process.stdin.isTTY === true,
    readFile: (file) => readFileSync(file, "utf8"),
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  });
}
