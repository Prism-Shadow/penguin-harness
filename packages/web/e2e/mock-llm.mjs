/**
 * Mock Anthropic Messages API (streaming SSE) for E2E.
 * Branches on request body:
 *  - title request (prompt contains "concise title") -> short text
 *  - files-card probe ("files card test") -> text with two backtick paths (one real, one missing)
 *  - subagent's own turns (its prompt is the only user text) -> tool_use(exec_command) first,
 *    then the report text once the tool_result is back — the tool call gives the child a real
 *    approval point (under always-ask it parks on a NESTED approval, which the subagents-panel
 *    e2e approves from the panel; under allow-all it auto-runs)
 *  - parent asked to delegate ("run a subagent") -> tool_use(run_subagent)
 *  - a repeat delegation later in the same conversation ("run another subagent", keyed on the
 *    LAST message so history can't shadow it) -> tool_use(run_subagent) again
 *  - "background server test" -> tool_use(exec_command) whose command outlives its yield
 *    window (processes.spec: the promoted background process shows in the session's
 *    process list and can be stopped from there)
 *  - "background exit test" -> tool_use(exec_command) whose command outlives the yield
 *    window but exits on its own shortly after (processes.spec: the exited row can be
 *    removed from the process list)
 *  - "slow stream test" -> tool_use(exec_command) with a command that prints one line
 *    every 200ms for ~8s (reload-midstream.spec reloads while its output streams)
 *  - "slow text test" -> a long text streamed one delta every 200ms for ~8s
 *    (reload-midstream.spec reloads while the TEXT streams)
 *  - last message has tool_result -> final text (turn 2)
 *  - otherwise (first user turn) -> thinking + text + tool_use(exec_command)
 */
import http from "node:http";

/** The run_subagent prompt; also the marker the mock uses to detect "this is the child session's own request". */
const SUBAGENT_PROMPT = "Count the TODO items in the repository";

const PORT = Number(process.env.MOCK_PORT || 8931);

/** Count of non-replay requests seen in the "bad stream" conversation: the 1st is cut off (malformed), later ones are retries that get a full tool call. */
let malformedTurns = 0;

/** Count of requests seen in the "quota retry" conversation: the first 5 are rejected 403 (insufficient_user_quota), the 6th streams normally. */
let quotaTurns = 0;

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function messageStart(res, msgCount = 1) {
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: "claude-4-8",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      // Usage grows with context length (as real providers do): more messages in the request
      // means a larger prompt. If the mock reported a fixed value, the compaction threshold
      // would either be hit on the very first request or never be hit at all, and it wouldn't
      // drop back down after compaction — this would make it impossible to reproduce the
      // "compaction only triggers at round end" timing, and would send the engine into an
      // infinite compaction loop.
      usage: {
        input_tokens: 40,
        output_tokens: 0,
        cache_read_input_tokens: 40 * msgCount,
        cache_creation_input_tokens: 10,
      },
    },
  });
}
function messageStop(res, stopReason, outputTokens) {
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

function block(res, index, start, deltas, extra) {
  sse(res, "content_block_start", { type: "content_block_start", index, content_block: start });
  for (const d of deltas)
    sse(res, "content_block_delta", { type: "content_block_delta", index, delta: d });
  if (extra) sse(res, "content_block_delta", { type: "content_block_delta", index, delta: extra });
  sse(res, "content_block_stop", { type: "content_block_stop", index });
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let json = {};
    try {
      json = JSON.parse(body);
    } catch {}
    const messages = json.messages || [];
    const flat = JSON.stringify(messages);
    const isTitle = flat.includes("concise title");
    // After compaction the new context has only the summary left, so the message count drops
    // sharply -> reported usage drops along with it, letting compaction converge.
    const msgCount = messages.length;
    const hasToolResult = flat.includes("tool_result");
    // Child-session request: the context has only the prompt handed down by run_subagent, no parent user input.
    const isSubagentTurn = flat.includes(SUBAGENT_PROMPT) && !flat.includes("run a subagent");
    const wantsSubagent = flat.includes("run a subagent");
    // "Bad stream" test case: the first request streams half the tool_use arguments then cuts
    // the connection (no message_stop), so AgentHub reports "stream incomplete" -> GenerativeModel
    // resolves it as malformed. On reconnect the engine **resends the input verbatim** — in this
    // scenario the failed attempt only has a half tool_call (never committed to the ledger), so
    // the retry request carries no [turn_retried] block and is byte-for-byte identical to the
    // first request; the mock can only tell them apart by request count (see the malformedTurns counter).
    const wantsMalformed = flat.includes("bad stream test");

    // "Auth dead" test case: KEY-BASED — requests carrying the bad key (`sk-auth-bad`,
    // the Anthropic protocol sends it as the x-api-key header) are rejected with a 401 +
    // OpenAI-compatible body code; any other key succeeds with a plain text answer. This
    // exercises the recoverable flow end to end: GenerativeModel classifies the 401 as
    // failed + code "auth" (never retried) and the composer goes dead; once the spec
    // updates the model's key via PUT /models, the very same conversation continues
    // (live unlock via credentials_updated + runtime invalidation re-reading the config).
    // Gated on !isTitle so a stray title request doesn't hit this branch.
    if (flat.includes("auth dead test") && !isTitle) {
      if (req.headers["x-api-key"] === "sk-auth-bad") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: { code: "invalid_api_key", message: "invalid x-api-key" } }),
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      messageStart(res, msgCount);
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Auth restored; hello again." },
      ]);
      messageStop(res, "end_turn", 8);
      return;
    }

    // "Quota give-up" test case: EVERY request is rejected 403 with the quota code — the
    // spec clicks the reconnect countdown's give-up button mid-wait, so the conversation
    // must never recover on its own (the abort ends it instead).
    if (flat.includes("quota giveup test") && !isTitle) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "insufficient_user_quota", message: "no active subscription" },
        }),
      );
      return;
    }

    // "Quota retry" test case: the first 5 requests of the conversation are rejected 403
    // with the provider's quota-exhaustion code (as OpenAI-compatible gateways do).
    // GenerativeModel classifies them retryable (timeout) and the engine reconnects with
    // exponential backoff (250/500/1000/2000/4000ms) — the 4s wait before retry #5 is the
    // window the spec uses to observe the live countdown and click "retry now"; the 6th
    // attempt streams a normal final answer.
    if (flat.includes("quota retry test") && !isTitle) {
      quotaTurns += 1;
      if (quotaTurns <= 5) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { code: "insufficient_user_quota", message: "no active subscription" },
          }),
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      messageStart(res, msgCount);
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Quota recovered; the answer is 42." },
      ]);
      messageStop(res, "end_turn", 10);
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    messageStart(res, msgCount);

    if (isTitle) {
      // The child session's title request carries **the child session's own answer** as
      // assistant material; respond with a distinguishable title based on that, so the E2E
      // test can prove the child session's title really comes from its own conversation,
      // not from the run_subagent prompt.
      const forSubagent = flat.includes("Subagent report");
      block(res, 0, { type: "text", text: "" }, [
        {
          type: "text_delta",
          text: forSubagent ? "Subagent TODO summary" : "Configure Tailwind theme",
        },
      ]);
      messageStop(res, "end_turn", 8);
      return;
    }

    // Files-card test case: the reply carries two backtick paths — demo.html was actually
    // written into the Workspace beforehand by the spec via files/content, while
    // missing-report.pdf doesn't exist; the card should only list the former. This branch
    // must be checked before hasToolResult (the same session's history already has a
    // first-round tool_result).
    if (flat.includes("files card test")) {
      block(res, 0, { type: "text", text: "" }, [
        {
          type: "text_delta",
          text: "Report generated: `demo.html`; the other file `missing-report.pdf` does not exist.",
        },
      ]);
      messageStop(res, "end_turn", 18);
      return;
    }

    if (wantsMalformed && !hasToolResult) {
      malformedTurns += 1;
      if (malformedTurns === 1) {
        sse(res, "content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_broken_1",
            name: "exec_command",
            input: {},
          },
        });
        sse(res, "content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"cmd": "ec' },
        });
        sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
        res.end(); // ends normally but is missing message_delta/message_stop -> AgentHub reports "stream incomplete"
        return;
      }
      // Retry (original input resent): return a complete tool_use, then proceed normally.
      block(res, 0, { type: "tool_use", id: "toolu_retry_1", name: "exec_command", input: {} }, [
        { type: "input_json_delta", partial_json: '{"cmd"' },
        { type: "input_json_delta", partial_json: ': "echo ok"}' },
      ]);
      messageStop(res, "tool_use", 12);
      return;
    }

    // A REPEAT delegation later in the same conversation (the task-scoped panel e2e needs a
    // second spawning Task): keyed on the LAST message only — the whole-history flags above
    // ("run a subagent" + hasToolResult) can never take this branch once a first delegation
    // sits in the history. The child flow it spawns is identical (same SUBAGENT_PROMPT). The
    // ~800ms delay keeps the e2e's two observations in order: the task boundary first CLOSES
    // the panel, and only then does this spawn auto-open it again.
    const lastFlat = JSON.stringify(messages[messages.length - 1] ?? {});
    if (lastFlat.includes("run another subagent")) {
      setTimeout(() => {
        block(
          res,
          0,
          { type: "tool_use", id: "toolu_mock_sub2", name: "run_subagent", input: {} },
          [
            { type: "input_json_delta", partial_json: '{"prompt": ' },
            { type: "input_json_delta", partial_json: `${JSON.stringify(SUBAGENT_PROMPT)}}` },
          ],
        );
        messageStop(res, "tool_use", 15);
      }, 800);
      return;
    }

    if (isSubagentTurn) {
      // Child turn 1: one tool call before reporting (see the header comment — the child needs
      // its own approval point for the nested-approval e2e). The command sleeps ~1s so the
      // whole parent Task reliably OUTLIVES the draft-flow navigation — the auto-open e2e
      // needs the client to attach while the spawn is still live (a real model is far slower;
      // without the sleep the mock finishes the entire tree before the page even connects).
      // Turn 2: the report text, the exact string the title branch keys on.
      if (!hasToolResult) {
        block(res, 0, { type: "tool_use", id: "toolu_sub_exec", name: "exec_command", input: {} }, [
          { type: "input_json_delta", partial_json: '{"cmd"' },
          { type: "input_json_delta", partial_json: ': "sleep 1; echo counting"}' },
        ]);
        messageStop(res, "tool_use", 10);
        return;
      }
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Subagent report: 3 TODOs" },
      ]);
      messageStop(res, "end_turn", 12);
      return;
    }

    // Background-notify test case (background-notify.spec): turn 1 launches a command with
    // run_in_background (returns a process_id immediately); turn 2 closes the task while
    // the command is still running; ~2s later the command exits and the harness injects a
    // [background_task_done] user message that auto-starts a task — whose turn is keyed on
    // the LAST message (the whole-history flags can't shadow it) and acknowledges.
    const lastText = JSON.stringify(messages[messages.length - 1] ?? {});
    if (lastText.includes("background_task_done")) {
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Acknowledged: the background command finished (bg-ack)." },
      ]);
      messageStop(res, "end_turn", 9);
      return;
    }
    if (flat.includes("background notify test")) {
      if (!hasToolResult) {
        block(res, 0, { type: "tool_use", id: "toolu_bgn_1", name: "exec_command", input: {} }, [
          { type: "input_json_delta", partial_json: '{"cmd": "echo bg-notify; sleep 6",' },
          { type: "input_json_delta", partial_json: ' "run_in_background": true}' },
        ]);
        messageStop(res, "tool_use", 14);
        return;
      }
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Started in the background; the report will follow." },
      ]);
      messageStop(res, "end_turn", 11);
      return;
    }

    // Background-process test case (processes.spec): an exec_command that outlives its
    // yield window — the engine promotes it to a background process with a process_id,
    // which the session's process list (details popover) must surface and be able to stop.
    // The tiny yield keeps the turn snappy; `sleep 600` stands in for a dev server.
    if (flat.includes("background server test") && !hasToolResult) {
      block(res, 0, { type: "tool_use", id: "toolu_bg_1", name: "exec_command", input: {} }, [
        { type: "input_json_delta", partial_json: '{"cmd": "sleep 600",' },
        { type: "input_json_delta", partial_json: ' "yield_time_ms": 300}' },
      ]);
      messageStop(res, "tool_use", 14);
      return;
    }

    // Background process that EXITS on its own (processes.spec: the exited row keeps its
    // "已退出" label and gains a remove button that deletes the entry from the list). The
    // command outlives the 300ms yield window — so it is promoted to background — and
    // exits ~200ms later, leaving an exited entry behind.
    if (flat.includes("background exit test") && !hasToolResult) {
      block(res, 0, { type: "tool_use", id: "toolu_bgexit_1", name: "exec_command", input: {} }, [
        { type: "input_json_delta", partial_json: '{"cmd": "sleep 0.5",' },
        { type: "input_json_delta", partial_json: ' "yield_time_ms": 300}' },
      ]);
      messageStop(res, "tool_use", 14);
      return;
    }

    // Slow tool-output test case (reload-midstream.spec): a real exec_command whose output
    // streams one line every 200ms for ~8s — long enough to reload the page mid-stream and
    // watch the output keep growing afterwards.
    if (flat.includes("slow stream test") && !hasToolResult) {
      block(res, 0, { type: "tool_use", id: "toolu_slow_1", name: "exec_command", input: {} }, [
        { type: "input_json_delta", partial_json: '{"cmd": "for i in $(seq 1 40); do' },
        { type: "input_json_delta", partial_json: ' echo line $i; sleep 0.2; done"}' },
      ]);
      messageStop(res, "tool_use", 14);
      return;
    }

    // Slow TEXT test case (reload-midstream.spec): a single text block streamed one delta
    // every 200ms (~8s total) so the page can be reloaded while the assistant text is
    // still streaming. Single turn: ends with end_turn, no tool call.
    if (flat.includes("slow text test")) {
      sse(res, "content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      let n = 0;
      const tick = () => {
        n += 1;
        sse(res, "content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: `chunk-${n} ` },
        });
        if (n < 40) {
          setTimeout(tick, 200);
        } else {
          sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
          messageStop(res, "end_turn", 80);
        }
      };
      tick();
      return;
    }

    if (wantsSubagent && !hasToolResult) {
      block(res, 0, { type: "tool_use", id: "toolu_mock_sub", name: "run_subagent", input: {} }, [
        { type: "input_json_delta", partial_json: '{"prompt": ' },
        { type: "input_json_delta", partial_json: `${JSON.stringify(SUBAGENT_PROMPT)}}` },
      ]);
      messageStop(res, "tool_use", 15);
      return;
    }

    if (hasToolResult) {
      // Turn 2: final answer text. The first sentence is asserted verbatim across several specs —
      // keep it byte-identical and in its own paragraph. The rest is a rendering fixture for
      // chat.spec: a ~170-char bare URL inside a CJK sentence (must autolink, open in a new tab,
      // and wrap instead of widening the page) plus a Markdown table with an unbreakable
      // 118-char plain token (must scroll inside the message body, not push the page wide).
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Command finished; " },
        { type: "text_delta", text: "the result looks as expected.\n\n" },
        { type: "text_delta", text: "长链接折行验证：完整报告地址是 " },
        {
          type: "text_delta",
          text: "https://example.com/penguin-harness/reports/2026-07/agent-session-0123456789abcdef0123456789abcdef/artifacts/deep-verification-run-with-a-very-long-descriptive-file-name-v3.html",
        },
        { type: "text_delta", text: " ，请在浏览器中打开查看。\n\n" },
        { type: "text_delta", text: "| 指标 | 标识 | 说明 |\n| --- | --- | --- |\n" },
        {
          type: "text_delta",
          text: "| 会话 | agent-session-0123456789abcdef0123456789abcdef-0123456789abcdef0123456789abcdef-final | 长标识验证表格横向滚动 |\n",
        },
        { type: "text_delta", text: "| 结果 | completed | 全部通过 |\n" },
      ]);
      messageStop(res, "end_turn", 20);
      return;
    }

    // Turn 1: thinking + text + tool_use, streamed with small delays.
    const steps = [];
    steps.push(() =>
      block(
        res,
        0,
        { type: "thinking", thinking: "" },
        [
          { type: "thinking_delta", thinking: "Let me look at " },
          { type: "thinking_delta", thinking: "the directory structure" },
        ],
        { type: "signature_delta", signature: "sig_mock_abc" },
      ),
    );
    steps.push(() =>
      block(res, 1, { type: "text", text: "" }, [
        { type: "text_delta", text: "I'll run a command to check." },
      ]),
    );
    steps.push(() =>
      block(res, 2, { type: "tool_use", id: "toolu_mock_1", name: "exec_command", input: {} }, [
        { type: "input_json_delta", partial_json: '{"cmd"' },
        { type: "input_json_delta", partial_json: ': "ls -la"}' },
      ]),
    );
    let i = 0;
    const run = () => {
      if (i < steps.length) {
        steps[i]();
        i += 1;
        setTimeout(run, 120);
      } else {
        messageStop(res, "tool_use", 30);
      }
    };
    run();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-llm on http://127.0.0.1:${PORT}`);
});
