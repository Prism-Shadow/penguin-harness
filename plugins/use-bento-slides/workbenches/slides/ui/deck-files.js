// Saved presentations always come from the Agent's deck collection. Only the open dialog is local.
import { S, locale } from "./strings.js";

const labels =
  locale === "zh"
    ? {
        title: "演示文稿",
        recent: "最近编辑",
        modified: "上次修改",
        name: "文稿名称",
        sample: "示例文稿",
        open: "打开 Bento HTML / JSON…",
        rename: "重命名",
        remove: "删除",
        importHint: "打开 Bento JSON 或 HTML 演示文稿",
        ai: "使用 AI 创建",
        empty: "还没有保存的演示文稿。",
        loading: "正在读取演示文稿…",
        failed: "无法读取演示文稿。",
        retry: "重试",
        editFailed: "无法保存新名称，请重试。",
        conflict: "这份文稿刚刚被修改。请重新打开重命名。",
        save: "保存名称",
        removeHeading: "删除演示文稿？",
        removeBody: (title) => `将删除《${title}》及其版本历史。`,
        returnHome: "返回文稿列表",
        openFailed: "无法打开文稿，请重试。",
      }
    : {
        title: "Presentations",
        recent: "Recently edited",
        modified: "Last modified",
        name: "Presentation name",
        sample: "Sample presentation",
        open: "Open Bento HTML / JSON…",
        rename: "Rename",
        remove: "Delete",
        importHint: "Open a Bento JSON or HTML presentation",
        ai: "Create with AI",
        empty: "No saved presentations yet.",
        loading: "Loading presentations…",
        failed: "Couldn’t load presentations.",
        retry: "Retry",
        editFailed: "Couldn’t save the new name. Try again.",
        conflict: "This presentation has changed. Reopen Rename to use its latest version.",
        save: "Save name",
        removeHeading: "Delete presentation?",
        removeBody: (title) => `“${title}” and its version history will be deleted.`,
        returnHome: "Back to presentations",
        openFailed: "Couldn’t open the presentation. Try again.",
      };
const dates = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const $ = (id) => document.getElementById(id);
const action = (label, hint = label) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", hint);
  return button;
};

export function deckFiles({ onOpen, onRename, onDelete, onRefresh, onBack }) {
  for (const node of document.querySelectorAll("[data-files-copy]"))
    node.textContent = labels[node.dataset.filesCopy];
  $("show-decks").textContent = labels.returnHome;
  $("show-decks").onclick = onBack;
  $("start-import").title = labels.importHint;
  $("retry-decks").onclick = onRefresh;
  const dialog = $("deck-action");
  let target = null;
  let busy = false;

  function edit(deck, mode) {
    target = { deck, mode };
    $("deck-action-title").textContent = mode === "rename" ? labels.rename : labels.removeHeading;
    $("rename-field").hidden = mode !== "rename";
    $("remove-message").hidden = mode !== "delete";
    $("remove-message").textContent = labels.removeBody(deck.title);
    $("rename-title").value = deck.title;
    $("deck-action-message").textContent = "";
    $("confirm-deck-action").textContent = mode === "rename" ? labels.save : labels.remove;
    dialog.showModal();
    if (mode === "rename") {
      $("rename-title").focus();
      $("rename-title").select();
    } else $("cancel-deck-action").focus();
  }
  $("cancel-deck-action").onclick = () => dialog.close();
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    target = null;
  });
  $("deck-action-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!target || busy) return;
    const { deck, mode } = target;
    const title = $("rename-title").value.trim();
    if (mode === "rename" && !title) {
      $("rename-title").focus();
      return;
    }
    busy = true;
    $("cancel-deck-action").disabled = $("confirm-deck-action").disabled = true;
    try {
      if (mode === "rename" && title !== deck.title) await onRename(deck, title);
      if (mode === "delete") await onDelete(deck.id);
      dialog.close();
    } catch (err) {
      $("deck-action-message").textContent =
        err?.status === 409
          ? labels.conflict
          : mode === "rename"
            ? labels.editFailed
            : S.deleteFailed(String(err?.message || ""));
    } finally {
      busy = false;
      $("cancel-deck-action").disabled = $("confirm-deck-action").disabled = false;
    }
  };

  function render(decks, state) {
    const list = $("recent-decks");
    const message = $("list-message");
    message.textContent =
      state === "error"
        ? labels.failed
        : state === "loading"
          ? labels.loading
          : decks.length
            ? ""
            : labels.empty;
    $("retry-decks").hidden = state !== "error";
    // Keep the last successful listing usable through a transient read error.
    if (state !== "ready") return;
    const rows = decks.map((deck) => {
      const row = document.createElement("li");
      row.className = "file-row";
      const open = document.createElement("button");
      open.type = "button";
      open.setAttribute("aria-label", deck.title);
      open.className = "file-open";
      open.dataset.openDeck = deck.id;
      const name = document.createElement("strong");
      name.textContent = deck.title;
      const meta = document.createElement("small");
      meta.textContent = S.slides(deck.slides);
      const file = document.createElement("span");
      file.className = "file-description";
      file.append(name, meta);
      open.onclick = () => onOpen(deck.id);
      const time = document.createElement("time");
      if (Number.isFinite(deck.mtimeMs)) {
        time.dateTime = new Date(deck.mtimeMs).toISOString();
        time.textContent = dates.format(deck.mtimeMs);
      }
      const icon = document.createElement("span");
      icon.className = "slide-file-icon";
      icon.setAttribute("aria-hidden", "true");
      open.append(icon, file, time);
      const actions = document.createElement("div");
      actions.className = "file-actions";
      const rename = action(labels.rename, `${labels.rename} · ${deck.title}`);
      rename.dataset.renameDeck = deck.id;
      rename.onclick = () => edit(deck, "rename");
      const remove = action(labels.remove, `${labels.remove} · ${deck.title}`);
      remove.dataset.removeDeck = deck.id;
      remove.onclick = () => edit(deck, "delete");
      actions.append(rename, remove);
      row.append(open, actions);
      return row;
    });
    // An Agent save can reorder the list while someone is using it with the keyboard.
    const selected = list.contains(document.activeElement) ? document.activeElement : null;
    const key = selected && Object.keys(selected.dataset)[0];
    const id = key && selected.dataset[key];
    list.replaceChildren(...rows);
    if (id)
      Array.from(list.querySelectorAll("button"))
        .find((button) => button.dataset[key] === id)
        ?.focus({ preventScroll: true });
  }
  return { render, openFailed: labels.openFailed };
}
