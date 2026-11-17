// A standalone workbench follows the device; an embedded one follows the host's chosen language.
let language = navigator.language;
try {
  if (window.parent !== window && window.parent.document.documentElement.lang)
    language = window.parent.document.documentElement.lang;
} catch {
  /* An embedding origin may not expose its document. */
}
export const zh = /^zh/i.test(language);
export const t = (en, cn) => (zh ? cn : en);
document.documentElement.lang = t("en", "zh-CN");

export function node(tag, props = {}, ...children) {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return element;
}
export const heading = (value) => node("h2", {}, value);
export const hint = (value) => node("p", { className: "hint" }, value);
export const row = (...children) => node("div", { className: "wb-row" }, ...children);
export const section = (title, ...children) => node("section", {}, heading(title), ...children);
export const button = (label, click, primary = false) =>
  node("button", { type: "button", className: primary ? "wb-primary" : "", onclick: click }, label);
export const input = (name, options = {}) => node("input", { name, maxLength: 100, ...options });
export const field = (label, control) => node("label", {}, node("span", {}, label), control);
export const select = (name, pairs, value) => {
  const control = node(
    "select",
    { name },
    pairs.map(([key, label]) => node("option", { value: key }, label)),
  );
  if (value != null) control.value = value;
  return control;
};
export const list = (...items) => node("ul", { className: "entries" }, items);
export const entry = (left, ...right) =>
  node("li", {}, node("div", { className: "detail" }, left), row(...right));
export const brief = (title, info = "") =>
  node("div", {}, node("strong", {}, title), info ? hint(info) : null);
export function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
export const displayDay = (day) =>
  new Date(day + "T12:00:00").toLocaleDateString(document.documentElement.lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const messages = {
  conflict: t(
    "Another window saved a change. Review it and try again.",
    "另一个窗口刚刚保存了更改，请确认后重试。",
  ),
  invalid: t("Check the values and try again.", "请检查输入后重试。"),
  full: t("The list is full. Remove an entry to make room.", "列表已满，请先移除一项。"),
  stale: t("That round has ended.", "这一轮已经结束。"),
  network: t("Couldn’t reach the workbench. Try again.", "未能连接工作台，请重试。"),
};

export function desk(title, render) {
  document.title = title;
  const screen = node("div", { className: "content" });
  const status = node("div", { role: "status", className: "status" });
  const dateLabel = node("time", {}, displayDay(today()));
  document.body.replaceChildren(
    node(
      "main",
      {},
      node(
        "header",
        {},
        node("img", { src: "./icon.svg", alt: "" }),
        node("h1", {}, title),
        dateLabel,
      ),
      status,
      screen,
    ),
  );
  let saved;
  let busy = false;
  let loading = false;

  function draw(clearForm) {
    const draft = new Map();
    for (const control of screen.querySelectorAll("form [name]"))
      if (control.form.id !== clearForm)
        draft.set(control.form.id + "/" + control.name, control.value);
    screen.replaceChildren(...render(saved.state, { send, draw }).flat());
    for (const control of screen.querySelectorAll("form [name]")) {
      const key = control.form.id + "/" + control.name;
      if (draft.has(key)) control.value = draft.get(key);
    }
    dateLabel.textContent = displayDay(today());
  }
  async function load() {
    if (busy || loading) return;
    loading = true;
    try {
      const res = await fetch("../api/state", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const next = await res.json();
      if (!busy && (!saved || saved.revision < next.revision)) {
        saved = next;
        draw();
      }
      status.replaceChildren();
    } catch {
      status.replaceChildren(messages.network, button(t("Retry", "重试"), load));
    } finally {
      loading = false;
    }
  }
  async function send(action, clearForm) {
    if (busy || !saved) return false;
    busy = true;
    screen.inert = true;
    try {
      const res = await fetch("../api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...action, revision: saved.revision }),
      });
      const data = await res.json();
      if (res.ok || res.status === 409) {
        saved = data;
        draw(res.ok ? clearForm : undefined);
      }
      status.textContent = res.ok ? "" : messages[data.error] || messages.network;
      return res.ok;
    } catch {
      status.textContent = messages.network;
      return false;
    } finally {
      busy = false;
      screen.inert = false;
    }
  }
  void load();
  window.addEventListener("focus", load);
  return () => {
    if (saved && !busy) draw();
  };
}

export function form(id, submitLabel, action, ...fields) {
  const form = node(
    "form",
    { id },
    ...fields,
    node("button", { type: "submit", className: "wb-primary" }, submitLabel),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    void action(data, id);
  };
  return form;
}
