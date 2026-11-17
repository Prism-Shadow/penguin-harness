import { all, get, remove, save } from "./library.js";
import { importBook } from "./import.js";
import { S, sample, zh } from "./strings.js";
const $ = (id) => document.getElementById(id);
const el = (tag, text, props = {}) =>
  Object.assign(document.createElement(tag), { textContent: text }, props);
document.documentElement.lang = zh ? "zh-CN" : "en";
document.title = S.desk;
document.querySelectorAll("[data-t]").forEach((node) => (node.textContent = S[node.dataset.t]));
for (const [id, label] of [
  ["smaller", S.smaller],
  ["larger", S.larger],
  ["progress", S.resume],
  ["file", S.pick],
])
  $(id).setAttribute("aria-label", label);
let books = [],
  notes = [],
  book,
  chapter = 0,
  font = 19,
  selected = null,
  generation = 0,
  positionTimer,
  toastTimer,
  restoring = false;
function notify(text) {
  clearTimeout(toastTimer);
  $("status").hidden = false;
  $("status").textContent = text;
  toastTimer = setTimeout(() => {
    $("status").hidden = true;
  }, 3200);
}
async function persist(store, row) {
  try {
    await save(store, row);
  } catch {
    notify(S.localError);
  }
}
function position() {
  const page = $("page"),
    total = page.scrollHeight - page.clientHeight;
  return { id: book.id, chapter, ratio: total > 0 ? page.scrollTop / total : 0 };
}
function percentage() {
  const p = position();
  const value = Math.round(
    (100 * (chapter + (p.ratio || ($("page").scrollHeight <= $("page").clientHeight ? 1 : 0)))) /
      book.chapters.length,
  );
  $("progress").value = value;
  $("percent").textContent = value + "%";
}
function keepPosition() {
  if (!book || restoring) return;
  clearTimeout(positionTimer);
  void persist("positions", position());
}
$("page").onscroll = () => {
  if (!book || restoring) return;
  percentage();
  clearTimeout(positionTimer);
  positionTimer = setTimeout(keepPosition, 150);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) keepPosition();
});
window.addEventListener("pagehide", keepPosition);
function closeShelf() {
  document.body.dataset.shelf = "closed";
  $("toggle-shelf").setAttribute("aria-expanded", "false");
}
$("toggle-shelf").onclick = () => {
  const open = document.body.dataset.shelf !== "open";
  document.body.dataset.shelf = open ? "open" : "closed";
  $("toggle-shelf").setAttribute("aria-expanded", String(open));
};
function row(label, active, run, leading) {
  const button = el("button", "");
  if (leading) button.append(leading);
  button.append(el("span", label));
  button.onclick = run;
  button.setAttribute("aria-current", String(active));
  return button;
}
function drawShelf() {
  $("books").replaceChildren(
    ...books.map((b) =>
      row(b.title, b.id === book.id, () => void openBook(b), el("i", "", { className: "spine" })),
    ),
  );
  $("chapters").replaceChildren(
    ...book.chapters.map((c, i) =>
      row(
        c.title,
        i === chapter,
        () => turn(i),
        el("span", String(i + 1), { className: "chapter-number" }),
      ),
    ),
  );
}
function drawText() {
  const c = book.chapters[chapter];
  const rows = c.paragraphs.map((text, i) => {
    const p = el("p", "");
    p.dataset.para = String(i);
    const marks = notes
      .filter((n) => n.book === book.id && n.chapter === chapter && n.para === i)
      .sort((a, b) => a.start - b.start);
    let offset = 0;
    for (const mark of marks) {
      const start = Math.max(offset, mark.start);
      if (start >= mark.end) continue;
      p.append(text.slice(offset, start), el("mark", text.slice(start, mark.end)));
      offset = mark.end;
    }
    p.append(text.slice(offset));
    return p;
  });
  $("paragraphs").replaceChildren(...rows);
  $("chapter-title").textContent = c.title;
  $("book-title").textContent = book.title;
  $("chapter-count").textContent = S.chapter(chapter + 1, book.chapters.length);
  $("previous").disabled = chapter === 0;
  $("next").disabled = chapter === book.chapters.length - 1;
}
function draw(ratio) {
  const version = ++generation;
  clearTimeout(positionTimer);
  restoring = true;
  selected = null;
  $("highlight").disabled = true;
  drawShelf();
  drawText();
  closeShelf();
  const page = $("page");
  page.scrollTop = ratio * (page.scrollHeight - page.clientHeight);
  percentage();
  requestAnimationFrame(() => {
    if (version === generation) {
      restoring = false;
      keepPosition();
    }
  });
}
async function openBook(next) {
  keepPosition();
  const version = ++generation;
  const old = await get("positions", next.id);
  if (version !== generation) return;
  book = next;
  chapter = Math.max(0, Math.min(old?.chapter || 0, next.chapters.length - 1));
  draw(old?.ratio || 0);
  void persist("settings", { id: "last", book: next.id });
}
function turn(index) {
  chapter = index;
  draw(0);
}
$("previous").onclick = () => turn(chapter - 1);
$("next").onclick = () => turn(chapter + 1);
function resize(value) {
  const ratio = book ? position().ratio : 0;
  font = Math.min(28, Math.max(15, value));
  document.documentElement.style.setProperty("--size", font + "px");
  $("larger").disabled = font >= 28;
  $("smaller").disabled = font <= 15;
  if (book) {
    $("page").scrollTop = ratio * ($("page").scrollHeight - $("page").clientHeight);
    percentage();
  }
}
for (const [id, delta] of [
  ["smaller", -2],
  ["larger", 2],
])
  $(id).onclick = () => {
    resize(font + delta);
    void persist("settings", { id: "font", size: font });
  };
$("import-open").onclick = () => {
  $("import-status").textContent = "";
  $("import").showModal();
};
$("file").onchange = async () => {
  const file = $("file").files[0];
  if (!file) return;
  $("file").disabled = true;
  $("import-status").textContent = S.busy;
  try {
    const imported = await importBook(file);
    await save("books", imported);
    books.unshift(imported);
    await openBook(imported);
    $("import").close();
  } catch (err) {
    $("import-status").textContent = S[err.message] || S.invalidFile;
  } finally {
    $("file").value = "";
    $("file").disabled = false;
  }
};
function paragraphNode(node) {
  return (node?.nodeType === 1 ? node : node?.parentElement)?.closest("#paragraphs > p");
}
document.addEventListener("selectionchange", () => {
  const selection = getSelection();
  selected = null;
  if (selection.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0),
      paragraph = paragraphNode(range.startContainer);
    if (paragraph && paragraph === paragraphNode(range.endContainer) && range.toString().trim()) {
      const prefix = document.createRange();
      prefix.selectNodeContents(paragraph);
      prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      selected = {
        id: crypto.randomUUID(),
        book: book.id,
        chapter,
        para: Number(paragraph.dataset.para),
        start,
        end: start + range.toString().length,
        quote: range.toString(),
        comment: "",
      };
    }
  }
  $("highlight").disabled = !selected;
});
$("highlight").onpointerdown = (e) => e.preventDefault();
$("highlight").onclick = async () => {
  if (!selected) return notify(S.selected);
  const note = selected;
  try {
    await save("notes", note);
  } catch {
    return notify(S.localError);
  }
  notes.push(note);
  getSelection().removeAllRanges();
  drawText();
  notify(S.saved);
};
function renderNotes() {
  const items = notes.filter((n) => n.book === book.id);
  $("download").disabled = !items.length;
  $("notes").replaceChildren(
    ...items.map((n) => {
      const entry = el("section", "", { className: "entry" });
      const jump = el("button", S.jump);
      jump.onclick = () => {
        $("notebook").close();
        turn(n.chapter);
        $("paragraphs").children[n.para]?.scrollIntoView({ block: "center" });
      };
      const field = el("textarea", "", { value: n.comment, placeholder: S.comment });
      field.setAttribute("aria-label", S.comment);
      const submit = el("button", S.save);
      submit.disabled = true;
      field.oninput = () => {
        submit.disabled = field.value === n.comment;
      };
      submit.onclick = async () => {
        const updated = { ...n, comment: field.value };
        try {
          await save("notes", updated);
        } catch {
          return notify(S.localError);
        }
        n.comment = updated.comment;
        submit.disabled = true;
        submit.textContent = S.saved;
      };
      const del = el("button", S.remove);
      del.onclick = async () => {
        try {
          await remove("notes", n.id);
        } catch {
          return notify(S.localError);
        }
        notes = notes.filter((note) => note.id !== n.id);
        renderNotes();
        drawText();
      };
      const actions = el("div", "", { className: "tools" });
      actions.append(submit, jump, del);
      entry.append(
        el("small", book.chapters[n.chapter].title),
        el("blockquote", n.quote),
        field,
        actions,
      );
      return entry;
    }),
  );
  if (!items.length) $("notes").append(el("p", S.empty));
}
$("notes-open").onclick = () => {
  renderNotes();
  $("notebook").showModal();
};
$("download").onclick = () => {
  const text = [`# ${book.title}`];
  for (const n of notes.filter((n) => n.book === book.id))
    text.push(
      `## ${book.chapters[n.chapter].title}`,
      n.quote
        .split("\n")
        .map((line) => "> " + line)
        .join("\n"),
      n.comment,
    );
  const url = URL.createObjectURL(
    new Blob([text.join("\n\n")], { type: "text/markdown;charset=utf-8" }),
  );
  const link = el("a", "", { href: url, download: book.title + " - " + S.notes + ".md" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
async function start() {
  const [local, entries, last, size] = await Promise.all([
    all("books"),
    all("notes"),
    get("settings", "last"),
    get("settings", "font"),
  ]);
  books = [...local.sort((a, b) => b.imported - a.imported), sample];
  notes = entries;
  resize(size?.size || 19);
  await openBook(books.find((b) => b.id === last?.book) || books[0]);
}
void start().catch(() => notify(S.localError));
