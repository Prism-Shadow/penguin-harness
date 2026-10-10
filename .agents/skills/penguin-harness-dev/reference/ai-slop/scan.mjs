#!/usr/bin/env node
/*
  kill-ai-slop scanner — dependency-free.

  Walks a project's frontend source and greps for the code-level signals of each
  AI-slop tell (see references/detection.md). Prints a grouped report of
  file:line hits. It NEVER edits files. Every hit is a lead to confirm by
  reading the code, not a verdict.

  Usage:
    node scan.mjs [root] [--json] [--no-color]
                  [--only=01,06] [--skip=19] [--exclude=path] [--rules=extra.mjs]

  Suppressing confirmed-intentional hits, in source comments:
    deslop-ignore [ids…]            suppress hits on the same line
    deslop-ignore-next-line [ids…]  suppress hits on the next line
    deslop-ignore-file [ids…]       suppress hits in the whole file
  Without ids the directive suppresses every tell; with ids (e.g. 06 19) only those.
*/

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("-")) || ".";
const asJson = args.includes("--json");
const normalizeId = (value) => (/^\d+$/.test(value) ? value.padStart(2, "0") : value);
const flagValues = (name) =>
  args
    .filter((a) => a.startsWith(`--${name}=`))
    .flatMap((a) => a.slice(name.length + 3).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
const onlyIds = new Set(flagValues("only").map(normalizeId));
const skipIds = new Set(flagValues("skip").map(normalizeId));
const excludes = flagValues("exclude");
const rulesFiles = flagValues("rules");
const useColor =
  !args.includes("--no-color") && process.stdout.isTTY && !asJson;
// realpath both roots so the "skip the skill's own files" check still works
// when one path arrives through a symlink (macOS /var/folders vs /private/var).
const realpathOr = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const resolvedRoot = realpathOr(resolve(root));
const skillRoot = realpathOr(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const escapeTerminal = (text) => text.replace(/[\0-\x1f\x7f-\x9f]/g, (char) =>
  `\\x${char.codePointAt(0).toString(16).padStart(2, "0")}`,
);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".astro",
  ".output", ".svelte-kit", ".nuxt", "coverage", "vendor", ".cache",
  ".vercel", ".turbo",
]);
const EXTS = new Set([
  ".html", ".css", ".scss", ".sass", ".less",
  ".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs",
  ".vue", ".svelte", ".astro", ".md", ".mdx",
  ".php", ".twig",
]);

// A tell: id, human name, one-line fix, and the line patterns that flag it.
// `code` tells only look at code/style files; `copy` tells also read prose.
const TELLS = [
  { id: "01", group: "color", name: "indigo→violet gradient", fix: "one solid, chosen accent",
    patterns: [
      /from-(indigo|violet|purple|fuchsia)-\d+[\s\S]{0,60}?to-(purple|violet|fuchsia|pink)-\d+/i,
      /(linear-gradient|bg-gradient)[^;"'`]*(#6366f1|#8b5cf6|#a855f7|#7c3aed)/i,
      /shadow-(purple|violet|indigo)-\d+\/\d+/i,
    ] },
  { id: "02", group: "color", name: "gradient-clip headline", fix: "solid ink, scale up",
    patterns: [
      /bg-clip-text[\s\S]{0,40}?text-transparent|text-transparent[\s\S]{0,40}?bg-clip-text/,
      /(?:-webkit-)?background-clip:\s*text/i,
      /-webkit-text-fill-color:\s*transparent/i,
    ] },
  { id: "03", group: "color", name: "warm ‘cozy’ palette", fix: "neutral base + one warm accent",
    patterns: [
      /\b(amber|orange|stone)-(50|100|200|300)\b/i,
      /bg-\[#(?:fdf6ec|fef3e2|faf3e8|fff7ed|fdf4e3)\]/i,
      /(text|border)-amber-\d+/i,
      /text-(?:gray|slate|zinc|neutral)-(?:400|500)[^"'\n]{0,60}bg-(?:amber|stone|orange|rose|blue|indigo|green)-/i,
    ] },
  { id: "04", group: "color", name: "default semantic palette", fix: "one palette: neutrals + a couple of chosen states",
    patterns: [
      /bg-(?:blue|indigo)-50|bg-amber-50|bg-(?:green|emerald)-50|bg-red-50/i,
      /(?:info|success|warning|error)[^\n]{0,30}(?:blue|green|amber|red)-(?:50|100|500|600|700)/i,
    ] },
  { id: "05", group: "color", name: "one-hue status box", fix: "state in words; one muted accent on neutral",
    patterns: [
      /border-(red|amber|yellow|green|blue)-\d+[\s\S]{0,60}?text-\1-\d+/i,
      /bg-(?:red|amber|yellow|green)-\d+\/(?:5|10|15|20)\b/i,
      /(?:error|warning|success)[^\n]{0,40}(?:red|amber|yellow|green)-\d+/i,
    ] },
  { id: "06", group: "color", name: "gradients as atmosphere", fix: "one flat bg; depth from a hairline",
    patterns: [
      /radial-gradient/i,
      /linear-gradient[^;)]*(?:to bottom|180deg|to top)/i,
      /bg-gradient-to-[bt]\b[\s\S]{0,40}?from-/i,
      /repeating-(?:linear|radial)-gradient/i,
      /bg-gradient-to-(?:br|tr|bl|tl)\b[\s\S]{0,40}?from-(?:emerald|green|teal|cyan|purple|violet|fuchsia)-\d+\/(?:5|10|15|20|25)/i,
      /box-shadow:[^;{}]*(?:#(?:6366f1|8b5cf6|a855f7|22d3ee|06b6d4)|rgba?\(\s*(?:139|168))/i,
    ] },
  { id: "07", group: "type", name: "serif-italic emphasis", fix: "emphasise by weight, one voice",
    patterns: [
      /font-serif\b/i,
      /font-family:\s*(?:georgia|"?playfair|"?lora|"?cormorant)/i,
    ] },
  { id: "08", group: "type", name: "serif where sans belongs", fix: "one legible UI sans",
    patterns: [
      /font-family:\s*[^;]*(playfair|cormorant|lora|dm serif|libre baskerville)/i,
      /fontFamily[^;\n]*(Playfair|Cormorant|Lora)/,
      /font-serif[^"'\n]{0,60}(?:italic|text-[4-9]xl)|(?:\bitalic\b|text-[4-9]xl)[^"'\n]{0,60}font-serif/i,
    ] },
  { id: "09", group: "type", name: "decorative strikes & highlights", fix: "strike for edits, underline for links",
    patterns: [
      /\bline-through\b/i,
      /<(?:mark|s|u|del|strike)[\s>]/i,
      /text-decoration:\s*(?:line-through|underline)/i,
    ] },
  { id: "10", group: "type", name: "kicker above every heading", fix: "delete kickers that restate the heading",
    patterns: [
      /\buppercase\b[\s\S]{0,40}?tracking-(?:wide|wider|widest)\b|tracking-(?:wide|wider|widest)\b[\s\S]{0,40}?\buppercase\b/i,
      /\b(?:eyebrow|kicker|overline)\b/i,
      /text-transform:\s*uppercase[\s\S]{0,80}?letter-spacing:\s*0?\.\d+em/i,
    ] },
  { id: "11", group: "type", name: "full-sentence display headline", fix: "few words big; specifics in a subline",
    patterns: [
      /\btext-(?:5|6|7|8|9)xl\b/,
      /tracking-tighter?\b[\s\S]{0,40}?font-(?:extrabold|black)|font-(?:extrabold|black)[\s\S]{0,40}?tracking-tighter?\b/i,
      /font-size:\s*(?:[5-9]\d(?:\.\d+)?px|[4-9](?:\.\d+)?rem)/i,
      /letter-spacing:\s*-0?\.0[5-9]/i,
    ] },
  { id: "12", group: "type", name: "flat type hierarchy", fix: "few steps, ≥1.25× between them",
    patterns: [
      /<h[12][^>]*text-(?:sm|base|lg)\b/i,
    ] },
  { id: "13", group: "copy", name: "highlighted keywords", fix: "let structure carry emphasis",
    copy: true,
    patterns: [
      /<mark[\s>]/i,
      /text-(primary|indigo|purple|violet)-\d+/,
    ] },
  { id: "14", group: "copy", name: "AI copywriting voice", fix: "say the specific thing",
    copy: true,
    patterns: [
      /not just .{1,40}\bit(?:['’])?s\b/i,
      /\b(say goodbye to|meet your new|supercharge|unlock the power of|in seconds,? not)\b/i,
      /\b(blazing[- ]fast|effortless(?:ly)?|seamless(?:ly)?|game[- ]?changer|next[- ]level)\b/i,
      /\b(?:growth|security|process|privacy|productivity|compliance|feature|innovation) theater\b/i,
    ] },
  { id: "15", group: "copy", name: "emoji everywhere", fix: "cut emoji from product copy",
    copy: true,
    patterns: [
      /\p{Extended_Pictographic}/u,
    ] },
  { id: "16", group: "component", name: "glowing status dot", fix: "flat dot + a word; no halo",
    patterns: [
      /\banimate-(?:ping|pulse)\b/i,
      /shadow-(?:green|emerald|lime)-\d+\/\d+/i,
      /(?:ready|online|live)[\s\S]{0,40}?(?:●|rounded-full)/i,
    ] },
  { id: "17", group: "component", name: "left-border callout", fix: "one aside, rest is body",
    patterns: [
      /border-l-4[\s\S]{0,40}?rounded|rounded[\s\S]{0,40}?border-l-4/i,
      /\b(admonition|callout|note-box)\b/i,
      /\bborder-2\b[\s\S]{0,40}?border-(indigo|purple|violet|blue|pink|green)-\d+/i,
    ] },
  { id: "18", group: "component", name: "pastel icon tiles", fix: "labelled list with specifics",
    patterns: [
      /rounded-(lg|xl|2xl)\s+bg-(indigo|purple|blue|green|amber|pink)-(50|100)/i,
      /<svg[^>]*(?:width|height)="(?:9[6-9]|[1-9]\d{2})"/i,
    ] },
  { id: "19", group: "component", name: "max-radius / glassmorphism", fix: "one small radius, solid surfaces",
    patterns: [
      /\brounded-full\b/,
      /backdrop-blur|backdrop-filter:\s*blur|bg-(?:white|black)\/(?:5|10|20|30)/i,
      /border-radius:\s*(?:9999px|50%|2rem|24px)/i,
    ] },
  { id: "20", group: "component", name: "oversized drop shadow", fix: "tight elevation, never bigger than the element",
    patterns: [
      /box-shadow:[^;{}]*\b(?:[6-9]\d|\d{3,})px/i,
      /shadow-\[[^\]]*\b(?:[6-9]\d|\d{3,})px/i,
      /filter:[^;{}]*drop-shadow\([^)]*\b(?:[6-9]\d|\d{3,})px/i,
      /\bborder\b[\s\S]{0,40}?shadow-(?:xl|2xl)\b|shadow-(?:xl|2xl)\b[\s\S]{0,40}?\bborder\b/,
    ] },
  { id: "21", group: "component", name: "corners that don't nest", fix: "inner = outer − padding",
    patterns: [
      /\brounded-(?:xl|2xl|3xl)\b/i,
      /border-radius:\s*(?:1rem|1\.5rem|24px|32px)/i,
    ] },
  { id: "22", group: "component", name: "border dies at the corner", fix: "radius and border on the same box",
    patterns: [
      /rounded-(?:lg|xl|2xl|3xl)[^"'\n]{0,60}overflow-(?:hidden|clip)|overflow-(?:hidden|clip)[^"'\n]{0,60}rounded-(?:lg|xl|2xl|3xl)/i,
      /clip-path:\s*inset\([^)]*round/i,
      /\bborder-[trbl]\b[^"'\n]{0,60}rounded-(?:lg|xl|2xl|3xl)|rounded-(?:lg|xl|2xl|3xl)[^"'\n]{0,60}\bborder-[trbl]\b/i,
    ] },
  { id: "23", group: "component", name: "badge / pill spam", fix: "badges only for real status",
    patterns: [
      /rounded-full[\s\S]{0,40}?bg-(indigo|purple|green|amber|pink)-(50|100|200)/i,
      />\s*(?:[✨🔥🎉🚀]\s*)?(new|beta|hot|popular|pro|coming soon)\s*</i,
    ] },
  { id: "24", group: "component", name: "AI-drawn SVG icon", fix: "a real, high-quality icon (a designer, or a strong image model)",
    patterns: [
      /<circle[^>]*\br="[1-9]/i,
      /(?:mascot|blob)\.svg/i,
    ] },
  { id: "25", group: "component", name: "icon in a tint of itself", fix: "no tinted tile; inherit text color",
    patterns: [
      /bg-(indigo|blue|green|amber|red|purple|pink)-\d+\/(?:5|10|15|20)[\s\S]{0,60}?text-\1-/i,
      /text-(indigo|blue|green|amber|red|purple|pink)-\d+[\s\S]{0,60}?bg-\1-\d+\/(?:5|10|15|20)/i,
    ] },
  { id: "26", group: "motion", name: "springy hover", fix: "transition what changes, 120–200ms, standard ease",
    patterns: [
      /hover:(?:scale-1[01]\d|-translate-y-)/i,
      /\btransition-all\b/,
      /cubic-bezier\([^)]*,\s*1\.[2-9]/,
      /\banimate-bounce\b/,
      /transition:[^;{}]*\b(?:width|height|margin|padding)\b/i,
    ] },
  // Leads only — the wobble itself is visual. A centering translate near a spin
  // keyframe is the classic clobber; an off-centre transform-origin near a spin
  // animation is the other spelling of the same bug.
  { id: "27", group: "motion", name: "wobbly spinner", fix: "fixed rotation centre; keep centering out of the animated transform",
    patterns: [
      /translate\(-50%,\s*-50%\)[\s\S]{0,600}?@keyframes\s+[\w-]*(?:spin|rotate|load)/i,
      /@keyframes\s+[\w-]*(?:spin|rotate|load)[\w-]*\s*\{[\s\S]{0,160}?transform:\s*rotate\([^)]*\)\s*;?\s*\}[\s\S]{0,600}?translate\(-50%,\s*-50%\)/i,
      /(?:\banimate-spin\b|animation:[^;{}]*\b[\w-]*spin)[\s\S]{0,200}?transform-origin:\s*(?!center\b|50%\s*50%)[\w.% -]/i,
      /transform-origin:\s*(?!center\b|50%\s*50%)[\w.% -]+;[\s\S]{0,200}?(?:\banimate-spin\b|animation:[^;{}]*\b[\w-]*spin)/i,
    ] },
  { id: "28", group: "layout", name: "all-caps card grid", fix: "show the one key thing fully",
    patterns: [
      /\bgrid-cols-3\b/,
      /\buppercase\b[\s\S]{0,30}?(?:text-xs|tracking-wide)/i,
      /\b(everything you need|why (?:you.?ll love|choose|teams))\b/i,
    ] },
  { id: "29", group: "layout", name: "invented stat row", fix: "only measured, sourced numbers",
    copy: true,
    patterns: [
      /\b\d+[km]\+[\s\S]{0,30}?(?:developers|users|teams|customers|downloads|stars)/i,
      /99\.9+%/,
      /\b24\/7\b/,
    ] },
  { id: "30", group: "layout", name: "01/02/03 section markers", fix: "number only real sequences",
    patterns: [
      /['"`>]0[1-9]['"`<]/,
      /text-[789]xl[\s\S]{0,50}?(?:text-(?:gray|slate|zinc|neutral)-(?:100|200)|opacity-(?:5|10|20))/i,
      /\bstep[- ](?:one|two|three)\b/i,
    ] },
  { id: "31", group: "layout", name: "cards inside cards", fix: "one surface per region; hairlines inside",
    patterns: [
      /<(Card|Panel|Box)[^>]*>\s*<\1\b/,
    ] },
  { id: "32", group: "layout", name: "one gap everywhere", fix: "space by relationship, not by token",
    patterns: [
      /(space-y-4|gap-4)\b[\s\S]{0,120}?\b(space-y-4|gap-4)\b/,
    ] },
  { id: "33", group: "evolved", name: "Inter everywhere", fix: "compare faces; be able to say why this one",
    patterns: [
      /fonts\.googleapis\.com\/css2\?family=(?:Inter|Space\+Grotesk|Manrope|Plus\+Jakarta)/i,
      /font-family:\s*[^;]*(?:\bInter\b|Space Grotesk|Manrope|Plus Jakarta Sans|\bGeist\b)/,
      /\b(?:Inter|Space_Grotesk|Manrope|Plus_Jakarta_Sans)\b[\s\S]{0,60}?next\/font\/google|next\/font\/google[\s\S]{0,60}?\b(?:Inter|Space_Grotesk|Manrope|Plus_Jakarta_Sans)\b/,
    ] },
  { id: "34", group: "evolved", name: "tasteful-terminal", fix: "mono for code only",
    patterns: [
      /\bfont-mono\b/,
      /font-family:\s*[^;]*(?:mono|jetbrains|fira code|ibm plex mono|geist mono)/i,
      /[╔╗╚╝║═▓▒░]/,
    ] },
  // Editorial serif faces beyond tell 08's list, the greeting-as-headline, and
  // opt-in oldstyle figures — the "magazine dashboard" kit. Serif on genuinely
  // editorial surfaces (docs, essays) is not this tell; confirm before fixing.
  { id: "35", group: "evolved", name: "editorial-dashboard", fix: "sans + tabular numerals for scanned UI",
    patterns: [
      />\s*Good (?:morning|afternoon|evening),/i,
      /font-family:\s*[^;]*(?:fraunces|canela|tiempos|didot|freight|reckless|newsreader)/i,
      /oldstyle-nums|font-variant-numeric:\s*oldstyle/i,
    ] },
];

// Extra rule modules (--rules=file.mjs): each exports an array of tells shaped
// like the entries above. Patterns may be RegExp or plain strings (compiled
// case-insensitive). Lets language- or stack-specific rules live outside core.
for (const rulesPath of rulesFiles) {
  let extra;
  try {
    const mod = await import(pathToFileURL(resolve(rulesPath)).href);
    extra = mod.default ?? mod.tells;
  } catch (err) {
    console.error(`Could not load rules file ${escapeTerminal(rulesPath)}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(extra)) {
    console.error(`Rules file ${escapeTerminal(rulesPath)} must export an array of tells`);
    process.exit(1);
  }
  for (const tell of extra) {
    if (!tell || typeof tell.id !== "string" || typeof tell.name !== "string" ||
        !Array.isArray(tell.patterns) || tell.patterns.length === 0) {
      console.error(`Rules file ${escapeTerminal(rulesPath)}: each tell needs a string id, a name, and a non-empty patterns array`);
      process.exit(1);
    }
    TELLS.push({
      id: tell.id,
      group: tell.group || "custom",
      name: tell.name,
      fix: tell.fix || "",
      copy: Boolean(tell.copy),
      patterns: tell.patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p, "iu"))),
    });
  }
}

const isExcluded = (path) => {
  if (excludes.length === 0) return false;
  const rel = relative(resolvedRoot, path);
  return excludes.some((token) => rel.includes(token));
};

function walk(dir, files = []) {
  if (resolve(dir) === skillRoot) return files;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    const full = join(dir, e.name);
    if (isExcluded(full)) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || resolve(full) === skillRoot) continue;
      walk(full, files);
    } else if (e.isFile()) {
      const base = e.name;
      if (/\.min\.(js|css)$/.test(base)) continue;
      if (/(package-lock|pnpm-lock|yarn\.lock)/.test(base)) continue;
      const ext = extname(base);
      if (EXTS.has(ext) || /^tailwind\.config\./.test(base)) files.push(full);
    }
  }
  return files;
}

function scanFile(path) {
  let text;
  try {
    const st = statSync(path);
    if (st.size > 512 * 1024) return []; // skip large/generated files
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const isCode = extname(path) !== ".md";
  const lines = text.split(/\r?\n/);

  // deslop-ignore directives, parsed once per file. Ids are the tokens after
  // the directive that contain a digit ("06", "ru-14"); none means all tells.
  const parseIds = (tail) => {
    const ids = (tail.match(/[\w-]+/g) || []).filter((t) => /\d/.test(t)).map(normalizeId);
    return ids.length ? new Set(ids) : null; // null = every tell
  };
  const lineIgnores = new Map(); // lineIndex -> null (all) | Set of ids
  let fileIgnore; // undefined | null (all) | Set of ids
  const addLineIgnore = (idx, ids) => {
    if (idx < 0 || idx >= lines.length || lineIgnores.get(idx) === null) return;
    if (ids === null) return void lineIgnores.set(idx, null);
    const set = lineIgnores.get(idx) || new Set();
    for (const id of ids) set.add(id);
    lineIgnores.set(idx, set);
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/deslop-ignore(-file|-next-line)?\b(.*)$/);
    if (!m) continue;
    const ids = parseIds(m[2]);
    if (m[1] === "-file") {
      if (ids === null) fileIgnore = null;
      else if (fileIgnore !== null) {
        fileIgnore = fileIgnore || new Set();
        for (const id of ids) fileIgnore.add(id);
      }
    } else if (m[1] === "-next-line") addLineIgnore(i + 1, ids);
    else addLineIgnore(i, ids);
  }
  if (fileIgnore === null) return [];
  const isSuppressed = (id, lineIndex) => {
    if (fileIgnore && fileIgnore.has(id)) return true;
    const ig = lineIgnores.get(lineIndex);
    return ig === null || (ig !== undefined && ig.has(id));
  };

  const lineStarts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1);
  }
  const hits = [];
  const seen = new Set();
  for (const tell of TELLS) {
    if (onlyIds.size > 0 && !onlyIds.has(tell.id)) continue;
    if (skipIds.has(tell.id)) continue;
    if (!tell.copy && !isCode) continue; // code-only tell in a prose file
    for (const pattern of tell.patterns) {
      const matcher = new RegExp(pattern.source, `${pattern.flags}g`);
      let match;
      while ((match = matcher.exec(text))) {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (lineStarts[middle] <= match.index) low = middle;
          else high = middle - 1;
        }
        const lineIndex = low;
        const line = lines[lineIndex];
        if (line.length > 2000) continue; // minified-ish
        const key = `${tell.id}:${lineIndex}`;
        if (!seen.has(key) && !isSuppressed(tell.id, lineIndex)) {
          seen.add(key);
          hits.push({ tell, line: lineIndex + 1, text: line.trim().slice(0, 100) });
        }
        if (match[0] === "") matcher.lastIndex += 1;
      }
    }
  }
  return hits;
}

// ---- run ----
try {
  if (!statSync(resolvedRoot).isDirectory()) {
    throw new Error("not a directory");
  }
} catch {
  console.error(`Scan root must be an existing directory: ${escapeTerminal(root)}`);
  process.exit(1);
}

const files = walk(resolvedRoot);
const byTell = new Map(); // id -> { tell, hits: [{file,line,text}] }
for (const f of files) {
  for (const h of scanFile(f)) {
    if (!byTell.has(h.tell.id)) byTell.set(h.tell.id, { tell: h.tell, hits: [] });
    byTell.get(h.tell.id).hits.push({ file: relative(resolvedRoot, f) || f, line: h.line, text: h.text });
  }
}

const groups = [...byTell.values()].sort((a, b) => a.tell.id.localeCompare(b.tell.id));
const totalHits = groups.reduce((n, g) => n + g.hits.length, 0);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        root,
        filesScanned: files.length,
        groups: groups.length,
        hits: totalHits,
        findings: groups.map((g) => ({
          id: g.tell.id,
          group: g.tell.group,
          name: g.tell.name,
          fix: g.tell.fix,
          hits: g.hits,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);

console.log(`\n${bold("kill-ai-slop")} — scanned ${files.length} files under ${escapeTerminal(root)}\n`);
if (groups.length === 0) {
  console.log("No slop signals found. (Still trust your eyes — open the pages.)\n");
  process.exit(0);
}

for (const g of groups) {
  console.log(`${red("slop")} ${bold(g.tell.id)} ${g.tell.name}  ${dim("→ " + g.tell.fix)}`);
  const shown = g.hits.slice(0, 12);
  for (const h of shown) {
    console.log(`     ${dim(escapeTerminal(h.file + ":" + h.line))}  ${escapeTerminal(h.text)}`);
  }
  if (g.hits.length > shown.length) {
    console.log(dim(`     … and ${g.hits.length - shown.length} more`));
  }
  console.log("");
}

console.log(
  `${bold("→")} ${groups.length} groups, ${totalHits} hits. ` +
    dim("Confirm each by reading the code, then fix per references/fixes.md.\n"),
);
