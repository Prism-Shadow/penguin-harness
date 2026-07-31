#!/usr/bin/env python3
# Author: ZhiJin Nan <cinderelladoyle@icloud.com>
# SPDX-License-Identifier: Apache-2.0
"""Deterministic variance calculator for benchmark ceiling detection.

Reads scoreboard.yaml + rubric README.md files, computes per-Case utilization
and volatility, classifies each Case into one of 6 categories, then aggregates
at the Benchmark level. Outputs JSON to stdout.

Usage:
  python3 calculate.py <scoreboard.yaml> <rubric_dir_1> [rubric_dir_2 ...]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# Classification matrix
# ---------------------------------------------------------------------------

def classify(utilization: float, volatility: float) -> str:
    """Map (utilization, volatility) → category label."""
    if utilization >= 0.95 and volatility == 0.0:
        return "Absolute Ceiling"
    if utilization >= 0.85 and volatility <= 0.15:
        return "Stable Ceiling"
    if utilization >= 0.85 and volatility <= 0.30:
        return "Probable Ceiling"
    if utilization >= 0.85:
        return "Unstable High"
    if utilization >= 0.75:
        return "Approaching"
    return "Healthy"


# ---------------------------------------------------------------------------
# Rubric case_max extraction
# ---------------------------------------------------------------------------

_RUBRIC_MAX_RE = re.compile(
    r"(?:max(?:imum)?|total)[:\s]*(\d+)\s*(?:points?|pts?)",
    re.IGNORECASE,
)

_ITEM_PTS_RE = re.compile(r"(\d+)\s*(?:points?|pts?)\b", re.IGNORECASE)


def extract_case_max(rubric_dir: str) -> float | None:
    """Extract the maximum score from a rubric/README.md file.

    Tries in order:
      1. "max N points" / "Total: N points" pattern
      2. Sum of individual "Npt"/"N points" items
    Returns None when no parsable maximum is found.
    """
    readme = Path(rubric_dir) / "README.md"
    if not readme.is_file():
        return None

    text = readme.read_text(encoding="utf-8")

    # Strategy 1 — explicit max declaration
    m = _RUBRIC_MAX_RE.search(text)
    if m:
        return float(m.group(1))

    # Strategy 2 — sum individual rubric-item point values
    pt_values = [int(m.group(1)) for m in _ITEM_PTS_RE.finditer(text)]
    if pt_values:
        return float(sum(pt_values))

    return None


# ---------------------------------------------------------------------------
# Scoreboard parsing
# ---------------------------------------------------------------------------

def load_scoreboard(path: str) -> dict[str, Any]:
    """Load and validate a scoreboard v2 YAML file."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if raw is None:
        return {"evaluations": []}
    if not isinstance(raw, dict) or "evaluations" not in raw:
        raise ValueError(f"Not a valid scoreboard v2: missing 'evaluations' key in {path}")
    return raw


def latest_evaluation(scoreboard: dict[str, Any]) -> dict[str, Any] | None:
    """Return the most recent evaluation by time, or None if empty."""
    evals: list[dict[str, Any]] = scoreboard.get("evaluations", [])
    if not evals:
        return None
    # Scoreboard entries carry an ISO-8601 `time` field; use the latest.
    return max(evals, key=lambda e: e.get("time", ""))


# ---------------------------------------------------------------------------
# Per-Case calculation
# ---------------------------------------------------------------------------

def compute_case(
    case: dict[str, Any],
    rubric_dirs: list[str],
) -> dict[str, Any] | None:
    """Compute utilization + volatility for one Case.  Returns None on bad data."""
    case_id: str = case.get("case", "")
    runs: list[dict[str, Any]] = case.get("runs", [])

    scores = [r.get("score") for r in runs]
    scores = [s for s in scores if isinstance(s, (int, float))]
    if not scores:
        return None

    case_mean = sum(scores) / len(scores)
    volatility = (max(scores) - min(scores)) / len(scores) if len(scores) > 1 else 0.0

    # Find matching rubric directory.
    # rubric_dirs entries may be either the rubric/ directory itself
    # (parent = case dir) or the case directory containing rubric/.
    case_max: float | None = None
    for rd in rubric_dirs:
        rp = Path(rd)
        if rp.name == "rubric":
            parent_name = rp.parent.name
        else:
            parent_name = rp.name
            # Auto-append rubric/ when a case dir was passed directly
            candidate = rp / "rubric"
            if candidate.is_dir():
                rd = str(candidate)

        if parent_name == case_id or case_id.startswith(parent_name):
            case_max = extract_case_max(rd)
            if case_max is not None:
                break

    if case_max is None or case_max == 0:
        return None

    utilization = round(case_mean / case_max, 4)
    volatility = round(volatility / case_max, 4) if case_max else 0.0
    category = classify(utilization, volatility)

    return {
        "id": case_id,
        "mean": round(case_mean, 2),
        "case_max": case_max,
        "utilization": utilization,
        "volatility": volatility,
        "category": category,
        "runs": scores,
    }


# ---------------------------------------------------------------------------
# Benchmark aggregation
# ---------------------------------------------------------------------------

def aggregate(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate per-Case results into a Benchmark-level summary."""
    if not cases:
        return {
            "eval_score": 0,
            "total_max": 0,
            "utilization": 0.0,
            "ceiling_ratio": 0.0,
            "category": "Healthy",
        }

    eval_score = sum(c["mean"] for c in cases)
    total_max = sum(c["case_max"] for c in cases)
    utilization = round(eval_score / total_max, 4) if total_max else 0.0

    ceiling_count = sum(1 for c in cases if c["utilization"] >= 0.85)
    ceiling_ratio = round(ceiling_count / len(cases), 4)

    # Benchmark category: dominated by the worst-case Case category
    if any(c["category"] == "Absolute Ceiling" for c in cases):
        bench_cat = "Ceiling (Absolute)"
    elif ceiling_ratio >= 0.5:
        bench_cat = "Ceiling"
    elif utilization >= 0.85:
        bench_cat = "Approaching Ceiling"
    elif utilization >= 0.75:
        bench_cat = "Approaching"
    else:
        bench_cat = "Healthy"

    return {
        "eval_score": round(eval_score, 2),
        "total_max": round(total_max, 2),
        "utilization": utilization,
        "ceiling_ratio": ceiling_ratio,
        "category": bench_cat,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: calculate.py <scoreboard.yaml> [rubric_dir ...]", file=sys.stderr)
        sys.exit(2)

    scoreboard_path = sys.argv[1]
    rubric_dirs = sys.argv[2:]

    try:
        scoreboard = load_scoreboard(scoreboard_path)
    except Exception as exc:
        json.dump({"error": f"Cannot read scoreboard: {exc}"}, sys.stdout)
        sys.exit(1)

    evaluation = latest_evaluation(scoreboard)
    if evaluation is None:
        json.dump(
            {"cases": [], "benchmark": aggregate([]), "warning": "No evaluations found"},
            sys.stdout,
        )
        return

    cases_raw: list[dict[str, Any]] = evaluation.get("cases", [])
    cases: list[dict[str, Any]] = []
    errors: list[str] = []

    for c in cases_raw:
        result = compute_case(c, rubric_dirs)
        if result is None:
            errors.append(f"{c.get('case', '?')}: missing rubric or no valid runs")
        else:
            cases.append(result)

    output: dict[str, Any] = {
        "cases": cases,
        "benchmark": aggregate(cases),
    }
    if errors:
        output["errors"] = errors

    json.dump(output, sys.stdout, indent=2, ensure_ascii=False)
    print()  # trailing newline


if __name__ == "__main__":
    main()
