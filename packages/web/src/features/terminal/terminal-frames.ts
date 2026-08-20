/**
 * Client half of the terminal wire format. Must stay in step with
 * `packages/server/src/terminal/frames.ts`: `[opcode, slot, ...payload]`.
 *
 * Output is decoded straight into a string and handed to xterm — no JSON parse on the hot
 * path, which is what keeps a noisy build from stuttering the UI thread.
 */

export const TerminalOpcode = {
  Output: 0x01,
  Input: 0x02,
  Resize: 0x03,
  Restore: 0x05,
  Exit: 0x06,
} as const;

export type TerminalOpcode = (typeof TerminalOpcode)[keyof typeof TerminalOpcode];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeFrame(opcode: TerminalOpcode, payload: string | Uint8Array = ""): Uint8Array {
  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
  const frame = new Uint8Array(2 + bytes.byteLength);
  frame[0] = opcode;
  frame[1] = 0; // slot: single stream per socket today
  frame.set(bytes, 2);
  return frame;
}

export interface DecodedFrame {
  opcode: number;
  slot: number;
  text: string;
}

export function decodeFrame(buffer: ArrayBuffer): DecodedFrame | null {
  if (buffer.byteLength < 2) return null;
  const head = new Uint8Array(buffer, 0, 2);
  return {
    opcode: head[0] as number,
    slot: head[1] as number,
    text: decoder.decode(new Uint8Array(buffer, 2)),
  };
}

export function encodeResize(cols: number, rows: number, intent: "claim" | "update"): Uint8Array {
  return encodeFrame(TerminalOpcode.Resize, JSON.stringify({ cols, rows, intent }));
}
