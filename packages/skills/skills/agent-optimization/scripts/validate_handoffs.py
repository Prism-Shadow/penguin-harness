#!/usr/bin/env python3
"""Strictly validate creation and benchmark handoffs before delegated optimization."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml


HEX64 = re.compile(r"^[0-9a-f]{64}$")
CREATION_KEYS = {
    "pipeline_protocol", "workflow_id", "project_id", "phase", "status", "agent_id",
    "agent_dir", "state_version", "target_was_absent", "state_digest", "protocol_end",
}
BENCHMARK_KEYS = {
    "pipeline_protocol", "workflow_id", "project_id", "phase", "status", "target_met",
    "test_agent_id", "tested_state_version", "tested_state_digest", "benchmark_id",
    "benchmark_dir", "benchmark_definition_digest", "scoreboard_digest", "reference_time",
    "provider", "model_id", "score", "case_count", "case_ids", "runs_per_case",
    "expected_cell_count", "valid_cell_count", "reference_evaluation_key",
    "full_matrix_count", "structural_revision_count", "point_allocation_digest",
    "stop_reason", "protocol_end",
}


def fail(message: str) -> None:
    print(f"invalid optimization handoff: {message}", file=sys.stderr)
    raise SystemExit(1)


def load(path: Path) -> dict:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"cannot parse {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path} is not a mapping")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("creation_handoff", type=Path)
    parser.add_argument("benchmark_handoff", type=Path)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--benchmark-id", required=True)
    args = parser.parse_args()

    creation = load(args.creation_handoff)
    benchmark = load(args.benchmark_handoff)
    if set(creation) != CREATION_KEYS:
        fail("creation handoff schema differs")
    if set(benchmark) != BENCHMARK_KEYS:
        fail("benchmark handoff schema differs")
    shared = {
        "pipeline_protocol": 1,
        "workflow_id": args.workflow_id,
        "project_id": args.project_id,
        "protocol_end": True,
    }
    for doc in (creation, benchmark):
        for key, expected in shared.items():
            if doc.get(key) != expected:
                fail(f"{key} differs")
    if creation.get("phase") != "creation" or creation.get("status") != "ok":
        fail("creation phase did not succeed")
    if creation.get("agent_id") != args.agent_id or creation.get("target_was_absent") is not True:
        fail("creation identity/provenance differs")
    if benchmark.get("phase") != "benchmark" or benchmark.get("status") != "calibrated" or benchmark.get("target_met") is not True:
        fail("Benchmark was not calibrated")
    if benchmark.get("test_agent_id") != args.agent_id or benchmark.get("benchmark_id") != args.benchmark_id:
        fail("Benchmark identity differs")
    if benchmark.get("tested_state_version") != creation.get("state_version"):
        fail("State versions differ")
    if benchmark.get("tested_state_digest") != creation.get("state_digest"):
        fail("State digests differ")
    for key in (
        "state_digest", "tested_state_digest", "benchmark_definition_digest",
        "scoreboard_digest", "point_allocation_digest",
    ):
        source = creation if key == "state_digest" else benchmark
        if not isinstance(source.get(key), str) or not HEX64.fullmatch(source[key]):
            fail(f"{key} is not lowercase SHA-256")
    if benchmark.get("valid_cell_count") != benchmark.get("expected_cell_count"):
        fail("Benchmark matrix is incomplete")

    print("valid")


if __name__ == "__main__":
    main()
