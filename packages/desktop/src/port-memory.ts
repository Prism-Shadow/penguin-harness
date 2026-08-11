/**
 * Port stickiness across launches. The renderer's localStorage (theme, language, panel
 * layout — the web app's persistence mechanism) is scoped to the app origin
 * `http://localhost:<port>`, so a port that changes every launch silently drops every
 * user preference. The shell therefore remembers the port the server actually bound and
 * asks for it again next launch — PORT=0 stays the allocator (first launch, or whenever
 * the remembered port is taken), so no fixed number is introduced that could clash with
 * other installs or dev servers.
 *
 * No Electron imports, so this unit-tests under plain vitest.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { parsePortFile } from "./util.js";

/** Reads the remembered port (same format as the announcement file); null when absent or invalid. */
export function readPreferredPort(file: string): number | null {
  try {
    return parsePortFile(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Records the port the server actually bound, for the next launch to prefer. */
export function rememberPreferredPort(file: string, port: number): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${port}\n`);
  } catch {
    // Best-effort: losing the memory only costs origin stickiness next launch.
  }
}

/**
 * Whether a bind on host:port would succeed. Only EADDRINUSE / EACCES veto the port;
 * any other error (e.g. no IPv6 stack for `::1`) says nothing about availability.
 */
function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code !== "EADDRINUSE" && err.code !== "EACCES");
    });
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * The port to request for this launch: the preferred (last bound) port when it is still
 * free, else 0 for a fresh OS-assigned one. Both loopback stacks are probed — the server
 * binds 127.0.0.1 and mirrors onto `::1`, and a foreign listener on either would let the
 * window's `localhost` resolution reach the wrong process.
 */
export async function choosePort(preferred: number | null): Promise<number> {
  if (preferred === null) return 0;
  const free = await Promise.all([
    portIsFree(preferred, "127.0.0.1"),
    portIsFree(preferred, "::1"),
  ]);
  return free.every(Boolean) ? preferred : 0;
}
