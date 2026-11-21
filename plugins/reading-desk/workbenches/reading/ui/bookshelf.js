import { S, sample } from "./strings.js";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};

const coverUrls = new WeakMap();

function cover(book) {
  const node = element("span", "book-cover");
  node.setAttribute("aria-hidden", "true");
  const fallback = () => {
    let hue = 0;
    for (const letter of book.title) hue = (hue + letter.codePointAt(0)) % 3;
    node.dataset.hue = String(hue);
    node.replaceChildren(element("span", "cover-letter", [...book.title.trim()][0]));
  };
  if (book.cover) {
    if (!coverUrls.has(book.cover)) {
      const image = new Blob([book.cover.bytes], { type: book.cover.type });
      coverUrls.set(book.cover, URL.createObjectURL(image));
    }
    const image = element("img", "cover-image");
    image.alt = "";
    image.onerror = fallback;
    image.src = coverUrls.get(book.cover);
    node.append(image);
  } else {
    fallback();
  }
  return node;
}

export function readingPercent(book, pos) {
  if (!pos) return 0;
  return Math.min(
    100,
    Math.round((100 * (pos.chapter + (pos.fits ? 1 : pos.ratio))) / book.chapters.length),
  );
}

export function showBookshelf(books, positions, last, open) {
  const $ = (id) => document.getElementById(id);
  const position = positions.get(last.id);
  const chapter = last.chapters[position?.chapter] || last.chapters[0];
  const resume = element("button", "resume-book");
  resume.type = "button";
  resume.onclick = () => open(last);
  const detail = element("span", "resume-detail");
  const startLabel = last.id === sample.id ? S.openSample : S.startReading;
  detail.append(
    element("span", "resume-label", position ? S.resume : startLabel),
    element("strong", "resume-title", last.title),
    element("span", "resume-chapter", chapter.title),
    element("span", "resume-excerpt", chapter.paragraphs[position?.paragraph || 0]),
  );
  const arrow = element("span", "resume-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  resume.append(cover(last), detail, arrow);
  $("resume-book").replaceChildren(resume);

  const sorted = [...books].sort(
    (a, b) =>
      (positions.get(b.id)?.opened || b.imported || 0) -
      (positions.get(a.id)?.opened || a.imported || 0),
  );
  const render = () => {
    const query = $("book-search").value.trim().toLocaleLowerCase();
    const matching = sorted.filter((book) =>
      [book.title, book.author || ""].some((name) => name.toLocaleLowerCase().includes(query)),
    );
    $("book-count").textContent = String(matching.length);
    $("search-empty").hidden = matching.length > 0;
    $("books").replaceChildren(
      ...matching.map((book) => {
        const current = positions.get(book.id);
        const button = element("button", "shelf-book");
        button.type = "button";
        const name = element("span", "shelf-detail");
        name.append(element("strong", "shelf-title", book.title));
        name.append(
          element(
            "span",
            "shelf-meta",
            [book.author, S.chapters(book.chapters.length)].filter(Boolean).join(" · "),
          ),
        );
        const progress = element(
          "span",
          "shelf-progress",
          current ? readingPercent(book, current) + "%" : S.unread,
        );
        if (current) {
          const bar = element("progress", "");
          bar.max = 100;
          bar.value = readingPercent(book, current);
          bar.setAttribute("aria-hidden", "true");
          progress.append(bar);
        }
        button.append(cover(book), name, progress);
        button.onclick = () => open(book);
        return button;
      }),
    );
  };
  $("book-search").oninput = render;
  render();
}
