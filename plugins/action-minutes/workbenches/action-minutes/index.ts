import { date, requireValue, text, workbench } from "./desk-kit.js";
interface Task {
  id: number;
  label: string;
  owner: string;
  due: string;
  done: boolean;
}
interface Meeting {
  id: number;
  title: string;
  day: string;
  decisions: string[];
  tasks: Task[];
}
interface Minutes {
  nextId: number;
  meetings: Meeting[];
}
export default workbench<Minutes>({ nextId: 1, meetings: [] }, (minutes, a) => {
  if (a.type === "meeting") {
    requireValue(minutes.meetings.length < 120, "full");
    minutes.meetings.unshift({
      id: minutes.nextId++,
      title: text(a.title),
      day: date(a.day),
      decisions: [],
      tasks: [],
    });
    return;
  }
  const meeting = minutes.meetings.find((m) => m.id === a.meeting);
  requireValue(meeting);
  switch (a.type) {
    case "decision":
      requireValue(meeting.decisions.length < 60, "full");
      meeting.decisions.push(text(a.label, 300));
      return;
    case "task":
      requireValue(meeting.tasks.length < 100, "full");
      meeting.tasks.push({
        id: minutes.nextId++,
        label: text(a.label, 200),
        owner: text(a.owner, 80, true),
        due: a.due === "" ? "" : date(a.due),
        done: false,
      });
      return;
    case "toggle": {
      const task = meeting.tasks.find((t) => t.id === a.id);
      requireValue(task);
      task.done = !task.done;
      return;
    }
    case "remove": {
      const at = meeting.tasks.findIndex((t) => t.id === a.id);
      requireValue(at >= 0);
      meeting.tasks.splice(at, 1);
      return;
    }
    case "drop-decision": {
      const i = a.index;
      requireValue(
        typeof i === "number" && Number.isInteger(i) && i >= 0 && i < meeting.decisions.length,
      );
      meeting.decisions.splice(i, 1);
      return;
    }
    case "delete-meeting":
      minutes.meetings.splice(minutes.meetings.indexOf(meeting), 1);
      return;
    default:
      requireValue(false);
  }
});
