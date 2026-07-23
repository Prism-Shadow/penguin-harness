#!/usr/bin/env python3
"""Audit a newly created canonical Agent against the default template and handoff."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import yaml


def fail(message: str) -> None:
    print(f"invalid created Agent: {message}", file=sys.stderr)
    raise SystemExit(1)


def state_digest(state: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        (path for path in state.rglob("*") if path.is_file() and path.name != ".vault.toml"),
        key=lambda path: path.relative_to(state).as_posix(),
    )
    for path in files:
        digest.update(path.relative_to(state).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_dir", type=Path)
    parser.add_argument("agent_id")
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--forbid-skill", action="append", default=[])
    args = parser.parse_args()

    project = args.project_dir.resolve()
    target = project / "agents" / args.agent_id
    state = target / "agent_state"
    if not target.is_dir() or target.is_symlink():
        fail("canonical target is missing or is a symlink")
    if (project / args.agent_id).exists() or (project / args.agent_id).is_symlink():
        fail("legacy Agent path exists")
    if not (state / "AGENTS.md").is_file() or not (state / "system_config.yaml").is_file():
        fail("required State files are missing")

    handoff = yaml.safe_load(args.handoff.read_text(encoding="utf-8"))
    target_config = yaml.safe_load((state / "system_config.yaml").read_text(encoding="utf-8"))
    default_config = yaml.safe_load(
        (project / "agents" / "default_agent" / "agent_state" / "system_config.yaml").read_text(
            encoding="utf-8"
        )
    )
    if target_config.get("version", 1) != 1:
        fail("new Agent version is not 1")
    for key in ("version", "name", "description"):
        target_config.pop(key, None)
        default_config.pop(key, None)
    if target_config != default_config:
        fail("system_config.yaml changed outside version/name/description")
    if state_digest(state) != handoff.get("state_digest"):
        fail("State digest differs from handoff")
    for skill in args.forbid_skill:
        if (state / "skills" / skill).exists():
            fail(f"forbidden Skill installed: {skill}")

    print("valid")


if __name__ == "__main__":
    main()
