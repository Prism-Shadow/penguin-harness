/**
 * The per-message deflate the API socket speaks — the same compression a dialler of another
 * server's socket asks for (machines/machine-sockets.ts) and the server serving its own
 * socket offers (socket/compression.ts). One definition, so both ends of one socket agree.
 */
import type { PerMessageDeflateOptions } from "ws";

/** The deflate both ends offer and accept: level 6, no context takeover, nothing under 1 KiB. */
export const API_SOCKET_DEFLATE: PerMessageDeflateOptions = {
  threshold: 1024,
  zlibDeflateOptions: { level: 6 },
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
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

