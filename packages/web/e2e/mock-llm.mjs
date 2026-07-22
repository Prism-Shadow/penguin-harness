/**
 * Mock Anthropic Messages API (streaming SSE) for E2E.
 * Branches on request body:
 *  - title request (prompt contains "concise title") -> short text
 *  - files-card probe ("files card test") -> text with two backtick paths (one real, one missing)
 *  - subagent's own turn (its prompt is the only user text) -> final text
 *  - parent asked to delegate ("run a subagent") -> tool_use(run_subagent)
 *  - last message has tool_result -> final text (turn 2)
 *  - otherwise (first user turn) -> thinking + text + tool_use(exec_command)
 */
import http from "node:http";

/** The run_subagent prompt; also the marker the mock uses to detect "this is the child session's own request". */
const SUBAGENT_PROMPT = "Count the TODO items in the repository";

const PORT = Number(process.env.MOCK_PORT || 8931);

/** Count of non-replay requests seen in the "bad stream" conversation: the 1st is cut off (malformed), later ones are retries that get a full tool call. */
let malformedTurns = 0;

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
    // the retry request carries no <turn_retried> block and is byte-for-byte identical to the
    // first request; the mock can only tell them apart by request count (see the malformedTurns counter).
    const wantsMalformed = flat.includes("bad stream test");

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

    if (isSubagentTurn) {
      block(res, 0, { type: "text", text: "" }, [
        { type: "text_delta", text: "Subagent report: 3 TODOs" },
      ]);
      messageStop(res, "end_turn", 12);
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
