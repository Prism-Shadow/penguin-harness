/**
 * A `penguin computer` command line read the way agent-desktop reads it: the command (the first
 * positional word), its positionals, and its options with their values — which options take a
 * value is commands.ts's table, so `--app Finder` is one option and not a positional. The tokens
 * are kept in order, so the line passed on is the line given, minus what this plugin takes out.
 */
import { COMMANDS, GLOBAL_VALUES, SHORT_OPTIONS } from "./commands.js";

/** This plugin's own options: read by the terminal and here, never passed to agent-desktop. */
export const TEXT_FILE = "--text-file";
export const OUT_DIR = "--out-dir";

interface Token {
  text: string;
  kind: "command" | "positional" | "option" | "value" | "end";
  /** For an option and its value: the option's long name. */
  option?: string;
}

export interface Parsed {
  command: string | null;
  positionals: string[];
  /** By long name; `true` for an option given without a value. */
  options: Map<string, Array<string | true>>;
  tokens: Token[];
  /**
   * Why the line cannot be read the way agent-desktop reads it, or undefined: a cluster of short
   * options (`-vw`), which agent-desktop expands — `-vw x` is `-v --wait-for x` — while this reader
   * would not, so the two would check different words.
   */
  fault?: string;
}

function valueOptions(command: string | null): Set<string> {
  const own = command === null ? [] : (COMMANDS[command]?.values ?? []);
  return new Set([...GLOBAL_VALUES, ...own, TEXT_FILE, OUT_DIR]);
}

function optionalValueOptions(command: string | null): Set<string> {
  return new Set(command === null ? [] : (COMMANDS[command]?.optional ?? []));
}

export function parseArgv(argv: readonly string[]): Parsed {
  const parsed: Parsed = { command: null, positionals: [], options: new Map(), tokens: [] };
  const add = (name: string, value: string | true) => {
    const list = parsed.options.get(name) ?? [];
    list.push(value);
    parsed.options.set(name, list);
  };
  let ended = false;
  for (let i = 0; i < argv.length; i++) {
    const text = argv[i]!;
    const long = text.startsWith("--") && text.length > 2;
    const short = /^-[A-Za-z]$/.test(text);
    if (ended || !(long || short || (text.startsWith("-") && text.length > 1))) {
      if (parsed.command === null && !ended) {
        parsed.command = text;
        parsed.tokens.push({ text, kind: "command" });
      } else {
        parsed.positionals.push(text);
        parsed.tokens.push({ text, kind: "positional" });
      }
      continue;
    }
    if (text === "--") {
      ended = true;
      parsed.tokens.push({ text, kind: "end" });
      continue;
    }
    if (!long && !short && !/^-\d/.test(text)) {
      parsed.fault ??= `'${text}' combines short options: give each on its own (for example -v -w <selector>)`;
    }
    const eq = long ? text.indexOf("=") : -1;
    const written = eq === -1 ? text : text.slice(0, eq);
    const name = short ? (SHORT_OPTIONS[written] ?? written) : written;
    const next = argv[i + 1];
    if (eq !== -1) {
      add(name, text.slice(eq + 1));
      parsed.tokens.push({ text, kind: "option", option: name });
    } else if (valueOptions(parsed.command).has(name) && next !== undefined) {
      add(name, next);
      parsed.tokens.push({ text, kind: "option", option: name });
      parsed.tokens.push({ text: next, kind: "value", option: name });
      i++;
    } else if (
      optionalValueOptions(parsed.command).has(name) &&
      next !== undefined &&
      /^\d+$/.test(next)
    ) {
      add(name, next);
      parsed.tokens.push({ text, kind: "option", option: name });
      parsed.tokens.push({ text: next, kind: "value", option: name });
      i++;
    } else {
      add(name, true);
      parsed.tokens.push({ text, kind: "option", option: name });
    }
  }
  return parsed;
}

/** Whether an option was given (with or without a value). */
export function has(parsed: Parsed, option: string): boolean {
  return parsed.options.has(option);
}

/** An option's last value given as text, or undefined. */
export function valueOf(parsed: Parsed, option: string): string | undefined {
  const values = parsed.options.get(option);
  if (values === undefined) return undefined;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/**
 * The command line to pass on: the tokens as given, without this plugin's own options and without
 * the positionals `drop` names (by index among the positionals), then `extra`.
 */
export function rebuild(
  parsed: Parsed,
  drop: ReadonlySet<number> = new Set(),
  extra: readonly string[] = [],
): string[] {
  const out: string[] = [];
  let positional = -1;
  for (const token of parsed.tokens) {
    if (token.option === TEXT_FILE || token.option === OUT_DIR) continue;
    if (token.kind === "positional") {
      positional++;
      if (drop.has(positional)) continue;
    }
    out.push(token.text);
  }
  // Extra options go before a `--`, where agent-desktop still reads them as options.
  const end = out.indexOf("--");
  if (end === -1) return [...out, ...extra];
  return [...out.slice(0, end), ...extra, ...out.slice(end)];
}
