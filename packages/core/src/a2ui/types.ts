/**
 * A2UI blocks: the catalog of components an assistant reply can carry as fenced JSON, and the
 * shapes the grammar module shares with its renderers, the text fallback and the checker.
 *
 * A block is a ```a2ui fence holding ONE JSON object whose `type` names a catalog entry; the
 * client draws it with its own components and theme, never with markup from the model. Markdown
 * stays the carrier, so a surface that cannot render a block still has readable text (see
 * fallback.ts), and a pick in the rendered block comes back as ordinary user text (see the
 * fill-text helpers). Nothing in this directory depends on Node except cli.ts: the same code
 * runs in the browser renderer and in the checker script bundled into the skill.
 */

export type A2uiType = "choice" | "form" | "steps" | "callout";

export interface A2uiOption {
  label: string;
  /** What a pick fills into the composer; defaults to the label. */
  value?: string;
  description?: string;
  recommended?: boolean;
}

/** One question with 2–7 options; the pick fills the composer and ends the model's turn. */
export interface A2uiChoice {
  type: "choice";
  id?: string;
  question: string;
  options: A2uiOption[];
  multiple?: boolean;
  /** Adds an "Other…" control that fills nothing and focuses the composer. */
  allowOther?: boolean;
}

export interface A2uiFormField {
  id: string;
  label: string;
  kind: "single" | "multiple" | "text" | "number";
  /** Required for single/multiple, not allowed otherwise. */
  options?: A2uiOption[];
  placeholder?: string;
  /** Number fields only. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  required?: boolean;
}

/** Several questions answered at once (1–6 fields); the answers fill the composer one line per field. */
export interface A2uiForm {
  type: "form";
  id?: string;
  title?: string;
  fields: A2uiFormField[];
  submitLabel?: string;
}

export interface A2uiStep {
  text: string;
  /** Risk of irreversible loss, security or harm; rendered above the step. */
  warning?: string;
  /** Risk of breaking something recoverable; rendered above the step. */
  caution?: string;
  /** Useful information; rendered below the step. */
  note?: string;
  code?: string;
  lang?: string;
}

/** A procedure, one instruction per step (1–15 steps). */
export interface A2uiSteps {
  type: "steps";
  title?: string;
  steps: A2uiStep[];
}

export interface A2uiCallout {
  type: "callout";
  tone: "note" | "tip" | "caution" | "warning";
  title?: string;
  text: string;
}

export type A2uiSpec = A2uiChoice | A2uiForm | A2uiSteps | A2uiCallout;

export type A2uiLevel = "error" | "warning";

/**
 * Which bucket of the score an issue counts toward: `l1` protocol validity (always an error),
 * `l2` task construction (block limits, cross-block heuristics; warnings), `prose` the STE-lite
 * lint of the text outside fences (warnings). Set by checkReply; absent on issues from the
 * single-block functions.
 */
export type A2uiScope = "l1" | "l2" | "prose";

export interface A2uiIssue {
  level: A2uiLevel;
  code: string;
  /** English, and ends with what to do about it: the checker prints it verbatim to the model. */
  message: string;
  /** 1-based block index (a2ui and mermaid fences counted together, in order). */
  block?: number;
  /** JSON path inside the block, e.g. `options[2].label`. */
  path?: string;
  /** 1-based line: relative to the fence body from parseA2ui/checkMermaid, absolute in the reply from checkReply. */
  line?: number;
  scope?: A2uiScope;
}

/** One fenced block found in a reply. `index` is 1-based and counts a2ui + mermaid blocks in order. */
export interface A2uiBlock {
  index: number;
  fence: "a2ui" | "mermaid";
  /** The fence body, de-indented, without the fence lines. */
  source: string;
  /** 1-based line of the opening fence. */
  startLine: number;
  /** 1-based line of the closing fence, or of the reply's last line when the fence is unclosed. */
  endLine: number;
  closed: boolean;
  /** The full info string, e.g. `a2ui json`. */
  info?: string;
}

export type A2uiLang = "zh" | "en";
export type A2uiLangOption = A2uiLang | "auto";

export interface A2uiReport {
  /** No error-level issue. */
  ok: boolean;
  blocks: Array<{ index: number; fence: "a2ui" | "mermaid"; type?: string; ok: boolean }>;
  issues: A2uiIssue[];
  /** 0–100 each; any L1 error makes `total` 0. See A2UI_SCORING. */
  score: { l1: number; l2: number; prose: number; total: number };
  /** The language the prose rules and the rubric used (resolved from `auto`). */
  lang: A2uiLang;
}

/** Field limits of the catalog. Over a limit is an L1 error; past a `warn` mark is an L2 warning. */
export const A2UI_LIMITS = {
  /** `id` of a choice or form. */
  idPattern: /^[a-z][a-z0-9_-]{0,31}$/,
  /** `id` of a form field (no hyphen: it doubles as an answer key). */
  fieldIdPattern: /^[a-z][a-z0-9_]{0,31}$/,
  question: 120,
  label: 60,
  labelWarn: 40,
  value: 500,
  description: 160,
  options: { min: 2, max: 7, warn: 5 },
  fields: { min: 1, max: 6, warn: 4 },
  steps: { min: 1, max: 15, warn: 10 },
  title: 80,
  placeholder: 80,
  unit: 12,
  submitLabel: 24,
  stepText: 200,
  stepCode: 2000,
  lang: 20,
  calloutText: 400,
  mermaid: { statements: 30, lines: 400 },
} as const;

/**
 * The score's weights, in one place so the skill can quote them. l1 is 100 or 0; l2 and prose
 * lose points per warning down to 0; total is 0 on any L1 error, else the weighted mean.
 * `passTotal` is the gate the skill teaches ("errors 0, total at least 70").
 */
export const A2UI_SCORING = {
  l2PerWarning: 15,
  prosePerWarning: 5,
  l2Weight: 0.5,
  proseWeight: 0.5,
  passTotal: 70,
} as const;
