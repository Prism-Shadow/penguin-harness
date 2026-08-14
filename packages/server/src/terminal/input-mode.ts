/**
 * DEC private mode tracker (Paseo's `TerminalInputModeTracker`).
 *
 * A snapshot of the screen grid restores what is *displayed*, but not how the terminal is
 * supposed to *behave*: with bracketed paste (2004) or application cursor keys (1) lost, a
 * reattached client sends the wrong bytes and a running shell/TUI misreads every arrow key
 * and every paste. Those modes are set once, long before the reattach, so they can only be
 * recovered by remembering them.
 *
 * So every pty chunk is scanned for `CSI ? Pm h|l` and the current state of a small
 * whitelist is kept. `preamble()` re-emits it ahead of the restored screen.
 */

/** Modes worth replaying — everything else is either display state (already in the snapshot) or noise. */
const TRACKED_MODES = new Set([
  1, // DECCKM, application cursor keys
  7, // DECAWM, auto-wrap
  12, // cursor blink
  25, // DECTCEM, cursor visibility
  66, // DECNKM, application keypad
  1000, // mouse: click tracking
  1002, // mouse: button-event tracking
  1003, // mouse: any-event tracking
  1004, // focus reporting
  1005, // mouse: utf-8 coordinates
  1006, // mouse: SGR coordinates
  1015, // mouse: urxvt coordinates
  1016, // mouse: SGR pixel coordinates
  2004, // bracketed paste
]);

/** Modes that are on unless something turned them off (so "not seen" != "off"). */
const DEFAULT_ON = new Set([7, 25]);

/** Longest sequence we may have to hold across a chunk boundary: ESC [ ? + params + final. */
const MAX_CARRY = 64;

const DEC_PRIVATE_MODE_PATTERN = /\x1b\[\?([0-9;]*)([hl])/g;

export class TerminalInputModeTracker {
  private readonly enabled = new Set<number>(DEFAULT_ON);
  /** Tail of the previous chunk that may hold the start of a split escape sequence. */
  private carry = "";

  feed(chunk: string): void {
    const text = this.carry + chunk;
    DEC_PRIVATE_MODE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = DEC_PRIVATE_MODE_PATTERN.exec(text)) !== null) {
      lastEnd = match.index + match[0].length;
      const on = match[2] === "h";
      for (const raw of (match[1] ?? "").split(";")) {
        if (raw === "") continue;
        const mode = Number.parseInt(raw, 10);
        if (!TRACKED_MODES.has(mode)) continue;
        if (on) this.enabled.add(mode);
        else this.enabled.delete(mode);
      }
    }
    // Keep only what could still be the head of an unfinished sequence. Anything before the
    // last complete match is settled, and a sequence can never be longer than MAX_CARRY.
    const tailStart = Math.max(lastEnd, text.length - MAX_CARRY);
    const tail = text.slice(tailStart);
    const escIndex = tail.lastIndexOf("\x1b");
    this.carry = escIndex === -1 ? "" : tail.slice(escIndex);
  }

  isEnabled(mode: number): boolean {
    return this.enabled.has(mode);
  }

  /**
   * Escape sequences that put a freshly attached client back into the modes the running
   * program believes it is in. Emitted right after the restored screen content.
   */
  preamble(): string {
    const on: number[] = [];
    const off: number[] = [];
    for (const mode of TRACKED_MODES) {
      const enabled = this.enabled.has(mode);
      if (enabled === DEFAULT_ON.has(mode)) continue; // already the client's default
      (enabled ? on : off).push(mode);
    }
    let out = "";
    if (on.length > 0) out += `\x1b[?${on.join(";")}h`;
    if (off.length > 0) out += `\x1b[?${off.join(";")}l`;
    return out;
  }
}
