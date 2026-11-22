// SessionReader sends durable history first, then live trace records in the same
// order. A reset discards the projection and lets the SDK replay the Session.
export function newConversation() {
  return { turns: [], current: null };
}

export function readConversation(model, record) {
  const p = record.payload;
  if (record.origin?.length || !p?.type) return;
  if (p.type === "task_begin") {
    const turn = {
      prompt: "",
      status: "running",
      at: record.timestamp,
      parts: [],
      calls: new Map(),
      compacting: false,
    };
    model.turns.push(turn);
    model.current = turn;
    return;
  }
  const turn = model.current;
  if (!turn) return;
  if (p.type === "text" && p.role === "user") {
    const prefix = "\nTheir request: ";
    const suffix = "\nUse the bento-slides skill.";
    const begin = p.text.indexOf(prefix),
      end = p.text.lastIndexOf(suffix);
    turn.prompt = begin >= 0 && end > begin ? p.text.slice(begin + prefix.length, end) : p.text;
    return;
  }
  if (p.type === "compaction_begin" || p.type === "compaction_end") {
    turn.compacting = p.type === "compaction_begin";
    return;
  }
  if (p.type === "request_begin") {
    turn.failure = null;
    return;
  }
  if (p.type === "request_end" && p.status !== "completed" && p.retry_in_ms === undefined) {
    turn.failure = { status: "failed", error: p.error_message || "" };
    return;
  }
  if (p.type === "abort") {
    turn.failure = { status: "interrupted", error: p.error_message || p.reason || "" };
    return;
  }
  if (p.type === "task_end") {
    Object.assign(turn, turn.failure ?? { status: "completed" });
    return;
  }
  if (turn.compacting || turn.status !== "running") return;
  if (["partial_thinking", "thinking", "partial_text", "text"].includes(p.type)) {
    if (p.role !== "assistant") return;
    const kind = p.type.endsWith("thinking") ? "thinking" : "text";
    const partial = p.type.startsWith("partial_");
    const value = kind === "thinking" ? p.thinking : p.text;
    let part = turn.parts.at(-1);
    if (p.event_type === "stop") return;
    if (!part || part.kind !== kind || !part.partial) {
      part = { kind, text: "", partial: true };
      turn.parts.push(part);
    }
    if (!partial || p.event_type === "start") part.text = value || "";
    else if (value) part.text += value;
    part.partial = partial;
    return;
  }
  if (
    !["partial_tool_call", "tool_call", "partial_tool_call_output", "tool_call_output"].includes(
      p.type,
    )
  )
    return;
  const id = p.tool_call_id;
  const isResult = p.type.endsWith("output");
  let call = turn.calls.get(id);
  if (!call || (!isResult && call.complete)) {
    call = { kind: "tool", name: "", input: "", output: "", complete: false, status: "running" };
    turn.parts.push(call);
    turn.calls.set(id, call);
  }
  if (p.name) call.name = p.name;
  const key = isResult ? "output" : "input";
  const data = isResult ? p.output : p.arguments;
  if (!p.type.startsWith("partial_") || p.event_type === "start") {
    call[key] = typeof data === "string" ? data : data == null ? "" : JSON.stringify(data, null, 2);
  } else if (p.event_type === "delta" && typeof data === "string") call[key] += data;
  if (p.type === "tool_call") call.complete = true;
  if (p.type === "tool_call_output") call.status = p.status || "completed";
}

// Match backwards so an older, trimmed duplicate of the same prompt cannot
// take the newer turn. The workbench stores the person's text, without its
// internal deck path and instructions. SessionReader supplies the visible work.
export function turnsFor(messages, trace) {
  const linked = new Map();
  let end = trace.turns.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    for (let j = end - 1; j >= 0; j--) {
      const turn = trace.turns[j];
      if (
        turn.prompt !== messages[i].text ||
        (turn.at && messages[i].at && turn.at < messages[i].at)
      )
        continue;
      linked.set(i, trace.turns[j]);
      end = j;
      break;
    }
  }
  return linked;
}
