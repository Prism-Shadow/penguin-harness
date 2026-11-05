/**
 * The one fetch fake: records each request and answers from the test's script (a response, or
 * a network failure). Installed with `vi.stubGlobal`; `vi.unstubAllGlobals()` restores it.
 */
import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

export type Answer = { status: number; body: unknown } | "network-error";

export function installFetch(answer: Answer) {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      credentials: init.credentials,
    });
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    const text = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    return new Response(text, {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  });
  return { requests };
}
