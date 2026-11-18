import { turnsFor } from "./conversation.js";

const labels = {
  en: {
    running: "Working",
    reading: "Reading a file",
    executing: "Running a command",
    waiting: "Approval needed",
    allow: "Allow",
    deny: "Deny",
    queued: "Queued",
    completed: "Completed",
    failed: "Failed",
    interrupted: "Stopped",
    thinking: "Thinking",
    tool: "Tool call",
    tools: {
      exec_command: "Run command",
      read_file: "Read file",
      write_file: "Write file",
      edit_file: "Edit file",
      run_subagent: "Consult an assistant",
    },
    input: "Arguments",
    output: "Result",
    retry: "Retry",
    stopped: "Stopped",
    cancelled: "Stopped",
    aborted: "Stopped",
  },
  zh: {
    running: "处理中",
    reading: "正在读取文件",
    executing: "正在运行命令",
    waiting: "需要批准",
    allow: "允许",
    deny: "拒绝",
    queued: "排队中",
    completed: "已完成",
    failed: "失败",
    interrupted: "已停止",
    thinking: "思考",
    tool: "工具调用",
    tools: {
      exec_command: "运行命令",
      read_file: "读取文件",
      write_file: "写入文件",
      edit_file: "编辑文件",
      run_subagent: "调用子助手",
    },
    input: "参数",
    output: "结果",
    retry: "重试",
    stopped: "已停止",
    cancelled: "已停止",
    aborted: "已停止",
  },
};
function element(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function details(label, key, opened, cls = "turn-step") {
  const item = element("details", cls);
  item.dataset.disclosure = key;
  item.open = opened.has(key);
  item.append(element("summary", "", label));
  return item;
}

export function showConversation(list, messages, trace, options) {
  const { locale, running, hint, retry, approvals = [], decide } = options;
  const S = labels[locale] || labels.en;
  const stick = list.scrollHeight - list.clientHeight - list.scrollTop < 40;
  const previous = list.scrollTop;
  const opened = new Set(
    [...list.querySelectorAll("details[open]")].map((el) => el.dataset.disclosure),
  );
  const scrolled = [...list.querySelectorAll("details[open] pre")].map((el) => el.scrollTop);
  const focused = document.activeElement?.closest("details")?.dataset.disclosure;
  const grouped = turnsFor(messages, trace);
  const out = document.createDocumentFragment();
  let row,
    prompt = "";
  for (const [i, msg] of messages.entries()) {
    if (msg.role !== "user") {
      if (!row) {
        row = element("li", "conversation-turn");
        out.append(row);
      }
      const traceTurn = grouped.get(i - 1);
      const last = traceTurn?.parts.at(-1);
      if (msg.role === "assistant" && last?.kind === "text" && last.text.trim() === msg.text.trim())
        continue;
      if (msg.role !== "error" || traceTurn?.error !== msg.text)
        row.append(element("div", msg.role === "error" ? "turn-error" : "turn-answer", msg.text));
      if (msg.role === "error" && prompt) addRetry(row, prompt);
      continue;
    }
    row = element("li", "conversation-turn");
    out.append(row);
    prompt = msg.text;
    row.append(element("div", "me", prompt));
    const turn = grouped.get(i);
    const next = messages[i + 1];
    const status =
      turn?.status ??
      (next && next.role !== "user"
        ? next.role === "error"
          ? "failed"
          : "completed"
        : running
          ? "running"
          : null);
    const active = status === "running" || status === "queued";
    const parts = turn?.parts || [];
    const waiting = active && i === messages.length - 1 ? approvals : [];
    const last = parts.at(-1);
    let state = S[status] || status;
    if (waiting.length) state = S.waiting;
    else if (active && last?.kind === "thinking") state = S.thinking;
    else if (active && last?.kind === "tool" && last.status === "running") {
      if (last.name === "read_file") state = S.reading;
      else if (last.name === "exec_command") state = S.executing;
      else state = S.tools[last.name] || S.running;
    }
    const key = msg.at || String(i);
    let group;
    if (parts.some((part) => part.kind !== "text")) {
      group = details(state, key, opened, "turn-history");
      group.firstElementChild.className = "turn-state";
      row.append(group);
    } else if (state) row.append(element("span", "turn-state", state));
    for (const { tool_call: call } of waiting) {
      const actions = element("div", "turn-approval");
      actions.append(element("span", "", S.tools[call.name] || call.name || S.tool));
      // Show the actual request before asking to authorize it, including the command or file.
      const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments);
      if (args) actions.append(element("pre", "", args));
      for (const decision of ["allow", "deny"]) {
        const btn = element("button", "", S[decision]);
        btn.type = "button";
        btn.onclick = async () => {
          const buttons = actions.querySelectorAll("button");
          buttons.forEach((b) => (b.disabled = true));
          try { await decide(call.tool_call_id, decision); }
          catch (error) {
            actions.append(element("span", "turn-error", error.message));
            buttons.forEach((b) => (b.disabled = false));
          }
        };
        actions.append(btn);
      }
      row.append(actions);
    }
    for (const [j, part] of parts.entries()) {
      if (part.kind === "text") {
        if (part.text) row.append(element("div", "turn-answer", part.text));
        continue;
      }
      const item = details(
        part.kind === "tool" ? (S.tools[part.name] ?? part.name) || S.tool : S.thinking,
        key + "-" + j,
        opened,
      );
      if (part.kind === "thinking") item.append(element("div", "turn-thought", part.text));
      else {
        if (S.tools[part.name]) item.firstElementChild.title = part.name;
        if (part.input) item.append(element("small", "", S.input), element("pre", "", part.input));
        if (part.output || part.status !== "running") {
          item.append(
            element("small", "", S.output + (part.status === "failed" ? " · " + S.failed : "")),
            element("pre", "", part.output),
          );
        }
      }
      group.append(item);
    }
    if (turn?.error) row.append(element("div", "turn-error", turn.error));
    if (
      (status === "failed" || status === "interrupted" || status === "aborted") &&
      next?.role !== "error"
    )
      addRetry(row, prompt);
  }
  if (!messages.length) out.append(element("li", "hint", hint));
  list.replaceChildren(out);
  [...list.querySelectorAll("details[open] pre")].forEach((el, i) => {
    el.scrollTop = scrolled[i] || 0;
  });
  if (focused)
    list
      .querySelector('[data-disclosure="' + CSS.escape(focused) + '"] > summary')
      ?.focus({ preventScroll: true });
  list.scrollTop = stick ? list.scrollHeight : previous;

  function addRetry(target, text) {
    const action = element("button", "turn-retry", S.retry);
    action.type = "button";
    action.disabled = running;
    action.addEventListener("click", () => retry(text));
    target.append(action);
  }
}
