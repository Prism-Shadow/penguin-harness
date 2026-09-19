// Minimal stdio MCP surface, using only Node builtins so installed skill files remain
// self-contained. No HTTP listener, token extraction, or model-provider emulation.
import path from "node:path";
import { CodexBridge, TOOLS } from "./bridge.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--project-dir" || !path.isAbsolute(args[1])) {
  process.stderr.write(
    "Usage: node server.mjs --project-dir <absolute Penguin project data directory>\n",
  );
  process.exit(1);
}
const bridge = new CodexBridge({ projectDir: args[1], cwd: process.cwd() });
let initialized = false;
let stopping = false;
let buffer = "";
let queue = Promise.resolve();
let queued = 0;
const active = new Set();
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");

async function stop() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => {
    bridge.client.close();
    process.exit(0);
  }, 2000);
  await bridge.close();
  clearTimeout(timer);
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.stdin.on("end", () => void stop());
process.stdout.on("error", () => void stop());
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (buffer.length > 1_000_000) return void stop();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Invalid JSON" } });
      continue;
    }
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      send({ id: msg?.id ?? null, error: { code: -32600, message: "Invalid request" } });
      continue;
    }
    if (msg.method === "notifications/cancelled") {
      // Calls are short management operations. An interrupted launch may have started
      // work already; close the connection and stop its delegated work explicitly.
      if (active.has(msg.params?.requestId)) void stop();
      continue;
    }
    if (msg.id === undefined) continue;
    if (++queued > 32) {
      queued--;
      send({ id: msg.id, error: { code: -32000, message: "Too many queued requests" } });
      continue;
    }
    active.add(msg.id);
    // Serializes account changes and task starts; polling never races a login/logout.
    queue = queue.then(async () => {
      if (stopping) return;
      try {
        let result;
        if (msg.method === "initialize") {
          if (initialized) throw new Error("Already initialized");
          initialized = true;
          const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
          result = {
            protocolVersion: versions.includes(msg.params?.protocolVersion)
              ? msg.params.protocolVersion
              : versions[0],
            capabilities: { tools: {} },
            serverInfo: { name: "penguin-codex", version: "0.2.13" },
          };
        } else if (!initialized) throw new Error("Initialize first");
        else if (msg.method === "ping") result = {};
        else if (msg.method === "tools/list") result = { tools: TOOLS };
        else if (msg.method === "tools/call") {
          try {
            const output = await bridge.call(msg.params?.name, msg.params?.arguments ?? {});
            result = { content: [{ type: "text", text: JSON.stringify(output) }] };
          } catch (error) {
            result = { isError: true, content: [{ type: "text", text: error.message }] };
          }
        } else {
          send({ id: msg.id, error: { code: -32601, message: "Method not found" } });
          return;
        }
        send({ id: msg.id, result });
      } catch (error) {
        send({ id: msg.id, error: { code: -32600, message: error.message } });
      } finally {
        queued--;
        active.delete(msg.id);
      }
    });
  }
});
