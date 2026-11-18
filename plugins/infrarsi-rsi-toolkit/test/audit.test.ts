import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(
  import.meta.dirname,
  "../skills/infrarsi-rsi-toolkit/scripts/audit-answerer.mjs",
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { audit, checkCommand, findSession }: any = await import(SCRIPT);

const REQ = "/p/.infrarsi/sessions/s1/requests/0003-code_review";
const TOOLS = ["read_file", "write_file", "exec_command"];

function trace(calls: [string, Record<string, unknown>][], tools = TOOLS, tokens = 1234) {
  const lines: unknown[] = [
    { type: "session_meta", payload: { session_id: "s" } },
    {
      type: "event_msg",
      payload: { type: "tool_list_ready", tools: tools.map((name) => ({ name })) },
    },
  ];
  for (const [name, args] of calls) {
    lines.push({
      type: "model_msg",
      payload: { type: "tool_call", name, arguments: JSON.stringify(args) },
    });
  }
  lines.push({ type: "event_msg", payload: { type: "token_usage", session: { total: tokens } } });
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

const CLEAN: [string, Record<string, unknown>][] = [
  ["read_file", { file_path: `${REQ}/README.md` }],
  ["exec_command", { cmd: `fold -w 1000 "${REQ}/prompt.txt"` }],
  ["exec_command", { cmd: `cd ${REQ} && ls -la && cut -c 8001-20000 prompt.txt | fold -w 1000` }],
  ["exec_command", { cmd: `fold -w 1000 ${REQ}/schema.json 2>/dev/null; echo "---"` }],
  ["write_file", { file_path: `${REQ}/answer.json`, content: "{}" }],
];

describe("auditing an answerer session", () => {
  it("passes a session that only read the request and wrote its answer, and reports its tokens", () => {
    expect(audit(trace(CLEAN), REQ)).toEqual({
      ok: true,
      tools: TOOLS,
      calls: 5,
      tokens: 1234,
      violations: [],
    });
  });

  it.each([
    [
      "a read of a sibling request",
      ["read_file", { file_path: `${REQ}/../0004-hypotheses/prompt.txt` }],
      /read_file outside/,
    ],
    [
      "a write of another file",
      ["write_file", { file_path: `${REQ}/notes.txt` }],
      /write_file to something other than answer\.json/,
    ],
    [
      "a write of another request's answer",
      ["write_file", { file_path: `${REQ}/../0002-prior/answer.json` }],
      /write_file/,
    ],
    [
      "a Python run",
      ["exec_command", { cmd: `python3 -c "import json; json.load(open('${REQ}/answer.json'))"` }],
      /runs python3/,
    ],
    ["a heredoc", ["exec_command", { cmd: "python3 - <<'EOF'\nprint(1)\nEOF" }], /heredoc/],
    [
      "a redirection into a file",
      ["exec_command", { cmd: `cat ${REQ}/prompt.txt > /tmp/x` }],
      /redirection/,
    ],
    ["a command substitution", ["exec_command", { cmd: "cat $(ls /etc)" }], /substitution/],
    [
      "a cd out of the request",
      ["exec_command", { cmd: "cd /p && cat infrarsi.yaml" }],
      /cd outside/,
    ],
    ["a print of a project file", ["exec_command", { cmd: "cat /p/train.py" }], /reads outside/],
    [
      "a non-printing sed",
      ["exec_command", { cmd: `sed -i s/a/b/ ${REQ}/answer.json` }],
      /sed other than/,
    ],
    ["another tool", ["run_subagent", { prompt: "x" }], /may not use/],
  ])("flags %s", (_label, call, pattern) => {
    const res = audit(trace([...CLEAN, call as [string, Record<string, unknown>]]), REQ);
    expect(res.ok).toBe(false);
    expect(res.violations.join("\n")).toMatch(pattern);
  });

  it("flags a session offered more tools than the three", () => {
    const res = audit(trace(CLEAN, [...TOOLS, "run_subagent"]), REQ);
    expect(res.violations).toEqual([
      "was offered tools beyond read_file, write_file and exec_command: run_subagent",
    ]);
  });

  it("flags a Trace with no tool list", () => {
    const text = trace(CLEAN)
      .split("\n")
      .filter((l) => !l.includes("tool_list_ready"))
      .join("\n");
    expect(audit(text, REQ).violations).toContain("the Trace records no tool list");
  });

  it("accepts an answer file of another name when told", () => {
    const calls: [string, Record<string, unknown>][] = [
      ["write_file", { file_path: `${REQ}/answer.txt` }],
    ];
    expect(audit(trace(calls), REQ, "answer.txt").ok).toBe(true);
  });

  it("allows the toolkit's request viewer on the request, and no other program", () => {
    const viewer = "/a/agents/x/agent_state/skills/infrarsi-rsi-toolkit/scripts/print-request.mjs";
    expect(checkCommand(`node ${viewer} ${REQ} prompt.txt --start 401 --lines 400`, REQ)).toEqual(
      [],
    );
    expect(checkCommand(`cd ${REQ} && node "${viewer}" . prompt.txt | head -50`, REQ)).toEqual([]);
    expect(checkCommand(`node ${viewer} /p prompt.txt`, REQ).join()).toMatch(
      /outside the request directory/,
    );
    expect(checkCommand(`node ${viewer} ${REQ} ../0002-prior/prompt.txt`, REQ).join()).toMatch(
      /reads outside/,
    );
    expect(checkCommand(`node ${viewer} ${REQ} --start x`, REQ).join()).toMatch(/needs a number/);
    expect(checkCommand(`node /tmp/print-request.mjs ${REQ}`, REQ).join()).toMatch(
      /not the toolkit's print-request/,
    );
    expect(checkCommand(`node -e "console.log(1)"`, REQ).join()).toMatch(
      /not the toolkit's print-request/,
    );
    expect(checkCommand(`python3 -m json.tool ${REQ}/prompt.txt`, REQ).join()).toMatch(
      /runs python3/,
    );
  });

  it("allows grep, nl, sort and uniq on the request's files, and not awk", () => {
    expect(checkCommand(`grep -n "def step" ${REQ}/prompt.txt | sort | uniq -c | nl`, REQ)).toEqual(
      [],
    );
    expect(checkCommand(`grep -rn secret /p`, REQ).join()).toMatch(/reads outside/);
    expect(checkCommand(`awk '{print}' ${REQ}/prompt.txt`, REQ).join()).toMatch(/runs awk/);
  });

  it("lets an answerer read the viewer script itself, and no other file outside", () => {
    const viewer = "/a/agents/x/agent_state/skills/infrarsi-rsi-toolkit/scripts/print-request.mjs";
    expect(audit(trace([...CLEAN, ["read_file", { file_path: viewer }]]), REQ).ok).toBe(true);
    const other = "/a/agents/x/agent_state/skills/infrarsi-rsi-toolkit/scripts/audit-answerer.mjs";
    expect(
      audit(trace([...CLEAN, ["read_file", { file_path: other }]]), REQ).violations.join(),
    ).toMatch(/read_file outside/);
  });

  it("reads relative paths against a cd inside the request", () => {
    expect(checkCommand(`cd ${REQ} && head -c 9000 prompt.txt`, REQ)).toEqual([]);
    expect(checkCommand(`cd ${REQ} && cat ../0002-prior/prompt.txt`, REQ).join()).toMatch(
      /reads outside/,
    );
  });

  it("finds the newest session naming the request, joins its parts, and ignores a prefix match", () => {
    const traces = mkdtempSync(path.join(tmpdir(), "traces-"));
    try {
      const day = path.join(traces, "2026-11-16");
      mkdirSync(day);
      const prompt = (dir: string) =>
        JSON.stringify({
          type: "model_msg",
          payload: {
            type: "text",
            role: "user",
            text: `Caller agent: x\nIts directory is ${dir}.\n`,
          },
        });
      const [head, ...rest] = trace(CLEAN).split("\n");
      writeFileSync(
        path.join(day, "session-2026-11-16-10-00-00-aaaa_001.jsonl"),
        [head, prompt(REQ), ...rest].join("\n"),
      );
      writeFileSync(
        path.join(day, "session-2026-11-16-11-00-00-bbbb_001.jsonl"),
        [head, prompt(REQ), ...rest.slice(0, 2)].join("\n"),
      );
      writeFileSync(
        path.join(day, "session-2026-11-16-11-00-00-bbbb_002.jsonl"),
        rest.slice(2).join("\n"),
      );
      writeFileSync(
        path.join(day, "session-2026-11-16-12-00-00-cccc_001.jsonl"),
        [head, prompt(`${REQ}-other`), ...rest].join("\n"),
      );
      const found = findSession(traces, REQ);
      expect(found.session).toBe("session-2026-11-16-11-00-00-bbbb");
      expect(found.files.map((f: string) => path.basename(f))).toEqual([
        "session-2026-11-16-11-00-00-bbbb_001.jsonl",
        "session-2026-11-16-11-00-00-bbbb_002.jsonl",
      ]);
      const cli = spawnSync(process.execPath, [SCRIPT, "--traces", traces, REQ], {
        encoding: "utf8",
      });
      expect(cli.status).toBe(0);
      expect(JSON.parse(cli.stdout)).toMatchObject({
        ok: true,
        calls: 5,
        tokens: 1234,
        session: "session-2026-11-16-11-00-00-bbbb",
      });
      const none = spawnSync(process.execPath, [SCRIPT, "--traces", traces, `${REQ}x/none`], {
        encoding: "utf8",
      });
      expect(none.status).toBe(1);
      expect(JSON.parse(none.stdout).violations[0]).toMatch(/no answerer session/);
    } finally {
      rmSync(traces, { recursive: true, force: true });
    }
  });

  it("works from the command line: JSON out, exit 1 on a violation", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "audit-"));
    try {
      const good = path.join(dir, "good.jsonl");
      const bad = path.join(dir, "bad.jsonl");
      writeFileSync(good, trace(CLEAN));
      writeFileSync(bad, trace([...CLEAN, ["exec_command", { cmd: "python3 x.py" }]]));
      const ok = spawnSync(process.execPath, [SCRIPT, good, REQ], { encoding: "utf8" });
      expect(ok.status).toBe(0);
      expect(JSON.parse(ok.stdout).ok).toBe(true);
      const no = spawnSync(process.execPath, [SCRIPT, bad, REQ], { encoding: "utf8" });
      expect(no.status).toBe(1);
      expect(JSON.parse(no.stdout).violations[0]).toMatch(/python3/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
