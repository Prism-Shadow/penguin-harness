/**
 * The reader the `agent-porting` skill reads another tool's files through
 * (skills/agent-porting/scripts/inspect-config.mjs), run as the Agent runs it: Node on a file or
 * a folder. Every planted value is fake, and none may appear in stdout or stderr.
 *
 * Structured configuration prints by allowlist:
 * - A Claude Code `~/.claude.json` prints its MCP servers and none of the account state around
 *   them. The program, a bare flag, a package name, a project path, a `${VAR}` reference (under
 *   a credential header too) and a URL's host and path print; a flag's value, an `env` value, a
 *   header value and a URL's query do not.
 * - A Codex `config.toml` prints its model settings and the variable names its name-holding keys
 *   carry (`env_key`, `bearer_token_env_var`, `env_vars`, `env_http_headers`), never a token or
 *   a client secret.
 * - A DeepSeek Harness `cordis.patch.yml` shows a `${credential:…}` reference's name, and masks a
 *   literal beside it.
 * - A reference under a credential key prints its variable's name; one whose inside is shaped
 *   like a token, and a name-holding key whose value is, print as their length only.
 * - A Qwen Code `settings.json` with comments still parses; a hook's shell line prints only its
 *   program.
 * - A value under a key the reader does not know prints as its length only, however plain it
 *   looks: nothing but structure leaks.
 * - The review's probes: a credential flag with a space inside a command line, a header inside a
 *   longer string or a block scalar, `curl -u user:pw`, `pass` / `pwd` / `passphrase` keys and
 *   flags, Stripe, Hugging Face, npm and JWT tokens, a PEM key under an unremarkable key, and
 *   files that do not parse (JSON5 quotes, an unquoted value, a bad YAML escape, a multi-line
 *   YAML string), whose error never quotes the file.
 *
 * Files it refuses: credential stores (`.env`, `secrets.env`, `.envrc`, `auth.json`, `*.pem`) are
 * not read, by any mode.
 *
 * `--scan` names each flagged line as `file:line: <kind>` and never prints the line: a shell
 * script's `export TOKEN=… DB_PASS=…`, `mysql -p…`, `curl -u user:pw … Bearer …`, an OpenSSH key
 * in a file without an extension, a literal key in code; a folder holding only references and
 * code that reads a variable passes. `--show` prints a text file with each flagged line replaced
 * whole and the rest as written.
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

/** A fresh folder holding `files` (paths relative to it). */
async function folder(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(dir, "case-"));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

/** Runs the script; `out` is stdout and stderr together, everything a Trace would get. */
function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { out: `${r.stdout}${r.stderr}`, status: r.status };
}

/** Writes `text` as `name` and reads it in the structured mode. */
async function inspect(name: string, text: string, ...flags: string[]) {
  const root = await folder({ [name]: text });
  return run(path.join(root, name), ...flags);
}

/** The fake values the fixtures plant. */
const secret = (n: number) => `planted-secret-value-${n}`;
/** The review's probe markers. */
const PROBE = /PROBESECRET\d+|PROBESIG/;
/**
 * A fake value in a vendor's token shape, assembled at run time so that no token-shaped literal
 * sits in the source (a secret scanner reads the repository, and would rightly stop it).
 */
const shaped = (...parts: string[]) => parts.join("");
const KEY_BLOCK = (kind: string, body: string) =>
  [`-----BEGIN ${kind}`, `${body}`, `-----END ${kind}`].join("\n");

describe("a Claude Code ~/.claude.json", () => {
  const file = JSON.stringify({
    oauthAccount: { emailAddress: "someone@example.com", accessToken: secret(1) },
    userID: "account-identity-hash",
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "example-github-mcp", "--token", secret(2)],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: secret(3), LOG_LEVEL: "${LOG_LEVEL}" },
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

  it("prints the servers' structure and none of their values or the account", async () => {
    const { out, status } = await inspect(".claude.json", file);
    expect(status).toBe(0);
    for (let n = 1; n <= 7; n++) expect(out).not.toContain(secret(n));
    for (const gone of [
      "someone@example.com",
      "account-identity-hash",
      "/home/u/empty",
      "region=eu",
    ]) {
      expect(out).not.toContain(gone);
    }
    for (const kept of [
      '"npx"',
      '"-y"',
      '"example-github-mcp"',
      '"--token"',
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      '"${LOG_LEVEL}"',
      "https://mcp.example.com/mcp?<redacted:query>",
      '"Bearer ${DOCS_TOKEN}"',
      "X-Team",
      "/home/u/repo",
      '"db-mcp"',
      "--password=<redacted:",
    ]) {
      expect(out).toContain(kept);
    }
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
    `client_secret = "${secret(11)}"`,
    "",
  ].join("\n");

  it("prints the model settings and the variable names, and no value", async () => {
    const { out, status } = await inspect("config.toml", file);
    expect(status).toBe(0);
    for (let n = 8; n <= 11; n++) expect(out).not.toContain(secret(n));
    for (const kept of [
      '"gpt-6.1-sol"',
      '"high"',
      '"ACME_API_KEY"',
      '"REMOTE_TOKEN"',
      '"ORG_ID"',
      '"GH_HOST"',
      "GITHUB_TOKEN",
      "X-Api-Key",
      "client_secret",
      '"https://mcp.example.com/mcp"',
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
    "",
  ].join("\n");

  it("shows the credential reference's name and masks the literal beside it", async () => {
    const { out, status } = await inspect("cordis.patch.yml", file);
    expect(status).toBe(0);
    expect(out).not.toContain(secret(12));
    for (const kept of [
      '"stdio"',
      '"@deepseek-ai/dsh-mcp-client"',
      '"${credential:github}"',
      "OTHER_TOKEN",
      '"example-github-mcp"',
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
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "API_TOKEN=${secret(15)} ./check.sh --strict" }] }
    ]
  },
}`;

  it("parses, and prints a hook's shell line as its program only", async () => {
    const { out, status } = await inspect("settings.json", file);
    expect(status).toBe(0);
    for (let n = 13; n <= 15; n++) expect(out).not.toContain(secret(n));
    for (const kept of [
      '"qwen-coder-example"',
      "8192",
      "apiKey",
      '"Bash"',
      "./check.sh <redacted:2 more words>",
    ]) {
      expect(out).toContain(kept);
    }
    expect(out).not.toContain("--strict");
  });
});

describe("a key the reader does not know", () => {
  it("prints its name and the length of its value, nothing else", async () => {
    const values = ["plain looking words", "another-plain-value", "one", "two"];
    const { out, status } = await inspect(
      "settings.json",
      JSON.stringify({
        mcpServers: {
          x: {
            command: "srv",
            customField: values[0],
            nested: { deep: values[1] },
            list: [values[2], values[3]],
          },
        },
      }),
    );
    expect(status).toBe(0);
    for (const v of values) expect(out).not.toContain(`"${v}"`);
    for (const kept of [
      "customField",
      "nested",
      "deep",
      "list",
      '"srv"',
      `<redacted:${values[0].length} chars>`,
    ]) {
      expect(out).toContain(kept);
    }
  });
});

describe("references and variable names under a credential key", () => {
  /** An API key's shape, assembled at run time so that no token-shaped literal is in the source. */
  const tokenShaped = shaped("sk", "-", "PROBESECRET29", "Q7x".repeat(8));

  it("prints a plain variable name and keeps a token-shaped inside back", async () => {
    const { out, status } = await inspect(
      "settings.json",
      JSON.stringify({
        mcpServers: {
          a: {
            command: "srv",
            env: { OPENAI_API_KEY: "${OPENAI_API_KEY}", SHAPED_KEY: `\${${tokenShaped}}` },
            headers: { Authorization: `Bearer \${${tokenShaped}}` },
          },
        },
        model_providers: { b: { env_key: "OPENAI_API_KEY", bearer_token_env_var: tokenShaped } },
      }),
    );
    expect(status).toBe(0);
    expect(out).not.toMatch(PROBE);
    expect(out).toContain('"OPENAI_API_KEY": "${OPENAI_API_KEY}"');
    expect(out).toContain('"env_key": "OPENAI_API_KEY"');
    expect(out).toContain(`"SHAPED_KEY": "\${<redacted:${tokenShaped.length} chars>}"`);
    expect(out).toContain(`"Authorization": "Bearer \${<redacted:${tokenShaped.length} chars>}"`);
    expect(out).toContain(`"bearer_token_env_var": "<redacted:${tokenShaped.length} chars>"`);
  });
});

describe("the review's probes", () => {
  const cases: Record<string, string> = {
    "command-forms.json": JSON.stringify({
      mcpServers: {
        a: { command: "my-mcp --api-key PROBESECRET5gggggggggggggggg --verbose" },
        b: {
          command: 'curl -sS -H "X-Api-Key: PROBESECRET6hhhhhhhhhhhh" https://example.invalid/mcp',
        },
        c: { command: "curl -u admin:PROBESECRET7iiiiiiii https://example.invalid/" },
        d: {
          command: "srv",
          args: ["--pass", "PROBESECRET8jjjjjjjj", "--pwd", "PROBESECRET9kkkkkkkk"],
        },
        e: {
          command: "srv",
          db: { pass: "PROBESECRET10llllllll", passphrase: "PROBESECRET11mmmmmmmm" },
        },
        f: {
          command: "srv",
          args: [
            shaped("sk", "_live_", "PROBESECRET12", "n".repeat(20)),
            shaped("hf", "_", "PROBESECRET13", "o".repeat(26)),
            shaped("npm", "_", "PROBESECRET14", "p".repeat(28)),
            shaped(
              "eyJhbGciOiJIUzI1NiJ9",
              ".",
              "eyJzdWIiOiJQUk9CRVNFQ1JFVDE1In0",
              ".",
              "PROBESIG",
              "q".repeat(12),
            ),
          ],
        },
        g: {
          command: "srv",
          serviceAccount: KEY_BLOCK("PRIVATE KEY-----", `PROBESECRET16${"r".repeat(20)}`),
        },
        h: {
          command: "srv",
          notes:
            "first line\nAuthorization: PROBESECRET17ssssssssss\nX-Api-Key: PROBESECRET18tttttttt",
        },
      },
    }),
    "block-scalar.yml": [
      "hooks:",
      "  pre:",
      "    script: |",
      "      echo start",
      "      X-Api-Key: PROBESECRET19uuuuuuuu",
      "      curl --token PROBESECRET20vvvvvvvv https://example.invalid",
      "",
    ].join("\n"),
    "json5-single-quote.mcp.json":
      "{ 'mcpServers': { 'gh': { 'env': { 'GITHUB_TOKEN': 'PROBESECRET1aaaaaaaaaaaaaaaaaaaa' } } } }\n",
    "unquoted-value.json":
      '{"mcpServers": {"x": {"command": "srv", "apiKey": PROBESECRET2bbbbbbbbbbbb}}}\n',
    "yaml-bad-escape.yml":
      'plugins:\n  - name: x\n    config:\n      note: "PROBESECRET3cccc\\$dddd"\n',
    "yaml-multiline-dq.yml":
      'servers:\n  gh:\n    token: "PROBESECRET4eeeeeeeeeeeeeeee\n      ffff"\n',
  };

  for (const [name, text] of Object.entries(cases)) {
    it(`${name}: no planted value is printed`, async () => {
      const { out } = await inspect(name, text);
      expect(out).not.toMatch(PROBE);
      expect(out).not.toContain("ffff");
    });
  }

  it("a file that does not parse names its line, never its content", async () => {
    const { out, status } = await inspect("unquoted-value.json", cases["unquoted-value.json"]!);
    expect(status).toBe(1);
    expect(out).toMatch(/could not parse .*unquoted-value\.json \(line 1\)/);
  });

  it("the commands keep their program, and the structured parts their shape", async () => {
    const { out } = await inspect("command-forms.json", cases["command-forms.json"]!);
    for (const kept of [
      "my-mcp <redacted:3 more words>",
      '"--pass"',
      '"--pwd"',
      "serviceAccount",
      "passphrase",
    ]) {
      expect(out).toContain(kept);
    }
  });
});

describe("files it refuses unread", () => {
  for (const name of ["auth.json", "secrets.env", ".envrc", "service.pem"]) {
    it(name, async () => {
      const root = await folder({ [name]: `OPENAI_API_KEY=${secret(16)}\n` });
      for (const mode of [[], ["--show"]]) {
        const { out, status } = run(...mode, path.join(root, name));
        expect(status).toBe(3);
        expect(out).not.toContain(secret(16));
        expect(out).not.toContain("OPENAI_API_KEY");
      }
    });
  }
});

describe("checking a folder with --scan", () => {
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

  it("names each flagged line by kind, never its text, and fails", async () => {
    const root = await folder({
      "manifest.json": manifest,
      "agent_state/hooks/review/check.mjs": hook,
      "agent_state/skills/deploy/SKILL.md":
        "---\nname: deploy\ndescription: Deploy.\n---\n\nRun ./deploy.sh\n",
      "agent_state/skills/deploy/deploy.sh": [
        "#!/bin/sh",
        "export TOKEN=PROBESECRET24zzzzzzzz DB_PASS=PROBESECRET25AAAAAAAA",
        "mysql -u root -pPROBESECRET26BBBBBBBB",
        'curl -u deploy:PROBESECRET27CCCCCCCC -H "Authorization: Bearer PROBESECRET28DDDDDDDDDDDD" https://example.invalid',
        "",
      ].join("\n"),
      "agent_state/skills/deploy/deploy_key": `${KEY_BLOCK("OPENSSH PRIVATE KEY-----", `PROBESECRET23${"y".repeat(36)}`)}\n`,
      "agent_state/skills/call/scripts/call.mjs": `const apiKey = "${secret(18)}";\n`,
    });
    const { out, status } = run("--scan", root);
    expect(status).toBe(1);
    expect(out).not.toMatch(PROBE);
    expect(out).not.toContain(secret(18));
    expect(out).not.toContain("export");
    const deploy = path.join("agent_state", "skills", "deploy");
    for (const line of [
      `${path.join(deploy, "deploy.sh")}:2: credential assignment`,
      `${path.join(deploy, "deploy.sh")}:3: -p password`,
      `${path.join(deploy, "deploy.sh")}:4: user:password`,
      `${path.join(deploy, "deploy_key")}:1: private key block`,
      `${path.join("agent_state", "skills", "call", "scripts", "call.mjs")}:1: credential assignment`,
    ]) {
      expect(out).toContain(line);
    }
    expect(out).not.toContain("manifest.json");
    expect(out).not.toContain("check.mjs");
    expect(out).not.toContain("SKILL.md");
  });

  it("names a credential file by its name without reading it", async () => {
    const root = await folder({ "keys/server.pem": `${secret(21)}\n` });
    const { out, status } = run("--scan", root);
    expect(status).toBe(1);
    expect(out).toContain(`${path.join("keys", "server.pem")}: credential file (not read)`);
    expect(out).not.toContain(secret(21));
  });

  it("passes a folder that holds only references and names", async () => {
    const root = await folder({
      "manifest.json": manifest,
      "agent_state/hooks/review/check.mjs": hook,
    });
    expect(run("--scan", root).status).toBe(0);
  });
});

describe("reading a text file with --show", () => {
  it("replaces each flagged line whole and keeps the rest as written", async () => {
    const root = await folder({
      "call.sh": `#!/bin/sh\nAPI_TOKEN=${secret(20)}\ncurl -H "Authorization: Bearer $API_TOKEN" "$URL"\n`,
      "CLAUDE.md": `# Notes\n\nUse the staging server.\nThe deploy key is ghp_${"A1b2C3d4E5".repeat(3)}\n`,
    });
    const { out, status } = run("--show", path.join(root, "call.sh"), path.join(root, "CLAUDE.md"));
    expect(status).toBe(0);
    expect(out).not.toContain(secret(20));
    expect(out).not.toContain("A1b2C3d4E5");
    expect(out).toContain("<redacted line: credential assignment>");
    expect(out).toContain('curl -H "Authorization: Bearer $API_TOKEN" "$URL"');
    expect(out).toContain("Use the staging server.");
  });
});
