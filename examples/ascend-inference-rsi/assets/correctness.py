#!/usr/bin/env python3
"""Send a fixed prompt set to a running server and record or compare output hashes.

Usage:
  correctness.py --save baseline_hashes.json
  correctness.py --check baseline_hashes.json

The same prompt file, temperature 0 and seed 0 are used for the baseline and every
candidate; a mismatch means the candidate changed the output and must be rejected.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request


def chat(base, model, prompt, max_tokens):
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "seed": 0,
            "max_tokens": max_tokens,
        }
    ).encode()
    req = urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=900) as response:
        data = json.load(response)
    return data["choices"][0]["message"]["content"]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--prompts", default=os.path.join(here, "prompts.jsonl"))
    parser.add_argument("--save")
    parser.add_argument("--check")
    args = parser.parse_args()

    hashes = {}
    for line in open(args.prompts, encoding="utf-8"):
        if not line.strip():
            continue
        item = json.loads(line)
        text = chat(args.base, args.model, item["prompt"], item.get("max_tokens", 64))
        hashes[item["id"]] = hashlib.sha256(text.encode()).hexdigest()

    if args.save:
        with open(args.save, "w", encoding="utf-8") as fh:
            json.dump(hashes, fh, indent=2, ensure_ascii=False)
        print(json.dumps({"saved": len(hashes), "file": args.save}))
        return

    if args.check:
        baseline = json.load(open(args.check, encoding="utf-8"))
        mismatch = [key for key, value in hashes.items() if baseline.get(key) != value]
        print(json.dumps({"checked": len(hashes), "mismatch": mismatch}, ensure_ascii=False))
        sys.exit(1 if mismatch else 0)

    print(json.dumps(hashes, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
