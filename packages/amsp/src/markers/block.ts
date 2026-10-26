/**
 * Marker block primitives — the one place that knows how a special message marker is
 * *spelled*.
 *
 * Canonical form is `[tag]…[/tag]`. The earlier angle-bracket form `<tag>…</tag>` is still
 * **recognized by every parser** and must stay recognized indefinitely: markers are persisted
 * in Traces (re-rendered later) and in each Agent's `system_config.yaml` compaction prompt
 * (old agents keep instructing the model to use `<summary>`). Producers emit the square form
 * only — that asymmetry is the whole compatibility policy, and it lives here rather than being
 * re-derived at each call site.
 */

/** Escapes a tag name for embedding in a RegExp (tags are `[a-z_]`, but keep this honest). */
function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps `body` in the canonical paired form: `[tag]\n…\n[/tag]` (newlines around the body). */
export function markerBlock(tag: string, body: string): string {
  return `[${tag}]\n${body}\n[/${tag}]`;
}

/** Opening/closing delimiters of the canonical form (for prefix checks and inline tags). */
export function markerOpen(tag: string): string {
  return `[${tag}]`;
}

export function markerClose(tag: string): string {
  return `[/${tag}]`;
}

/**
 * A pair of regexes for one tag — the current square form and the legacy angle form — built
 * from a single source pattern. `body` is the sub-pattern placed between the tags (capture
 * groups inside it keep their order), `flags` are applied to both.
 *
 * Callers match square first and fall back to angle (`matchDualForm`), so a message mixing
 * both resolves to the current form.
 */
export function dualFormPatterns(tag: string, body: string, flags = ""): [RegExp, RegExp] {
  const t = escapeTag(tag);
  return [
    new RegExp(`\\[${t}\\]${body}\\[/${t}\\]`, flags),
    new RegExp(`<${t}>${body}</${t}>`, flags),
  ];
}

/** Runs the square-form pattern first, then the legacy angle form; returns the first match (or null). */
export function matchDualForm(
  patterns: readonly [RegExp, RegExp],
  text: string,
): RegExpExecArray | null {
  return patterns[0].exec(text) ?? patterns[1].exec(text);
}

/**
 * Strips every occurrence of one tag's block from `text` (both forms, across lines), plus any
 * stray unpaired opening/closing tag left behind. Used by title generation, where a leaked
 * marker must never become the title.
 */
export function stripMarkerBlocks(text: string, tag: string): string {
  const t = escapeTag(tag);
  return text
    .replace(new RegExp(`\\[${t}\\][\\s\\S]*?\\[/${t}\\]`, "g"), "")
    .replace(new RegExp(`\\[/?${t}\\]`, "g"), "")
    .replace(new RegExp(`<${t}>[\\s\\S]*?</${t}>`, "g"), "")
    .replace(new RegExp(`</?${t}>`, "g"), "");
}

/** True when `text` starts with this marker's opening tag in either form (prefix detection, e.g. context_summary). */
export function startsWithMarker(text: string, tag: string): boolean {
  return text.startsWith(`[${tag}]`) || text.startsWith(`<${tag}>`);
}
