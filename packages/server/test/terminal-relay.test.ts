/**
 * A pty on a machine is named in the terminal id (machines/terminal-relay.ts).
 *
 * The runtime serves one socket path and asks the platform for the session by id, so the
 * whole of "which machine, which pty, which user" has to fit in that id. Pinned: the spelling
 * round-trips, an ordinary id is never mistaken for a remote one, and the owner the runtime
 * checks is exactly the user the client named — which is what makes naming anyone else
 * refusable before the relay runs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket as WsSocket } from "ws";
import {
  isRemoteTerminalRef,
  parseRemoteTerminalRef,
  relayTerminalStream,
} from "../src/machines/terminal-relay.js";

describe("remote terminal references", () => {
  it("parses <terminalId>@<machineId>@<userId>", () => {
    const ref = parseRemoteTerminalRef("t-1@AtZ2EEKC5jxZipMN@admin");
    expect(ref).toEqual({
      id: "t-1@AtZ2EEKC5jxZipMN@admin",
      ownerUserId: "admin",
      remote: { machineId: "AtZ2EEKC5jxZipMN", terminalId: "t-1" },
    });
    expect(isRemoteTerminalRef(ref!)).toBe(true);
  });

  it("is null for a plain local id, and for anything half-spelled", () => {
    expect(parseRemoteTerminalRef("6f4861fc-d64e-48d3-afad-89e1108e3e55")).toBeNull();
    expect(parseRemoteTerminalRef("t@m")).toBeNull();
    expect(parseRemoteTerminalRef("t@@u")).toBeNull();
    expect(parseRemoteTerminalRef("a@b@c@d")).toBeNull();
  });

  it("reads a percent-encoded separator too", () => {
    expect(parseRemoteTerminalRef("t%40m%40u")?.remote).toEqual({
      machineId: "m",
      terminalId: "t",
    });
  });
});

/**
 * The relay's own plumbing, against a real WebSocket server standing in for the machine.
 *
 * Both promises here are about the window between a viewer asking for a remote pty and the
 * machine's stream opening — a round trip through the held connection, during which the
 * viewer is free to go away or to type.
 */
describe("relaying a viewer to a machine's stream", () => {
  /** The viewer's end: enough of a ws socket for the relay, plus a way to drop it. */
  class FakeViewer extends EventEmitter {
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    readonly received: string[] = [];
    closedWith: { code: number; reason: string } | null = null;

    send(data: RawData): void {
      this.received.push(data.toString());
    }

    close(code: number, reason: string): void {
      this.closedWith = { code, reason };
      this.readyState = 3;
      this.emit("close", code, Buffer.from(reason));
    }

    /** The browser going away — a pane closed, a reload, a dock reattaching. */
    drop(): void {
      this.readyState = 3;
      this.emit("close", 1001, Buffer.from("gone"));
    }
  }

  const ref = parseRemoteTerminalRef("t-1@m-1@admin")!;
  const url = new URL("http://localhost/api/terminals/t-1@m-1@admin/stream?cols=80&rows=24");

  let machine: WebSocketServer;
  let machinePort: number;
  /** Sockets the machine accepted, and every frame each of them was sent. */
  let accepted: { socket: WsSocket; frames: string[] }[];

  beforeEach(async () => {
    accepted = [];
    machine = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    machine.on("connection", (socket) => {
      const entry = { socket, frames: [] as string[] };
      accepted.push(entry);
      socket.on("message", (data) => entry.frames.push(data.toString()));
    });
    await once(machine, "listening");
    machinePort = (machine.address() as AddressInfo).port;
  });

  afterEach(async () => {
    // Sockets a test left open first: close() waits for every client, and a relayed stream
    // stays up exactly as a real one would.
    for (const client of machine.clients) client.terminate();
    await new Promise<void>((resolve) => machine.close(() => resolve()));
  });

  const depsFor = (
    target: Promise<{ agent: http.Agent; port: number; cookie: string } | null>,
  ) => ({
    proxyTarget: () => target,
    isAdmin: () => true,
  });

  const settle = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it("dials nobody when the viewer left while the machine was being reached", async () => {
    const viewer = new FakeViewer();
    let reached: (t: { agent: http.Agent; port: number; cookie: string }) => void = () => undefined;
    const target = new Promise<{ agent: http.Agent; port: number; cookie: string }>((resolve) => {
      reached = resolve;
    });
    const relaying = relayTerminalStream(
      viewer as unknown as WsSocket,
      ref,
      url,
      depsFor(target),
      () => undefined,
    );
    // The pane closes first; the connection to the machine answers only afterwards.
    viewer.drop();
    reached({ agent: new http.Agent(), port: machinePort, cookie: "" });
    await relaying;
    await settle(() => accepted.length > 0);
    // Nothing was opened, so nothing is attached to a pty over there with no reader. Before
    // the viewer's close was listened to from the start, this left one stream per pane.
    expect(accepted).toHaveLength(0);
  });

  it("holds the frames typed before the machine's stream opened", async () => {
    const viewer = new FakeViewer();
    await relayTerminalStream(
      viewer as unknown as WsSocket,
      ref,
      url,
      depsFor(Promise.resolve({ agent: new http.Agent(), port: machinePort, cookie: "" })),
      () => undefined,
    );
    // The opening resize, sent while the handshake above is still in flight.
    viewer.emit("message", Buffer.from("resize 80x24"), true);
    await settle(() => (accepted[0]?.frames.length ?? 0) > 0);
    expect(accepted[0]?.frames).toEqual(["resize 80x24"]);

    // And the machine's output reaches the viewer once both ends are up.
    accepted[0]!.socket.send("hello");
    await settle(() => viewer.received.length > 0);
    expect(viewer.received).toEqual(["hello"]);
  });
});
