/**
 * What this process answers when there is no App to answer with: the entry binds the port
 * before `start` has built one, and the seam can find no generation current. Both are 503
 * with the reason. Only the first ends by itself, so only it asks for a retry.
 */

export function startingResponse(): Response {
  return unavailable("penguin-server is starting", true);
}

export function noPlatformResponse(reason: string): Response {
  return unavailable(`penguin-server has no running platform: ${reason}`, false);
}

function unavailable(text: string, retry: boolean): Response {
  return new Response(text, {
    status: 503,
    headers: {
      ...(retry ? { "retry-after": "1" } : {}),
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
