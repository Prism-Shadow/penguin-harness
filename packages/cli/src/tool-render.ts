/**
 * Streaming tool-call rendering (CLI side).
 *
 * The CLI only consumes `partial_tool_call` for visible rendering. Formats (the `<-` marker
 * reads "input to the tool", paired with the `->` output gutter in render.ts):
 * - exec_command: `exec_command <- $ {cmd}`, or with a model-written description
 *   `exec_command <- {description} ($ {cmd})`;
 * - input_command: `input_command <- {process_id} << {chars}` (`<< …` only when writing;
 *   an empty payload just polls), or `input_command <- {description} ({process_id} << {chars})`;
 * - run_subagent: `run_subagent <- {prompt}` or `run_subagent <- {description} ({prompt})`;
 * - input_subagent: `input_subagent <- {subagent_id} << {prompt}` or
 *   `input_subagent <- {description} ({subagent_id} << {prompt})`;
 * - file tools (read_file / edit_file / write_file): `{name} {shortened path}` — the path is
 *   shortened to at most one parent directory (`…/parent/file.ts`); the full path stays in
 *   the arguments.
 * The payload (chars / prompt) is critical for approval and later audit (writing to stdin
 * is equivalent to running a command), so the session id alone is never enough; other tools
 * fall back to `name(args-prefix)`.
 *
 * The render layer streams by appending to the preview (see render.ts), so the preview must
 * stay append-only — a preview that is not an extension of the previous one costs a fresh
 * line, leaving the superseded one on screen. Which of the two forms a call will take is
 * therefore decided **before** its arguments stream, from the tool's assembled schema
 * (`expectDescription`, taken from `session_meta.tools` — the per-tool `call_description`
 * switch decides whether the argument exists at all; see the docs on tool configuration):
 * - schema without the argument (and the unknown case) → the plain form streams immediately,
 *   character by character, and any stray `description` is ignored;
 * - schema with it → the description is awaited: it streams live as it grows
 *   (`name <- desc…`) and the payload is appended once its value completes
 *   (`name <- desc ({payload…` → `)`), so the plain form never reaches the screen whichever
 *   order the model emits its arguments in. The model may still omit the optional argument;
 *   that is only knowable once the arguments parse, so nothing renders until then.
 * A `final` fragment (stream ended, or arguments from a complete message) is settled by
 * definition and renders whichever form the arguments actually carry.
 * File-tool paths render only once complete — shortening a still-growing path would rewrite
 * the line.
 */

/** Max length of the single-line preview for a payload (chars / prompt / description); truncated with an ellipsis beyond this, after which the preview stops growing. */
const MAX_PAYLOAD_PREVIEW = 120;

/** Max lines of a file-tool payload printed before the approval prompt; the rest is elided with a count. */
const MAX_APPROVAL_PAYLOAD_LINES = 24;

/** Max characters per printed approval-payload line (the full text stays in the trace). */
const MAX_APPROVAL_PAYLOAD_LINE = 200;

/** Collapse to a single line: newlines/runs of whitespace become a single space, and leading/trailing whitespace is trimmed. */
function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Turn control characters into a visible, faithful form so stdin writes don't garble the
 * screen: `\n`/`\r`/`\t` are shown as escape literals (whether Enter was pressed is important
 * information and must not collapse into a space), other C0 control chars and DEL use caret
 * notation (U+0003 → `^C`); backslash itself is escaped to avoid ambiguity.
 */
function visualizeControlChars(text: string): string {
  return text.replace(/[\\\u0000-\u001f\u007f]/g, (ch) => {
    if (ch === "\\") return "\\\\";
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    if (ch === "\t") return "\\t";
    if (ch === "\u007f") return "^?";
    return `^${String.fromCharCode(ch.charCodeAt(0) + 64)}`;
  });
}

/** Truncate to the single-line preview limit, appending an ellipsis if exceeded. */
function capPreview(text: string): string {
  return text.length > MAX_PAYLOAD_PREVIEW ? `${text.slice(0, MAX_PAYLOAD_PREVIEW)}…` : text;
}

/** A string field extracted from possibly-incomplete JSON: its value so far, and whether the closing quote was seen. */
interface PartialField {
  value: string;
  complete: boolean;
}

/** Extract a string field from a possibly-incomplete JSON object string, reporting completeness. */
function extractField(argsJson: string, field: string): PartialField | null {
  const key = `"${field}"`;
  const keyIndex = argsJson.indexOf(key);
  if (keyIndex === -1) return null;

  let i = keyIndex + key.length;
  while (/\s/.test(argsJson[i] ?? "")) i += 1;
  if (argsJson[i] !== ":") return null;
  i += 1;
  while (/\s/.test(argsJson[i] ?? "")) i += 1;
  if (argsJson[i] !== '"') return null;
  i += 1;

  let out = "";
  let escaped = false;
  for (; i < argsJson.length; i += 1) {
    const ch = argsJson[i]!;
    if (escaped) {
      switch (ch) {
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case '"':
        case "\\":
        case "/":
          out += ch;
          break;
        case "u": {
          // If \uXXXX is cut off at an incremental chunk boundary, return "as far as we got":
          // emitting the incomplete hex as a literal would cause a rollback once the next
          // increment completes it (breaking append-only preview); the render layer falls
          // back to a new line in that case.
          if (i + 5 > argsJson.length) return { value: out, complete: false };
          const hex = argsJson.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(Number.parseInt(hex, 16));
            i += 4;
          }
          break;
        }
        default:
          out += ch;
          break;
      }
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return { value: out, complete: true };
    out += ch;
  }
  return { value: out, complete: false };
}

/** Extract the current value of a string field from a possibly-incomplete JSON object string. */
function extractPartialStringField(argsJson: string, field: string): string | null {
  return extractField(argsJson, field)?.value ?? null;
}

/** The three file tools: previewed as `<name> <shortened file_path>`. */
const FILE_TOOL_NAMES = new Set(["read_file", "edit_file", "write_file"]);

/**
 * Shortens a path for one-line display: at most one parent directory plus the filename
 * (`…/parent/file.ts`); paths already within that shape are shown as-is. The full path
 * stays in the argument JSON (and the expanded web card).
 */
export function shortenPath(p: string): string {
  const segments = p.split("/").filter((s) => s.length > 0);
  if (segments.length <= 2) return p;
  return `…/${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

/** How a tool call is previewed while its arguments stream (see the module header). */
export interface ToolCallPreviewOptions {
  /**
   * Whether this tool's assembled schema carries the `description` argument (from
   * `session_meta.tools`). Unknown ⇒ `false`: fall back to the plain form, matching a
   * configuration with the argument switched off.
   */
  expectDescription?: boolean;
  /** The call's last fragment (its stream ended) or arguments from a complete message: settled, so render whichever form they carry. */
  final?: boolean;
}

/**
 * State of the model-written `description` argument within a possibly-incomplete arguments
 * fragment:
 * - `pending`: it is expected but hasn't produced anything showable yet — nothing renders;
 * - `none`: no usable description (not expected, or the settled arguments carry none), so
 *   the plain form is correct;
 * - `{ text, complete }`: the description's value so far, single-lined and capped. Payload
 *   is appended only once `complete`, keeping the preview append-only whichever order the
 *   model emits its arguments in.
 */
type DescriptionState = "pending" | "none" | { text: string; complete: boolean };

function describedState(argsJson: string, opts: ToolCallPreviewOptions): DescriptionState {
  const settled = opts.final === true || argsComplete(argsJson);
  // Not expected and not settled: the schema has no such argument, so stream the plain form
  // right away. Settled fragments are read for real — a complete call renders what it carries.
  if (!settled && opts.expectDescription !== true) return "none";
  const field = extractField(argsJson, "description");
  if (field === null) return settled ? "none" : "pending";
  const text = toSingleLine(field.value);
  // An empty description (still opening, or explicitly "") carries nothing to show: once
  // settled it means "no description", otherwise keep waiting for its first characters.
  if (!text) return settled ? "none" : "pending";
  return { text: capPreview(text), complete: field.complete };
}

/** Whether the whole argument JSON parses (i.e. argument streaming is finished). */
function argsComplete(argsJson: string): boolean {
  try {
    JSON.parse(argsJson);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps a payload preview in the description form: `{name} <- {description} ({payload…}`,
 * closing the parenthesis once `closed`. The open parenthesis mid-stream keeps the preview
 * append-only while the payload grows.
 */
function describedForm(name: string, desc: string, payload: string, closed: boolean): string {
  return `${name} <- ${desc} (${payload}${closed ? ")" : ""}`;
}

/**
 * Streaming argument preview (formats documented in the module header). Returns null while
 * nothing presentable has streamed in yet — including a call whose schema carries the
 * `description` argument (`opts.expectDescription`) whose value hasn't started streaming.
 */
export function renderPartialToolCall(
  name: string,
  argsJson: string,
  opts: ToolCallPreviewOptions = {},
): string | null {
  if (!argsJson) return null;
  if (name === "exec_command") {
    const desc = describedState(argsJson, opts);
    if (desc === "pending") return null;
    const cmd = extractField(argsJson, "cmd");
    if (desc !== "none") {
      if (!desc.complete || cmd === null) return `${name} <- ${desc.text}`;
      return describedForm(name, desc.text, `$ ${toSingleLine(cmd.value)}`, cmd.complete);
    }
    if (cmd !== null) return `${name} <- $ ${toSingleLine(cmd.value)}`;
    return null;
  }
  if (name === "run_subagent") {
    const desc = describedState(argsJson, opts);
    if (desc === "pending") return null;
    const prompt = extractField(argsJson, "prompt");
    if (desc !== "none") {
      if (!desc.complete || prompt === null) return `${name} <- ${desc.text}`;
      return describedForm(
        name,
        desc.text,
        capPreview(toSingleLine(prompt.value)),
        prompt.complete,
      );
    }
    if (prompt !== null) return `${name} <- ${capPreview(toSingleLine(prompt.value))}`;
    return null;
  }
  if (name === "input_command") {
    const desc = describedState(argsJson, opts);
    if (desc === "pending") return null;
    const pid = extractField(argsJson, "process_id");
    if (desc === "none" && pid === null) return null;
    const chars = extractPartialStringField(argsJson, "chars");
    const payloadSuffix = chars ? ` << ${capPreview(visualizeControlChars(chars))}` : "";
    if (desc !== "none") {
      if (!desc.complete || pid === null) return `${name} <- ${desc.text}`;
      return describedForm(
        name,
        desc.text,
        `${toSingleLine(pid.value)}${payloadSuffix}`,
        argsComplete(argsJson),
      );
    }
    return `${name} <- ${toSingleLine(pid!.value)}${payloadSuffix}`;
  }
  if (name === "input_subagent") {
    const desc = describedState(argsJson, opts);
    if (desc === "pending") return null;
    const sid = extractField(argsJson, "subagent_id");
    if (desc === "none" && sid === null) return null;
    const prompt = extractPartialStringField(argsJson, "prompt");
    const payloadSuffix = prompt ? ` << ${capPreview(toSingleLine(prompt))}` : "";
    if (desc !== "none") {
      if (!desc.complete || sid === null) return `${name} <- ${desc.text}`;
      return describedForm(
        name,
        desc.text,
        `${toSingleLine(sid.value)}${payloadSuffix}`,
        argsComplete(argsJson),
      );
    }
    return `${name} <- ${toSingleLine(sid!.value)}${payloadSuffix}`;
  }
  if (FILE_TOOL_NAMES.has(name)) {
    // Path rendered only once complete: shortening a still-growing path would rewrite the line.
    const filePath = extractField(argsJson, "file_path");
    if (filePath !== null && filePath.complete) {
      return `${name} ${shortenPath(toSingleLine(filePath.value))}`;
    }
    return null;
  }
  return `${name || "tool_call"}(${toSingleLine(argsJson)}`;
}

/**
 * File-tool payload for the interactive approval prompt: the full decoded arguments
 * (old_string / new_string / content …), bounded to MAX_APPROVAL_PAYLOAD_LINES lines with
 * an explicit elision note — under always-ask/read-only approval the user must see what
 * they are approving, not just the file path. Returns null for other tools or unparseable
 * arguments (arguments are complete by approval time).
 */
export function renderFileToolApprovalPayload(name: string, argsJson: string): string | null {
  if (!FILE_TOOL_NAMES.has(name)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const args = parsed as Record<string, unknown>;
  const lines: string[] = [];
  const pushField = (label: string, value: unknown): void => {
    if (value === undefined) return;
    if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${label}:`);
      for (const line of value.split("\n")) lines.push(`  | ${line}`);
    } else {
      lines.push(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  };
  pushField("file_path", args["file_path"]);
  if (name === "read_file") {
    pushField("offset", args["offset"]);
    pushField("limit", args["limit"]);
  } else if (name === "edit_file") {
    pushField("old_string", args["old_string"]);
    pushField("new_string", args["new_string"]);
    if (args["replace_all"] === true) pushField("replace_all", true);
  } else if (name === "write_file") {
    pushField("content", args["content"]);
  }
  let shown = lines;
  let elided = 0;
  if (shown.length > MAX_APPROVAL_PAYLOAD_LINES) {
    elided = shown.length - MAX_APPROVAL_PAYLOAD_LINES;
    shown = shown.slice(0, MAX_APPROVAL_PAYLOAD_LINES);
  }
  const capped = shown.map((l) =>
    l.length > MAX_APPROVAL_PAYLOAD_LINE ? `${l.slice(0, MAX_APPROVAL_PAYLOAD_LINE)}…` : l,
  );
  if (elided > 0) capped.push(`[… ${elided} more line${elided === 1 ? "" : "s"} not shown]`);
  return capped.join("\n");
}
