/**
 * CappedTextBuffer — capacity-capped unread-text buffer shared by background sessions.
 *
 * When over capacity, drops the oldest content (keeping the tail) and tallies the dropped count;
 * `drain()` prefixes a marker noting the drop count when taking all unread content (guards
 * against a chatty background process / sub-agent blowing up memory, see each session class's
 * capacity constant).
 */
export class CappedTextBuffer {
  private text = "";
  private omitted = 0; // Characters dropped due to the capacity cap, not yet read

  /** `dropLabel` is used in the drop-marker text, e.g. "earlier output" / "earlier subagent output". */
  constructor(
    private readonly cap: number,
    private readonly dropLabel: string,
  ) {}

  get isEmpty(): boolean {
    return this.text.length === 0 && this.omitted === 0;
  }

  append(chunk: string): void {
    this.text += chunk;
    if (this.text.length > this.cap) {
      const drop = this.text.length - this.cap;
      this.text = this.text.slice(drop); // Keep the newest (tail), drop the oldest
      this.omitted += drop;
    }
  }

  /** Takes the current unread content (including the drop marker); clears the buffer. */
  drain(): string {
    if (this.isEmpty) return "";
    const b = this.text;
    this.text = "";
    if (this.omitted > 0) {
      const n = this.omitted;
      this.omitted = 0;
      return `[... ${n} chars of ${this.dropLabel} dropped ...]\n${b}`;
    }
    return b;
  }
}
