/**
 * Incremental ANSI/VT control-sequence stripper for piped command output.
 *
 * A command session publishes stdout/stderr as soon as each pipe chunk arrives, so a normal
 * one-shot regular expression is insufficient: an escape can be split between `exec_command`
 * and a later `input_command` poll. This small state machine keeps only parser state (never
 * command text) between chunks and removes CSI color/control sequences plus the OSC/DCS-style
 * string controls used for terminal titles, hyperlinks, and similar metadata.
 */
export class AnsiStripper {
  private state: "text" | "escape" | "escape-intermediate" | "csi" | "string" | "string-escape" =
    "text";

  strip(chunk: string): string {
    let out = "";
    for (const ch of chunk) {
      const code = ch.codePointAt(0)!;
      switch (this.state) {
        case "text":
          if (ch === "\u001b") {
            this.state = "escape";
          } else if (code === 0x9b) {
            this.state = "csi";
          } else if (
            code === 0x90 ||
            code === 0x98 ||
            code === 0x9d ||
            code === 0x9e ||
            code === 0x9f
          ) {
            this.state = "string";
          } else if (code < 0x80 || code > 0x9f) {
            out += ch;
          }
          break;
        case "escape":
          if (ch === "[") {
            this.state = "csi";
          } else if (ch === "]" || ch === "P" || ch === "X" || ch === "^" || ch === "_") {
            this.state = "string";
          } else if (code >= 0x20 && code <= 0x2f) {
            this.state = "escape-intermediate";
          } else {
            // A two-byte escape ends here. Invalid/incomplete terminal metadata is discarded
            // as well: leaking its tail would recreate the visible `[36m` corruption.
            this.state = "text";
          }
          break;
        case "escape-intermediate":
          if (code >= 0x30 && code <= 0x7e) this.state = "text";
          else if (code < 0x20 || code > 0x2f) this.state = "text";
          break;
        case "csi":
          // ECMA-48 CSI final byte. Parameters/intermediates before it stay suppressed even
          // when every byte arrived in a different stream chunk.
          if (code >= 0x40 && code <= 0x7e) this.state = "text";
          break;
        case "string":
          if (ch === "\u0007" || code === 0x9c)
            this.state = "text"; // BEL / 8-bit ST
          else if (ch === "\u001b") this.state = "string-escape";
          break;
        case "string-escape":
          if (ch === "\\")
            this.state = "text"; // 7-bit ST (ESC \\)
          else if (ch !== "\u001b") this.state = "string";
          break;
      }
    }
    return out;
  }
}
