/**
 * Which API sockets compress their frames (permessage-deflate, RFC 7692), and how.
 *
 * A socket between two servers — this server's dial to a machine, over an ssh session that may
 * run at 10 KB/s — compresses: a Trace's text shrinks about threefold per frame, and deflate
 * per 64 KiB slice matched or beat zstd on the measured Traces while needing no binary frames.
 * So does a browser on another computer (a LAN address, Penguin Remote's public host). A
 * browser on this computer — the desktop app, the local dev page — does not: its link is
 * free, and compressing would spend CPU on nothing. The handshake tells them apart by its
 * `Origin`: none is a server (a browser always sends one), a loopback host is this computer.
 * The peer address cannot tell: Penguin Remote's last hop reaches the server over loopback.
 */
import type { PerMessageDeflateOptions } from "ws";

/** The deflate both ends offer and accept: level 6, context takeover on, nothing under 1 KiB. */
export const API_SOCKET_DEFLATE: PerMessageDeflateOptions = {
  threshold: 1024,
  zlibDeflateOptions: { level: 6 },
  serverNoContextTakeover: false,
  clientNoContextTakeover: false,
};

/** Whether `hostname` (a URL's, brackets kept for IPv6) names this computer. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "[::1]" || h === "::1") return true;
  return /^127(\.\d{1,3}){3}$/.test(h);
}

/** Whether an API socket handshake carrying this `Origin` is answered with compression. */
export function compressesApiSocket(origin: string | undefined): boolean {
  if (origin === undefined || origin.trim() === "") return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false; // the origin check refuses it anyway; nothing to compress for
  }
  return !isLoopbackHost(hostname);
}
