import { deckTemplates, templateDeck } from "./templates.js";
import { S, locale } from "./strings.js";

const $ = (id) => document.getElementById(id);

// Starters contain native rects and plain text. Both the gallery and the preview read the
// actual slide positions, colors and copy; creating the file uses the same slide objects.
function paint(sheet, page) {
  sheet.style.backgroundColor = page.background;
  sheet.replaceChildren(
    ...page.elements.map((item) => {
      const node = document.createElement("span");
      Object.assign(node.style, {
        left: item.x / 12.8 + "%",
        top: item.y / 7.2 + "%",
        width: item.w / 12.8 + "%",
        height: item.h / 7.2 + "%",
      });
      if (item.type === "shape") {
        node.style.backgroundColor = item.fill;
      } else {
        node.textContent = item.html
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&");
        Object.assign(node.style, {
          color: item.color,
          fontSize: item.fontSize / 12.8 + "cqw",
          fontWeight: item.fontWeight,
          lineHeight: item.lineHeight,
        });
      }
      return node;
    }),
  );
}

export function setupTemplatePicker({ blankDeck, createDeck }) {
  const templates = deckTemplates(locale);
  const layout = $("create-layout"),
    name = $("create-name"),
    dialog = $("create-dialog");
  const form = $("create-form"),
    submit = form.querySelector('[type="submit"]');
  let page = 0;
  let previousDefault = "";
  const selection = () => templates.find((item) => item.id === layout.value);
  const build = () => {
    const item = selection(),
      title = name.value.trim() || item?.title || S.untitled;
    return item ? templateDeck(locale, item.id, title) : blankDeck(title);
  };
  function preview() {
    const current = selection();
    $("template-preview").hidden = !current;
    if (!current) return;
    const { slides } = build(),
      selected = slides[page];
    paint($("preview-sheet"), selected);
    const heading = selected.elements.find((item) => item.role === "title");
    const slideTitle = page === 0 ? name.value.trim() || current.title : heading.html;
    $("preview-caption").textContent = S.contextSlide(page + 1, slides.length) + " · " + slideTitle;
    $("preview-prev").disabled = page === 0;
    $("preview-next").disabled = page === slides.length - 1;
  }
  function select() {
    const nextDefault = selection()?.title ?? S.untitled;
    if (!name.value.trim() || name.value === previousDefault) name.value = nextDefault;
    previousDefault = nextDefault;
    page = 0;
    preview();
  }
  function open(key) {
    name.value = "";
    layout.value = key;
    $("create-error").textContent = "";
    select();
    dialog.showModal();
    name.select();
  }
  for (const item of templates) {
    layout.add(new Option(item.label, item.id));
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.template = item.id;
    const sheet = document.createElement("span");
    sheet.className = "template-sheet slide-preview";
    sheet.setAttribute("aria-hidden", "true");
    const { slides } = templateDeck(locale, item.id, item.title);
    paint(sheet, slides[0]);
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(sheet, label);
    button.onclick = () => open(item.id);
    $("templates").append(button);
  }
  $("start-blank").onclick = $("new").onclick = () => open("blank");
  layout.onchange = select;
  name.oninput = preview;
  $("preview-prev").onclick = () => {
    page--;
    preview();
  };
  $("preview-next").onclick = () => {
    page++;
    preview();
  };
  $("create-cancel").onclick = () => dialog.close();
  dialog.addEventListener("cancel", (event) => {
    if (submit.disabled) event.preventDefault();
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (!name.value.trim()) return name.focus();
    const doc = build();
    $("create-error").textContent = "";
    for (const control of [submit, name, layout, $("create-cancel")]) control.disabled = true;
    try {
      await createDeck(doc.title, doc);
      dialog.close();
    } catch {
      $("create-error").textContent = S.createFailed;
    } finally {
      for (const control of [submit, name, layout, $("create-cancel")]) control.disabled = false;
    }
  };
}
