/**
 * Streaming tool-call rendering (CLI side).
 *
 * The CLI only consumes `partial_tool_call` for visible rendering. exec_command is shown as
 * `$ <cmd>` as early as possible; input_command / input_subagent show the target session id,
 * with a non-empty payload (chars / prompt) appended as `<< <content>` — the payload is
 * critical for approval and later audit (writing to stdin is equivalent to running a command),
 * so the session id alone is not enough; run_subagent shows the prompt; other tools fall back
 * to `name(args-prefix)`.
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

/**
 * Streaming argument preview: exec_command shows `$ <cmd>` once cmd can be read; input_command /
 * input_subagent show `⌨ <name> → <id>` once the target id is available, with a non-empty
 * chars / prompt appended as `<< <content>` (an empty payload just means polling, left as-is);
 * run_subagent shows `run_subagent << <prompt>` once prompt can be read; other tools fall back
 * to name(args-prefix).
 */
export function renderPartialToolCall(name: string, argsJson: string): string | null {
  if (!argsJson) return null;
  if (name === "exec_command") {
    const cmd = extractPartialStringField(argsJson, "cmd");
    if (cmd !== null) return `$ ${toSingleLine(cmd)}`;
    return null;
  }
  if (name === "run_subagent") {
    const prompt = extractPartialStringField(argsJson, "prompt");
    if (prompt !== null) return `run_subagent << ${capPreview(toSingleLine(prompt))}`;
    return null;
  }
  if (name === "input_command") {
    const pid = extractPartialStringField(argsJson, "process_id");
    if (pid === null) return null;
    const chars = extractPartialStringField(argsJson, "chars");
    const payload = chars ? ` << ${capPreview(visualizeControlChars(chars))}` : "";
    return `⌨ input_command → ${toSingleLine(pid)}${payload}`;
  }
  if (name === "input_subagent") {
    const sid = extractPartialStringField(argsJson, "subagent_id");
    if (sid === null) return null;
    const prompt = extractPartialStringField(argsJson, "prompt");
    const payload = prompt ? ` << ${capPreview(toSingleLine(prompt))}` : "";
    return `⌨ input_subagent → ${toSingleLine(sid)}${payload}`;
  }
  return `${name || "tool_call"}(${toSingleLine(argsJson)}`;
}
