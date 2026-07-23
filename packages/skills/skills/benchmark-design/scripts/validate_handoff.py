#!/usr/bin/env python3
"""Validate a successful benchmark-design delegated-phase handoff."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml


HEX64 = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_KEYS = {
    "pipeline_protocol",
    "workflow_id",
    "project_id",
    "phase",
    "status",
    "target_met",
    "test_agent_id",
    "tested_state_version",
    "tested_state_digest",
    "benchmark_id",
    "benchmark_dir",
    "benchmark_definition_digest",
    "scoreboard_digest",
    "reference_time",
    "provider",
    "model_id",
    "score",
    "case_count",
    "case_ids",
    "runs_per_case",
    "expected_cell_count",
    "valid_cell_count",
    "reference_evaluation_key",
    "full_matrix_count",
    "structural_revision_count",
    "point_allocation_digest",
    "stop_reason",
    "protocol_end",
}


def fail(message: str) -> None:
    print(f"invalid benchmark handoff: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--project-dir", type=Path, required=True)
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--benchmark-id", required=True)
    parser.add_argument("--target-low", type=float, required=True)
    parser.add_argument("--target-high", type=float, required=True)
    args = parser.parse_args()

    try:
        doc = yaml.safe_load(args.handoff.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"cannot parse YAML: {exc}")
    if not isinstance(doc, dict):
        fail("document is not a mapping")
    if set(doc) != REQUIRED_KEYS:
        fail(f"keys differ: missing={sorted(REQUIRED_KEYS - set(doc))}, extra={sorted(set(doc) - REQUIRED_KEYS)}")

    expected_dir = (
        args.project_dir / "agents" / args.agent_id / "benchmarks" / args.benchmark_id
    ).resolve()
    checks = {
        "pipeline_protocol": 1,
        "workflow_id": args.workflow_id,
        "project_id": args.project_id,
        "phase": "benchmark",
        "status": "calibrated",
        "target_met": True,
        "test_agent_id": args.agent_id,
        "benchmark_id": args.benchmark_id,
        "benchmark_dir": str(expected_dir),
        "stop_reason": "target_reached",
        "protocol_end": True,
    }
    for key, expected in checks.items():
        if doc.get(key) != expected:
            fail(f"{key} must be {expected!r}, got {doc.get(key)!r}")

    for key in (
        "tested_state_digest",
        "benchmark_definition_digest",
        "scoreboard_digest",
        "point_allocation_digest",
    ):
        if not isinstance(doc.get(key), str) or not HEX64.fullmatch(doc[key]):
            fail(f"{key} is not lowercase SHA-256")
    if not isinstance(doc.get("score"), (int, float)) or not (
        args.target_low <= float(doc["score"]) <= args.target_high
    ):
        fail("score is outside the requested target interval")

    case_ids = doc.get("case_ids")
    if (
        not isinstance(case_ids, list)
        or not all(isinstance(case_id, str) for case_id in case_ids)
        or case_ids != sorted(set(case_ids))
    ):
        fail("case_ids must be sorted and unique")
    if doc.get("case_count") != len(case_ids) or doc.get("case_count", 0) <= 0:
        fail("case_count does not match case_ids")
    if not isinstance(doc.get("runs_per_case"), int) or doc["runs_per_case"] <= 0:
        fail("runs_per_case must be positive")
    expected_cells = doc["case_count"] * doc["runs_per_case"]
    if doc.get("expected_cell_count") != expected_cells or doc.get("valid_cell_count") != expected_cells:
        fail("cell counts are incomplete")
    if doc.get("full_matrix_count") not in (1, 2):
        fail("full_matrix_count must be 1 or 2")
    if doc.get("structural_revision_count") not in (0, 1):
        fail("structural_revision_count must be 0 or 1")

    print("valid")


if __name__ == "__main__":
    main()
