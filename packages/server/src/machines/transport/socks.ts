/**
 * A SOCKS5 CONNECT, the way this server reaches any TCP port on a machine.
 *
 * The one ssh session per machine is opened with `-D <local port>` (ssh-session.ts): ssh
 * listens on that loopback port as a SOCKS server, and every connection accepted there
 * becomes a `direct-tcpip` channel inside the session — the SSH protocol's own
 * multiplexing, over the one TCP connection already up. Reaching the machine's API, its
 * update endpoint, anything: dial here, and nothing new is opened on the far side.
 *
 * This is what VS Code Remote-SSH does, and for the same reason: Win32 OpenSSH has no
 * ControlMaster, so "one connection" cannot be had by sharing a socket between ssh
 * processes; it can be had by never starting a second one.
 *
 * Only the CONNECT command, no authentication (the listener is loopback and ssh's), and the
 * target is always an IPv4 loopback address on the far side. Small enough to own.
 */
import net from "node:net";

/** How long the SOCKS handshake itself may take; the request behind it sets its own after. */
const HANDSHAKE_TIMEOUT_MS = 20_000;

/** Dials `host:port` as seen from the machine, through the session's SOCKS port. */
export function dialThroughSocks(
  socksPort: number,
  host: string,
  port: number,
): Promise<net.Socket> {
  const parts = host.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return Promise.reject(new Error(`not an IPv4 address: ${host}`));
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error(`bad port ${port}`));
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: socksPort });
    // A handshake that stalls — a session half-dead, a far side that never answers the
    // channel open — must fail rather than hang the request that wanted it; the request's own
    // timeout only starts once it has a socket.
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => fail("the session's SOCKS handshake timed out"));
    let buffer = Buffer.alloc(0);
    let stage: "greet" | "connect" = "greet";
    const fail = (message: string) => {
      socket.removeListener("data", onData);
      socket.destroy();
      reject(new Error(message));
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greet") {
        if (buffer.length < 2) return;
        if (buffer[0] !== 5 || buffer[1] !== 0) return fail("the session's SOCKS listener refused");
        buffer = buffer.subarray(2);
        stage = "connect";
        socket.write(Buffer.from([5, 1, 0, 1, ...parts, port >> 8, port & 0xff]));
      }
      if (stage === "connect") {
        if (buffer.length < 4) return;
        if (buffer[1] !== 0)
          return fail(`the machine refused ${host}:${port} (SOCKS reply ${buffer[1]})`);
        const addrLen = buffer[3] === 1 ? 4 : buffer[3] === 4 ? 16 : 1 + (buffer[4] ?? 0);
        const total = 4 + addrLen + 2;
        if (buffer.length < total) return;
        const rest = buffer.subarray(total);
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        socket.setTimeout(0);
        if (rest.length > 0) socket.unshift(rest);
        resolve(socket);
      }
    };
    const onError = (err: Error) => fail(`the session's SOCKS port did not answer: ${err.message}`);
    socket.once("connect", () => socket.write(Buffer.from([5, 1, 0]))); // no authentication
    socket.on("data", onData);
    socket.once("error", onError);
  });
}
