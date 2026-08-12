#!/usr/bin/env python3
"""Deterministic, non-destructive PDF inspection and merge commands."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Callable

from pypdf import PdfReader, PdfWriter


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def input_path(raw: str) -> Path:
    path = Path(raw).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() != ".pdf":
        raise ValueError(f"input must be an existing .pdf file: {path}")
    return path


def output_path(raw: str, sources: list[Path]) -> Path:
    path = Path(raw).expanduser().resolve()
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"output must use the .pdf extension: {path}")
    if path in sources:
        raise ValueError("output must be different from every input")
    if path.exists():
        raise FileExistsError(f"output already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def open_reader(path: Path) -> PdfReader:
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError(f"encrypted PDF is not supported: {path}")
    return reader


def page_signature(page) -> str:
    digest = hashlib.sha256()
    digest.update((page.extract_text() or "").encode("utf-8"))
    digest.update(str(tuple(page.mediabox)).encode("ascii"))
    digest.update(str(page.get("/Rotate", 0)).encode("ascii"))
    contents = page.get_contents()
    if contents is not None:
        digest.update(contents.get_data())
    return digest.hexdigest()


def inspect_pdf(args: argparse.Namespace) -> dict[str, object]:
    source = input_path(args.input)
    reader = open_reader(source)
    pages = [
        {"index": index, "text": page.extract_text() or ""}
        for index, page in enumerate(reader.pages, start=1)
    ]
    return {
        "operation": "inspect",
        "input": str(source),
        "page_count": len(pages),
        "pages": pages,
        "verified": True,
    }


def save_verified(
    writer: PdfWriter,
    sources: list[Path],
    source_hashes: dict[Path, str],
    output: Path,
    verify: Callable[[PdfReader], None],
) -> None:
    temporary: Path | None = None
    linked = False
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            writer.write(handle)
        verify(open_reader(temporary))
        os.link(temporary, output)
        linked = True
        for source in sources:
            if file_digest(source) != source_hashes[source]:
                raise RuntimeError(f"source PDF changed during merge: {source}")
    except Exception:
        if linked:
            output.unlink(missing_ok=True)
        raise
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def merge_pdfs(args: argparse.Namespace) -> dict[str, object]:
    if len(args.input) < 2:
        raise ValueError("merge requires at least two --input values")
    sources = [input_path(raw) for raw in args.input]
    if len(set(sources)) != len(sources):
        raise ValueError("merge inputs must be distinct files")
    output = output_path(args.output, sources)
    source_hashes = {source: file_digest(source) for source in sources}
    readers = [open_reader(source) for source in sources]
    expected_signatures = [page_signature(page) for reader in readers for page in reader.pages]

    writer = PdfWriter()
    for reader in readers:
        for page in reader.pages:
            writer.add_page(page)

    def verify(reopened: PdfReader) -> None:
        signatures = [page_signature(page) for page in reopened.pages]
        if signatures != expected_signatures:
            raise RuntimeError("merged PDF page count, order, or content differs after reopen")

    save_verified(writer, sources, source_hashes, output, verify)
    return {
        "operation": "merge",
        "inputs": [str(source) for source in sources],
        "output": str(output),
        "page_count": len(expected_signatures),
        "verified": True,
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    inspect = commands.add_parser("inspect", help="read page counts and extractable text")
    inspect.add_argument("--input", required=True)
    inspect.set_defaults(run=inspect_pdf)

    merge = commands.add_parser("merge", help="merge PDF inputs in argument order")
    merge.add_argument("--input", action="append", required=True)
    merge.add_argument("--output", required=True)
    merge.set_defaults(run=merge_pdfs)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        result = args.run(args)
    except Exception as error:
        print(json.dumps({"error": str(error), "verified": False}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
