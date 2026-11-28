import type { DocBlock, ParsedDoc } from "./types.js";

export function slugOf(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function cleanTypeWs(src: string): string {
  return src
    .replace(/\s+/g, " ")
    .replace(/([<([]+)\s+/g, "$1")
    .replace(/\s+([>)\],;])/g, "$1")
    .trim();
}

export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { order: string[]; groups: Map<string, T[]> } {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) {
      list.push(item);
    } else {
      order.push(key);
      groups.set(key, [item]);
    }
  }
  return { order, groups };
}

const TAG_RE =
  /^@(param|returns?|see|example|deprecated|remarks|throws|category|group|internal|publicApi|experimental)\b\s*(.*)$/;

/** Parse a leading JSDoc block into structured paragraphs, lists, fenced/indented code, and @tags. */
export function parseJsDocBlocks(raw: string): DocBlock[] {
  const inner = raw.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  const rawLines = inner
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").replace(/\s+$/, ""));

  while (rawLines.length > 0 && rawLines[0]?.trim() === "") rawLines.shift();
  while (rawLines.length > 0 && rawLines[rawLines.length - 1]?.trim() === "") rawLines.pop();

  const blocks: DocBlock[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || "ts";
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !(rawLines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(rawLines[i] ?? "");
        i++;
      }
      if (i < rawLines.length) i++;
      blocks.push({ kind: "code", lang, code: codeLines.join("\n").replace(/^\n+|\n+$/g, "") });
      continue;
    }

    if (/^  \S/.test(line) && !/^\s*[-*]\s+/.test(line)) {
      const codeLines: string[] = [];
      while (i < rawLines.length) {
        const cur = rawLines[i] ?? "";
        if (cur.trim() !== "" && !/^  /.test(cur)) break;
        codeLines.push(cur.replace(/^  /, ""));
        i++;
      }
      while (codeLines.length > 0 && codeLines[codeLines.length - 1]?.trim() === "") {
        codeLines.pop();
      }
      blocks.push({ kind: "code", lang: "ts", code: codeLines.join("\n") });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < rawLines.length) {
        const cur = (rawLines[i] ?? "").trim();
        if (!/^[-*]\s+/.test(cur)) break;
        let item = cur.replace(/^[-*]\s+/, "");
        i++;
        while (i < rawLines.length) {
          const cont = (rawLines[i] ?? "").trim();
          if (!cont || /^[-*]\s+/.test(cont) || cont.startsWith("```") || /^@\w+/.test(cont)) break;
          item += ` ${cont}`;
          i++;
        }
        items.push(item);
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    const tagMatch = trimmed.match(TAG_RE);
    if (tagMatch) {
      const tag = tagMatch[1] ?? "";
      let text = tagMatch[2] ?? "";
      i++;
      while (i < rawLines.length) {
        const cont = (rawLines[i] ?? "").trim();
        if (!cont || /^@\w+/.test(cont) || cont.startsWith("```") || /^[-*]\s+/.test(cont)) break;
        text += text ? ` ${cont}` : cont;
        i++;
      }
      blocks.push({ kind: "tag", tag, text: text.trim() });
      continue;
    }

    const pLines: string[] = [];
    while (i < rawLines.length) {
      const curRaw = rawLines[i] ?? "";
      const cur = curRaw.trim();
      if (
        !cur ||
        cur.startsWith("```") ||
        /^[-*]\s+/.test(cur) ||
        TAG_RE.test(cur) ||
        (/^  \S/.test(curRaw) && pLines.length === 0)
      ) {
        break;
      }
      pLines.push(cur);
      i++;
    }
    if (pLines.length > 0) blocks.push({ kind: "p", text: pLines.join(" ") });
  }

  return blocks;
}

export function blocksToPlainParas(blocks: readonly DocBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "p") out.push(b.text);
    else if (b.kind === "ul") out.push(...b.items.map((x) => `• ${x}`));
    else if (b.kind === "tag") out.push(`@${b.tag} ${b.text}`);
  }
  return out;
}

export function parsedDocFromRaw(raw: string): ParsedDoc {
  const docBlocks = parseJsDocBlocks(raw);
  return { doc: blocksToPlainParas(docBlocks), docBlocks };
}

export const EMPTY_DOC: ParsedDoc = { doc: [], docBlocks: [] };
