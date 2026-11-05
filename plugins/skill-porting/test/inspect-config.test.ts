/**
 * The masked config reader the `agent-porting` skill reads another tool's configuration through
 * (skills/agent-porting/scripts/inspect-config.mjs), run as the Agent runs it: Node on a file.
 *
 * - A Claude Code `~/.claude.json` prints its MCP servers, top level and per project, and none of
 *   the account state around them; every credential in them is masked, by key, by position
 *   (`env`, `headers`), as a flag's argument, as a `--name=value` argument and as a URL query
 *   parameter, while the key names, the commands and the `${VAR}` references stay readable.
 * - A Codex `config.toml` keeps the variable names a key says it holds (`env_key`,
 *   `bearer_token_env_var`, `env_vars`, `env_http_headers`), a public OAuth client id and the
 *   model settings, and masks the bearer token, the client secret and every `env` and header
 *   value.
 * - A DeepSeek Harness `cordis.patch.yml` keeps a `${credential:…}` reference and masks a literal
 *   value beside it.
 * - A Qwen Code `settings.json` with comments and a trailing comma still parses: the API key and
 *   an inline `NAME=value` in a hook command are masked, a token count is kept.
 * - A credential store is refused unread, and a file that does not parse prints its key names
 *   and no value.
 * - `--scan` on a folder about to be imported names each line where a literal credential sits,
 *   masked, and fails; a folder holding only `${KEY}` references and code that reads a variable
 *   passes. `--show` prints such a file with the literal masked and the rest as written.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "../skills/agent-porting/scripts/inspect-config.mjs");

let dir = "";
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspect-config-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Writes `text` as `name` in a fresh folder and runs the script on it. */
async function inspect(name: string, text: string, ...flags: string[]) {
  const sub = await fs.mkdtemp(path.join(dir, "case-"));
  const file = path.join(sub, name);
  await fs.writeFile(file, text);
  const run = spawnSync(process.execPath, [SCRIPT, file, ...flags], { encoding: "utf8" });
  return { out: run.stdout, err: run.stderr, status: run.status };
}

/** The fake secret values each fixture plants; none of them may be printed. */
const secret = (n: number) => `planted-secret-value-${n}`;

describe("a Claude Code ~/.claude.json", () => {
  const file = JSON.stringify({
    oauthAccount: { emailAddress: "someone@example.com", accessToken: secret(1) },
    userID: "account-identity-hash",
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "example-github-mcp", "--token", secret(2)],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: secret(3) },
      },
      docs: {
        type: "http",
        url: `https://mcp.example.com/mcp?api_key=${secret(4)}&region=eu`,
        headers: { Authorization: "Bearer ${DOCS_TOKEN}", "X-Team": secret(5) },
      },
    },
    projects: {
      "/home/u/repo": {
        mcpServers: { db: { command: "db-mcp", args: [`--password=${secret(6)}`] } },
        history: [{ display: `a prompt that mentions ${secret(7)}` }],
      },
      "/home/u/empty": { mcpServers: {} },
    },
  });

  it("prints the MCP servers with every credential masked and nothing of the account", async () => {
    const { out, status } = await inspect(".claude.json", file);
    expect(status).toBe(0);
    for (let n = 1; n <= 7; n++) expect(out).not.toContain(secret(n));
    expect(out).not.toContain("someone@example.com");
    expect(out).not.toContain("account-identity-hash");
    expect(out).not.toContain("/home/u/empty");
    for (const kept of [
      "github",
      "example-github-mcp",
      "--token",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "Bearer ${DOCS_TOKEN}",
      "X-Team",
      "region=eu",
      "/home/u/repo",
      "db-mcp",
      "--password=",
    ]) {
      expect(out).toContain(kept);
    }
    expect(out).toContain("<redacted:GITHUB_PERSONAL_ACCESS_TOKEN>");
  });
});

describe("a Codex config.toml", () => {
  const file = [
    'model = "gpt-6.1-sol"',
    'model_reasoning_effort = "high"',
    "",
    "[model_providers.acme]",
    'env_key = "ACME_API_KEY"',
    `experimental_bearer_token = "${secret(8)}"`,
    "",
    "[mcp_servers.github]",
    'command = "npx"',
    'args = ["-y", "example-github-mcp"]',
    `env = { GITHUB_TOKEN = "${secret(9)}" }`,
    'env_vars = ["GH_HOST"]',
    "",
    "[mcp_servers.remote]",
    'url = "https://mcp.example.com/mcp"',
    'bearer_token_env_var = "REMOTE_TOKEN"',
    `http_headers = { "X-Api-Key" = "${secret(10)}" }`,
    'env_http_headers = { "X-Org" = "ORG_ID" }',
    "",
    "[mcp_servers.remote.oauth]",
    'client_id = "public-client-id"',
    `client_secret = "${secret(11)}"`,
    "",
  ].join("\n");

  it("keeps the variable names and the model settings, and masks every value", async () => {
    const { out, status } = await inspect("config.toml", file);
    expect(status).toBe(0);
    for (let n = 8; n <= 11; n++) expect(out).not.toContain(secret(n));
    for (const kept of [
      "gpt-6.1-sol",
      "ACME_API_KEY",
      "GH_HOST",
      "REMOTE_TOKEN",
      "ORG_ID",
      "public-client-id",
      "GITHUB_TOKEN",
      "X-Api-Key",
      "client_secret",
      "https://mcp.example.com/mcp",
    ]) {
      expect(out).toContain(kept);
    }
  });
});

describe("a DeepSeek Harness cordis.patch.yml", () => {
  const file = [
    "- insert:",
    "    - id: mcp-github",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: github",
    "        transport: stdio",
    "        command: npx",
    "        args: [-y, example-github-mcp]",
    "        env:",
    "          GITHUB_TOKEN: ${credential:github}",
    `          OTHER_TOKEN: ${secret(12)}  # a comment`,
    "        cwd: !!js process.cwd()",
    "",
  ].join("\n");

  it("keeps the credential reference and masks the literal beside it", async () => {
    const { out, status } = await inspect("cordis.patch.yml", file);
    expect(status).toBe(0);
    expect(out).not.toContain(secret(12));
    for (const kept of [
      "serverName",
      "github",
      "${credential:github}",
      "OTHER_TOKEN",
      "example-github-mcp",
    ]) {
      expect(out).toContain(kept);
    }
  });
});

describe("a Qwen Code settings.json with comments", () => {
  const file = `{
  // user settings
  "model": { "name": "qwen-coder-example", "maxTokens": 8192 },
  "security": { "auth": { "selectedType": "openai", "apiKey": "${secret(13)}" } },
  "mcpServers": {
    "x": { "httpUrl": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer ${secret(14)}" } }
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "API_TOKEN=${secret(15)} ./check.sh" }] }
    ]
  },
}`;

  it("parses, masks the key, the header and the inline assignment, and keeps the rest", async () => {
    const { out, status } = await inspect("settings.json", file);
    expect(status).toBe(0);
    for (let n = 13; n <= 15; n++) expect(out).not.toContain(secret(n));
    for (const kept of [
      "qwen-coder-example",
      "8192",
      "apiKey",
      "httpUrl",
      "PreToolUse",
      "./check.sh",
      "API_TOKEN=",
    ]) {
      expect(out).toContain(kept);
    }
  });
});

describe("files it does not print", () => {
  it("refuses a credential store unread", async () => {
    const { out, status } = await inspect(
      "auth.json",
      JSON.stringify({ OPENAI_API_KEY: secret(16) }),
    );
    expect(status).not.toBe(0);
    expect(out).not.toContain(secret(16));
    expect(out).not.toContain("OPENAI_API_KEY");
  });

  it("prints only the key names of a file it cannot parse", async () => {
    const { out } = await inspect("config.toml", `token = "${secret(17)}"\n[[broken\nname = "x"\n`);
    expect(out).not.toContain(secret(17));
    expect(out).toContain("token");
  });
});

describe("checking a folder before it is imported", () => {
  /** A port folder: `files` relative to it. */
  async function folder(files: Record<string, string>): Promise<string> {
    const root = await fs.mkdtemp(path.join(dir, "port-"));
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), text);
    }
    return root;
  }
  const manifest = JSON.stringify(
    {
      agentId: "reviewer",
      vaultKeys: ["DOCS_TOKEN"],
      definition: {
        mcpServers: [
          { name: "docs", config: { headers: { Authorization: "Bearer ${DOCS_TOKEN}" } } },
        ],
      },
    },
    null,
    2,
  );
  const hook = "const token = process.env.REVIEW_TOKEN;\nconsole.log(token ? '' : '{}');\n";

  it("names the line a literal value sits on, masked, and fails", async () => {
    const root = await folder({
      "manifest.json": manifest,
      "agent_state/hooks/review/check.mjs": hook,
      "agent_state/skills/call/scripts/call.mjs": `const apiKey = "${secret(18)}";\n`,
      "agent_state/skills/call/config.yaml": `password: ${secret(19)}\n`,
    });
    const run = spawnSync(process.execPath, [SCRIPT, "--scan", root], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain(secret(18));
    expect(run.stdout).not.toContain(secret(19));
    expect(run.stdout).toContain(path.join("agent_state", "skills", "call", "scripts", "call.mjs"));
    expect(run.stdout).toContain(path.join("agent_state", "skills", "call", "config.yaml"));
    expect(run.stdout).not.toContain("manifest.json");
    expect(run.stdout).not.toContain("check.mjs");
  });

  it("shows a flagged script with the literal masked and the code around it intact", async () => {
    const root = await folder({
      "call.sh": `#!/bin/sh\nAPI_TOKEN=${secret(20)}\ncurl -H "Authorization: Bearer $API_TOKEN" "$URL"\n`,
    });
    const run = spawnSync(process.execPath, [SCRIPT, "--show", path.join(root, "call.sh")], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain(secret(20));
    expect(run.stdout).toContain("API_TOKEN=");
    expect(run.stdout).toContain('curl -H "Authorization: Bearer $API_TOKEN" "$URL"');
  });

  it("passes a folder that holds only references and names", async () => {
    const root = await folder({
      "manifest.json": manifest,
      "agent_state/hooks/review/check.mjs": hook,
    });
    const run = spawnSync(process.execPath, [SCRIPT, "--scan", root], { encoding: "utf8" });
    expect(run.status).toBe(0);
  });
});
