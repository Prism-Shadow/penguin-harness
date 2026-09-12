/**
 * What this process answers when there is no App to answer with. Two situations, and they
 * are not the same one:
 *
 * - **Starting.** The entry binds the port first (index.ts), so from the moment the OS
 *   accepts connections until `start` has built the App, every request lands here. That
 *   window is short on a warm Linux box and long on a cold Windows one, where a pushed
 *   plugin tree is thousands of files read through a virus scanner. It ends by itself, so
 *   the answer says to come back.
 * - **No platform.** No generation is current: not even the packaged one could boot. It
 *   does not end by itself, so the answer says what happened and does not ask for a retry.
 *
 * Either way a navigating client must not be stranded on text it cannot act on: a browser,
 * the desktop shell's window above all, renders whatever it gets and never asks again on
 * its own.
 */

const STARTING = "penguin-server is starting";

function page(text: string, retry: boolean): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    (retry ? `<meta http-equiv="refresh" content="1">` : "") +
    `<title>${STARTING}</title>` +
    `<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;` +
    `align-items:center;justify-content:center;padding:0 16px;text-align:center;` +
    `font:14px system-ui,sans-serif;opacity:.7}</style>` +
    `</head><body>${text}</body></html>`
  );
}

function unavailable(request: Request, text: string, retry: boolean): Response {
  const html = (request.headers.get("accept") ?? "").includes("text/html");
  return new Response(html ? page(text, retry) : text, {
    status: 503,
    headers: {
      ...(retry ? { "retry-after": "1" } : {}),
      "cache-control": "no-store",
      "content-type": html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    },
  });
}

/** Before the App exists: the window ends on its own, so the client is told to come back. */
export function startingResponse(request: Request): Response {
  return unavailable(request, STARTING, true);
}

/** No generation is current: a fault, named, and no retry to promise. */
export function noPlatformResponse(request: Request, reason: string): Response {
  return unavailable(request, `penguin-server has no running platform: ${reason}`, false);
}
