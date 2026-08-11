#!/usr/bin/env python3
"""Create one Agent-owned offline Skill environment, then run its fixed helper."""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


SUPPORTED_PYTHONS = {(3, minor) for minor in range(9, 14)}


def environment_python(environment: Path) -> Path:
    if os.name == "nt":
        return environment / "Scripts" / "python.exe"
    return environment / "bin" / "python"


@contextmanager
def exclusive_lock(path: Path, skill_name: str):
    with path.open("a+b") as lock_file:
        if os.name == "nt":
            import msvcrt

            lock_file.seek(0, os.SEEK_END)
            if lock_file.tell() == 0:
                lock_file.write(b"\0")
                lock_file.flush()
            lock_file.seek(0)
            deadline = time.monotonic() + 300
            while True:
                try:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as error:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(
                            f"timed out waiting for the {skill_name} environment lock: {path}"
                        ) from error
                    time.sleep(0.1)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)


def clean_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in tuple(environment):
        if key.startswith("PIP_") or key in {"PYTHONHOME", "PYTHONPATH"}:
            environment.pop(key)
    environment["PYTHONNOUSERSITE"] = "1"
    return environment


def requirement_marker(requirements: Path) -> str:
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    return f"{sys.version_info.major}.{sys.version_info.minor}:{digest}\n"


def import_command(python: Path, imports: tuple[str, ...]) -> list[str]:
    return [str(python), "-I", "-c", "; ".join(f"import {name}" for name in imports)]


def imports_available(python: Path, imports: tuple[str, ...], environment: dict[str, str]) -> bool:
    try:
        return (
            subprocess.run(
                import_command(python, imports),
                check=False,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode
            == 0
        )
    except OSError:
        return False


def ensure_environment(skill_dir: Path, skill_name: str, imports: tuple[str, ...]) -> Path:
    version = sys.version_info[:2]
    if version not in SUPPORTED_PYTHONS:
        raise RuntimeError(
            f"{skill_name} requires Python 3.9 through 3.13 with the venv module; found "
            f"{sys.version_info.major}.{sys.version_info.minor}"
        )

    offline_root = os.environ.get("PENGUIN_OFFLINE_ROOT")
    if not offline_root:
        raise RuntimeError("PENGUIN_OFFLINE_ROOT is not set; install the offline profile")
    resource_root = Path(offline_root)
    wheels = resource_root / "wheels"
    if not wheels.is_dir():
        raise RuntimeError(f"bundled wheel directory is missing: {wheels}")
    requirements = skill_dir / "requirements.lock"
    if not requirements.is_file():
        raise RuntimeError(f"locked requirements are missing: {requirements}")

    agent_dir = skill_dir.parents[2]
    shared_dir = agent_dir / "shared_env"
    environment = shared_dir / skill_name
    marker_path = environment / ".requirements.sha256"
    expected_marker = requirement_marker(requirements)
    shared_dir.mkdir(parents=True, exist_ok=True)
    install_env = clean_environment()

    with exclusive_lock(shared_dir / f".{skill_name}.lock", skill_name):
        python = environment_python(environment)
        if python.is_file() and marker_path.is_file():
            if marker_path.read_text(encoding="utf-8") == expected_marker:
                if imports_available(python, imports, install_env):
                    return python

        if environment.exists():
            shutil.rmtree(environment)
        try:
            subprocess.run(
                [sys.executable, "-I", "-m", "venv", str(environment)],
                check=True,
                env=install_env,
            )
            python = environment_python(environment)
            install_env.update(
                {
                    "PIP_CONFIG_FILE": os.devnull,
                    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                    "PIP_NO_INDEX": "1",
                    "PIP_REQUIRE_VIRTUALENV": "1",
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
                import_command(python, imports),
                check=True,
                env=install_env,
            )
            marker_path.write_text(expected_marker, encoding="utf-8")
            print(f"Initialized {skill_name} environment: {environment}", file=sys.stderr)
            return python
        except Exception:
            if environment.exists():
                shutil.rmtree(environment)
            raise


def run(
    *,
    skill_name: str,
    helper_name: str,
    imports: tuple[str, ...],
    skill_dir: Path,
    arguments: list[str],
) -> int:
    try:
        python = ensure_environment(skill_dir, skill_name, imports)
    except Exception as error:
        print(f"{skill_name} initialization failed: {error}", file=sys.stderr)
        return 1
    helper = skill_dir / "scripts" / helper_name
    return subprocess.run(
        [str(python), "-I", str(helper), *arguments],
        env=clean_environment(),
        check=False,
    ).returncode
