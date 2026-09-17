/**
 * A semantic id derived from a display name without a model (pure, unit tested): the ASCII
 * fallback of `suggest-id`, and the sanitizer every model answer passes through before it is
 * offered. Diacritics are folded (`Café` → `cafe`), every run of anything but a letter or digit
 * becomes one separator, and the result is lowercased. What the id then has to look like is
 * the kind's, and one table says it for every kind a create dialog names:
 *
 * | kind        | prefix               | words joined | the id the create route accepts          |
 * | ----------- | -------------------- | ------------ | ---------------------------------------- |
 * | `org`       | `co_`                | `_`          | `^[a-z][a-z0-9_]{1,63}$`                 |
 * | `channel`   | `ch_`                | `_`          | `^[a-z][a-z0-9_]{1,63}$`                 |
 * | `project`   | none (admin)         | `_`          | `^[a-z][a-z0-9_]{1,63}$`                 |
 * | `project`   | `<username>-` (user) | `_`          | `<username>-[a-z0-9_]+`, 64 at most      |
 * | `agent`     | none                 | `_`          | `^[a-z][a-z0-9_]{1,63}$`                 |
 * | `benchmark` | none                 | `-`          | letters, digits, `_` and `-`; 100 at most |
 *
 * The organization's and the channel's prefix says what an id names and makes every core a
 * valid id; a core that already carries it is not prefixed twice. A non-admin's Project id
 * lives in its owner's namespace, so that prefix is the username the route already demands,
 * not a convention. A Benchmark id is kebab-case, like the ones the evaluation Skills write.
 * The prefixes are a generator's convention, not a rule the server enforces: an id typed by
 * hand is accepted as written, and ids that predate them keep working.
 *
 * A core the kind still rejects — an unprefixed id that would start with a digit, or a
 * one-letter one — is tried once more behind the kind's noun (`3D Viewer` → `agent_3d_viewer`),
 * which keeps the words rather than discarding a name that did carry ASCII. A name with no
 * ASCII letters or digits at all (a Chinese name) yields null: nothing mechanical can name it,
 * and that is exactly the case the model exists for. When the model cannot name it either,
 * `placeholderSemanticId` is the floor — a valid, dated, obviously-temporary id, so the dialog
 * is never left with nothing to put in the box.
 */
import { isValidId } from "@prismshadow/penguin-core";
import type { SemanticIdKind } from "../api/types.js";
import { PROJECT_ID_MAX_LENGTH, PROJECT_SUFFIX_PATTERN, SEMANTIC_ID_PATTERN } from "./ids.js";

/** What a kind's id looks like: everything the generator, the sanitizer and the prompt need. */
export interface SemanticIdRule {
  /** Put in front of every generated id; "" for none. */
  prefix: string;
  /** What joins the words of an id: `_` (snake_case) or `-` (kebab-case). */
  separator: "_" | "-";
  /** The longest id the generator produces (never longer than the create route accepts). */
  maxLength: number;
  /** Whether the create route accepts an id. */
  accepts: (id: string) => boolean;
  /** The word a placeholder carries, and the word a core the rule rejects is put behind. */
  noun: string;
  /** The prompt's examples, in this kind's own spelling (see semantic-id-suggest.ts). */
  examples: string;
}

const snakeCaseId = (id: string): boolean => SEMANTIC_ID_PATTERN.test(id);

const SNAKE_EXAMPLES =
  "Plugin Marketplace → plugin_marketplace; 科研论文公司 → research_paper_lab; 市场推广 → marketing; Site → site.";

/** The kind table (see the module header); a non-admin's Project rule is {@link projectIdRule}. */
export const SEMANTIC_ID_RULES: Record<SemanticIdKind, SemanticIdRule> = {
  org: {
    prefix: "co_",
    separator: "_",
    maxLength: 64,
    accepts: snakeCaseId,
    noun: "org",
    examples: SNAKE_EXAMPLES,
  },
  channel: {
    prefix: "ch_",
    separator: "_",
    maxLength: 64,
    accepts: snakeCaseId,
    noun: "channel",
    examples: SNAKE_EXAMPLES,
  },
  project: {
    prefix: "",
    separator: "_",
    maxLength: 64,
    accepts: snakeCaseId,
    noun: "project",
    examples:
      "Plugin Marketplace → plugin_marketplace; 科研论文项目 → research_papers; 官网改版 → website_redesign; Site → site.",
  },
  agent: {
    prefix: "",
    separator: "_",
    maxLength: 64,
    accepts: snakeCaseId,
    noun: "agent",
    examples:
      "Report Writer → report_writer; 金融助手 → finance_copilot; 深度研究报告智能体 → deep_research_reporter; Notes → notes.",
  },
  benchmark: {
    prefix: "",
    separator: "-",
    maxLength: 64,
    accepts: (id) => id.length <= 100 && isValidId(id),
    noun: "benchmark",
    examples:
      "Report Writing → report-writing; 代码审查能力 → code-review; 深度研究 v2 → deep-research-v2; SQL → sql.",
  },
};

/**
 * A Project id as `userId` may create it: the admin's is a plain semantic id, anyone else's is
 * `<userId>-<suffix>` within the length cap — the rule `POST /api/projects` enforces.
 */
export function projectIdRule(user: { userId: string; isAdmin: boolean }): SemanticIdRule {
  const base = SEMANTIC_ID_RULES.project;
  if (user.isAdmin) return base;
  const prefix = `${user.userId}-`;
  return {
    ...base,
    prefix,
    maxLength: PROJECT_ID_MAX_LENGTH,
    accepts: (id) =>
      id.startsWith(prefix) &&
      PROJECT_SUFFIX_PATTERN.test(id.slice(prefix.length)) &&
      id.length <= PROJECT_ID_MAX_LENGTH,
  };
}

/** The ASCII core of a name: folded, lowercased, joined by `separator`; "" when nothing survives. */
function asciiCore(name: string, separator: "_" | "-"): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(/^[_-]+|[_-]+$/g, "");
}

/**
 * `base`, or the first `base_2`, `base_3`, … (`base-2` for a kebab-case kind) that `taken` does
 * not hold; the suffix never pushes the id past the length cap.
 */
export function uniqueSemanticId(
  base: string,
  taken: Iterable<string>,
  separator: "_" | "-",
  maxLength: number,
): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `${separator}${n}`;
    const candidate = `${base.slice(0, maxLength - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The core with the rule's prefix in front, or unchanged when it already starts with it. */
export function prefixSemanticId(core: string, rule: SemanticIdRule): string {
  return core.startsWith(rule.prefix) ? core : `${rule.prefix}${core}`;
}

/** The prefixed core capped at the kind's length — prefix first, so it survives a long name — with no trailing separator. */
function capped(core: string, rule: SemanticIdRule): string {
  return prefixSemanticId(core, rule)
    .slice(0, rule.maxLength)
    .replace(/[_-]+$/, "");
}

/**
 * A valid semantic id for a name, or null when the name carries nothing an ASCII id can be
 * built from. Never returns an id in `taken`.
 */
export function fallbackSemanticId(
  name: string,
  rule: SemanticIdRule,
  taken: Iterable<string> = [],
): string | null {
  const core = asciiCore(name, rule.separator);
  if (core === "") return null;
  let id = capped(core, rule);
  if (!rule.accepts(id)) id = capped(`${rule.noun}${rule.separator}${core}`, rule);
  if (!rule.accepts(id)) return null;
  return uniqueSemanticId(id, taken, rule.separator, rule.maxLength);
}

/**
 * What a model's answer becomes: its first line, stripped of quotes and code marks, run
 * through the same folding and prefixing as a name — so a model that answers `research_lab`
 * yields `co_research_lab`, one that answers `` `Research Lab` `` yields the same, one that
 * answers `co_research_lab` is not prefixed twice, and one that answers in Chinese yields
 * null and the caller falls back.
 */
export function sanitizeSuggestedId(
  answer: string,
  rule: SemanticIdRule,
  taken: Iterable<string> = [],
): string | null {
  const line = answer
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (line === undefined) return null;
  return fallbackSemanticId(line.replace(/^[`"'“”‘’]+|[`"'“”‘’.]+$/g, ""), rule, taken);
}

/** `yyyymmdd` in the host's own local date, the stamp a placeholder id carries. */
function dateStamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * The id a name that neither the model nor the ASCII fallback can name gets: the kind's noun
 * and the date behind its prefix — `co_org_<yyyymmdd>`, `ch_channel_<yyyymmdd>`,
 * `agent_<yyyymmdd>`, `benchmark-<yyyymmdd>` — made unique against `taken`. It names nothing —
 * that is the point. It is valid, so the dialog can go on, and it reads as temporary at a
 * glance, so the surface that fills it in can ask for a meaningful name in its place. Refusing
 * instead would leave the user of a Chinese-named object with no model configured staring at
 * a dialog that cannot be completed.
 */
export function placeholderSemanticId(
  rule: SemanticIdRule,
  taken: Iterable<string> = [],
  now: Date = new Date(),
): string {
  return uniqueSemanticId(
    prefixSemanticId(`${rule.noun}${rule.separator}${dateStamp(now)}`, rule),
    taken,
    rule.separator,
    rule.maxLength,
  );
}
