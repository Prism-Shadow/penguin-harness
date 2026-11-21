# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib>=3.9,<4", "pyyaml>=6,<7"]
# ///
"""Render Figure 5 from the blog's pinned benchmark records.

uv run packages/landing/scripts/render-harness-radar.py \
    --benchmark-repo /path/to/penguin-harness-benchmark \
    --output-dir /path/to/penguin-harness-community/assets/blog-assets

Add --update-posts to refresh the score tables in both translations.

The radar plots three-run means on a shared 0–100 scale. A separate Markdown
table retains sample standard deviations without reducing the chart's size.
PNG and SVG exports are local files; this script performs no network writes.

Radar-specific visual references (layout only; benchmark data remains pinned):
https://github.com/deepseek-ai/DeepSeek-LLM/blob/main/images/llm_radar.png
https://arxiv.org/pdf/2507.01006v6 (Figure 1A)
"""

import argparse
import math
import statistics
import subprocess
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.patches import Polygon
import yaml


REVISION = "6ad65ea054fe8035c1c48724dbb5626d699f6cb2"
PREFIX = "experiments/harness-comparison"
SOURCE = f"https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/{REVISION}/{PREFIX}"
SERIES = [
    ("dsh", "DSH", "#984284"),
    ("penguin", "PenguinHarness", "#3656DF"),
    ("pi", "Pi", "#B5701B"),
    ("codex", "Codex", "#007F78"),
]
# Distinct shapes retain series identity when colors are hard to distinguish.
# The smaller Penguin circle leaves DSH's square visible at their tied A score.
MARKERS = {"dsh": ("s", 8.0), "penguin": ("o", 6.0), "pi": ("^", 8.5), "codex": ("D", 7.3)}
COPY = {
    "zh": {
        "title": "五个子集的得分对比",
        "subtitle": "均分（0–100） · 每个子集 10 题 · 3 次测试",
        "axes": ["数据分析", "软件工程", "自动化流程", "科学计算", "终端任务"],
        "table": "平均分 ± 样本标准差",
        "subset": "子集",
    },
    "en": {
        "title": "Scores across the five subsets",
        "subtitle": "Mean score (0–100) · 10 tasks per subset · 3 runs",
        "axes": ["Data analysis", "Software engineering", "Automated workflows", "Scientific computing", "Terminal tasks"],
        "table": "Mean ± sample standard deviation",
        "subset": "Subset",
    },
}


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True)


def read_scores(repo):
    paths = git(repo, "ls-tree", "-r", "--name-only", REVISION, PREFIX).splitlines()
    scores = {}
    for sec in "abcde":
        for key, *_ in SERIES:
            matches = [p for p in paths if p.startswith(f"{PREFIX}/sec-{sec}-{key}-") and p.endswith("/test/summary.yaml")]
            if len(matches) != 1:
                raise ValueError(f"Expected one summary for {sec}/{key}: {matches}")
            summary_path = matches[0]
            read = lambda p: yaml.safe_load(git(repo, "show", f"{REVISION}:{p}"))
            summary = read(summary_path)
            attempts = [read(summary_path.replace("summary.yaml", f"attempt-{n}.yaml")) for n in (1, 2, 3)]
            task_sets = []
            means = []
            for attempt in attempts:
                if len(attempt) != 10 or any(row["score"] not in (0, 100) for row in attempt):
                    raise ValueError(f"Expected ten binary scores for {sec}/{key}")
                tasks = {row["source"][0]["task_id"] for row in attempt}
                if len(tasks) != 10:
                    raise ValueError(f"Duplicate tasks for {sec}/{key}")
                task_sets.append(tasks)
                means.append(statistics.mean(row["score"] for row in attempt))
            if any(tasks != task_sets[0] for tasks in task_sets[1:]):
                raise ValueError(f"Task sets differ between runs for {sec}/{key}")
            mean, std = statistics.mean(means), statistics.stdev(means)
            if summary["n_attempt"] != 3 or any(abs(summary[field] - value) > 0.0051 for field, value in [("score_mean", mean), ("score_std", std)]):
                raise ValueError(f"Summary disagrees with trial records for {sec}/{key}")
            scores[sec, key] = (mean, std)
    return scores


def render(scores, locale, output_dir, font):
    copy = COPY[locale]
    text, muted, grid = "#485569", "#657287", "#DDE4ED"
    plt.rcParams.update({"font.family": font, "text.color": text, "svg.fonttype": "path", "svg.hashsalt": "harness-subset-radar"})
    fig = plt.figure(figsize=(12, 10), facecolor="white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_aspect("equal")
    ax.set_xlim(0, 1200)
    ax.set_ylim(1000, 0)
    ax.axis("off")
    cx, cy, radius = 600, 435, 417
    # Place A and B on either side of the top with D pointing down.
    angles = [math.radians(72 * i - 36) for i in range(5)]

    def points(values):
        return [(cx + math.sin(a) * radius * v / 100, cy - math.cos(a) * radius * v / 100) for a, v in zip(angles, values)]

    ticks = (20, 40, 60, 80, 100)
    for value in ticks:
        ax.add_patch(Polygon(points([value] * 5), fill=False, edgecolor=grid, linewidth=0.85))
    for x, y in points([100] * 5):
        ax.plot([cx, x], [cy, y], color=grid, linewidth=0.65)
    # Place the scale in the open sector between D and E, clear of the curves.
    for value in ticks:
        distance = radius * value / 100 * math.cos(math.pi / 5)
        ax.text(cx - math.sin(math.pi / 5) * distance, cy + math.cos(math.pi / 5) * distance - 12,
                str(value), ha="center", va="bottom", fontsize=14, color=muted)

    outlines = {}
    for key, _, color in SERIES:
        vertices = points([scores[sec, key][0] for sec in "abcde"])
        ax.add_patch(Polygon(vertices, facecolor=color, alpha=0.03, edgecolor="none"))
        outlines[key] = (color, vertices)

    # Keep both colors visible on coincident edges by widening the DSH stroke
    # under the Penguin stroke, with both centered on the original coordinates.
    dsh_color, dsh_vertices = outlines["dsh"]
    _, penguin_vertices = outlines["penguin"]
    for start, point in enumerate(dsh_vertices):
        end = (start + 1) % len(dsh_vertices)
        if point == penguin_vertices[start] and dsh_vertices[end] == penguin_vertices[end]:
            ax.plot(*zip(point, dsh_vertices[end]), color=dsh_color, linewidth=6,
                    solid_capstyle="round")

    for color, vertices in outlines.values():
        closed = vertices + vertices[:1]
        ax.plot(*zip(*closed), color=color, linewidth=3.2, solid_joinstyle="round")
    for key, (color, vertices) in outlines.items():
        marker, size = MARKERS[key]
        ax.plot(*zip(*vertices), color=color, linestyle="none", marker=marker,
                markersize=size, markeredgewidth=0, zorder=4)

    positions = [(355, 62), (845, 62), (1100, 560), (600, 884), (100, 560)]
    for i, ((x, y), name) in enumerate(zip(positions, copy["axes"])):
        if locale == "en" and i in (2, 4):
            name = name.replace(" ", "\n", 1)
        ax.text(x, y, name, ha="center", va="center", fontsize=21, linespacing=1.1)

    handles = [
        Line2D([], [], color=color, marker=MARKERS[key][0], linewidth=3.2,
               markersize=MARKERS[key][1], markeredgewidth=0, label=name)
        for key, name, color in SERIES
    ]
    fig.legend(handles=handles, loc="center", bbox_to_anchor=(0.5, 0.069), ncol=4, frameon=False, fontsize=20, columnspacing=1.65, handlelength=1.55, handletextpad=0.5)
    ax.text(600, 974, copy["subtitle"], ha="center", va="center", fontsize=14, color=muted)

    output_dir.mkdir(parents=True, exist_ok=True)
    stem = output_dir / f"harness-comparison-02-subset-radar-{locale}"
    description = f"{copy['title']}. Radar: three-run mean, shared linear 0–100 axes. Source: {SOURCE}"
    fig.savefig(stem.with_suffix(".png"), dpi=240, metadata={"Description": description, "Software": "Matplotlib"})
    svg = stem.with_suffix(".svg")
    fig.savefig(svg, metadata={"Title": copy["title"], "Description": description, "Date": None})
    svg_lines = svg.read_text(encoding="utf-8").splitlines()
    svg.write_text("\n".join(line.rstrip() for line in svg_lines) + "\n", encoding="utf-8")
    plt.close(fig)
    print(f"Wrote {stem}.png (2880 × 2400) and .svg")


def score_table(scores, locale):
    copy = COPY[locale]
    lines = [f"**{copy['table']}**", "", f"| {copy['subset']} | " + " | ".join(name for _, name, _ in SERIES) + " |", "| --- | ---: | ---: | ---: | ---: |"]
    for i, sec in enumerate("abcde"):
        best = max(scores[sec, key][0] for key, *_ in SERIES)
        values = []
        for key, *_ in SERIES:
            mean, std = scores[sec, key]
            label = f"{mean:.2f}"
            if math.isclose(mean, best):
                label = f"**{label}**"
            values.append(f"{label} ± {std:.2f}")
        lines.append(f"| Sec {sec.upper()} {copy['axes'][i]} | " + " | ".join(values) + " |")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark-repo", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / ".blog-assets")
    parser.add_argument("--font", type=Path, help="Optional CJK font file for portable exports")
    parser.add_argument("--update-posts", action="store_true", help="Refresh the generated score tables in both blog posts")
    args = parser.parse_args()
    if args.font:
        font_manager.fontManager.addfont(args.font)
        font = font_manager.FontProperties(fname=args.font).get_name()
    else:
        font = font_manager.FontProperties(fname=font_manager.findfont(font_manager.FontProperties(family=["Noto Sans CJK JP", "Noto Sans CJK SC"]), fallback_to_default=False)).get_name()
    scores = read_scores(args.benchmark_repo)
    print("Validated all 600 trial scores against 20 summaries at", REVISION)
    for locale in COPY:
        render(scores, locale, args.output_dir, font)
        if args.update_posts:
            post = Path(__file__).resolve().parents[1] / "content" / "blog" / f"harness-comparison.{locale}.md"
            body = post.read_text()
            start = "<!-- harness-subset-scores:start -->"
            end = "<!-- harness-subset-scores:end -->"
            block = f"{start}\n{score_table(scores, locale)}\n{end}"
            if start in body and end in body:
                before, rest = body.split(start, 1)
                _, after = rest.split(end, 1)
                body = before + block + after
            else:
                figure = next(line for line in body.splitlines() if f"harness-comparison-02-subset-radar-{locale}.svg" in line)
                body = body.replace(figure, figure + "\n\n" + block, 1)
            post.write_text(body)


if __name__ == "__main__":
    main()
