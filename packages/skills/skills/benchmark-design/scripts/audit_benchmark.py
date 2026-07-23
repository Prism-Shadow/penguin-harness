#!/usr/bin/env python3
"""Audit a calibrated Benchmark's immutable points, matrix, digests, and literal privacy leaks."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import tomllib
from pathlib import Path

import yaml


MAX_POINTS = re.compile(r"(?mi)^max_points:\s*(\d+(?:\.\d+)?)\s*$")


def fail(message: str) -> None:
    print(f"invalid benchmark artifact: {message}", file=sys.stderr)
    raise SystemExit(1)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sequence_digest(root: Path, files: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda value: value.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix().encode()
        digest.update(rel)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def points_digest(points: dict[str, float]) -> str:
    digest = hashlib.sha256()
    for case_id, value in sorted(points.items()):
        digest.update(case_id.encode())
        digest.update(b"\0")
        digest.update(format(value, "g").encode())
        digest.update(b"\0")
    return digest.hexdigest()


def normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("benchmark_dir", type=Path)
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--expected-uniform-points", type=float)
    args = parser.parse_args()

    root = args.benchmark_dir.resolve()
    handoff = yaml.safe_load(args.handoff.read_text(encoding="utf-8"))
    config = tomllib.loads((root / "benchmark_config.toml").read_text(encoding="utf-8"))
    scoreboard = yaml.safe_load((root / "scoreboard.yaml").read_text(encoding="utf-8"))
    runs = config.get("runs")
    if not isinstance(runs, int) or runs <= 0:
        fail("benchmark_config.toml has invalid runs")

    case_ids = sorted(path.name for path in root.iterdir() if path.is_dir() and path.name.startswith("CASE-"))
    if case_ids != handoff.get("case_ids"):
        fail("Case directory set differs from handoff")

    points: dict[str, float] = {}
    for case_id in case_ids:
        rubric = root / case_id / "rubric" / "README.md"
        if not rubric.is_file():
            fail(f"{case_id} has no rubric/README.md")
        match = MAX_POINTS.search(rubric.read_text(encoding="utf-8"))
        if not match:
            fail(f"{case_id} Rubric lacks max_points")
        points[case_id] = float(match.group(1))
    if not math.isclose(sum(points.values()), 100.0, abs_tol=1e-9):
        fail("Rubric maxima do not total 100")
    if args.expected_uniform_points is not None and any(
        not math.isclose(value, args.expected_uniform_points, abs_tol=1e-9)
        for value in points.values()
    ):
        fail("Case maxima differ from the user-supplied uniform allocation")
    digest = points_digest(points)
    if digest != handoff.get("point_allocation_digest"):
        fail("point allocation digest differs from handoff")

    lock_path = root / ".private" / "point-lock.json"
    history_path = root / ".private" / "calibration-history.json"
    if not lock_path.is_file() or not history_path.is_file():
        fail("missing private point lock or calibration history")
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    if lock != {"case_points": points, "point_allocation_digest": digest}:
        fail("point lock differs from current Rubrics")
    history = json.loads(history_path.read_text(encoding="utf-8"))
    if history.get("point_allocation_digest") != digest:
        fail("calibration history changed point allocation")
    if history.get("full_matrix_count") != handoff.get("full_matrix_count"):
        fail("full-matrix count differs from handoff")
    if history.get("structural_revision_count") != handoff.get("structural_revision_count"):
        fail("structural-revision count differs from handoff")

    evaluations = scoreboard.get("evaluations") if isinstance(scoreboard, dict) else None
    if not isinstance(evaluations, list) or len(evaluations) != 1:
        fail("Scoreboard must contain exactly one accepted baseline")
    evaluation = evaluations[0]
    if evaluation.get("version") != handoff.get("tested_state_version"):
        fail("Scoreboard version differs from handoff")
    if evaluation.get("provider") != handoff.get("provider") or evaluation.get("model_id") != handoff.get("model_id"):
        fail("Scoreboard Model differs from handoff")
    if not math.isclose(float(evaluation.get("score")), float(handoff.get("score")), abs_tol=1e-9):
        fail("Scoreboard score differs from handoff")
    eval_cases = evaluation.get("cases")
    if not isinstance(eval_cases, list) or sorted(item.get("case") for item in eval_cases) != case_ids:
        fail("Scoreboard Case set is incomplete")
    recomputed_total = 0.0
    losses: list[float] = []
    diagnostic_case_count = 0
    for item in eval_cases:
        case_id = item.get("case")
        run_items = item.get("runs")
        if not isinstance(run_items, list) or len(run_items) != runs:
            fail(f"{case_id} does not have the configured run count")
        if any(not isinstance(run.get("session_id"), str) or not run["session_id"] for run in run_items):
            fail(f"{case_id} has a run without a Session id")
        mean = sum(float(run["score"]) for run in run_items) / runs
        if not math.isclose(mean, float(item.get("score")), abs_tol=1e-6):
            fail(f"{case_id} mean does not match its runs")
        if mean > points[case_id] + 1e-9:
            fail(f"{case_id} score exceeds its locked maximum")
        loss = points[case_id] - mean
        losses.append(loss)
        if loss >= 0.1 * points[case_id] - 1e-9:
            diagnostic_case_count += 1
        recomputed_total += mean
    if not math.isclose(recomputed_total, float(evaluation["score"]), abs_tol=1e-6):
        fail("aggregate score does not match Case means")
    total_loss = sum(losses)
    if diagnostic_case_count < 2:
        fail("diagnostic headroom is not distributed across at least two Cases")
    if total_loss <= 0 or max(losses) > 0.7 * total_loss + 1e-9:
        fail("one Case contributes more than 70% of aggregate lost points")

    if sha256_file(root / "scoreboard.yaml") != handoff.get("scoreboard_digest"):
        fail("scoreboard digest differs from handoff")
    definition_files = [root / "benchmark_config.toml"]
    for case_id in case_ids:
        definition_files.extend(path for path in (root / case_id / "statement").rglob("*") if path.is_file())
        definition_files.extend(path for path in (root / case_id / "rubric").rglob("*") if path.is_file())
    private_dir = root / ".private"
    if private_dir.is_dir():
        definition_files.extend(path for path in private_dir.rglob("*") if path.is_file())
    if sequence_digest(root, definition_files) != handoff.get("benchmark_definition_digest"):
        fail("Benchmark definition digest differs from handoff")

    manifest_path = private_dir / "mechanism-manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        private_terms = manifest.get("private_terms")
        if not isinstance(private_terms, list) or not all(isinstance(term, str) and len(term.strip()) >= 4 for term in private_terms):
            fail("black-box manifest must declare private_terms")
        public_parts: list[str] = []
        for case_id in case_ids:
            public_parts.extend(
                path.read_text(encoding="utf-8", errors="replace")
                for path in (root / case_id / "statement").rglob("*")
                if path.is_file()
            )
        public_parts.append(str(evaluation.get("summary_title", "")))
        public_parts.append(str(evaluation.get("summary", "")))
        corpus = normalized("\n".join(public_parts))
        leaked = [term for term in private_terms if normalized(term) in corpus]
        if leaked:
            fail(f"private terms leaked into public material: {leaked}")

    print("valid")


if __name__ == "__main__":
    main()
