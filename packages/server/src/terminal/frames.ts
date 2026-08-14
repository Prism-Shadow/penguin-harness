/**
 * Terminal stream binary frame codec (modelled on Paseo's `binary-frames/terminal.ts`).
 *
 * Terminal traffic is the one place where JSON framing actually hurts: a build's output is
 * megabytes of bytes that would otherwise be escaped, re-parsed and re-allocated on both
 * ends, on the same event loop that carries every other message. So the data plane is raw
 * bytes behind a 2-byte header and the control plane (create / list / kill / capture) stays
 * ordinary JSON over HTTP.
 *
 *   byte 0  opcode
 *   byte 1  slot     (stream index within one socket)
 *   byte 2+ payload  (raw UTF-8 terminal bytes, or JSON for the control opcodes)
 *
 * `slot` is always 0 today — this server opens one socket per terminal. It is in the wire
 * format from the start because the alternative (adding it later) is a protocol break, and
 * because multiplexing every terminal of a page onto one socket is the obvious next step.
 */

export const TerminalStreamOpcode = {
  /** Server -> client: terminal output bytes. */
  Output: 0x01,
  /** Client -> server: keyboard/paste input bytes. */
  Input: 0x02,
  /** Client -> server: viewport size, JSON `{cols, rows, intent}`. */
  Resize: 0x03,
  /** Server -> client: full-screen restore stream (ANSI), sent once on attach. */
  Restore: 0x05,
  /** Server -> client: the pty exited, JSON `{exitCode, signal}`. */
  Exit: 0x06,
} as const;

export type TerminalStreamOpcode = (typeof TerminalStreamOpcode)[keyof typeof TerminalStreamOpcode];

export interface TerminalStreamFrame {
  opcode: TerminalStreamOpcode;
  slot: number;
  payload: Uint8Array;
}

const OPCODES = new Set<number>(Object.values(TerminalStreamOpcode));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeTerminalFrame(input: {
  opcode: TerminalStreamOpcode;
  slot?: number;
  payload?: Uint8Array | string;
}): Uint8Array {
  const payload =
    typeof input.payload === "string"
      ? encoder.encode(input.payload)
      : (input.payload ?? new Uint8Array(0));
  const bytes = new Uint8Array(2 + payload.byteLength);
  bytes[0] = input.opcode;
  bytes[1] = (input.slot ?? 0) & 0xff;
  bytes.set(payload, 2);
  return bytes;
}

/** Decodes a frame; returns null for anything malformed (a client must never crash the daemon). */
export function decodeTerminalFrame(bytes: Uint8Array): TerminalStreamFrame | null {
  if (bytes.byteLength < 2) return null;
  const opcode = bytes[0] as number;
  if (!OPCODES.has(opcode)) return null;
  return {
    opcode: opcode as TerminalStreamOpcode,
    slot: bytes[1] as number,
    payload: bytes.subarray(2),
  };
}

export function framePayloadText(frame: TerminalStreamFrame): string {
  return decoder.decode(frame.payload);
}

export interface TerminalResizePayload {
  cols: number;
  rows: number;
  /** `claim` takes size ownership for this connection; `update` only applies if it already owns it. */
  intent: "claim" | "update";
}

/** Parses a Resize payload, returning null when the client sent something unusable. */
export function parseResizePayload(frame: TerminalStreamFrame): TerminalResizePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(framePayloadText(frame));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { cols, rows, intent } = parsed as Record<string, unknown>;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  if ((cols as number) < 1 || (rows as number) < 1) return null;
  return {
    cols: Math.min(cols as number, 1000),
    rows: Math.min(rows as number, 500),
    intent: intent === "update" ? "update" : "claim",
  };
}
