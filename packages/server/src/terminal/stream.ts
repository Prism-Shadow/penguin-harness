/**
 * The terminal stream's PROTOCOL: frames, coalescing, the restore-first attach sequence,
 * size ownership, the heartbeat and the lagging-viewer resync.
 *
 * This is platform code even though the socket is the runtime's. The seam cannot carry a
 * stream — a handler returns one whole Response — so the runtime keeps the upgrade
 * handshake and its authentication (terminal/ws.ts) and hands the live socket here. What
 * flows over it afterwards is behaviour, and behaviour a push must be able to change:
 * every byte of the wire format, the coalescing window, the heartbeat and both
 * backpressure watermarks are decided in this file. Two of those are no longer constants:
 * the window and the high-water mark are derived per socket from what the link measures
 * (link-quality.ts), because a number tuned on a LAN means something else entirely on a
 * phone.
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
import { RoundTripEstimator, SocketDrainMeter } from "./link-quality.js";
import type { TerminalSession } from "./session.js";

/**
 * Per-viewer backpressure. A send queues without limit when the peer cannot drain, so a
 * viewer too far behind stops receiving live output — the bytes keep feeding the server
 * emulator, nothing of the session is lost — and once its backlog falls below LOW_WATER it
 * is repainted with one fresh Restore frame (the same self-contained repaint an attach
 * uses) and live output resumes. Skipping ahead beats both alternatives: replaying
 * megabytes the viewer could only fast-forward through, or disconnecting it.
 *
 * "Too far behind" is the one number that is no longer a constant: it is derived per socket
 * from what that link delivers (link-quality.ts), because the byte bound this used to be
 * meant milliseconds of lag on a LAN and many seconds on a phone.
 */
const BACKPRESSURE_LOW_WATER = 64 * 1024;
const BACKPRESSURE_POLL_MS = 250;

/**
 * Heartbeat. A phone loses a socket without closing it — a radio hand-off, a carrier NAT
 * reaping an idle flow — and both ends then hold a connection that will never carry a byte
 * again: the pty writes into a dead socket, the viewer waits for output that cannot arrive.
 * The probe is what turns that into a close, which is what the client retries on. The reply
 * doubles as the round-trip sample that sizes the merge window (link-quality.ts).
 *
 * The timeout is generous on purpose: a backgrounded tab is throttled to roughly one timer
 * a minute, and reaping a viewer that is merely asleep would cost it a full repaint on
 * every glance at the screen.
 *
 * Only a viewer that has ANSWERED a probe is ever reaped for silence. A page loaded before
 * this shipped stays open across the push that brought it — the platform is replaced under
 * a tab that is not reloaded — and that page does not know the opcode: it would go quiet,
 * be closed, and (having no reattach either) show a dead pane. Silence only means something
 * from a peer that has shown it can break it.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 75_000;

export function bindTerminalStream(
  ws: WebSocket,
  session: TerminalSession,
  url: URL,
  log: (line: string) => void,
): void {
  const connectionId = randomUUID();
  ws.binaryType = "nodebuffer";

  // What this viewer's link is doing, measured from this socket alone: the round trip from
  // the heartbeat's echo, the drain rate from what the socket accepts.
  const roundTrip = new RoundTripEstimator();
  const drain = new SocketDrainMeter();

  /**
   * Bytes handed to the socket that have not left it yet — the viewer's backlog, counted in
   * the output the terminal produced rather than in what the wire carried. `bufferedAmount`
   * cannot answer this any more: the stream is compressed (terminal/ws.ts), and a screen of
   * repeated build output leaves the socket a hundred times smaller than the user is behind.
   * ws calls back once a message is flushed, so what has not called back is what is waiting.
   */
  let inFlight = 0;

  const send = (bytes: Uint8Array): void => {
    if (ws.readyState !== ws.OPEN) return;
    const size = bytes.byteLength;
    inFlight += size;
    ws.send(bytes, () => {
      inFlight -= size;
      drain.note(size, inFlight);
    });
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
    // A LAG bound, in bytes: how much output this viewer can still be behind and catch up
    // within MAX_VIEWER_LAG_MS at the rate its socket has been delivering (link-quality.ts),
    // which on a link fast enough to drain it is the 1MB this server always used.
    if (inFlight <= drain.highWaterBytes()) return;
    desynced = true;
    log(`[terminal] stream ${session.id}: viewer ${inFlight}B behind, pausing for resync`);
    resyncTimer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return stopResyncPoll();
      if (inFlight > BACKPRESSURE_LOW_WATER) return;
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
  // The merge window follows the measured round trip: 5ms on a LAN, up to 50ms on a link
  // where a single trip already costs twenty times that.
  const coalescer = new TerminalOutputCoalescer(sendOutput, () => roundTrip.windowMs());

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

  // Anything arriving proves the socket is still a socket, heartbeat replies included.
  let lastSeenAt = Date.now();
  // Whether this viewer speaks the heartbeat at all (see HEARTBEAT_TIMEOUT_MS).
  let answersProbes = false;
  const heartbeat = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    if (answersProbes && Date.now() - lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
      log(`[terminal] stream ${session.id}: viewer stopped answering, closing`);
      ws.terminate(); // not close(): a socket this quiet will not complete a handshake
      return;
    }
    send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Ping, payload: String(Date.now()) }));
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) return; // the data plane is binary-only
    lastSeenAt = Date.now();
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
      // The client probes for itself (its own timers are the ones a phone suspends); the
      // payload is its clock reading and goes back untouched.
      case TerminalStreamOpcode.Ping:
        send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Pong, payload: frame.payload }));
        break;
      case TerminalStreamOpcode.Pong: {
        answersProbes = true;
        const sentAt = Number.parseInt(framePayloadText(frame), 10);
        if (Number.isFinite(sentAt)) roundTrip.sample(Date.now() - sentAt);
        break;
      }
      default:
        break; // server-only opcodes echoed back by a confused client
    }
  });

  const teardown = (): void => {
    clearInterval(heartbeat);
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
