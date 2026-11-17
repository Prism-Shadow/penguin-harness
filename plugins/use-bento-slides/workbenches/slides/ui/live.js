// What the open question's dialog shows while its answer is written: folded from the Session's
// records as the page SDK's reader delivers them (the latest task's history, then live).

/** The view before any record: nothing known yet. */
export function emptyLive() {
  // running: null until a task_begin or task_end says. text: the current Request's finished
  // texts; streaming: the one still arriving. activity: a key of the strings' `activity`.
  return { running: null, compacting: false, text: "", streaming: "", activity: null };
}

// Plain words for what a tool call is doing (keys of `activity` in strings.js).
const TOOL_ACTIVITY = {
  read_file: "reading",
  exec_command: "searching",
  input_command: "searching",
  run_subagent: "helper",
  input_subagent: "helper",
  write_file: "notes",
  edit_file: "notes",
};

export const toolActivity = (name) =>
  Object.hasOwn(TOOL_ACTIVITY, name) ? TOOL_ACTIVITY[name] : "other";

/** The view after one more record. A subagent's record (it carries `origin`) changes nothing. */
export function foldLive(view, record) {
  if (record.origin?.length) return view;
  const p = record.payload || {};
  switch (p.type) {
    case "task_begin":
      return { ...emptyLive(), running: true };
    case "task_end":
      return { ...view, running: false, streaming: "" };
    case "request_begin":
      // Each Request drafts afresh: what one wrote before its tool calls is not the answer.
      return { ...view, text: "", streaming: "" };
    case "compaction_begin":
      return { ...view, compacting: true, activity: "summarizing" };
    case "compaction_end":
      return { ...view, compacting: false };
    case "partial_thinking":
      return { ...view, activity: "thinking" };
    case "partial_tool_call":
    case "tool_call":
      return { ...view, activity: toolActivity(p.name) };
    case "partial_text":
      // The summary a compaction writes streams as text too, and is no answer.
      if (view.compacting || p.role !== "assistant") return view;
      if (p.event_type === "start")
        return { ...view, activity: "writing", streaming: p.text || "" };
      if (p.event_type === "delta") return { ...view, streaming: view.streaming + (p.text || "") };
      return view;
    case "text":
      if (view.compacting || p.role !== "assistant") return view;
      return { ...view, text: joinText(view.text, p.text), streaming: "" };
    default:
      return view;
  }
}

/** The draft to show: the current Request's text so far, or "" when none is being written. */
export function draftOf(view) {
  return view.running === false ? "" : joinText(view.text, view.streaming);
}

const joinText = (a, b) => (a && b ? a + "\n\n" + b : a || b);
