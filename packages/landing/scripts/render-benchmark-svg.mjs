/**
 * Renders the README / blog benchmark chart from the same data the landing page uses
 * (src/lib/benchmark-data.ts), so the static SVGs cannot drift from the site when the
 * numbers are refreshed. Emits:
 *   assets/readme/benchmark-light.svg
 *   assets/readme/benchmark-dark.svg
 *   packages/landing/public/blog-assets/benchmark-light.svg
 *
 * Two panels per suite (accuracy, cost), horizontal bars scaled linearly from zero — the
 * cost spread is ~70x, so the PenguinHarness bar is by far the shortest. That is the
 * result, not a defect; a zoomed baseline would flatter everyone else. Bars are floored at
 * MIN_BAR, though: at true scale the cost bar comes out ~2.5px, which reads as "no bar" and
 * loses the series entirely. The floor keeps it visible and unmistakably smallest, and the
 * exact figure is printed beside every bar, so nothing is overstated.
 *
 * Run: node packages/landing/scripts/render-benchmark-svg.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LANDING = path.resolve(HERE, "..");
const REPO = path.resolve(LANDING, "..", "..");

/**
 * The data module is TypeScript; rather than add a build step, read the two exported
 * arrays out of the source. Any shape change here fails loudly instead of silently
 * rendering a stale chart.
 */
function loadBench() {
  const src = readFileSync(path.join(LANDING, "src/lib/benchmark-data.ts"), "utf8");
  const consts = Object.fromEntries(
    [...src.matchAll(/^const (\w+) = "([^"]+)";$/gm)].map((m) => [m[1], m[2]]),
  );
  const pick = (name) => {
    const block = src.match(
      new RegExp(`export const ${name}: BenchResult\\[\\] = \\[([\\s\\S]*?)\\n\\];`),
    );
    if (!block) throw new Error(`could not find ${name} in benchmark-data.ts`);
    const rows = [...block[1].matchAll(/\{([\s\S]*?)\n {2}\}/g)].map((m) => {
      const body = m[1];
      const field = (k) => body.match(new RegExp(`${k}:\\s*([^,\\n]+)`))?.[1]?.trim();
      const str = (k) => {
        const v = field(k);
        if (!v) throw new Error(`missing ${k}`);
        return v.startsWith('"') ? v.slice(1, -1) : (consts[v] ?? v);
      };
      return {
        framework: str("framework"),
        model: str("model"),
        accuracyPct: Number(field("accuracyPct")),
        tokensM: Number(field("tokensM")),
        costUsd: Number(field("costUsd")),
        emphasized: /emphasized:\s*true/.test(body),
      };
    });
    if (rows.length !== 3) throw new Error(`${name}: expected 3 rows, got ${rows.length}`);
    for (const r of rows) {
      if (!Number.isFinite(r.accuracyPct) || !Number.isFinite(r.costUsd)) {
        throw new Error(`${name}: ${r.framework} has a non-numeric field`);
      }
    }
    return rows;
  };
  return { DATA_BENCH: pick("DATA_BENCH"), CODE_BENCH: pick("CODE_BENCH") };
}

const THEMES = {
  light: {
    strong: "#1f2328",
    mid: "#52514e",
    muted: "#898781",
    rule: "#c3c2b7",
    brand: "#2a78d6",
    bar: "#898781",
  },
  dark: {
    strong: "#f0f3f6",
    mid: "#c3c2b7",
    muted: "#898781",
    rule: "#383835",
    brand: "#3987e5",
    bar: "#6b6a64",
  },
};

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const W = 920;
const H = 368;
const BAR_H = 16;
const ROW_H = 30;
const MAX_BAR = 176;
/** Shortest a bar may render, so a near-zero value still reads as a bar (~8% of full). */
const MIN_BAR = 14;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function text(x, y, s, { size = 12, weight = 400, fill, anchor = "start" }) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" font-family="${FONT}">${esc(s)}</text>`;
}

/** Rounded-end horizontal bar starting at the axis. */
function bar(x, y, w, fill) {
  const r = Math.min(4, w / 2);
  return `<path d="M${x} ${y} h${(w - r).toFixed(1)} a${r} ${r} 0 0 1 ${r} ${r} v${BAR_H - 2 * r} a${r} ${r} 0 0 1 -${r} ${r} h-${(w - r).toFixed(1)} z" fill="${fill}"/>`;
}

/** One measure for one suite: label column, axis rule, three bars, value labels. */
function panel(t, x0, yTop, rows, value, format) {
  const axis = x0 + 124;
  const max = Math.max(...rows.map(value));
  const out = [
    `<rect x="${axis - 1}" y="${yTop}" width="1" height="${ROW_H * rows.length + 2}" fill="${t.rule}"/>`,
  ];
  rows.forEach((row, i) => {
    const y = yTop + 4 + i * ROW_H;
    const w = Math.max(MIN_BAR, (value(row) / max) * MAX_BAR);
    const weight = row.emphasized ? 600 : 400;
    out.push(
      text(axis - 12, y + 12.5, row.framework, {
        fill: row.emphasized ? t.strong : t.mid,
        weight,
        anchor: "end",
      }),
      bar(axis + 1, y, w, row.emphasized ? t.brand : t.bar),
      text(axis + w + 13, y + 12.5, format(value(row)), { fill: t.strong, weight }),
    );
  });
  return out.join("\n");
}

function suite(t, yTop, title, rows) {
  return [
    text(24, yTop, title, { size: 13, weight: 600, fill: t.strong }),
    panel(
      t,
      24,
      yTop + 10,
      rows,
      (r) => r.accuracyPct,
      (v) => `${v.toFixed(2)}%`,
    ),
    panel(
      t,
      472,
      yTop + 10,
      rows,
      (r) => r.costUsd,
      (v) => `$${v.toFixed(2)}`,
    ),
  ].join("\n");
}

function render(theme, { DATA_BENCH, CODE_BENCH }) {
  const t = THEMES[theme];
  const alt =
    "Benchmark: PenguinHarness vs Claude Code vs OpenAI Codex on two suites — comparable accuracy at a small fraction of the cost";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(alt)}">
${text(148, 36, "Accuracy · suite total · higher is better", { fill: t.muted })}
${text(596, 36, "Total cost (USD) · lower is better", { fill: t.muted })}
${suite(t, 68, "Data analysis — 15 tasks, single run", DATA_BENCH)}
${suite(t, 210, "Coding — 40 tasks × 2 runs", CODE_BENCH)}
${text(24, 338, "Each harness runs the model it is normally paired with: PenguinHarness on DeepSeek V4 Pro, Claude Code on Claude Opus 4.8,", { fill: t.muted })}
${text(24, 356, "OpenAI Codex on GPT-5.5. Accuracy, Tokens and cost are suite totals at official pricing.", { fill: t.muted })}
</svg>
`;
}

const bench = loadBench();
const targets = [
  ["light", path.join(REPO, "assets/readme/benchmark-light.svg")],
  ["dark", path.join(REPO, "assets/readme/benchmark-dark.svg")],
  ["light", path.join(LANDING, "public/blog-assets/benchmark-light.svg")],
];
for (const [theme, file] of targets) {
  writeFileSync(file, render(theme, bench));
  console.log(`wrote ${path.relative(REPO, file)}`);
}
