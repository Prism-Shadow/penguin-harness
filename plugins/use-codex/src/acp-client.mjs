import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

// ACP transport only. Agent-specific authentication, launch settings and policies
// belong to a profile; Penguin's provider layer never sees this connection.
export class AcpClient {
  constructor({ command, args, env, cwd, spawnProcess = spawn }) {
    Object.assign(this, { command, args, env, cwd, spawnProcess });
    this.listeners = new Set();
    this.handlers = new Map();
    this.closed = false;
  }

  emit(method, params) {
    for (const listener of this.listeners) listener({ method, params });
  }

  async start() {
    if (this.closed) throw new Error("ACP connection is closed; reconnect the MCP server");
    this.proc = this.spawnProcess(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
    });
    this.proc.on("error", () => this.close());
    this.proc.on("exit", () => this.close());
    this.proc.stdin.on("error", () => this.close());
    // Account diagnostics can contain secrets. Drain them without exposing them.
    this.proc.stderr.resume();
    let app = client({ name: "penguin-delegation" });
    for (const method of [methods.client.session.update, methods.client.elicitation.complete])
      app = app.onNotification(method, (ctx) => this.emit(method, ctx.params));
    for (const method of [
      methods.client.session.requestPermission,
      methods.client.elicitation.create,
    ])
      app = app.onRequest(method, (ctx) => {
        const handler = this.handlers.get(method);
        if (!handler) throw new Error("Unsupported ACP client request");
        return handler(ctx.params, ctx.signal);
      });
    this.connection = app.connect(
      ndJsonStream(Writable.toWeb(this.proc.stdin), Readable.toWeb(this.proc.stdout)),
    );
    void this.connection.closed.then(() => this.close());
    this.info = await this.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "penguin-harness", version: "0.2.13" },
      // Agent handles filesystem/terminal operations. URL elicitation is for login;
      // forms are relayed to the human, never answered by the parent model.
      clientCapabilities: { elicitation: { url: {}, form: {} } },
    });
    if (this.info.protocolVersion !== PROTOCOL_VERSION) {
      this.close();
      throw new Error("Unsupported ACP protocol version");
    }
    return this.info;
  }

  async request(method, params = {}, timeoutMs = 30_000) {
    if (this.closed) throw new Error("ACP connection is closed; reconnect the MCP server");
    const timer = setTimeout(() => this.close(), timeoutMs);
    try {
      return await this.connection.agent.request(method, params);
    } catch {
      // Avoid forwarding arbitrary credential-bearing upstream error payloads.
      throw new Error(`ACP ${method} failed; check connection, sign-in and session state`);
    } finally {
      clearTimeout(timer);
    }
  }

  async notify(method, params) {
    if (this.closed) throw new Error("ACP connection is closed");
    await this.connection.agent.notify(method, params);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("bridge/closed", {});
    this.connection?.close();
    this.proc?.stdin.end();
    // Give the maintained adapter time to stop its Codex child on stdin EOF.
    // If it hangs, terminate the process tree, not just the adapter process.
    if (this.proc?.pid && this.proc.exitCode === null) {
      const pid = this.proc.pid;
      const timer = setTimeout(() => {
        if (process.platform === "win32") {
          const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.on("error", () => this.proc.kill());
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* Already exited. */
          }
        }
      }, 4_000);
      timer.unref();
      this.proc.once("exit", () => clearTimeout(timer));
    }
  }
}
