/**
 * Readable text for a surface that cannot render a block — the CLI, a messaging channel, a raw
 * Trace — and the plain text a rendered choice or form fills into the composer. The fill text is
 * deliberately just the answer (the option's `value`, or `label: answer` lines): the model reads
 * it next turn as ordinary user text, so nothing here is a marker the core would have to parse.
 */
import { parseA2ui } from "./catalog.js";
import { scanFences, splitLines } from "./fences.js";
import { detectLang } from "./prose.js";
import type { A2uiCallout, A2uiChoice, A2uiForm, A2uiLang, A2uiSpec, A2uiSteps } from "./types.js";

const STR = {
  zh: {
    recommended: "推荐",
    multiple: "可多选。",
    replyChoice: "回复编号或直接写出你的答案。",
    replyForm: "按字段逐行回复。",
    required: "必填",
    colon: "：",
    sep: "、",
    stepWarning: "警告：",
    stepCaution: "注意：",
    stepNote: "说明：",
    tone: { note: "说明", tip: "提示", caution: "注意", warning: "警告" },
  },
  en: {
    recommended: "recommended",
    multiple: "Pick all that apply.",
    replyChoice: "Reply with a number or your own answer.",
    replyForm: "Reply with one line per field.",
    required: "required",
    colon: ": ",
    sep: ", ",
    stepWarning: "WARNING:",
    stepCaution: "CAUTION:",
    stepNote: "NOTE:",
    tone: { note: "Note", tip: "Tip", caution: "Caution", warning: "Warning" },
  },
} as const;

/** The separator between several picked values: 「、」 in zh, ", " in en. */
export const listSeparator = (lang: A2uiLang): string => STR[lang].sep;

function choiceMarkdown(spec: A2uiChoice, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out = [`**${spec.question}**`, ""];
  spec.options.forEach((option, i) => {
    let line = `${i + 1}. ${option.label}`;
    if (option.description) line += ` — ${option.description}`;
    if (option.recommended) line += lang === "zh" ? `（${t.recommended}）` : ` (${t.recommended})`;
    out.push(line);
  });
  out.push(
    "",
    spec.multiple ? `${t.multiple}${lang === "zh" ? "" : " "}${t.replyChoice}` : t.replyChoice,
  );
  return out;
}

function formMarkdown(spec: A2uiForm, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  for (const field of spec.fields) {
    let line = `- **${field.label}**`;
    if (field.required) line += lang === "zh" ? `（${t.required}）` : ` (${t.required})`;
    const detail: string[] = [];
    if (field.options) detail.push(field.options.map((o) => o.label).join(" / "));
    if (field.kind === "number") {
      if (field.min !== undefined && field.max !== undefined)
        detail.push(`${field.min}–${field.max}`);
      else if (field.min !== undefined) detail.push(`≥ ${field.min}`);
      else if (field.max !== undefined) detail.push(`≤ ${field.max}`);
      if (field.unit) detail.push(field.unit);
    }
    if (field.placeholder && (field.kind === "text" || field.kind === "number")) {
      detail.push(field.placeholder);
    }
    if (detail.length > 0) line += `${t.colon}${detail.join(" ")}`;
    out.push(line);
  }
  out.push("", t.replyForm);
  return out;
}

function stepsMarkdown(spec: A2uiSteps, lang: A2uiLang): string[] {
  const t = STR[lang];
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  spec.steps.forEach((step, i) => {
    const marker = `${i + 1}. `;
    const indent = " ".repeat(marker.length);
    const parts: string[] = [];
    if (step.warning) parts.push(`**${t.stepWarning}** ${step.warning}`);
    if (step.caution) parts.push(`**${t.stepCaution}** ${step.caution}`);
    parts.push(step.text);
    if (step.note) parts.push(`**${t.stepNote}** ${step.note}`);
    if (step.code !== undefined) {
      parts.push(["```" + (step.lang ?? ""), ...step.code.split("\n"), "```"].join("\n"));
    }
    parts.forEach((part, j) => {
      const partLines = part.split("\n");
      partLines.forEach((line, k) => {
        out.push(j === 0 && k === 0 ? marker + line : indent + line);
      });
      if (j < parts.length - 1) out.push("");
    });
  });
  return out;
}

function calloutMarkdown(spec: A2uiCallout, lang: A2uiLang): string[] {
  const t = STR[lang];
  const tone = t.tone[spec.tone];
  const body = spec.text.split("\n").map((line) => `> ${line}`);
  if (spec.title) {
    return [`> **${tone}${t.colon.trim()}${lang === "zh" ? "" : " "}${spec.title}**`, ">", ...body];
  }
  const first = body[0] ?? ">";
  return [`> **${tone}${t.colon.trim()}** ${first.slice(2)}`, ...body.slice(1)];
}

/** Readable Markdown for one valid block. */
export function specToMarkdown(spec: A2uiSpec, lang: A2uiLang): string {
  switch (spec.type) {
    case "choice":
      return choiceMarkdown(spec, lang).join("\n");
    case "form":
      return formMarkdown(spec, lang).join("\n");
    case "steps":
      return stepsMarkdown(spec, lang).join("\n");
    case "callout":
      return calloutMarkdown(spec, lang).join("\n");
  }
}

/**
 * The reply with every valid, closed ```a2ui fence replaced by readable Markdown. Mermaid fences
 * stay as they are; an invalid or unclosed block stays as its source fence (the reader still sees
 * what the model wrote). Language from `opts.lang`, else detected from the prose.
 */
export function toFallbackMarkdown(markdown: string, opts: { lang?: A2uiLang } = {}): string {
  const lang = opts.lang ?? detectLang(markdown);
  const lines = splitLines(markdown);
  const out: string[] = [];
  let cursor = 0;
  for (const span of scanFences(markdown)) {
    if (span.lang !== "a2ui" || !span.closed) continue;
    const { spec } = parseA2ui(span.body.join("\n"));
    if (spec === undefined) continue;
    for (; cursor < span.startLine - 1; cursor++) out.push(lines[cursor] ?? "");
    out.push(...specToMarkdown(spec, lang).split("\n"));
    cursor = span.endLine;
  }
  for (; cursor < lines.length; cursor++) out.push(lines[cursor] ?? "");
  return out.join("\n");
}

/**
 * The text a choice fills into the composer. `picked` holds option LABELS (unique by L1); each
 * maps to the option's `value` (default: the label). A string that is not a label passes through
 * as typed, so an "Other…" answer can be given the same way. Several picks are joined with the
 * language's list separator.
 */
export function choiceFillText(spec: A2uiChoice, picked: string[], lang: A2uiLang): string {
  const byLabel = new Map(spec.options.map((o) => [o.label, o.value ?? o.label] as const));
  return picked
    .map((label) => byLabel.get(label) ?? label)
    .filter((value) => value.trim() !== "")
    .join(listSeparator(lang));
}

/**
 * The text a form fills into the composer: one line per answered field in the form's order,
 * `label: answer` (en) / `label：answer` (zh). Answers for option fields are LABELS and map to
 * values like a choice's; several are joined with the list separator; a number gets its unit.
 * Unanswered fields (missing, empty, or an empty list) produce no line.
 */
export function formFillText(
  spec: A2uiForm,
  answers: Record<string, string | string[]>,
  lang: A2uiLang,
): string {
  const lines: string[] = [];
  for (const field of spec.fields) {
    const raw = answers[field.id];
    if (raw === undefined) continue;
    const byLabel = new Map(
      (field.options ?? []).map((o) => [o.label, o.value ?? o.label] as const),
    );
    const parts = (Array.isArray(raw) ? raw : [raw])
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .map((value) => byLabel.get(value) ?? value);
    if (parts.length === 0) continue;
    let answer = parts.join(listSeparator(lang));
    if (field.kind === "number" && field.unit) answer = `${answer} ${field.unit}`;
    lines.push(`${field.label}${STR[lang].colon}${answer}`);
  }
  return lines.join("\n");
}
