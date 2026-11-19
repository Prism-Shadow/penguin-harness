#!/usr/bin/env python3
"""Small accuracy gate for the serving run.

The MTP path on this stack is not bit-stable across repeated runs, so an exact
output hash cannot be the only correctness check. This script asks a fixed set
of questions with temperature 0 and requires the reference answer to appear in
the response. A candidate must stay within one question of the baseline.

Usage:
  accuracy.py --save baseline_accuracy.json
  accuracy.py --check baseline_accuracy.json
"""

import argparse
import json
import os
import re
import sys
import urllib.request


def ask(base, model, question, max_tokens=256):
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": question}],
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
    return data["choices"][0]["message"]["content"] or ""


def matches(text, answer):
    if re.fullmatch(r"[0-9.]+", answer):
        return re.search(r"(?<![0-9.])" + re.escape(answer) + r"(?![0-9.])", text) is not None
    return answer.lower() in text.lower()


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--qa", default=os.path.join(here, "qa.jsonl"))
    parser.add_argument("--save")
    parser.add_argument("--check")
    args = parser.parse_args()

    results = {}
    for line in open(args.qa, encoding="utf-8"):
        if not line.strip():
            continue
        item = json.loads(line)
        text = ask(args.base, args.model, item["question"])
        results[item["id"]] = bool(matches(text, item["answer"]))

    accuracy = sum(results.values()) / len(results)
    summary = {"accuracy": round(accuracy, 3), "correct": sum(results.values()), "total": len(results)}

    if args.save:
        with open(args.save, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary, "results": results}, fh, indent=2)
        print(json.dumps(summary))
        return

    if args.check:
        baseline = json.load(open(args.check, encoding="utf-8"))["summary"]
        allowed = max(1, round(0.05 * baseline["total"]))
        ok = abs(summary["correct"] - baseline["correct"]) <= allowed
        print(json.dumps({"baseline": baseline, "candidate": summary, "ok": ok}))
        sys.exit(0 if ok else 1)

    print(json.dumps({"summary": summary, "results": results}, indent=2))


if __name__ == "__main__":
    main()
