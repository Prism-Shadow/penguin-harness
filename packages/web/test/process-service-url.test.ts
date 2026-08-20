/**
 * process-service-url.ts unit tests: pulling a background process's service URL out of
 * the transcript — the exec_command promotion note and input_command arguments bind an
 * output text to a process id, the last printed local URL wins, ANSI wrapping and
 * listen-side wildcard hosts are cleaned up, and nested subagent conversations are
 * walked too.
 */
import { describe, expect, it } from "vitest";
import type { ChatItem, StreamModel, ToolCallItem } from "../src/lib/omni/stream-model";
import {
  detectProcessServiceUrls,
  extractLastLocalUrl,
  serviceUrlLabel,
} from "../src/features/chat/process-service-url";

let nextId = 1;

function toolItem(over: Partial<ToolCallItem> & Pick<ToolCallItem, "name">): ToolCallItem {
  return {
    kind: "tool_call",
    id: nextId++,
    toolCallId: `tc_${nextId}`,
    argumentsText: "",
    callStreaming: false,
    callComplete: true,
    output: "",
    outputStreaming: false,
    outputComplete: true,
    ...over,
  };
}

const PROMOTED = (id: string): string =>
  `[process running with process_id ${id}; use input_command to send input or poll for output]`;

describe("extractLastLocalUrl", () => {
  it("finds a plain localhost URL with port and path", () => {
    expect(extractLastLocalUrl("Local:   http://localhost:5173/app/ ready")).toBe(
      "http://localhost:5173/app/",
    );
  });

  it("strips ANSI color wrapping around the URL", () => {
    const esc = String.fromCharCode(0x1b);
    const text = `  ${esc}[32m➜${esc}[39m  Local: ${esc}[36mhttp://localhost:5173/${esc}[39m`;
    expect(extractLastLocalUrl(text)).toBe("http://localhost:5173/");
    const osc = `${esc}]8;;http://localhost:9999/${esc}\\http://localhost:5173/${esc}]8;;${esc}\\`;
    expect(extractLastLocalUrl(osc)).toBe("http://localhost:5173/");
  });

  it("takes the last URL when several are printed", () => {
    const text = "http://localhost:3000/ then restarted on http://localhost:3001/";
    expect(extractLastLocalUrl(text)).toBe("http://localhost:3001/");
  });

  it("normalizes listen-side wildcard hosts to localhost", () => {
    expect(extractLastLocalUrl("on http://0.0.0.0:8080")).toBe("http://localhost:8080");
    expect(extractLastLocalUrl("on http://[::]:8080")).toBe("http://localhost:8080");
  });

  it("keeps loopback hosts as printed", () => {
    expect(extractLastLocalUrl("http://127.0.0.1:9090/x")).toBe("http://127.0.0.1:9090/x");
    expect(extractLastLocalUrl("http://[::1]:9090")).toBe("http://[::1]:9090");
  });

  it("trims sentence punctuation but keeps the path's own slash", () => {
    expect(extractLastLocalUrl("Listening on http://localhost:4000/.")).toBe(
      "http://localhost:4000/",
    );
  });

  it("accepts https and a port-less origin", () => {
    expect(extractLastLocalUrl("at https://localhost/admin")).toBe("https://localhost/admin");
  });

  it("ignores remote hosts and URL-less text", () => {
    expect(extractLastLocalUrl("see https://example.com:5173/")).toBeNull();
    expect(extractLastLocalUrl("compiled in 130ms")).toBeNull();
  });
});

describe("serviceUrlLabel", () => {
  it("drops the scheme for the 11px row", () => {
    expect(serviceUrlLabel("http://localhost:5173/")).toBe("localhost:5173/");
  });
});

describe("detectProcessServiceUrls", () => {
  it("binds an exec_command promotion note's output URL to its process id", () => {
    const items: ChatItem[] = [
      toolItem({
        name: "exec_command",
        output: `vite ready at http://localhost:5173/\n${PROMOTED("proc_1")}`,
      }),
    ];
    expect(detectProcessServiceUrls(items).get("proc_1")).toBe("http://localhost:5173/");
  });

  it("binds an input_command poll's URL via its process_id argument", () => {
    const items: ChatItem[] = [
      toolItem({ name: "exec_command", output: `starting…\n${PROMOTED("proc_1")}` }),
      toolItem({
        name: "input_command",
        argumentsText: JSON.stringify({ process_id: "proc_1" }),
        output: "Local: http://localhost:3000/",
      }),
    ];
    expect(detectProcessServiceUrls(items).get("proc_1")).toBe("http://localhost:3000/");
  });

  it("recognizes the input_command still-running note spelling", () => {
    const items: ChatItem[] = [
      toolItem({
        name: "input_command",
        output: "on http://localhost:8080\n[process still running with process_id proc_9]",
      }),
    ];
    expect(detectProcessServiceUrls(items).get("proc_9")).toBe("http://localhost:8080");
  });

  it("lets a later URL replace an earlier one, and a URL-less poll keeps the last", () => {
    const items: ChatItem[] = [
      toolItem({
        name: "exec_command",
        output: `http://localhost:3000/\n${PROMOTED("proc_1")}`,
      }),
      toolItem({
        name: "input_command",
        argumentsText: '{"process_id":"proc_1"}',
        output: "restarted on http://localhost:3001/",
      }),
      toolItem({
        name: "input_command",
        argumentsText: '{"process_id":"proc_1"}',
        output: "GET /health 200",
      }),
    ];
    expect(detectProcessServiceUrls(items).get("proc_1")).toBe("http://localhost:3001/");
  });

  it("reads process_id out of partially streamed argument JSON", () => {
    const items: ChatItem[] = [
      toolItem({
        name: "input_command",
        argumentsText: '{"process_id":"proc_2","chars":"',
        output: "http://localhost:7000/",
      }),
    ];
    expect(detectProcessServiceUrls(items).get("proc_2")).toBe("http://localhost:7000/");
  });

  it("walks nested subagent conversations", () => {
    const nested = {
      items: [
        toolItem({
          name: "exec_command",
          output: `http://localhost:6006/\n${PROMOTED("proc_sub")}`,
        }),
      ],
    } as unknown as StreamModel;
    const viaCard: ChatItem[] = [toolItem({ name: "run_subagent", subagent: nested })];
    expect(detectProcessServiceUrls(viaCard).get("proc_sub")).toBe("http://localhost:6006/");
    const viaStandalone: ChatItem[] = [
      { kind: "subagent", id: nextId++, sessionId: "s1", model: nested },
    ];
    expect(detectProcessServiceUrls(viaStandalone).get("proc_sub")).toBe("http://localhost:6006/");
  });

  it("leaves processes without a printed URL absent", () => {
    const items: ChatItem[] = [
      toolItem({ name: "exec_command", output: `no url here\n${PROMOTED("proc_3")}` }),
      toolItem({ name: "read_file", output: "http://localhost:1234/ in a file" }),
    ];
    const urls = detectProcessServiceUrls(items);
    expect(urls.has("proc_3")).toBe(false);
    expect(urls.size).toBe(0);
  });
});
