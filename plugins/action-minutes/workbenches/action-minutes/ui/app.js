import {
  t,
  desk,
  node,
  row,
  section,
  hint,
  input,
  select,
  button,
  form,
  field,
  list,
  entry,
  brief,
  today,
  displayDay,
} from "./desk-kit.js";
import { followUp } from "./follow-up.js";
let view = "follow";
let selected = null,
  adding = false;
desk(t("Action Minutes", "会议行动簿"), (minutes, { send, draw }) => {
  const meeting = minutes.meetings.find((m) => m.id === selected) ?? minutes.meetings[0];
  const add = form(
    "meeting",
    t("Create meeting", "创建会议"),
    async (v, id) => {
      if (await send({ type: "meeting", ...v }, id)) {
        selected = null;
        adding = false;
        view = "meeting";
        draw(id);
      }
    },
    field(t("Meeting title", "会议名称"), input("title", { required: true })),
    field(t("Date", "会议日期"), input("day", { type: "date", required: true, value: today() })),
  );
  if (!meeting) return [section(t("New meeting", "新建会议"), add)];
  const openMeeting = (id) => {
    selected = id;
    view = "meeting";
    adding = false;
    draw();
  };
  function switcher(key, label) {
    const b = button(label, () => {
      view = key;
      adding = false;
      draw();
    });
    b.setAttribute("aria-current", view === key && !adding ? "page" : "false");
    return b;
  }
  const navigation = node(
    "nav",
    { className: "work-views" },
    row(
      switcher("follow", t("Follow-up", "跟进")),
      switcher("meeting", t("Meeting notes", "会议纪要")),
    ),
    button(
      adding ? t("Cancel", "取消") : t("New meeting", "新建会议"),
      () => {
        adding = !adding;
        draw();
        if (adding) document.querySelector('input[name="title"]')?.focus();
      },
      !adding,
    ),
  );
  if (adding) return [navigation, section(t("New meeting", "新建会议"), add)];
  if (view === "follow")
    return [navigation, ...followUp(minutes.meetings, { send, draw }, openMeeting)];
  const picker = select(
    "picked",
    minutes.meetings.map((m) => [m.id, m.title + " / " + displayDay(m.day)]),
    meeting.id,
  );
  picker.onchange = () => {
    selected = Number(picker.value);
    draw();
  };
  const meetingId = meeting.id;
  const act = (action, id) => send({ ...action, meeting: meetingId }, id);
  const summary = () =>
    [
      meeting.title + " — " + displayDay(meeting.day),
      "",
      t("Decisions", "会议决定"),
      ...meeting.decisions.map((d) => "- " + d),
      "",
      t("Action items", "行动项"),
      ...meeting.tasks.map(
        (a) =>
          "- [" +
          (a.done ? "x" : " ") +
          "] " +
          a.label +
          [a.owner, a.due]
            .filter(Boolean)
            .map((s) => " / " + s)
            .join(""),
      ),
    ].join("\n");
  const exportText = () => {
    const url = URL.createObjectURL(new Blob([summary()], { type: "text/plain;charset=utf-8" }));
    const link = node("a", {
      href: url,
      download: meeting.title.replace(/[^\p{L}\p{N} _-]/gu, "_") + ".txt",
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const controls = row(
    field(t("Meeting", "会议"), picker),
    button(t("Export minutes", "导出纪要"), exportText),
  );
  const tasks = section(
    t("Action items", "行动项"),
    form(
      "tasks-" + meetingId,
      t("Add action", "添加行动项"),
      (v, id) => act({ type: "task", ...v }, id),
      field(t("Action", "事项"), input("label", { required: true, maxLength: 200 })),
      field(t("Owner", "负责人"), input("owner", { maxLength: 80 })),
      field(t("Due date", "截止日期"), input("due", { type: "date" })),
    ),
    list(
      ...meeting.tasks.map((task) =>
        entry(
          brief(
            task.label,
            [task.owner, task.due ? displayDay(task.due) : ""].filter(Boolean).join(" / "),
          ),
          node(
            "span",
            { className: "wb-badge" },
            task.done ? t("Done", "已完成") : t("Open", "待办"),
          ),
          button(task.done ? t("Reopen", "重新打开") : t("Complete", "完成"), () =>
            act({ type: "toggle", id: task.id }),
          ),
          button(t("Remove", "移除"), () => act({ type: "remove", id: task.id })),
        ),
      ),
    ),
  );
  const decisions = section(
    t("Decisions", "会议决定"),
    form(
      "decision-" + meetingId,
      t("Record decision", "记录决定"),
      (v, id) => act({ type: "decision", ...v }, id),
      field(t("Decision", "决定"), input("label", { required: true, maxLength: 300 })),
    ),
    list(
      ...meeting.decisions.map((d, index) =>
        entry(
          d,
          button(t("Remove", "移除"), () => act({ type: "drop-decision", index })),
        ),
      ),
    ),
  );
  return [
    navigation,
    controls,
    section(meeting.title, hint(displayDay(meeting.day))),
    node("div", { className: "columns" }, tasks, decisions),
    row(
      button(t("Delete meeting", "删除会议"), () => {
        if (confirm(t("Delete this meeting and its minutes?", "删除这场会议及其全部纪要？")))
          void act({ type: "delete-meeting" });
      }),
    ),
  ];
});
