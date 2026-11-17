// Text stays in this browser. EPUB and Word archives are read entry by entry in memory.
const LIMIT = 32 * 1024 * 1024;
const decoder = new TextDecoder();
const chapterHeading =
  /^(?:#{1,3}\s+|第[零〇一二三四五六七八九十百千万\d]+[章节回卷篇部]|(?:chapter|part)\s+(?:\d+|[ivxlcdm]+)\b)/i;

export function chaptersFromText(text, title) {
  const chapters = [];
  let chapter = { title, paragraphs: [] };
  let paragraph = [];
  function endParagraph() {
    if (paragraph.length)
      chapter.paragraphs.push(
        paragraph.join(" ").replace(/([\p{Script=Han}]) (?=[\p{Script=Han}])/gu, "$1"),
      );
    paragraph = [];
  }
  function endChapter() {
    endParagraph();
    if (chapter.paragraphs.length) chapters.push(chapter);
  }
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line) endParagraph();
    else if (line.length <= 140 && chapterHeading.test(line)) {
      endChapter();
      chapter = { title: line.replace(/^#{1,3}\s+/, ""), paragraphs: [] };
    } else {
      paragraph.push(line);
      if (/[。！？.!?][”’"']?$/.test(line)) endParagraph();
    }
  }
  endChapter();
  if (!chapters.length && text.trim()) chapters.push({ title, paragraphs: [text.trim()] });
  return chapters;
}

function archive(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50)
    end--;
  if (end < Math.max(0, bytes.length - 65557)) throw new Error("invalidFile");
  const entries = new Map();
  let p = view.getUint32(end + 16, true);
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("invalidFile");
    const nameLength = view.getUint16(p + 28, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(p + 10, true),
      compressed: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      local: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  let readBytes = 0;
  return async function read(name) {
    const entry = entries.get(name);
    if (!entry) throw new Error("invalidFile");
    const { method, compressed, size, local } = entry;
    if (size > LIMIT - readBytes) throw new Error("tooLarge");
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("invalidFile");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) throw new Error("invalidFile");
    const data = bytes.subarray(start, start + compressed);
    if (method === 0 && compressed === size) {
      readBytes += size;
      return decoder.decode(data);
    }
    if (method !== 8) throw new Error("invalidFile");
    const reader = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader();
    const out = new Uint8Array(size);
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > size) {
        await reader.cancel();
        throw new Error("invalidFile");
      }
      out.set(value, at);
      at += value.length;
    }
    if (at !== size) throw new Error("invalidFile");
    readBytes += size;
    return decoder.decode(out);
  };
}
const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
const tags = (node, name) => [...node.getElementsByTagNameNS("*", name)];
const content = (node) => node?.textContent.trim() || "";
const basename = (name) => name.replace(/\.[^.]+$/, "");

async function epub(read, name) {
  const root = xml(await read("META-INF/container.xml"));
  const path = tags(root, "rootfile")[0]?.getAttribute("full-path");
  if (!path) throw new Error("invalidFile");
  const opf = xml(await read(path));
  const items = new Map(tags(opf, "item").map((e) => [e.getAttribute("id"), e]));
  const chapters = [];
  for (const ref of tags(opf, "itemref")) {
    const item = items.get(ref.getAttribute("idref"));
    if (!item || !/x?html/.test(item.getAttribute("media-type") || "")) continue;
    const resolved = new URL(item.getAttribute("href"), new URL(path, "https://epub.invalid/"));
    if (resolved.origin !== "https://epub.invalid") continue;
    const doc = xml(await read(decodeURIComponent(resolved.pathname.slice(1))));
    const body = tags(doc, "body")[0];
    if (!body) continue;
    for (const tag of ["style", "script", "nav"]) tags(body, tag).forEach((e) => e.remove());
    const heading = body.querySelector("h1,h2,h3");
    const paragraphs = [...body.querySelectorAll("p,li,blockquote,h2,h3")]
      .filter((e) => e !== heading && !e.querySelector("p,li,blockquote"))
      .map(content)
      .filter(Boolean);
    if (!paragraphs.length && content(body)) paragraphs.push(content(body));
    if (paragraphs.length)
      chapters.push({ title: content(heading) || String(chapters.length + 1), paragraphs });
  }
  return {
    title: content(tags(opf, "title")[0]) || basename(name),
    author: content(tags(opf, "creator")[0]),
    chapters,
  };
}
export async function importBook(file) {
  if (file.size > LIMIT) throw new Error("tooLarge");
  const bytes = await file.arrayBuffer();
  const title = basename(file.name);
  let book;
  if (/\.epub$/i.test(file.name)) book = await epub(archive(bytes), file.name);
  else if (/\.docx$/i.test(file.name)) {
    const doc = xml(await archive(bytes)("word/document.xml"));
    const text = tags(doc, "p")
      .map((p) =>
        tags(p, "t")
          .map((t) => t.textContent)
          .join(""),
      )
      .join("\n\n");
    book = { title, chapters: chaptersFromText(text, title) };
  } else if (/\.(?:txt|md|markdown)$/i.test(file.name)) {
    let text = decoder.decode(bytes);
    if ((text.match(/\uFFFD/g) || []).length > text.length * 0.01)
      text = new TextDecoder("gb18030").decode(bytes);
    book = { title, chapters: chaptersFromText(text, title) };
  } else throw new Error("format");
  if (!book.chapters.length) throw new Error("noText");
  return { ...book, id: crypto.randomUUID(), imported: Date.now() };
}
