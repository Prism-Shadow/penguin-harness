/**
 * Session title generation: an **out-of-band, one-off request** that generates
 * a short title from the first-turn conversation text (used by `Session.generateTitle`
 * for assembly, not exported wholesale via the barrel).
 *
 * Called by `session.generateTitle()`: sends one request using the bare LLM for the session's
 * Model (no tools, no system prompt, thinking off), without writing history or Trace. Material
 * defaults to what the Session self-captures during run (see session.ts); this module is only
 * responsible for the prompt format, driving the one-off request, and sanitizing the result —
 * when to generate a title and where to store it is decided by the host (Web server / CLI).
 * The narrow public surface — `SessionTitleResult` (part of `Session.generateTitle`'s
 * signature) and the sanitation helpers the host's title fallback builds on — is re-exported
 * by the barrel; the prompt/request internals are not.
 */
import { userText } from "../omnimessage/index.js";
import type {
  OmniMessage,
  TextPayload,
  TokenCounts,
  TokenUsagePayload,
} from "../omnimessage/index.js";
import type { LLMInterface } from "../interfaces.js";

/** Cap on conversation text spliced into the title request (user/model each truncated separately, to control cost). */
const EXCERPT_MAX_CHARS = 2000;
/** Cap on title length (fallback truncation for when the model occasionally ignores the constraint). */
const TITLE_MAX_CHARS = 30;

/**
 * Special message markers that must never leak into a title. These are machine-inserted
 * blocks (a skill invocation wraps the body in `[use_skills]…[/use_skills]`, a subagent
 * handoff / scheduled task prepend their own blocks) — meaningful to the runtime, noise in a
 * title. The list is a fixed allowlist so ordinary bracketed text is left untouched.
 */
const MARKER_TAGS = ["use_skills", "handoff_from", "scheduled_task"];

/**
 * Strips machine-inserted marker blocks (see MARKER_TAGS) from conversation text so titles are
 * built from the human-meaningful body only — both the material sent to the model and the
 * fallback derived from the raw first message. Removes the paired `[tag]…[/tag]` block (any
 * inner content, across lines) and any stray unpaired `[tag]` / `[/tag]` left behind. The old
 * angle-bracket `<tag>…</tag>` form is still stripped too: titles can be (re)generated from
 * material that came out of a Trace written before the marker format changed.
 */
export function stripConversationMarkers(text: string): string {
  let out = text;
  for (const tag of MARKER_TAGS) {
    out = out
      .replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[/${tag}\\]`, "g"), "")
      .replace(new RegExp(`\\[/?${tag}\\]`, "g"), "")
      .replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "")
      .replace(new RegExp(`</?${tag}>`, "g"), "");
  }
  return out.trim();
}

export interface SessionTitleResult {
  /** The sanitized title; null when material is insufficient, the request fails, or the output is empty. */
  title: string | null;
  /** Token consumption for this request (accumulated token_usage.request); null if no request occurred or there's no usage. */
  usage: TokenCounts | null;
}

/**
 * Assembles the title-generation Prompt (exported for host/test assertion use). Uses English
 * instructions to avoid polluting the title's language, and requires the **title to be in the
 * same language as the conversation** (English conversation gets an English title, Chinese
 * conversation gets a Chinese title); when assistant material is empty, it relies on the user
 * request alone.
 */
export function buildTitlePrompt(userExcerpt: string, assistantExcerpt: string): string {
  const clip = (s: string) => (s.length > EXCERPT_MAX_CHARS ? s.slice(0, EXCERPT_MAX_CHARS) : s);
  const lines = [
    "Generate a concise title for the conversation below.",
    "Rules:",
    "- Write the title in the SAME language the user is using.",
    "- Keep it short: at most 6 words, or ~16 characters for CJK.",
    "- Output ONLY the title text — no quotes, no trailing punctuation, no explanation.",
    "- Answer immediately — do not think aloud or produce chain-of-thought.",
    "",
    "[User]",
    clip(userExcerpt),
  ];
  if (assistantExcerpt.trim()) {
    lines.push("", "[Assistant]", clip(assistantExcerpt));
  }
  // The trailing empty think block makes many reasoning models treat their thinking phase
  // as already closed, so the one-off request spends its budget on the title itself.
  lines.push("", "<think></think>");
  return lines.join("\n");
}

/** Sanitizes model output into a title: strips any leaked marker blocks and leading/trailing quotes/brackets and trailing punctuation (until stable), collapses whitespace, and truncates if too long; returns null for an empty result. */
export function sanitizeTitle(raw: string): string | null {
  let t = stripConversationMarkers(raw).replace(/\s+/g, " ").trim();
  // Stripping quotes can expose more punctuation underneath (or vice versa), so strip repeatedly until stable.
  for (let prev = ""; prev !== t;) {
    prev = t;
    t = t
      .replace(/^["'“”‘’「」『』《》〈〉【】()（）\s]+/, "")
      .replace(/["'“”‘’「」『』《》〈〉【】()（）\s]+$/, "")
      .replace(/[。.．!！?？;；,，、:：]+$/, "")
      .trim();
  }
  if (!t) return null;
  return t.length > TITLE_MAX_CHARS ? t.slice(0, TITLE_MAX_CHARS) : t;
}

/**
 * Drives a single title-generation request: collects model text and token_usage, and resolves
 * based on the outcome. Generation only requires user material (assistant material may be
 * empty — a pure tool-only turn can still get a title); no request is sent if user material is
 * empty; `title` is null if the request doesn't complete (any usage already produced is still
 * returned).
 */
export async function generateTitleWithLLM(
  llm: LLMInterface,
  args: { userText: string; assistantText: string; signal?: AbortSignal },
): Promise<SessionTitleResult> {
  // Strip machine markers before the model ever sees the material, so a skill-invocation
  // block (or handoff / scheduled-task marker) can't bleed into the generated title.
  const userMaterial = stripConversationMarkers(args.userText);
  const assistantMaterial = stripConversationMarkers(args.assistantText);
  if (!userMaterial.trim()) {
    return { title: null, usage: null };
  }
  const prompt = buildTitlePrompt(userMaterial, assistantMaterial);
  const gen = llm.streamGenerate({
    newMessages: [userText(prompt)],
    ...(args.signal ? { signal: args.signal } : {}),
  });
  let collected = "";
  let usage: TokenCounts | null = null;
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      if (step.value.status !== "completed") return { title: null, usage };
      break;
    }
    const msg = step.value;
    if (isAssistantText(msg)) collected += msg.payload.text;
    if (isTokenUsage(msg)) {
      const r = msg.payload.request;
      usage = usage
        ? {
            cache_read: usage.cache_read + r.cache_read,
            cache_write: usage.cache_write + r.cache_write,
            output: usage.output + r.output,
            total: usage.total + r.total,
          }
        : { ...r };
    }
  }
  return { title: sanitizeTitle(collected), usage };
}

function isAssistantText(msg: OmniMessage): msg is OmniMessage<TextPayload> {
  const payload = msg.payload as { type?: string; role?: string };
  return msg.type === "model_msg" && payload.type === "text" && payload.role === "assistant";
}

function isTokenUsage(msg: OmniMessage): msg is OmniMessage<TokenUsagePayload> {
  return msg.type === "event_msg" && (msg.payload as { type?: string }).type === "token_usage";
}
