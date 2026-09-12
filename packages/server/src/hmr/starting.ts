/**
 * What this process answers before the App exists.
 *
 * The entry binds the port first (index.ts), so from the moment the OS accepts connections
 * until `start` has built the App, every request lands here. That window is short on a warm
 * Linux box and long on a cold Windows one — a pushed plugin tree is thousands of files
 * read through a virus scanner — and a client that navigates into it must not be stranded:
 * a browser (the desktop shell's window above all) renders whatever it gets and never asks
 * again on its own. So an HTML client gets a page that re-requests until the App answers,
 * and every client gets `Retry-After`.
 */

const STARTING = "penguin-server is starting";

/** The page a navigating client gets: says what is happening, and comes back for the App. */
const PAGE =
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="refresh" content="1"><title>${STARTING}</title>` +
  `<style>:root{color-scheme:light dark}body{margin:0;height:100vh;display:flex;` +
  `align-items:center;justify-content:center;font:14px system-ui,sans-serif;opacity:.7}</style>` +
  `</head><body>${STARTING}…</body></html>`;

export function startingResponse(request: Request): Response {
  const html = (request.headers.get("accept") ?? "").includes("text/html");
  return new Response(html ? PAGE : STARTING, {
    status: 503,
    headers: {
      "retry-after": "1",
      "cache-control": "no-store",
      "content-type": html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    },
  });
}
