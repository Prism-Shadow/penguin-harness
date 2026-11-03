/**
 * The terminal stream's PROTOCOL: frames, coalescing, the restore-first attach sequence,
 * size ownership and the lagging-viewer resync.
 *
 * This is platform code even though the socket is the runtime's. The seam cannot carry a
 * stream — a handler returns one whole Response — so the runtime keeps the upgrade
 * handshake and its authentication (terminal/ws.ts) and hands the live socket here. What
 * flows over it afterwards is behaviour, and behaviour a push must be able to change:
 * every byte of the wire format, the ~5ms coalescing window and both backpressure
 * watermarks are decided in this file.
 *
 * Attach sequence — the part that makes a browser reload look seamless:
 *   1. the client's geometry (?cols=&rows=) resizes the pty FIRST, so the snapshot is
 *      rendered at the width the client is about to display it at;
 *   2. one Restore frame replays the whole screen;
 *   3. live output follows, coalesced.
 * Any output produced between 2 and 3 would be a lost line, so the output subscription is
 * opened before the snapshot is rendered and buffered until the Restore frame is out.
 */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  TerminalStreamOpcode,
  decodeTerminalFrame,
  encodeTerminalFrame,
  framePayloadText,
  parseResizePayload,
} from "./frames.js";
import { TerminalOutputCoalescer } from "./output-coalescer.js";
import type { TerminalSession } from "./session.js";

const BACKPRESSURE_HIGH_WATER = 1024 * 1024;
const BACKPRESSURE_LOW_WATER = 64 * 1024;
const BACKPRESSURE_POLL_MS = 250;

export function bindTerminalStream(
  ws: WebSocket,
  session: TerminalSession,
  url: URL,
  log: (line: string) => void,
): void {
  const connectionId = randomUUID();
  ws.binaryType = "nodebuffer";

  const send = (bytes: Uint8Array): void => {
    if (ws.readyState === ws.OPEN) ws.send(bytes);
  };

  // Lagging-viewer state (see the watermark comment above): while desynced, this viewer's
  // live output is dropped and a slow poll waits for its socket to drain for the resync.
  let desynced = false;
  let resyncTimer: ReturnType<typeof setInterval> | null = null;
  const stopResyncPoll = (): void => {
    if (resyncTimer) clearInterval(resyncTimer);
    resyncTimer = null;
  };

  const sendOutput = (data: string): void => {
    if (desynced) return; // dropped: the emulator keeps every byte; the resync repaints
    send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Output, payload: data }));
    if (ws.bufferedAmount <= BACKPRESSURE_HIGH_WATER) return;
    desynced = true;
    log(`[terminal] stream ${session.id}: viewer ${ws.bufferedAmount}B behind, pausing for resync`);
    resyncTimer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return stopResyncPoll();
      if (ws.bufferedAmount > BACKPRESSURE_LOW_WATER) return;
      stopResyncPoll();
      desynced = false; // flip first: output parsed after this snapshot flows live again
      try {
        send(
          encodeTerminalFrame({
            opcode: TerminalStreamOpcode.Restore,
            payload: session.restoreStream(),
          }),
        );
      } catch {
        // The session was reaped while this viewer lagged; the Exit frame (sent directly,
        // never dropped) already told it the story.
      }
    }, BACKPRESSURE_POLL_MS);
  };

  // Buffers output until the Restore frame has been sent (see the attach sequence above).
  let restored = false;
  let preRestore = "";
  const coalescer = new TerminalOutputCoalescer(sendOutput);

  const unsubscribeOutput = session.onOutput((data) => {
    if (!restored) {
      preRestore += data;
      return;
    }
    coalescer.push(data);
  });

  const unsubscribeExit = session.onExit((info) => {
    coalescer.flush();
    send(
      encodeTerminalFrame({
        opcode: TerminalStreamOpcode.Exit,
        payload: JSON.stringify({ exitCode: info.exitCode, signal: info.signal }),
      }),
    );
  });

  // The attaching client's geometry wins: it is the viewport the user is looking at, and the
  // snapshot below is laid out for it.
  const cols = Number.parseInt(url.searchParams.get("cols") ?? "", 10);
  const rows = Number.parseInt(url.searchParams.get("rows") ?? "", 10);
  if (Number.isInteger(cols) && Number.isInteger(rows)) {
    session.resize({ connectionId, cols, rows, intent: "claim" });
  }

  send(
    encodeTerminalFrame({
      opcode: TerminalStreamOpcode.Restore,
      payload: session.restoreStream(),
    }),
  );
  restored = true;
  if (preRestore) {
    coalescer.push(preRestore);
    preRestore = "";
  }
  if (!session.alive && session.exit) {
    send(
      encodeTerminalFrame({
        opcode: TerminalStreamOpcode.Exit,
        payload: JSON.stringify({ exitCode: session.exit.exitCode, signal: session.exit.signal }),
      }),
    );
  }

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) return; // the data plane is binary-only
    const frame = decodeTerminalFrame(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (!frame) return;
    switch (frame.opcode) {
      case TerminalStreamOpcode.Input:
        session.write(framePayloadText(frame));
        break;
      case TerminalStreamOpcode.Resize: {
        const size = parseResizePayload(frame);
        if (size) session.resize({ connectionId, ...size });
        break;
      }
      default:
        break; // server-only opcodes echoed back by a confused client
    }
  });

  const teardown = (): void => {
    unsubscribeOutput();
    unsubscribeExit();
    stopResyncPoll();
    coalescer.dispose();
    // Closing a view must not resize or kill the shell — only give up size ownership so the
    // next client to attach can claim it.
    session.releaseSize(connectionId);
  };

  ws.on("close", teardown);
  ws.on("error", (err: Error) => {
    log(`[terminal] stream ${session.id} socket error: ${err.message}`);
    teardown();
  });
}
