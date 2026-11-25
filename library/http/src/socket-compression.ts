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
