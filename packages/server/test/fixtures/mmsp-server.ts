/**
 * A loopback MMSP server: the model boundary for a request made with `client_type = "mmsp"`.
 *
 * MMSP's `mmsp` client POSTs `{ model, messages, config }` to `<baseUrl>/stream` and reads the
 * answer as server-sent events, one UniEvent (bytes as base64) per `data:` line, ending at
 * `[DONE]`; an error the server reports mid-stream is `data: {"error": {...}}`, which the client
 * raises as UpstreamError. Each request is answered by the test's script and recorded with the
 * headers it carried.
 */
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { once } from "node:events";

/** One request as the server received it. */
export interface MmspRequest {
  path: string;
  headers: IncomingHttpHeaders;
  model: string;
  config: Record<string, unknown>;
  messages: { role: string; content_items: { type: string; text?: string }[] }[];
}

/** How the server answers one request. */
export type MmspReply =
  /** These events, then `[DONE]`. */
  | { events: unknown[] }
  /** These events, then an error event (MMSP's envelope: `type`, `message`, any extra fields). */
  | { events: unknown[]; error: Record<string, unknown> }
  /** A keep-alive comment, then nothing until the client goes away. */
  | { hang: true };

export interface MmspServer {
  /** The base URL a model row is configured with (`…/v1`). */
  baseUrl: string;
  requests: MmspRequest[];
  close(): Promise<void>;
}

/** A text answer as MMSP streams it: one done item, then the stop event with this usage. */
export function textReply(text: string, usage: Record<string, number | null> | null): MmspReply {
  return {
    events: [
      {
        role: "assistant",
        event_type: "delta",
        content_items: [{ type: "text.done", text }],
        usage_metadata: null,
        finish_reason: null,
      },
      {
        role: "assistant",
        event_type: "stop",
        content_items: [],
        usage_metadata: usage,
        finish_reason: "stop",
      },
    ],
  };
}

export async function startMmspServer(
  answer: (request: MmspRequest) => MmspReply,
): Promise<MmspServer> {
  const requests: MmspRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Omit<
        MmspRequest,
        "path" | "headers"
      >;
      const request: MmspRequest = { ...body, path: req.url ?? "", headers: req.headers };
      requests.push(request);
      const reply = answer(request);
      res.writeHead(200, { "content-type": "text/event-stream" });
      if ("hang" in reply) {
        res.write(": waiting\n\n");
        return;
      }
      const lines = reply.events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
      if ("error" in reply) lines.push(`data: ${JSON.stringify({ error: reply.error })}\n\n`);
      else lines.push("data: [DONE]\n\n");
      res.end(lines.join(""));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close").catch(() => undefined);
    },
  };
}
