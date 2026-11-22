import {
  t,
  node,
  section,
  heading,
  hint,
  select,
  button,
  list,
  entry,
  today,
  displayDay,
} from "./desk-kit.js";

let owner = null;

export function followUp(meetings, { send, draw }, openMeeting) {
  const todayKey = today();
  const pending = meetings.flatMap((meeting) =>
    meeting.tasks.filter((task) => !task.done).map((task) => ({ meeting, task })),
  );
  const owners = [...new Set(pending.map(({ task }) => task.owner))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (owner !== null && !owners.includes(owner)) owner = null;
  // Option values use positions so a person's name cannot collide with the “all” or unassigned filter.
  const filter = select(
    "owner-filter",
    [
      ["all", t("All owners", "全部负责人")],
      ...owners.map((name, index) => [String(index), name || t("Unassigned", "未分配")]),
    ],
    owner === null ? "all" : String(owners.indexOf(owner)),
  );
  filter.setAttribute("aria-label", t("Filter by owner", "按负责人筛选"));
  filter.onchange = () => {
    owner = filter.value === "all" ? null : owners[Number(filter.value)];
    draw();
  };
  const groups = [[], [], [], []];
  pending.sort(
    (a, b) => (a.task.due || "9999").localeCompare(b.task.due || "9999") || a.task.id - b.task.id,
  );
  for (const { meeting, task } of pending) {
    if (owner !== null && task.owner !== owner) continue;
    const group = !task.due ? 3 : task.due < todayKey ? 0 : task.due === todayKey ? 1 : 2;
    const source = button(meeting.title, () => openMeeting(meeting.id));
    source.className = "meeting-link";
    const meta = node(
      "div",
      { className: "task-source" },
      node("span", {}, task.owner || t("Unassigned", "未分配")),
      source,
    );
    groups[group].push(
      entry(
        node("div", {}, node("strong", {}, task.label), meta),
        task.due ? node("time", { dateTime: task.due }, displayDay(task.due)) : null,
        button(t("Complete", "完成"), () =>
          send({ type: "toggle", meeting: meeting.id, id: task.id }),
        ),
      ),
    );
  }
  const labels = [
    t("Overdue", "已逾期"),
    t("Due today", "今天到期"),
    t("Upcoming", "即将到期"),
    t("No due date", "未设截止日期"),
  ];
  return [
    node(
      "div",
      { className: "follow-heading" },
      heading(t("Open action items", "待跟进行动项")),
      owners.length > 0 ? filter : null,
    ),
    ...groups.flatMap((group, index) =>
      group.length ? [section(labels[index], list(...group))] : [],
    ),
    ...(pending.length
      ? []
      : [
          hint(
            t(
              "All caught up. Actions added in meeting notes appear here.",
              "已没有待办。在会议纪要中添加的行动项会显示在这里。",
            ),
          ),
        ]),
  ];
}
