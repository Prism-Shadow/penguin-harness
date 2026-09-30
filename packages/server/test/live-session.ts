/**
 * What a suite needs to drive a real core Session rather than a fake: a loopback model
 * endpoint and a hook package written by hand.
 *
 * The endpoint answers every request with one streamed text reply in the Anthropic Messages
 * wire format — what the `custom` provider's `claude-4-8` is read with — and records each
 * request body, so a test can check what the model was sent. Point a model entry's
 * `base_url` at its `url`.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { OmniMessage, TextPayload } from "@prismshadow/penguin-core";

/** The model id the endpoint stands in for (routed to the Anthropic Messages client). */
export const MOCK_MODEL_ID = "claude-4-8";

export interface MockLLM {
  url: string;
  /** Every request body, parsed, in arrival order. */
  requests: Array<{ messages?: unknown[] }>;
  close(): Promise<void>;
}

/** Starts the endpoint; `reply` is the text of the n-th answer (1-based). */
export async function startMockLLM(
  reply: (n: number) => string = (n) => `reply ${n}`,
): Promise<MockLLM> {
  const requests: MockLLM["requests"] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      try {
        requests.push(JSON.parse(body) as MockLLM["requests"][number]);
      } catch {
        requests.push({});
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (data: { type: string; [key: string]: unknown }): void => {
        res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send({
        type: "message_start",
        message: {
          id: `msg_${requests.length}`,
          type: "message",
          role: "assistant",
          model: MOCK_MODEL_ID,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 40,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      });
      send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      send({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: reply(requests.length) },
      });
      send({ type: "content_block_stop", index: 0 });
      send({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      });
      send({ type: "message_stop" });
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A recorded request's messages as one string, for order and count checks. */
export function requestText(request: { messages?: unknown[] }): string {
  return JSON.stringify(request.messages ?? []);
}

/** What the clock package answers for a prompt. */
export const clockContext = (prompt: string): string =>
  `The local time is 10:00 (asked: ${prompt}).`;

/** The clock package's one script: answers every prompt with a context naming what it was asked. */
const CLOCK_SCRIPT = [
  "let raw = '';",
  "process.stdin.on('data', (chunk) => (raw += chunk));",
  "process.stdin.on('end', () => {",
  "  const { prompt } = JSON.parse(raw);",
  "  const context = 'The local time is 10:00 (asked: ' + prompt + ').';",
  "  process.stdout.write(JSON.stringify({ context }));",
  "});",
  "",
].join("\n");

/**
 * The clock package's files, keyed by path inside the package directory, as a person or an
 * Agent writes them by hand: a manifest naming only the hook point it uses — no name, no
 * version — and its script.
 */
export function clockPackageFiles(): Record<string, string> {
  return {
    "hooks.json": `${JSON.stringify({ user_prompt: [{ command: "clock.mjs" }] }, null, 2)}\n`,
    "clock.mjs": CLOCK_SCRIPT,
  };
}

/** Writes the clock package into `hooksRoot` (an Agent's `agent_state/hooks/`) as `clock/`. */
export async function writeClockPackage(hooksRoot: string): Promise<void> {
  const dir = path.join(hooksRoot, "clock");
  await fs.mkdir(dir, { recursive: true });
  for (const [rel, text] of Object.entries(clockPackageFiles())) {
    await fs.writeFile(path.join(dir, rel), text);
  }
}

/** The main-session user texts among `messages`, as their sender and text. */
export function userTexts(
  messages: readonly OmniMessage[],
): Array<{ sender: string; text: string }> {
  return messages
    .filter((m) => {
      const p = m.payload as { type?: string; role?: string };
      return m.type === "model_msg" && !m.origin?.length && p.type === "text" && p.role === "user";
    })
    .map((m) => {
      const p = m.payload as TextPayload;
      return { sender: p.sender ?? "user", text: p.text };
    });
}
