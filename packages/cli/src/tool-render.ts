/**
 * Streaming tool-call rendering (CLI side).
 *
 * The CLI only consumes `partial_tool_call` for visible rendering. run_command (legacy name
 * exec_command — old traces and pre-rename agents still emit it) is shown as `$ <cmd>` as
 * early as possible; input_command / input_subagent show the target session id, with a
 * non-empty payload (chars / prompt) appended as `<< <content>` — the payload is critical
 * for approval and later audit (writing to stdin is equivalent to running a command), so the
 * session id alone is not enough; run_subagent shows the prompt; the file tools
 * (read_file / edit_file / write_file) show the tool name plus the file path; other tools
 * fall back to `name(args-prefix)`.
 *
 * The command/subagent tools accept an optional model-written `description` argument (see
 * tools.call_descriptions); when present it is appended as a `— <description>` suffix, but
 * only once the argument JSON is complete — appending it while other fields still stream
 * would rewrite the middle of the preview.
 *
 * The render layer streams by appending to the preview (see render.ts), so the preview format
 * must stay append-only: rendering only starts once the target id has fully appeared, the
 * payload is only appended at the end, and the preview stops growing once it hits the
 * truncation limit.
 */

/** Max length of the single-line preview for a payload (chars / prompt); truncated with an ellipsis beyond this, after which the preview stops growing. */
const MAX_PAYLOAD_PREVIEW = 120;

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

/** Extract the current value of a string field from a possibly-incomplete JSON object string. */
function extractPartialStringField(argsJson: string, field: string): string | null {
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
          if (i + 5 > argsJson.length) return out;
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
    if (ch === '"') return out;
    out += ch;
  }
  return out;
}

/** The three file tools: previewed as `<name> <file_path>`. */
const FILE_TOOL_NAMES = new Set(["read_file", "edit_file", "write_file"]);

/**
 * The optional model-written `description` argument, as a ` — <description>` suffix.
 * Only appended once the whole argument JSON parses (i.e. streaming is finished): before
 * that, other fields may still be growing and a suffix after them would break the
 * append-only preview. The suffix itself then appends onto the settled base preview.
 */
function descriptionSuffix(argsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return "";
  }
  const desc = (parsed as Record<string, unknown> | null)?.["description"];
  if (typeof desc !== "string") return "";
  const line = toSingleLine(desc);
  return line ? ` — ${capPreview(line)}` : "";
}

/**
 * Streaming argument preview: run_command (and its legacy name exec_command) shows `$ <cmd>`
 * once cmd can be read; input_command / input_subagent show `⌨ <name> → <id>` once the target
 * id is available, with a non-empty chars / prompt appended as `<< <content>` (an empty
 * payload just means polling, left as-is); run_subagent shows `run_subagent << <prompt>` once
 * prompt can be read; read_file / edit_file / write_file show `<name> <file_path>`; other
 * tools fall back to name(args-prefix). The command/subagent tools append the optional
 * `description` argument as a ` — <description>` suffix once the arguments are complete.
 */
export function renderPartialToolCall(name: string, argsJson: string): string | null {
  if (!argsJson) return null;
  if (name === "run_command" || name === "exec_command") {
    const cmd = extractPartialStringField(argsJson, "cmd");
    if (cmd !== null) return `$ ${toSingleLine(cmd)}${descriptionSuffix(argsJson)}`;
    return null;
  }
  if (name === "run_subagent") {
    const prompt = extractPartialStringField(argsJson, "prompt");
    if (prompt !== null) {
      return `run_subagent << ${capPreview(toSingleLine(prompt))}${descriptionSuffix(argsJson)}`;
    }
    return null;
  }
  if (name === "input_command") {
    const pid = extractPartialStringField(argsJson, "process_id");
    if (pid === null) return null;
    const chars = extractPartialStringField(argsJson, "chars");
    const payload = chars ? ` << ${capPreview(visualizeControlChars(chars))}` : "";
    return `⌨ input_command → ${toSingleLine(pid)}${payload}${descriptionSuffix(argsJson)}`;
  }
  if (name === "input_subagent") {
    const sid = extractPartialStringField(argsJson, "subagent_id");
    if (sid === null) return null;
    const prompt = extractPartialStringField(argsJson, "prompt");
    const payload = prompt ? ` << ${capPreview(toSingleLine(prompt))}` : "";
    return `⌨ input_subagent → ${toSingleLine(sid)}${payload}${descriptionSuffix(argsJson)}`;
  }
  if (FILE_TOOL_NAMES.has(name)) {
    const filePath = extractPartialStringField(argsJson, "file_path");
    if (filePath !== null) return `${name} ${toSingleLine(filePath)}`;
    return null;
  }
  return `${name || "tool_call"}(${toSingleLine(argsJson)}`;
}
