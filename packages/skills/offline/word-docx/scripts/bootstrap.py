#!/usr/bin/env python3
"""Create the Agent-owned DOCX environment from bundled wheels, then run the helper."""

from __future__ import annotations

import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv


SUPPORTED_PYTHONS = {(3, minor) for minor in range(9, 14)}


def environment_python(environment: Path) -> Path:
    return environment / "bin" / "python"


def requirement_marker(requirements: Path) -> str:
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    return f"{sys.version_info.major}.{sys.version_info.minor}:{digest}\n"


def ensure_environment() -> Path:
    version = sys.version_info[:2]
    if version not in SUPPORTED_PYTHONS:
        supported = "3.9 through 3.13"
        raise RuntimeError(
            f"word-docx requires Python {supported} with the venv module; found "
            f"{sys.version_info.major}.{sys.version_info.minor}"
        )

    skill_dir = Path(__file__).resolve().parent.parent
    requirements = skill_dir / "requirements.lock"
    offline_root = os.environ.get("PENGUIN_OFFLINE_ROOT")
    if not offline_root:
        raise RuntimeError("PENGUIN_OFFLINE_ROOT is not set; install the word-docx bundle")
    wheels = Path(offline_root) / "word-docx" / "wheels"
    if not wheels.is_dir():
        raise RuntimeError(f"bundled wheel directory is missing: {wheels}")

    agent_dir = skill_dir.parents[2]
    shared_dir = agent_dir / "shared_env"
    environment = shared_dir / "word-docx"
    marker_path = environment / ".requirements.sha256"
    expected_marker = requirement_marker(requirements)
    shared_dir.mkdir(parents=True, exist_ok=True)

    lock_path = shared_dir / ".word-docx.lock"
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        python = environment_python(environment)
        if python.is_file() and marker_path.is_file():
            if marker_path.read_text(encoding="utf-8") == expected_marker:
                return python

        if environment.exists():
            shutil.rmtree(environment)
        try:
            venv.EnvBuilder(with_pip=True).create(environment)
            python = environment_python(environment)
            install_env = os.environ.copy()
            for key in tuple(install_env):
                if key.startswith("PIP_") or key in {"PYTHONHOME", "PYTHONPATH"}:
                    install_env.pop(key)
            install_env.update(
                {
                    "PIP_CONFIG_FILE": os.devnull,
                    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                    "PIP_NO_INDEX": "1",
                    "PIP_REQUIRE_VIRTUALENV": "1",
                    "PYTHONNOUSERSITE": "1",
                }
            )
            subprocess.run(
                [
                    str(python),
                    "-I",
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    "--no-compile",
                    "--no-deps",
                    "--no-index",
                    "--only-binary=:all:",
                    "--require-hashes",
                    "--find-links",
                    str(wheels),
                    "--requirement",
                    str(requirements),
                ],
                check=True,
                env=install_env,
                stdout=sys.stderr,
            )
            subprocess.run(
                [str(python), "-I", "-c", "import docx, lxml"],
                check=True,
                env=install_env,
            )
            marker_path.write_text(expected_marker, encoding="utf-8")
            print(f"Initialized word-docx environment: {environment}", file=sys.stderr)
            return python
        except Exception:
            if environment.exists():
                shutil.rmtree(environment)
            raise


def main() -> int:
    if len(sys.argv) == 1:
        print("usage: bootstrap.py {inspect,append,replace} ...", file=sys.stderr)
        return 2
    try:
        python = ensure_environment()
    except Exception as error:
        print(f"word-docx initialization failed: {error}", file=sys.stderr)
        return 1
    helper = Path(__file__).resolve().with_name("docx_helper.py")
    helper_env = os.environ.copy()
    for key in tuple(helper_env):
        if key.startswith("PIP_") or key in {"PYTHONHOME", "PYTHONPATH"}:
            helper_env.pop(key)
    helper_env["PYTHONNOUSERSITE"] = "1"
    os.execve(
        str(python),
        [str(python), "-I", str(helper), *sys.argv[1:]],
        helper_env,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
