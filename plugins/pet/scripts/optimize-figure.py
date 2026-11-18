#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow==11.1.0"]
# ///
"""
The figure pack's textures as WebP — the one change this repository makes to its vendored art.

`ui/figure/` comes from Coopanion unmodified (see the README beside it), and its textures are
PNG. A pet open draws about fifty of them: 1.2 MB of art that a browser must pull before she can
be drawn at all, which on a slow link is most of the wait. Re-encoded as WebP at quality 90 with
a lossless alpha channel they are about a fifth of that, and the difference is not visible at the
size she is drawn (280 CSS px tall from ~500 px sources).

Run it once, from the package directory, with the pack's PNGs still in place:

    uv run scripts/optimize-figure.py           # dry run: what it would write
    uv run scripts/optimize-figure.py --write   # write the .webp beside each .png, then delete it

The rig keeps asking for `.png` names — `widget.js`'s `packUrl` is the single place a pack path
becomes a URL, and it rewrites the extension — so the vendored code needs no edit, and a future
re-vendor just runs this again.
"""

import argparse
import io
import os
import sys

from PIL import Image

# Quality 90 with a lossless alpha channel: at the drawn size the art is indistinguishable from
# the PNG (composited PSNR ≥ 33 dB on every texture), and alpha edges — where a cut-out figure
# actually shows damage — carry no loss at all.
QUALITY = 90
ALPHA_QUALITY = 100
METHOD = 6


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="write the files (default: dry run)")
    ap.add_argument("--dir", default=os.path.join("ui", "figure"), help="pack directory")
    args = ap.parse_args()
    if not os.path.isdir(args.dir):
        print(f"no such directory: {args.dir}", file=sys.stderr)
        return 1

    before = after = 0
    files = 0
    for root, _, names in os.walk(args.dir):
        for name in sorted(names):
            if not name.lower().endswith(".png"):
                continue
            png = os.path.join(root, name)
            webp = png[: -len(".png")] + ".webp"
            with Image.open(png) as im:
                out = io.BytesIO()
                im.convert("RGBA").save(
                    out,
                    "WEBP",
                    lossless=False,
                    quality=QUALITY,
                    alpha_quality=ALPHA_QUALITY,
                    method=METHOD,
                )
            data = out.getvalue()
            before += os.path.getsize(png)
            after += len(data)
            files += 1
            if args.write:
                with open(webp, "wb") as f:
                    f.write(data)
                os.remove(png)
    print(
        f"{files} textures: {before / 1048576:.1f} MB PNG -> {after / 1048576:.1f} MB WebP "
        f"({after * 100 // max(before, 1)}%)"
        + ("" if args.write else "  [dry run]")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
