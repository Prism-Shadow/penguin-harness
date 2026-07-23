#!/usr/bin/env python3
"""Validate an agent-creation delegated-phase handoff."""

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
    "agent_id",
    "agent_dir",
    "state_version",
    "target_was_absent",
    "state_digest",
    "protocol_end",
}


def fail(message: str) -> None:
    print(f"invalid creation handoff: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--project-dir", type=Path, required=True)
    parser.add_argument("--agent-id", required=True)
    args = parser.parse_args()

    try:
        doc = yaml.safe_load(args.handoff.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"cannot parse YAML: {exc}")
    if not isinstance(doc, dict):
        fail("document is not a mapping")
    if set(doc) != REQUIRED_KEYS:
        fail(f"keys differ: missing={sorted(REQUIRED_KEYS - set(doc))}, extra={sorted(set(doc) - REQUIRED_KEYS)}")

    expected_dir = (args.project_dir / "agents" / args.agent_id).resolve()
    checks = {
        "pipeline_protocol": 1,
        "workflow_id": args.workflow_id,
        "project_id": args.project_id,
        "phase": "creation",
        "status": "ok",
        "agent_id": args.agent_id,
        "agent_dir": str(expected_dir),
        "state_version": 1,
        "target_was_absent": True,
        "protocol_end": True,
    }
    for key, expected in checks.items():
        if doc.get(key) != expected:
            fail(f"{key} must be {expected!r}, got {doc.get(key)!r}")
    if not isinstance(doc.get("state_digest"), str) or not HEX64.fullmatch(doc["state_digest"]):
        fail("state_digest is not lowercase SHA-256")

    print("valid")


if __name__ == "__main__":
    main()
