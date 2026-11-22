import { appUrl, install, request, token, verify } from "./install.js";
import { words } from "./strings.js";
import * as sdk from "../sdk/workbench.js";

const $ = (id) => document.getElementById(id);
function language() {
  try {
    return parent.document.documentElement.lang || navigator.language;
  } catch {
    return navigator.language;
  }
}
const lang = language().startsWith("zh") ? "zh" : "en",
  w = words[lang];
document.documentElement.lang = lang;
const storageKey = "first-workbench-guide:" + location.pathname;
let saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") ?? { key: token() };
let guide = null,
  defaultModel = null,
  busy = false,
  loading = true,
  notice = "",
  timer;
function save() {
  sessionStorage.setItem(storageKey, JSON.stringify(saved));
}
save();
function el(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
function message(error) {
  return (
    {
      "invalid-design": w.invalid,
      "load-failed": w.load,
      "wrong-board": w.wrong,
      "test-failed": w.testFailed,
      "empty-reply": w.empty,
    }[error] ||
    error ||
    w.failed
  );
}
function render() {
  const phase = guide?.phase,
    working = phase === "chatting" || phase === "generating",
    blocked = busy || loading;
  const locked = !!guide && phase !== "chat-error",
    ready = phase === "ready";
  $("model").textContent = saved.model
    ? w.selected(saved.model.label || saved.model.modelId)
    : defaultModel
      ? w.found(defaultModel.label)
      : w.unconfigured;
  $("settings").classList.toggle("wb-primary", !saved.model && !defaultModel);
  $("choose").classList.toggle("wb-primary", !saved.model && !!defaultModel);
  $("send").classList.toggle("wb-primary", !!saved.model && !locked);
  $("generate").classList.toggle("wb-primary", !!guide?.answer && !ready);
  $("install").classList.toggle("wb-primary", ready && !saved.installed);
  $("test").classList.toggle("wb-primary", !!saved.installed && !saved.verified);
  $("settings").disabled = blocked || locked;
  $("choose").disabled = blocked || locked;
  $("request").disabled = blocked || locked;
  $("send").disabled = blocked || locked || !saved.model || !$("request").value.trim();
  $("send").textContent = phase === "chat-error" ? w.retry : w.send;
  $("answer").textContent = guide?.answer ?? "";
  $("design-section").hidden = !guide?.answer;
  $("design-form").hidden = ready;
  $("generate").disabled = blocked || working;
  $("feedback").disabled = blocked || working;
  $("preview").replaceChildren();
  if (ready) {
    $("preview").append(el("h3", guide.design.title));
    for (const group of new Set(guide.design.items.map((i) => i.group))) {
      const list = el("ul", "");
      $("preview").append(el("h3", group), list);
      for (const item of guide.design.items.filter((i) => i.group === group)) {
        const li = el("li", item.task);
        li.append(el("small", item.doneWhen));
        list.append(li);
      }
    }
  }
  $("install-section").hidden = !ready;
  $("install").disabled = blocked || !!saved.installed;
  if (ready) $("export").href = endpoint() + "/plugin.zip";
  $("test").disabled = blocked || !saved.installed;
  $("open").hidden = !saved.installed;
  if (saved.installed && guide)
    $("open").href = appUrl(guide.boardId) || "../../" + guide.boardId + "/ui/index.html";
  $("restart").hidden = !guide || working;
  $("restart").disabled = blocked;
  $("status").textContent =
    notice ||
    (working
      ? phase === "chatting"
        ? w.chatting
        : w.generating
      : guide?.error
        ? message(guide.error)
        : saved.verified
          ? w.verified
          : saved.installed
            ? w.installed
            : "");
}
for (const [id, text] of Object.entries({
  title: w.title,
  intro: w.intro,
  "model-title": w.modelTitle,
  settings: w.settings,
  choose: w.choose,
  "chat-title": w.chatTitle,
  "design-title": w.designTitle,
  generate: w.generate,
  "install-title": w.installTitle,
  "install-info": w.installInfo,
  install: w.install,
  export: w.export,
  test: w.test,
  open: w.open,
  restart: w.restart,
}))
  $(id).textContent = text;
document.title = w.title;
document.querySelector("label[for=request]").textContent = w.request;
document.querySelector("label[for=feedback]").textContent = w.feedback;
$("request").placeholder = w.placeholder;
$("request").value = saved.request || "";
$("feedback").value = saved.feedback || "";
for (const id of ["request", "feedback"])
  $(id).oninput = () => {
    saved[id] = $(id).value;
    save();
    render();
  };
async function run(fn) {
  if (busy) return;
  busy = true;
  notice = "";
  render();
  try {
    await fn();
  } catch (error) {
    notice = error.name === "WorkbenchHostUnavailable" ? w.unavailable : message(error.message);
  } finally {
    busy = false;
    render();
    schedule();
  }
}
const endpoint = () => "../api/guides/" + saved.key;
function schedule() {
  clearTimeout(timer);
  if (!document.hidden && (guide?.phase === "chatting" || guide?.phase === "generating"))
    timer = setTimeout(() => run(refresh), 1400);
}
async function refresh() {
  guide = await request(endpoint());
  if (guide) {
    saved.model =
      guide.model.provider === saved.model?.provider && guide.model.modelId === saved.model?.modelId
        ? saved.model
        : guide.model;
    $("request").value = guide.request;
  }
  save();
}
$("settings").onclick = () =>
  run(async () => {
    if (typeof sdk.openModelSettings !== "function") {
      notice = w.unavailable;
      return;
    }
    await sdk.openModelSettings();
  });
$("choose").onclick = () =>
  run(async () => {
    const choice = await sdk.chooseChatModel(saved.model);
    if (choice) {
      saved.model = choice;
      save();
    }
  });
$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    guide = await request(endpoint(), {
      action: "chat",
      model: saved.model,
      request: $("request").value.trim(),
      lang,
    });
  });
};
$("design-form").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    guide = await request(endpoint(), { action: "generate", feedback: $("feedback").value.trim() });
  });
};
$("install").onclick = () =>
  run(async () => {
    await install(guide, await request(endpoint() + "/installation"));
    saved.installed = true;
    save();
  });
$("test").onclick = () =>
  run(async () => {
    saved.verified = false;
    save();
    await verify(guide, w.testItem);
    saved.verified = true;
    save();
  });
$("restart").onclick = () => {
  saved = { key: token(), model: saved.model };
  save();
  guide = null;
  notice = "";
  $("request").value = "";
  $("feedback").value = "";
  render();
};
document.addEventListener("visibilitychange", schedule);
render();
try {
  await refresh();
  if (saved.installed && !guide) {
    saved.installed = false;
    saved.verified = false;
    save();
  }
  if (saved.installed) {
    const board = await request("../../" + guide.boardId + "/api/board").catch(() => null);
    if (board?.id !== guide.boardId) {
      saved.installed = false;
      saved.verified = false;
      save();
    }
  }
  if (!saved.model) defaultModel = await sdk.getChatModel();
} catch (error) {
  notice = message(error.message);
} finally {
  loading = false;
  render();
  schedule();
}
