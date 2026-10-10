#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools==4.65.0", "brotli==1.2.0"]
# ///
"""
Frost's MiSans web font slices, cut from Xiaomi's official MiSans package.

MiSans (https://hyperos.mi.com/font/) has no official npm package, so unlike every other face the
package bundles it cannot arrive as a dependency. This script turns the official download into
what `src/fonts/misans/` ships:

- `misans-<weight>-<slice>.woff2`: MiSans Regular as CSS weight 400 and MiSans Medium as 500, each
  cut into `unicode-range` slices. The slices follow the partition fontsource ships for Noto Sans SC
  (Google Fonts' frequency-ordered slicing, read from @fontsource-variable/noto-sans-sc's
  `unicode.json`), so a zh page downloads about as many MiSans slices under Frost as Noto slices
  under the other themes. One `extra` slice holds MiSans's other non-ideograph characters (Greek,
  more Cyrillic, number forms, box drawing, ...). Ideographs outside the partition, about 15,500
  rare ones worth 2.5 MB per weight, are left out and fall back to the system CJK face.
- `misans.css`: one `@font-face` per slice, its `unicode-range` computed from the characters the
  slice actually holds, so a browser never fetches a slice for a character it lacks.

What subsetting changes (the MiSans licence forbids adapting the font, so this is kept to
delivery): a slice holds the glyphs its characters reach, and each of those glyphs is copied
unchanged, including outline, hinting instructions, horizontal and vertical metrics and glyph
name. Every OpenType feature is kept along with the glyphs it reaches, and every name record is
kept, so each file still carries Xiaomi's copyright notice and the MiSans family name. Only the
tables that index glyphs (cmap, loca, hmtx/vmtx, GSUB/GPOS/GDEF, post) are rebuilt for the smaller
glyph set, and the DSIG table goes, because no digital signature survives any repackaging. WOFF2
is a lossless container. The full TTF or OTF is never written into the repository.

Usage, from the repository root:

  uv run packages/ui/scripts/build-misans.py <MiSans.zip>           rebuild src/fonts/misans/
  uv run packages/ui/scripts/build-misans.py <MiSans.zip> --check   exit 1 if the committed files differ

<MiSans.zip> is the official package, https://hyperos.mi.com/font-download/MiSans.zip, downloaded
through the site, which asks you to accept the MiSans licence first. The script refuses a package
whose Regular or Medium TTF differs from the files pinned in FACES: adopting a new MiSans release
is a deliberate change to the pins, reviewed with the slices it produces. Run `pnpm install` first
so the partition is present in node_modules.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import filecmp
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

PACKAGE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PACKAGE_DIR / "src" / "fonts" / "misans"
PARTITION_DIR = PACKAGE_DIR / "node_modules" / "@fontsource-variable" / "noto-sans-sc"

FAMILY = "MiSans"
PACKAGE_URL = "https://hyperos.mi.com/font-download/MiSans.zip"

# CSS weight -> (member of the official zip, its sha256). MiSans names its own weights on a
# 150-700 axis where Regular is 330 and Medium 380; they are the faces a 400 and a 500 request want.
FACES: dict[int, tuple[str, str]] = {
    400: (
        "MiSans/ttf/MiSans-Regular.ttf",
        "9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6",
    ),
    500: (
        "MiSans/ttf/MiSans-Medium.ttf",
        "b03e98374e971594b0b7a9706d0704241f76e1b88556cdda79c5039ef8a638d1",
    ),
}

# Left out of the `extra` slice: the ideographs the partition does not carry.
EXCLUDED_FROM_EXTRA = (
    (0x3400, 0x4DBF),  # CJK Unified Ideographs Extension A
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
    (0x20000, 0x3FFFF),  # Supplementary and Tertiary Ideographic Planes
)

EXTRA_SLICE = "extra"


def subset_options() -> subset.Options:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]  # every feature, e.g. tnum for tabular figures
    options.name_IDs = ["*"]  # every name record: copyright, family, version, manufacturer
    options.name_languages = ["*"]
    options.name_legacy = True
    options.legacy_cmap = True
    options.symbol_cmap = True
    options.glyph_names = True
    options.notdef_outline = True
    options.hinting = True
    options.prune_unicode_ranges = False  # OS/2 keeps the original font's declared ranges
    options.prune_codepage_ranges = False
    options.recalc_bounds = False
    options.recalc_timestamp = False
    options.harfbuzz_repacker = False  # the same table packing whether or not uharfbuzz is installed
    return options


def parse_range(text: str) -> set[int]:
    """A CSS `unicode-range` value ("U+0020-007e,U+00a0") as a set of code points."""
    points: set[int] = set()
    for part in text.split(","):
        part = part.strip().upper().removeprefix("U+")
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-")
            points.update(range(int(start, 16), int(end, 16) + 1))
        else:
            points.add(int(part, 16))
    return points


def format_range(points: list[int]) -> str:
    """Sorted code points as a compact `unicode-range` value."""
    spans: list[str] = []
    start = previous = points[0]
    for point in points[1:] + [-1]:
        if point == previous + 1:
            previous = point
            continue
        spans.append(f"U+{start:04X}" if start == previous else f"U+{start:04X}-{previous:04X}")
        start = previous = point
    return ", ".join(spans)


def load_partition() -> tuple[list[tuple[str, set[int]]], str]:
    unicode_json = PARTITION_DIR / "unicode.json"
    if not unicode_json.exists():
        sys.exit(f"build-misans: {unicode_json} is missing; run `pnpm install` first")
    raw: dict[str, str] = json.loads(unicode_json.read_text(encoding="utf-8"))
    version = json.loads((PARTITION_DIR / "package.json").read_text(encoding="utf-8"))["version"]
    # Google's ranges overlap: a numbered CJK slice also lists the ASCII and punctuation that
    # co-occur with its characters, and the script slices (latin, latin-ext, ...) come last. A
    # browser tries overlapping faces last-declared first, so under the Noto CSS a code point is
    # fetched from the last slice that lists it. Assigning each code point to that slice alone
    # gives slices that load the same way and share almost nothing. The exception: the subsetter
    # adds a requested character's Bidi mirror to the cut, so the pairs ≤ ≥, 〈 〉 and ＜ ＞ are
    # held, and declared, by two slices each. That is harmless: a browser takes the last-declared
    # face, as it does under Noto.
    taken: set[int] = set()
    slices: list[tuple[str, set[int]]] = []
    for key, value in reversed(list(raw.items())):
        points = parse_range(value) - taken
        taken |= points
        slices.append((key.strip("[]"), points))
    slices.reverse()
    return slices, version


def read_faces(package: Path) -> dict[int, bytes]:
    faces: dict[int, bytes] = {}
    with zipfile.ZipFile(package) as archive:
        for weight, (member, expected) in FACES.items():
            try:
                data = archive.read(member)
            except KeyError:
                sys.exit(f"build-misans: {package} has no {member}; is it the official MiSans.zip?")
            actual = hashlib.sha256(data).hexdigest()
            if actual != expected:
                sys.exit(
                    f"build-misans: {member} is sha256 {actual}, not the pinned {expected}.\n"
                    "A different MiSans release: update FACES deliberately and review the output."
                )
            faces[weight] = data
    return faces


_FACE_DATA: dict[int, bytes] = {}


def _init_worker(faces: dict[int, bytes]) -> None:
    """Hands each worker the TTFs `build()` already read and verified."""
    _FACE_DATA.update(faces)


def _cut(job: tuple[int, str, list[int]]) -> tuple[int, str, bytes, list[int]]:
    weight, name, points = job
    options = subset_options()
    font = subset.load_font(io.BytesIO(_FACE_DATA[weight]), options, dontLoadGlyphNames=False)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    # The subsetter keeps name IDs below 256 but drops the higher ones nothing references any more
    # (the labels of stylistic sets a CJK slice has no glyphs for). Every record goes back, so each
    # slice carries the source's name table whole.
    font["name"].names = TTFont(io.BytesIO(_FACE_DATA[weight]), lazy=True)["name"].names
    out = io.BytesIO()
    subset.save_font(font, out, options)
    font.close()
    data = out.getvalue()
    problems, held = compare_with_source(_FACE_DATA[weight], data)
    if problems:
        raise RuntimeError(f"{FAMILY} {weight} {name} is not a faithful cut:\n  " + "\n  ".join(problems[:20]))
    return weight, name, data, held


def compare_with_source(source_data: bytes, cut_data: bytes) -> tuple[list[str], list[int]]:
    """
    Reads the finished WOFF2 back and holds it against the official TTF: every character it maps,
    and every glyph it carries (outline points, on-curve flags, contours, components, hinting
    instructions, advance and side bearings, both directions), must be the source's own, and so
    must every name record. Returns the differences and the characters the cut holds.
    """
    source = TTFont(io.BytesIO(source_data), lazy=True)
    cut = TTFont(io.BytesIO(cut_data))
    problems: list[str] = []
    source_cmap, cut_cmap = source.getBestCmap(), cut.getBestCmap()
    for point, glyph in cut_cmap.items():
        if source_cmap.get(point) != glyph:
            problems.append(f"U+{point:04X} maps to {glyph}, the source maps it to {source_cmap.get(point)}")

    def outline(font: TTFont, glyph_name: str) -> tuple:
        glyf = font["glyf"]
        glyph = glyf[glyph_name]
        glyph.expand(glyf)
        program = glyph.program.getBytecode() if hasattr(glyph, "program") else b""
        if glyph.isComposite():
            parts = tuple(
                (c.glyphName, c.x, c.y, getattr(c, "transform", None), c.flags & 0x0204)
                for c in glyph.components
            )
            return ("composite", parts, program)
        if glyph.numberOfContours == 0:
            return ("empty",)
        coordinates, ends, flags = glyph.getCoordinates(glyf)
        return ("simple", tuple(coordinates), tuple(ends), tuple(f & 0x01 for f in flags), program)

    for glyph_name in cut.getGlyphOrder():
        if outline(source, glyph_name) != outline(cut, glyph_name):
            problems.append(f"glyph {glyph_name}: outline or instructions differ")
        for table in ("hmtx", "vmtx"):
            if table in source and source[table][glyph_name] != cut[table][glyph_name]:
                problems.append(f"glyph {glyph_name}: {table} metrics differ")

    def names(font: TTFont) -> set[tuple]:
        return {
            (r.platformID, r.platEncID, r.langID, r.nameID, r.toUnicode()) for r in font["name"].names
        }

    if names(source) != names(cut):
        problems.append("the name table differs from the source's")
    if source["OS/2"].fsType != cut["OS/2"].fsType:
        problems.append("OS/2 fsType differs from the source's")
    return problems, sorted(cut_cmap)


def font_version(data: bytes) -> str:
    font = subset.load_font(io.BytesIO(data), subset_options())
    version = font["name"].getDebugName(5)
    font.close()
    return version.removeprefix("Version ")


def build(package: Path, target: Path, jobs: int) -> None:
    faces = read_faces(package)
    partition, partition_version = load_partition()
    coverage = {w: set(TTFont(io.BytesIO(d), lazy=True).getBestCmap()) for w, d in faces.items()}
    if len({frozenset(points) for points in coverage.values()}) != 1:
        sys.exit("build-misans: the weights cover different characters; slices would not line up")
    covered = next(iter(coverage.values()))
    in_partition = set().union(*(points for _, points in partition))
    extra = sorted(
        point
        for point in covered - in_partition
        if not any(start <= point <= end for start, end in EXCLUDED_FROM_EXTRA)
    )

    slices = [(name, sorted(points & covered)) for name, points in partition]
    slices = [(name, points) for name, points in slices if points]
    if extra:
        slices.append((EXTRA_SLICE, extra))

    work = [(weight, name, points) for weight in FACES for name, points in slices]
    results: dict[tuple[int, str], tuple[bytes, list[int]]] = {}
    with concurrent.futures.ProcessPoolExecutor(
        max_workers=jobs, initializer=_init_worker, initargs=(faces,)
    ) as pool:
        for weight, name, data, held in pool.map(_cut, work, chunksize=1):
            results[(weight, name)] = (data, held)
            print(f"  {FAMILY} {weight} {name}: {len(held)} characters, {len(data)} bytes")

    target.mkdir(parents=True, exist_ok=True)
    faces_css: list[str] = []
    for weight in FACES:
        for name, _ in slices:
            data, held = results[(weight, name)]
            file = f"misans-{weight}-{name}.woff2"
            (target / file).write_bytes(data)
            faces_css.append(
                "@font-face {\n"
                f'  font-family: "{FAMILY}";\n'
                "  font-style: normal;\n"
                "  font-display: swap;\n"
                f"  font-weight: {weight};\n"
                f'  src: url("./{file}") format("woff2");\n'
                f"  unicode-range: {format_range(held)};\n"
                "}\n"
            )

    version = font_version(faces[400])
    header = f"""/**
 * GENERATED by packages/ui/scripts/build-misans.py; do not edit, rerun the script.
 *
 * {FAMILY} {version} by Xiaomi Inc., from the official package {PACKAGE_URL}:
 * MiSans Regular as weight 400 and MiSans Medium as weight 500, {len(slices)} slices each: one per
 * slice of the unicode-range partition of @fontsource-variable/noto-sans-sc {partition_version} that
 * MiSans has characters for, plus `{EXTRA_SLICE}` for its other non-ideograph characters. Ideographs
 * outside the partition are not shipped and fall back to the system CJK face.
 *
 * Licence: the MiSans Font Intellectual Property License Agreement (fonts/LICENSES/misans.txt).
 * The software must state that it uses MiSans, and the font is never offered on its own.
 */
"""
    (target / "misans.css").write_text(header + "\n" + "\n".join(faces_css), encoding="utf-8")


def owned_files(directory: Path) -> set[str]:
    if not directory.exists():
        return set()
    return {
        path.name
        for path in directory.iterdir()
        if path.name == "misans.css" or (path.name.startswith("misans-") and path.suffix == ".woff2")
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut Frost's MiSans slices from MiSans.zip.")
    parser.add_argument("package", type=Path, help="the official MiSans.zip")
    parser.add_argument("--check", action="store_true", help="compare with the committed files")
    parser.add_argument("--jobs", type=int, default=min(4, os.cpu_count() or 1))
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="misans-") as scratch:
        fresh = Path(scratch)
        build(args.package, fresh, args.jobs)
        built, committed = owned_files(fresh), owned_files(OUT_DIR)
        if args.check:
            drift = sorted(built ^ committed) + sorted(
                name
                for name in built & committed
                if not filecmp.cmp(fresh / name, OUT_DIR / name, shallow=False)
            )
            if drift:
                sys.exit("build-misans: src/fonts/misans/ differs from the package:\n  " + "\n  ".join(drift))
            print(f"build-misans: src/fonts/misans/ is current ({len(built)} files).")
            return
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for name in committed - built:
            (OUT_DIR / name).unlink()
        for name in sorted(built):
            shutil.copyfile(fresh / name, OUT_DIR / name)
        total = sum((OUT_DIR / name).stat().st_size for name in built if name.endswith(".woff2"))
        print(f"build-misans: wrote {len(built)} files to src/fonts/misans/ ({total} bytes of woff2).")


if __name__ == "__main__":
    main()
