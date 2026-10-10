/**
 * The one fake of the WebSocket boundary: a socket the test plays the server's side of. It
 * records what the extension sent (parsed), and opens, speaks and closes on the test's word.
 */
import type { SocketLike } from "../../src/connection.js";
import { SUBPROTOCOL } from "../../src/wire.js";

export class FakeSocket implements SocketLike {
  readyState = 0;
  protocol = "";
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  /** Frames the extension sent, parsed. */
  readonly sent: Record<string, unknown>[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("InvalidStateError: not open");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  /** The server accepts the upgrade, selecting `protocol`. */
  accept(protocol: string = SUBPROTOCOL): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.({});
  }

  /** The server sends one frame. */
  deliver(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  /** The server sends a command. */
  command(id: string, command: Record<string, unknown>): void {
    this.deliver({ type: "desktop-browser-command", id, command });
  }

  /** The server (or the network) closes the socket. */
  drop(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  replies(): Record<string, unknown>[] {
    return this.sent.filter((frame) => frame.type === "desktop-browser-reply");
  }

  reply(id: string): Record<string, unknown> | undefined {
    return this.replies().find((frame) => frame.id === id);
  }

  events(): Record<string, unknown>[] {
    return this.sent
      .filter((frame) => frame.type === "desktop-browser-event")
      .map((frame) => frame.event as Record<string, unknown>);
  }
}

/** A socket factory that remembers every socket it made, newest last. */
export function socketFactory() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    create: (url: string, protocols: string[]) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
    get last(): FakeSocket {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error("no socket was opened");
      return socket;
    },
  };
}
