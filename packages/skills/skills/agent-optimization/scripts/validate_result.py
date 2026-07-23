#!/usr/bin/env python3
"""Validate a successful delegated optimization terminal handoff."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml


HEX64 = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_KEYS = {
    "pipeline_protocol", "workflow_id", "project_id", "phase", "status", "target_met",
    "test_agent_id", "benchmark_id", "benchmark_definition_digest", "baseline_version",
    "baseline_score", "final_version", "final_score", "target_score", "score_curve",
    "accepted_changes", "accepted_rounds", "invalid_cell_count", "final_state_digest",
    "scoreboard_digest", "stop_reason", "protocol_end",
}


def fail(message: str) -> None:
    print(f"invalid optimization result: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--benchmark-id", required=True)
    parser.add_argument("--target-score", type=float, required=True)
    args = parser.parse_args()

    try:
        doc = yaml.safe_load(args.handoff.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"cannot parse YAML: {exc}")
    if not isinstance(doc, dict) or set(doc) != REQUIRED_KEYS:
        fail("schema differs")
    checks = {
        "pipeline_protocol": 1,
        "workflow_id": args.workflow_id,
        "project_id": args.project_id,
        "phase": "optimization",
        "status": "optimized",
        "target_met": True,
        "test_agent_id": args.agent_id,
        "benchmark_id": args.benchmark_id,
        "target_score": args.target_score,
        "invalid_cell_count": 0,
        "stop_reason": "target_reached",
        "protocol_end": True,
    }
    for key, expected in checks.items():
        if doc.get(key) != expected:
            fail(f"{key} must be {expected!r}, got {doc.get(key)!r}")
    if not isinstance(doc.get("final_score"), (int, float)) or float(doc["final_score"]) < args.target_score:
        fail("final score is below target")
    if not isinstance(doc.get("accepted_rounds"), int) or doc["accepted_rounds"] <= 0:
        fail("accepted_rounds must be positive")
    if not isinstance(doc.get("score_curve"), list) or doc["score_curve"][0] != doc.get("baseline_score") or doc["score_curve"][-1] != doc.get("final_score"):
        fail("score curve does not match baseline/final scores")
    if not isinstance(doc.get("accepted_changes"), list):
        fail("accepted_changes is not a list")
    for key in ("benchmark_definition_digest", "final_state_digest", "scoreboard_digest"):
        if not isinstance(doc.get(key), str) or not HEX64.fullmatch(doc[key]):
            fail(f"{key} is not lowercase SHA-256")

    print("valid")


if __name__ == "__main__":
    main()
