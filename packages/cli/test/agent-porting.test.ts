/**
 * `penguin agent export` / `penguin agent import` against the fake server: export writes the
 * server-named bundle where --out points (a directory, a file path, or the cwd) and prints
 * the path; import posts the file's bytes as base64 with the id override and reports what
 * the server installed, skipped and expects in the vault.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { resolveOutPath } from "../src/commands/agent.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
let scratch: string;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  stdout = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-port-"));
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  uninstall();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const out = () => stdout.join("");

describe("penguin agent export", () => {
  it("writes the server-named bundle into --out <dir> and prints the path", async () => {
    server.bundle = new TextEncoder().encode("PKbytes");
    const code = await cli(["agent", "export", "researcher", "--out", scratch]);
    expect(code).toBe(0);
    const file = path.join(scratch, "researcher-export.zip");
    expect(fs.readFileSync(file, "utf8")).toBe("PKbytes");
    expect(out()).toContain(t.agent.exported(file));
    expect(
      server.requests.some(
        (r) =>
          r.method === "GET" && r.path === "/api/projects/default_project/agents/researcher/bundle",
      ),
    ).toBe(true);
  });

  it("--out <file> names the file, creating its parent; --json prints the record", async () => {
    const file = path.join(scratch, "nested", "bundle.zip");
    const code = await cli(["agent", "export", "researcher", "--out", file, "--json"]);
    expect(code).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(out())).toEqual({
      agentId: "researcher",
      projectId: "default_project",
      file,
    });
  });

  it("resolveOutPath: cwd by default, a directory when it exists or ends with a separator", async () => {
    expect(await resolveOutPath(undefined, "a-export.zip")).toBe(path.resolve("a-export.zip"));
    expect(await resolveOutPath(scratch, "a-export.zip")).toBe(path.join(scratch, "a-export.zip"));
    const fresh = path.join(scratch, "new-dir");
    expect(await resolveOutPath(`${fresh}/`, "a-export.zip")).toBe(
      path.join(fresh, "a-export.zip"),
    );
    expect(fs.statSync(fresh).isDirectory()).toBe(true);
  });
});

describe("penguin agent import", () => {
  it("posts the file as base64 with --agent-id and reports the outcome", async () => {
    const file = path.join(scratch, "researcher-export.zip");
    fs.writeFileSync(file, "PK zip bytes");
    server.importOutcome = {
      installed: { skills: ["skill-porting"], hooks: ["goal"] },
      skipped: ['Built-in tool "no_such_tool" does not exist in this install; it was not enabled.'],
      vaultKeys: ["SEARCH_API_KEY"],
    };
    const code = await cli(["agent", "import", file, "--agent-id", "researcher_2"]);
    expect(code).toBe(0);
    const post = server.requests.find(
      (r) => r.method === "POST" && r.path.endsWith("/agents/import"),
    );
    expect(post?.body).toEqual({
      dataBase64: Buffer.from("PK zip bytes").toString("base64"),
      agentId: "researcher_2",
    });
    expect(out()).toContain(t.agent.imported("researcher_2", "default_project"));
    expect(out()).toContain(t.agent.importInstalled(1, 1));
    expect(out()).toContain("no_such_tool");
    expect(out()).toContain(t.agent.importVaultKeys("SEARCH_API_KEY"));
  });

  it("a bare penguin-agent.json goes up the same way; --json prints the server's response", async () => {
    const file = path.join(scratch, "penguin-agent.json");
    fs.writeFileSync(file, JSON.stringify({ format: "penguin-agent/1", id: "greeter" }));
    const code = await cli(["agent", "import", file, "--json"]);
    expect(code).toBe(0);
    const post = server.requests.find(
      (r) => r.method === "POST" && r.path.endsWith("/agents/import"),
    );
    expect(post?.body).toEqual({ dataBase64: fs.readFileSync(file).toString("base64") });
    expect(JSON.parse(out()).agent.agentId).toBe("imported_agent");
  });
});
