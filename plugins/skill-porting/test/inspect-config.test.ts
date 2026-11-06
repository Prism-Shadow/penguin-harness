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
        args: ["-y", "@example/github-mcp", "--token", secret(2)],
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
      '"@example/github-mcp"',
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

// ---- The third review's probes -------------------------------------------------------------

/** The r3 probe markers: every planted value, whatever its case. */
const R3 =
  /PROBE[sS][eE][cC][rR][eE][tT][0-9A-Za-z]*|Pr0bE9x|Pr0bEk3y|f00dfacecafebeef0123456789abcdef|d00dfeedbeefcafe0123456789abcdef|c0ffee00ba5eba11deadbeef00112233|0badc0de0badc0de0badc0de0badc0de/;
/** A webhook address, assembled at run time like the other token-shaped fixtures. */
const webhook = (a: string, b: string, tail: string) =>
  shaped("https://hooks.slack", ".invalid/services/", a, "/", b, "/", tail);

describe("the third review's probes", () => {
  const args = JSON.stringify({
    mcpServers: {
      pw: { command: "mcp-db", args: ["--pw", "PROBEsecretAAAA"] },
      capP: { command: "mcp-db", args: ["-P", "PROBEsecretBBBB"] },
      pos: { command: "mcp-db", args: ["serve", "root", "PROBEsecretCCCC", "Pr0bE9x"] },
      conn: { command: "mcp-db", args: ["--connection", "host=db user=app PROBEsecretDDDD"] },
      seg: { type: "http", url: "https://mcp.example.invalid/PROBEsecretEEEEEEEEEEEE/mcp" },
      hookstr: { hooks: { Stop: "notify.sh f00dfacecafebeef0123456789abcdef" } },
      names: {
        env_key: "PROBEsecretFFFF",
        bearer_token_env_var: "Pr0bEk3y",
        env_http_headers: { "X-Api-Key": "PROBEsecretGGGG" },
      },
      ref: { headers: { Authorization: "Bearer ${PROBEsecretHHHH}" } },
      keyname: { env: { PROBEsecretIIII: "x" } },
      prose: {
        description:
          "Log in with the password PROBEsecretJJJJ, then use the deploy key d00dfeedbeefcafe0123456789abcdef.",
      },
    },
  });
  const agentToml = [
    'name = "reviewer"',
    'description = "Reviews code"',
    'developer_instructions = """',
    "You review code.",
    "The staging database password is PROBEsecretKKKK and the admin token is c0ffee00ba5eba11deadbeef00112233.",
    '"""',
    "",
  ].join("\n");
  const claudeMd = [
    "# Notes",
    "",
    "- The staging password is PROBEsecretLLLL.",
    `- Notion integration: ${shaped("secret", "_", "PROBEsecretMMMMxyz")}`,
    "- Deploy key for prod: 0badc0de0badc0de0badc0de0badc0de",
    `- Webhook: ${webhook("T0PROBE1", "B0PROBE2", "PROBEsecretNNNNNNNNNNNN")}`,
    "",
  ].join("\n");
  const subagent = [
    "---",
    "name: reviewer",
    "description: Reviews code",
    "mcpServers:",
    "  db:",
    "    command: mcp-db",
    "    env:",
    "      API: PROBEsecretOOOO",
    `      SLACK_HOOK: ${webhook("T0PROBE3", "B0PROBE4", "PROBEsecretPPPPPPPPPPPP")}`,
    "---",
    "",
    "You review code.",
    "",
  ].join("\n");

  it("arguments, a path segment, a hook-event string, name positions and prose print nothing planted", async () => {
    const { out, status } = await inspect("r3-args.json", args);
    expect(status).toBe(0);
    expect(out).not.toMatch(R3);
    for (const kept of [
      '"--pw"',
      '"-P"',
      '"--connection"',
      '"notify.sh <redacted:1 more word>"',
      "--show <file> --key mcpServers.prose.description",
    ]) {
      expect(out).toContain(kept);
    }
  });

  it("a Codex agent's instructions point to --show, which masks their flagged lines", async () => {
    const root = await folder({ "reviewer.toml": agentToml });
    const viewed = run(path.join(root, "reviewer.toml"));
    expect(viewed.out).not.toMatch(R3);
    expect(viewed.out).toContain("--key developer_instructions");
    const shown = run(
      "--show",
      path.join(root, "reviewer.toml"),
      "--key",
      "developer_instructions",
    );
    expect(shown.out).not.toMatch(R3);
    expect(shown.out).toContain("You review code.");
    expect(shown.out).toContain("<redacted line: ");
  });

  it("--show masks the Markdown's flagged lines and its frontmatter by allowlist", async () => {
    const root = await folder({ "CLAUDE.md": claudeMd, "reviewer-agent.md": subagent });
    const { out } = run(
      "--show",
      path.join(root, "CLAUDE.md"),
      path.join(root, "reviewer-agent.md"),
    );
    expect(out).not.toMatch(R3);
    expect(out).toContain("# Notes");
    expect(out).toContain("You review code.");
    expect(out).toContain('"command": "mcp-db"');
  });

  it("--scan flags the same Markdown and fails", async () => {
    const root = await folder({ "CLAUDE.md": claudeMd, "reviewer-agent.md": subagent });
    const { out, status } = run("--scan", root);
    expect(status).toBe(1);
    expect(out).not.toMatch(R3);
    for (const line of [3, 4, 5, 6]) expect(out).toContain(`CLAUDE.md:${line}: `);
    for (const line of [8, 9]) expect(out).toContain(`reviewer-agent.md:${line}: `);
  });
});

// ---- --emit and --append -----------------------------------------------------------------

/** A port folder with the manifest the agent writes before it emits anything. */
async function portFolder(id = "ported"): Promise<string> {
  const root = await fs.mkdtemp(path.join(dir, "port-"));
  const port = path.join(root, id);
  await fs.mkdir(port, { recursive: true });
  await fs.writeFile(
    path.join(port, "manifest.json"),
    JSON.stringify({
      format: "penguin-agent-zip/1",
      exportedAt: "2026-11-05T09:00:00Z",
      agentId: id,
      name: "Ported",
      parts: {
        skills: false,
        hooks: false,
        memory: false,
        workbenches: false,
        workbenchData: false,
        schedules: false,
        traces: { kind: "none" },
      },
      vaultKeys: [],
      redacted: [],
      definition: {},
    }),
  );
  return port;
}

type Manifest = {
  vaultKeys: string[];
  parts: { hooks: boolean };
  definition: {
    mcpServers?: Array<{ name: string; config: Record<string, unknown> }>;
    model?: { thinkingLevel?: string };
  };
};
const manifestOf = async (port: string) =>
  JSON.parse(await fs.readFile(path.join(port, "manifest.json"), "utf8")) as Manifest;
const server = (m: Manifest, name: string) =>
  m.definition.mcpServers?.find((s) => s.name === name)?.config;

describe("--emit writes the mapped servers into the port folder", () => {
  it("keeps a Claude Code server's command, arguments and plain values exactly, and makes each secret a Vault reference", async () => {
    const src = await folder({
      ".claude.json": JSON.stringify({
        oauthAccount: { accessToken: secret(30) },
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "example-github-mcp", "--token", secret(31), "--region", "eu"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: secret(32),
              LOG_LEVEL: "${LOG_LEVEL}",
              REGION: "eu",
            },
          },
          docs: {
            type: "http",
            url: `https://mcp.example.com/mcp?api_key=${secret(33)}&region=eu`,
            headers: {
              Authorization: "Bearer ${DOCS_TOKEN}",
              "X-Api-Key": secret(34),
              "X-Team": "platform",
            },
          },
        },
        projects: {
          "/home/u/repo": {
            mcpServers: { db: { command: "db-mcp", args: [`--password=${secret(35)}`] } },
          },
        },
      }),
    });
    const port = await portFolder();
    const first = run(
      "--emit",
      path.join(src, ".claude.json"),
      "--framework",
      "claude-code",
      "--out",
      port,
    );
    const second = run(
      "--emit",
      path.join(src, ".claude.json"),
      "--framework",
      "claude-code",
      "--out",
      port,
      "--project",
      "/home/u/repo",
    );
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    for (let n = 30; n <= 35; n++) {
      expect(first.out).not.toContain(secret(n));
      expect(second.out).not.toContain(secret(n));
    }
    expect(first.out).toContain("--project");

    const m = await manifestOf(port);
    expect(server(m, "github")).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "example-github-mcp", "--token", "${GITHUB_TOKEN}", "--region", "eu"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
        LOG_LEVEL: "${LOG_LEVEL}",
        REGION: "eu",
      },
    });
    expect(server(m, "docs")).toEqual({
      transport: "http",
      url: "https://mcp.example.com/mcp?api_key=${DOCS_API_KEY}&region=eu",
      headers: {
        Authorization: "Bearer ${DOCS_TOKEN}",
        "X-Api-Key": "${DOCS_X_API_KEY}",
        "X-Team": "platform",
      },
    });
    expect(server(m, "db")).toEqual({
      transport: "stdio",
      command: "db-mcp",
      args: ["--password=${DB_PASSWORD}"],
    });
    expect(m.vaultKeys).toEqual([
      "DB_PASSWORD",
      "DOCS_API_KEY",
      "DOCS_TOKEN",
      "DOCS_X_API_KEY",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "GITHUB_TOKEN",
      "LOG_LEVEL",
    ]);
    const text = await fs.readFile(path.join(port, "manifest.json"), "utf8");
    for (let n = 30; n <= 35; n++) expect(text).not.toContain(secret(n));
  });

  it("maps a Codex config's variable names, headers, OAuth secret and effort", async () => {
    const src = await folder({
      "config.toml": [
        'model_reasoning_effort = "ultra"',
        "[mcp_servers.github]",
        'command = "npx"',
        'args = ["-y", "example-github-mcp"]',
        `env = { GITHUB_TOKEN = "${secret(36)}" }`,
        'env_vars = ["GH_HOST"]',
        "[mcp_servers.remote]",
        'url = "https://mcp.example.com/mcp"',
        'bearer_token_env_var = "REMOTE_TOKEN"',
        `http_headers = { "X-Api-Key" = "${secret(37)}" }`,
        'env_http_headers = { "X-Org" = "ORG_ID" }',
        "tool_timeout_sec = 30",
        "[mcp_servers.remote.oauth]",
        'client_id = "public-client"',
        `client_secret = "${secret(38)}"`,
        "",
      ].join("\n"),
    });
    const port = await portFolder();
    const { out, status } = run(
      "--emit",
      path.join(src, "config.toml"),
      "--framework",
      "codex",
      "--out",
      port,
    );
    expect(status).toBe(0);
    for (let n = 36; n <= 38; n++) expect(out).not.toContain(secret(n));
    const m = await manifestOf(port);
    expect(server(m, "github")).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "example-github-mcp"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", GH_HOST: "${GH_HOST}" },
    });
    expect(server(m, "remote")).toEqual({
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: {
        "X-Api-Key": "${REMOTE_X_API_KEY}",
        "X-Org": "${ORG_ID}",
        Authorization: "Bearer ${REMOTE_TOKEN}",
      },
      timeoutMs: 30000,
      oauth: { client_id: "public-client", client_secret: "${REMOTE_CLIENT_SECRET}" },
    });
    expect(m.definition.model?.thinkingLevel).toBe("max");
  });

  it("turns a DeepSeek Harness credential reference into a Vault key", async () => {
    const src = await folder({
      "cordis.patch.yml": [
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
        `          OTHER_TOKEN: ${secret(39)}`,
        "",
      ].join("\n"),
    });
    const port = await portFolder();
    const { out } = run(
      "--emit",
      path.join(src, "cordis.patch.yml"),
      "--framework",
      "deepseek-harness",
      "--out",
      port,
    );
    expect(out).not.toContain(secret(39));
    expect(server(await manifestOf(port), "github")).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "example-github-mcp"],
      env: { GITHUB_TOKEN: "${GITHUB}", OTHER_TOKEN: "${OTHER_TOKEN}" },
    });
  });

  it("ports the hooks that map, as wrappers that answer the way the source's command did", async () => {
    const src = await folder({
      "settings.json": JSON.stringify({
        effortLevel: "high",
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: 'echo "not here" >&2; exit 2', timeout: 10 }],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: `curl -H "X-Api-Key: ${secret(40)}" https://example.invalid`,
                },
              ],
            },
          ],
          Notification: [{ hooks: [{ type: "command", command: "notify-send done" }] }],
        },
      }),
    });
    const port = await portFolder();
    const { out, status } = run(
      "--emit",
      path.join(src, "settings.json"),
      "--framework",
      "claude-code",
      "--out",
      port,
    );
    expect(status).toBe(0);
    expect(out).not.toContain(secret(40));
    expect(out).toContain("not ported: hook Stop");
    expect(out).toContain("not ported: hooks on Notification");
    const m = await manifestOf(port);
    expect(m.parts.hooks).toBe(true);
    expect(m.definition.model?.thinkingLevel).toBe("high");
    const pkg = path.join(port, "agent_state", "hooks", "claude-code-hooks");
    const hooks = JSON.parse(await fs.readFile(path.join(pkg, "hooks.json"), "utf8"));
    expect(hooks.pre_tool_use).toEqual([{ command: "pre-tool-use-1.mjs", timeout: 10 }]);
    expect(hooks.stop).toEqual([]);

    const call = (tool: string) =>
      spawnSync(process.execPath, [path.join(pkg, "pre-tool-use-1.mjs")], {
        input: JSON.stringify({
          hook: "pre_tool_use",
          session_id: "s1",
          tool_name: tool,
          tool_call_id: "c1",
          arguments: '{"cmd":"rm -rf build"}',
        }),
        encoding: "utf8",
      });
    expect(JSON.parse(call("exec_command").stdout)).toEqual({
      decision: "deny",
      reason: "not here",
    });
    expect(call("read_file").stdout).toBe("");
    // The folder it built passes the check before the import.
    expect(run("--scan", port).status).toBe(0);
  });

  it("writes a subagent's servers and instructions, holding back instructions that look like they carry a secret", async () => {
    const plain =
      "---\nname: reviewer\ndescription: Reviews code\neffort: medium\nmcpServers:\n  db:\n    command: mcp-db\n    env:\n      DB_PASSWORD: " +
      secret(41) +
      "\n---\n\nYou review code.\n";
    const flagged = "---\nname: helper\n---\n\nThe staging password is PROBEsecretQQQQ.\n";
    const src = await folder({ "reviewer.md": plain, "helper.md": flagged });
    const port = await portFolder("reviewer");
    const r = run(
      "--emit",
      path.join(src, "reviewer.md"),
      "--framework",
      "claude-code",
      "--out",
      port,
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toContain(secret(41));
    const m = await manifestOf(port);
    expect(server(m, "db")).toEqual({
      transport: "stdio",
      command: "mcp-db",
      env: { DB_PASSWORD: "${DB_PASSWORD}" },
    });
    expect(m.definition.model?.thinkingLevel).toBe("medium");
    expect(await fs.readFile(path.join(port, "agent_state", "AGENTS.md"), "utf8")).toBe(
      "You review code.\n",
    );

    const other = await portFolder("helper");
    const held = run(
      "--emit",
      path.join(src, "helper.md"),
      "--framework",
      "claude-code",
      "--out",
      other,
    );
    expect(held.out).not.toMatch(R3);
    expect(held.out).toContain("--confirmed");
    await expect(fs.access(path.join(other, "agent_state", "AGENTS.md"))).rejects.toThrow();
    run(
      "--emit",
      path.join(src, "helper.md"),
      "--framework",
      "claude-code",
      "--out",
      other,
      "--confirmed",
    );
    expect(await fs.readFile(path.join(other, "agent_state", "AGENTS.md"), "utf8")).toContain(
      "PROBEsecretQQQQ",
    );
  });
});

describe("--append copies instructions file to file", () => {
  it("copies a rule verbatim with its scope as a sentence, and a flagged file only once confirmed", async () => {
    const src = await folder({
      "testing.md": "---\npaths: src/**/*.ts\n---\n\nRun the tests before you commit.\n",
      "CLAUDE.md": "Deploy with the key 0badc0de0badc0de0badc0de0badc0de.\n",
    });
    const port = await portFolder();
    const target = path.join(port, "agent_state", "AGENTS.md");
    const ok = run(
      "--append",
      path.join(src, "testing.md"),
      "--to",
      target,
      "--heading",
      "Testing",
    );
    expect(ok.status).toBe(0);
    expect(await fs.readFile(target, "utf8")).toBe(
      "## Testing\n\nThese instructions apply when working on files matching `src/**/*.ts`.\n\nRun the tests before you commit.\n",
    );
    const held = run("--append", path.join(src, "CLAUDE.md"), "--to", target);
    expect(held.status).toBe(1);
    expect(held.out).not.toMatch(R3);
    expect(await fs.readFile(target, "utf8")).not.toMatch(R3);
    expect(run("--append", path.join(src, "CLAUDE.md"), "--to", target, "--confirmed").status).toBe(
      0,
    );
    expect(await fs.readFile(target, "utf8")).toMatch(R3);
  });
});

// ---- The ported hooks behave like their source (the fourth review) ------------------------

describe("a ported hook behaves like its source", () => {
  /** Emits `hooks` from a Claude Code settings.json; the hook package and the summary. */
  async function ported(hooks: Record<string, unknown>, files: Record<string, string> = {}) {
    const src = await folder({ "settings.json": JSON.stringify({ hooks }), ...files });
    const port = await portFolder();
    const emitted = run(
      "--emit",
      path.join(src, "settings.json"),
      "--framework",
      "claude-code",
      "--out",
      port,
    );
    expect(emitted.status, emitted.out).toBe(0);
    const pkg = path.join(port, "agent_state", "hooks", "claude-code-hooks");
    const manifest = JSON.parse(await fs.readFile(path.join(pkg, "hooks.json"), "utf8")) as Record<
      string,
      Array<{ command: string; timeout: number }>
    >;
    return { src, port, pkg, manifest, summary: emitted.out };
  }
  /** Runs a wrapper the way core runs a hook script: Node, in the package directory. */
  async function call(pkg: string, file: string, input: Record<string, unknown>, tmp: string) {
    const r = spawnSync(process.execPath, [path.join(pkg, file)], {
      cwd: pkg,
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp },
    });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      answer: r.stdout === "" ? null : JSON.parse(r.stdout),
    };
  }
  const tmpDir = () => fs.mkdtemp(path.join(dir, "tmp-"));

  it("a Stop hook that guards against loops lets the stop through once it has blocked", async () => {
    const src = await folder({
      "guard.mjs": [
        'import { readFileSync } from "node:fs";',
        'const input = JSON.parse(readFileSync(0, "utf8"));',
        "if (input.stop_hook_active) process.exit(0);",
        'process.stderr.write("review once more");',
        "process.exit(2);",
        "",
      ].join("\n"),
    });
    const { pkg, manifest } = await ported({
      Stop: [
        {
          hooks: [
            // Forward slashes: the command runs in a POSIX shell, which eats `\` as an escape.
            {
              type: "command",
              command: `node ${path.join(src, "guard.mjs").split(path.sep).join("/")}`,
            },
          ],
        },
      ],
    });
    const file = manifest.stop![0]!.command;
    const tmp = await tmpDir();
    const stop = { hook: "stop", session_id: "s-loop" };
    expect((await call(pkg, file, stop, tmp)).answer).toMatchObject({
      decision: "continue",
      input: "review once more",
    });
    expect((await call(pkg, file, stop, tmp)).answer).toBeNull();
    // A later stop starts a new chain: the guard may block it again.
    expect((await call(pkg, file, stop, tmp)).answer).toMatchObject({ decision: "continue" });
  });

  it("a Stop hook that always blocks is cut off after three blocks in a row", async () => {
    const { pkg, manifest } = await ported({
      Stop: [{ hooks: [{ type: "command", command: 'echo "keep going" >&2; exit 2' }] }],
    });
    const file = manifest.stop![0]!.command;
    const tmp = await tmpDir();
    const stop = { hook: "stop", session_id: "s-always" };
    for (let i = 0; i < 3; i++) {
      expect((await call(pkg, file, stop, tmp)).answer).toMatchObject({
        decision: "continue",
        input: "keep going",
      });
    }
    const fourth = await call(pkg, file, stop, tmp);
    expect(fourth.answer).toBeNull();
    expect(fourth.stderr).toContain("blocked 3 stops in a row");
    // Another Session keeps its own count.
    expect(
      (await call(pkg, file, { hook: "stop", session_id: "s-other" }, tmp)).answer,
    ).toMatchObject({
      decision: "continue",
    });
  });

  it("a project-relative guard runs in the Session's Workspace, and a guard that cannot run denies", async () => {
    const { pkg, manifest } = await ported({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "./missing-guard.sh" }] },
      ],
    });
    const workspace = await folder({
      "check.sh":
        '#!/bin/sh\ncase "$(cat)" in *"rm -rf"*) echo "no rm -rf here" >&2; exit 2;; esac\nexit 0\n',
    });
    await fs.chmod(path.join(workspace, "check.sh"), 0o755);
    const trace = path.join(await tmpDir(), "s1_001.jsonl");
    await fs.writeFile(
      trace,
      `${JSON.stringify({ type: "session_meta", payload: { session_id: "s1", workspace } })}\n`,
    );
    const [guard, missing] = manifest.pre_tool_use!.map((entry) => entry.command);
    const tmp = await tmpDir();
    const tool = (cmd: string) => ({
      hook: "pre_tool_use",
      session_id: "s1",
      trace_path: trace,
      tool_name: "exec_command",
      tool_call_id: "c1",
      arguments: JSON.stringify({ cmd }),
    });
    expect((await call(pkg, guard!, tool("rm -rf build"), tmp)).answer).toEqual({
      decision: "deny",
      reason: "no rm -rf here",
    });
    expect((await call(pkg, guard!, tool("ls"), tmp)).answer).toBeNull();
    const refused = (await call(pkg, missing!, tool("ls"), tmp)).answer;
    expect(refused.decision).toBe("deny");
    expect(refused.reason).toContain(`the ported guard claude-code-hooks/${missing} could not run`);
  });

  it("a matcher on an MCP server's tools follows the server's ported name", async () => {
    const { pkg, manifest } = await ported({
      PreToolUse: [
        {
          matcher: "mcp__GitHub__.*",
          hooks: [{ type: "command", command: 'echo "no issues" >&2; exit 2' }],
        },
      ],
    });
    const file = manifest.pre_tool_use![0]!.command;
    const tmp = await tmpDir();
    const tool = (name: string) => ({
      hook: "pre_tool_use",
      session_id: "s1",
      tool_name: name,
      arguments: "{}",
    });
    expect((await call(pkg, file, tool("mcp__github__create_issue"), tmp)).answer).toEqual({
      decision: "deny",
      reason: "no issues",
    });
    expect((await call(pkg, file, tool("mcp__other__create_issue"), tmp)).answer).toBeNull();
  });

  it("an ask becomes a deny, a timeout defaults to the source's 600 s, and a prompt hook's lost block is said", async () => {
    const ask = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "check with the owner",
      },
    });
    const { pkg, manifest, summary } = await ported({
      PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: `echo '${ask}'` }] }],
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "echo remember the style guide" }] },
      ],
    });
    expect(manifest.pre_tool_use![0]!.timeout).toBe(600);
    expect(summary).toContain("asked for confirmation");
    expect(summary).toContain("cannot be expressed");
    const tmp = await tmpDir();
    const answer = (
      await call(
        pkg,
        manifest.pre_tool_use![0]!.command,
        { hook: "pre_tool_use", tool_name: "read_file", arguments: "{}" },
        tmp,
      )
    ).answer;
    expect(answer).toEqual({
      decision: "deny",
      reason: "the source hook asked for confirmation: check with the owner",
    });
    const context = (
      await call(pkg, manifest.user_prompt![0]!.command, { hook: "user_prompt", prompt: "hi" }, tmp)
    ).answer;
    expect(context).toEqual({ context: "remember the style guide" });
  });

  it("emitting the same source again replaces its hooks instead of adding them twice", async () => {
    const src = await folder({
      "settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] }],
        },
      }),
    });
    const port = await portFolder();
    const pkg = path.join(port, "agent_state", "hooks", "claude-code-hooks");
    run("--emit", path.join(src, "settings.json"), "--framework", "claude-code", "--out", port);
    const once = await fs.readdir(pkg);
    run("--emit", path.join(src, "settings.json"), "--framework", "claude-code", "--out", port);
    expect((await fs.readdir(pkg)).sort()).toEqual(once.sort());
    const hooks = JSON.parse(await fs.readFile(path.join(pkg, "hooks.json"), "utf8"));
    expect(hooks.pre_tool_use).toHaveLength(1);
  });
});

describe("--emit on the shapes a server mapping cannot take as they are", () => {
  it("keeps this machine's variables out of the Vault keys, and leaves out nested values", async () => {
    const src = await folder({
      ".mcp.json": JSON.stringify({
        mcpServers: {
          files: {
            command: "npx",
            args: ["-y", "files-mcp", "${HOME}/notes"],
            env: { CONFIG: { nested: true }, LEVEL: "debug" },
          },
          odd: { command: "srv", args: [["nested", "list"]] },
        },
      }),
    });
    const port = await portFolder();
    const { out } = run(
      "--emit",
      path.join(src, ".mcp.json"),
      "--framework",
      "claude-code",
      "--out",
      port,
    );
    const m = await manifestOf(port);
    expect(m.vaultKeys).not.toContain("HOME");
    expect(out).toContain("needs a path on this machine: ${HOME}");
    expect(server(m, "files")).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "files-mcp", "${HOME}/notes"],
      env: { LEVEL: "debug" },
    });
    expect(out).toContain("env CONFIG holds a nested value");
    expect(server(m, "odd")).toBeUndefined();
    expect(out).toContain("not ported: mcp server odd: its arguments hold a nested value");
    expect(await fs.readFile(path.join(port, "manifest.json"), "utf8")).not.toContain(
      "[object Object]",
    );
  });

  it("names a Codex profile's servers, and ports them with --profile", async () => {
    const src = await folder({
      "config.toml": [
        "[mcp_servers.github]",
        'command = "npx"',
        "[profiles.work]",
        'model_reasoning_effort = "low"',
        "[profiles.work.mcp_servers.jira]",
        'command = "jira-mcp"',
        "",
      ].join("\n"),
    });
    const port = await portFolder();
    const plain = run(
      "--emit",
      path.join(src, "config.toml"),
      "--framework",
      "codex",
      "--out",
      port,
    );
    expect(plain.out).toContain("profile(s) work have their own MCP servers");
    expect(server(await manifestOf(port), "jira")).toBeUndefined();
    run(
      "--emit",
      path.join(src, "config.toml"),
      "--framework",
      "codex",
      "--out",
      port,
      "--profile",
      "work",
    );
    const m = await manifestOf(port);
    expect(server(m, "jira")).toEqual({ transport: "stdio", command: "jira-mcp" });
    expect(m.definition.model?.thinkingLevel).toBe("low");
  });
});
