let locale = navigator.language;
try {
  locale = parent.document.documentElement.lang || locale;
} catch {}
const lang = locale.startsWith("zh") ? "zh" : "en";
document.documentElement.lang = lang;
const labels = {
  en: {
    add: "Add task",
    field: "New task",
    group: "Other tasks",
    remove: "Remove",
    error: "The checklist could not be saved.",
  },
  zh: {
    add: "添加任务",
    field: "新任务",
    group: "其他任务",
    remove: "移除",
    error: "清单保存失败。",
  },
}[lang];
const items = document.querySelector("#items"),
  form = document.querySelector("form"),
  input = document.querySelector("input");
const status = document.querySelector("[role=status]");
function element(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
async function request(path, action) {
  const r = await fetch(
    "../api/" + path,
    action
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        }
      : { cache: "no-store" },
  );
  if (!r.ok) throw Error(String(r.status));
  return r.json();
}
function render(board) {
  document.title = document.querySelector("h1").textContent = board.title;
  items.replaceChildren();
  for (const group of new Set(board.items.map((i) => i.group))) {
    items.append(element("h2", group));
    for (const item of board.items.filter((i) => i.group === group)) {
      const row = element("div", ""),
        label = element("label", ""),
        check = document.createElement("input");
      row.className = "item";
      check.type = "checkbox";
      check.checked = item.done;
      check.onchange = () => change({ op: "check", id: item.id, done: check.checked });
      label.append(check, element("span", item.task));
      row.append(label);
      if (item.doneWhen) row.append(element("small", item.doneWhen));
      const remove = element("button", labels.remove);
      remove.className = "secondary";
      remove.onclick = () => change({ op: "remove", id: item.id });
      row.append(remove);
      items.append(row);
    }
  }
}
async function change(action) {
  try {
    document.querySelector("main").inert = true;
    render(await request("items", action));
    status.textContent = "";
    return true;
  } catch (e) {
    status.textContent = labels.error + " " + e.message;
    try {
      render(await request("board"));
    } catch {}
    return false;
  } finally {
    document.querySelector("main").inert = false;
  }
}
form.querySelector("label").textContent = labels.field;
form.querySelector("button").textContent = labels.add;
form.onsubmit = async (e) => {
  e.preventDefault();
  const task = input.value.trim();
  if (
    task &&
    (await change({
      op: "add",
      id: Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join(""),
      task,
      group: labels.group,
    }))
  )
    input.value = "";
};
try {
  render(await request("board"));
} catch (e) {
  status.textContent = e.message;
}
