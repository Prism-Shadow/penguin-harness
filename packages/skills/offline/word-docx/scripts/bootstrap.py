#!/usr/bin/env python3
"""Create the Agent-owned DOCX environment, then run the fixed helper."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys


def main() -> int:
    offline_root = os.environ.get("PENGUIN_OFFLINE_ROOT")
    if not offline_root:
        print("word-docx initialization failed: PENGUIN_OFFLINE_ROOT is not set", file=sys.stderr)
        return 1
    runtime_path = Path(offline_root) / "_shared" / "bootstrap_runtime.py"
    spec = importlib.util.spec_from_file_location("penguin_offline_bootstrap", runtime_path)
    if spec is None or spec.loader is None:
        print(f"word-docx initialization failed: shared bootstrap is missing: {runtime_path}", file=sys.stderr)
        return 1
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    return runtime.run(
        skill_name="word-docx",
        helper_name="docx_helper.py",
        imports=("docx", "lxml"),
        skill_dir=Path(__file__).resolve().parent.parent,
        arguments=sys.argv[1:],
    )


if __name__ == "__main__":
    raise SystemExit(main())
