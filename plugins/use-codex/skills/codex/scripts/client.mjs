import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

// Transport only: Codex owns its delegated thread. No OpenAI model requests or tokens
// pass through Penguin's LLM layer. This file also runs from an installed skill.
export class CodexClient {
  constructor({
    projectDir,
    cwd,
    executable = process.env.PENGUIN_CODEX_EXECUTABLE ||
      (process.platform === "win32" ? "codex.exe" : "codex"),
    spawnProcess = spawn,
  }) {
    if (!path.isAbsolute(projectDir))
      throw new Error("projectDir must be an absolute Penguin project data directory");
    this.home = path.join(projectDir, "coding-agents", "codex");
    this.cwd = cwd;
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.pending = new Map();
    this.listeners = new Set();
    this.nextId = 0;
    this.closed = false;
  }

  async start() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    // Only pass the OS execution environment. Never inherit API keys, access tokens,
    // CODEX_HOME, or provider overrides from Penguin's host process.
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|CODEX_CA_CERTIFICATE)$/i.test(
          key,
        )
      )
        env[key] = value;
    }
    env.CODEX_HOME = this.home;
    this.proc = this.spawnProcess(
      this.executable,
      [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        'forced_login_method="chatgpt"',
        "-c",
        'cli_auth_credentials_store="file"',
      ],
      {
        cwd: this.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      },
    );
    this.proc.on("error", () =>
      this.fail(
        new Error(
          "Could not start Codex. Install the official Codex CLI; on Windows configure PENGUIN_CODEX_EXECUTABLE with the absolute codex.exe path.",
        ),
      ),
    );
    this.proc.on("exit", () =>
      this.fail(
        new Error(
          "Codex app-server exited; reconnect the MCP server and resume the returned thread ID.",
        ),
      ),
    );
    // stderr is intentionally drained, never copied into tool output (login diagnostics
    // may contain sensitive account information).
    this.proc.stderr.resume();
    this.proc.stdin.on("error", () => this.fail(new Error("Codex connection closed")));
    this.lines = createInterface({ input: this.proc.stdout });
    this.lines.on("line", (line) => {
      if (line.length > 4_000_000)
        return this.fail(new Error("Codex response exceeded the transport limit"));
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return this.fail(new Error("Invalid Codex app-server response"));
      }
      if (msg.method) {
        for (const listener of this.listeners) listener(msg);
      } else {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        // Do not expose arbitrary upstream error payloads or credential-bearing RPCs.
        if (msg.error)
          pending.reject(
            new Error(`Codex ${pending.method} failed (code ${msg.error.code ?? "unknown"})`),
          );
        else pending.resolve(msg.result);
      }
    });
    await this.request("initialize", {
      clientInfo: {
        name: "penguin_harness",
        title: "PenguinHarness Codex delegation",
        version: "0.2.13",
      },
    });
    this.send({ method: "initialized", params: {} });
  }

  send(message) {
    if (this.closed) throw new Error("Codex connection is closed");
    this.proc.stdin.write(JSON.stringify(message) + "\n");
  }

  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Codex connection is closed"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed-out mutating RPC has an uncertain outcome: terminate rather than
        // keep an untracked task running or retry it as another task.
        this.fail(new Error(`Codex ${method} timed out`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ id, method, params });
    });
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners)
      listener({ method: "bridge/closed", params: { message: error.message } });
    this.lines?.close();
    this.proc?.kill();
  }

  close() {
    this.fail(new Error("Codex connection closed"));
  }
}
