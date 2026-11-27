/**
 * Feishu's rich-text `post` message, read into the parts the bridge composes: its words as one
 * text, its pictures as image keys in the order they appear, and anything else it carries that
 * is not delivered.
 *
 * A `post` is what the Feishu client sends whenever a message is more than a plain line: a
 * picture pasted in with words around it, several pictures sent together, a file attached with
 * a note, a title, formatting, a code block. Reading only the `text` type therefore turned the
 * commonest mixed message — a screenshot and a question — into a not-supported notice.
 *
 * Attached files ride beside the paragraphs, in a top-level `files` list of `{file_key,
 * file_name, is_folder}` that the content reference does not describe; they are read when
 * present and downloaded like a `file` message's. A folder is not a file — its key resolves to
 * a cover picture — so it is named as left out instead.
 *
 * The content is paragraphs of inline elements. Each paragraph becomes one line of the text,
 * elements concatenated: words as written, a link as `[text](href)` (or the bare address when
 * the two are the same), a mention as Feishu's own placeholder — the connector resolves those
 * for the whole text at once, exactly as it does for a `text` message — and a code block as a
 * fenced block. Pictures leave no mark in the text: they ride the input as image parts after it,
 * the shape the web composer submits for words plus pasted pictures. A paragraph that held only
 * a picture contributes no line. Styling (bold, underline, …) is not carried: the input is the
 * person's words, and the model reads them the same without it.
 */
import type { MessagingOmittedPart } from "./connector.js";

/** One `post` reduced: its words, its pictures' keys, and the media it carried that is not delivered. */
export interface FeishuPostParts {
  /** The post's words, title first; "" when it holds none. */
  text: string;
  /** `image_key` of every `img` element, in reading order. */
  imageKeys: string[];
  /** The attached files, in the order the post lists them. */
  files: { fileKey: string; fileName: string }[];
  /** One entry per `media` element (a video, which nothing downstream plays) and per folder. */
  omitted: MessagingOmittedPart[];
}

interface PostElement {
  tag?: unknown;
  text?: unknown;
  href?: unknown;
  user_id?: unknown;
  user_name?: unknown;
  image_key?: unknown;
  emoji_type?: unknown;
  language?: unknown;
}

interface PostBody {
  title?: unknown;
  content?: unknown;
  files?: unknown;
}

interface PostFile {
  file_key?: unknown;
  file_name?: unknown;
  is_folder?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The post body: the content JSON itself as an event delivers it, or — for a document written in
 * the send format, which wraps the body in a locale key (`zh_cn`, `en_us`, …) — the first locale's.
 */
function bodyOf(parsed: unknown): PostBody | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const direct = parsed as PostBody;
  if (Array.isArray(direct.content)) return direct;
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && Array.isArray((value as PostBody).content)) {
      return value as PostBody;
    }
  }
  return null;
}

/** One inline element as text ("" for a picture or anything without words). */
function inlineText(el: PostElement): string {
  switch (el.tag) {
    case "text":
    case "md":
      return str(el.text);
    case "a": {
      const text = str(el.text);
      const href = str(el.href);
      if (href === "") return text;
      return text === "" || text === href ? href : `[${text}](${href})`;
    }
    case "at": {
      // The placeholder (`@_user_1`) is resolved against the event's `mentions` by the caller,
      // so it stays as Feishu wrote it; a mention that carries a plain id instead is named.
      const id = str(el.user_id);
      if (id.startsWith("@_")) return id;
      const name = str(el.user_name);
      return name !== "" ? `@${name}` : "";
    }
    case "emotion": {
      // An inline emoji: kept as its name, the closest a plain-text input comes to it.
      const emoji = str(el.emoji_type);
      return emoji !== "" ? `[${emoji}]` : "";
    }
    default:
      return "";
  }
}

/** The post's parts, or null when the content is not a post body at all. */
export function feishuPostOf(content: string): FeishuPostParts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const body = bodyOf(parsed);
  if (body === null) return null;
  const lines: string[] = [];
  const title = str(body.title).trim();
  if (title !== "") lines.push(title);
  const imageKeys: string[] = [];
  const omitted: MessagingOmittedPart[] = [];
  for (const paragraph of body.content as unknown[]) {
    if (!Array.isArray(paragraph)) continue;
    let line = "";
    for (const raw of paragraph as unknown[]) {
      if (raw === null || typeof raw !== "object") continue;
      const el = raw as PostElement;
      if (el.tag === "img") {
        const key = str(el.image_key);
        if (key !== "") imageKeys.push(key);
      } else if (el.tag === "media") {
        omitted.push("video");
      } else if (el.tag === "code_block") {
        // Its own block, whatever shares the paragraph: a fence only opens at a line's start.
        if (line.trim() !== "") lines.push(line);
        line = "";
        lines.push(`\`\`\`${str(el.language).toLowerCase()}\n${str(el.text)}\n\`\`\``);
      } else if (el.tag === "hr") {
        if (line.trim() !== "") lines.push(line);
        line = "";
        // `***` rather than `---`: under a line of words, `---` reads as a heading underline.
        lines.push("***");
      } else {
        line += inlineText(el);
      }
    }
    if (line.trim() !== "") lines.push(line);
  }
  const files: { fileKey: string; fileName: string }[] = [];
  for (const raw of Array.isArray(body.files) ? (body.files as unknown[]) : []) {
    if (raw === null || typeof raw !== "object") continue;
    const file = raw as PostFile;
    const fileKey = str(file.file_key);
    if (fileKey === "") continue;
    if (file.is_folder === true) {
      omitted.push("folder");
      continue;
    }
    // `file` for a nameless one, as for a `file` message: an invented extension would tell the
    // model the bytes are something they are not.
    files.push({ fileKey, fileName: str(file.file_name) !== "" ? str(file.file_name) : "file" });
  }
  return { text: lines.join("\n").trim(), imageKeys, files, omitted };
}
