#!/usr/bin/env python3
"""Normalize recorded usage and total disjoint Train/Test/controller measurements.

No pricing guesses, model calls, credential reads or writes to experiment artifacts.
"""

import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from artifacts import read_json, require, strings

TOKEN_KEYS = ("cached_input", "uncached_input", "output", "total_input", "total")
PHASES = ("train", "test", "controller")


def number(value, label, integer=False):
    if value is not None:
        require(type(value) in ((int,) if integer else (int, float))
                and math.isfinite(value) and value >= 0, f"Invalid {label}")
    return value


def tokens(raw, kind="canonical"):
    require(isinstance(raw, dict), "Usage must be an object")
    if kind == "harbor":
        values = {"cached_input": raw.get("n_cache_tokens"), "uncached_input": None,
                  "output": raw.get("n_output_tokens"), "total_input": raw.get("n_input_tokens"), "total": None}
    elif kind == "penguin":
        values = {"cached_input": raw.get("cache_read", raw.get("cacheRead")),
                  "uncached_input": raw.get("cache_write", raw.get("cacheWrite")),
                  "output": raw.get("output"), "total_input": None, "total": raw.get("total")}
    else:
        require(kind == "canonical", "Unknown token source format")
        values = {key: raw.get(key) for key in TOKEN_KEYS}
    for key, value in values.items():
        number(value, key, integer=True)
    cached, uncached, total_input, output = (values[k] for k in ("cached_input", "uncached_input", "total_input", "output"))
    if total_input is not None and uncached is not None:
        require(uncached <= total_input, "Uncached tokens exceed total input")
    if total_input is not None and cached is not None:
        require(cached <= total_input, "Cached tokens exceed total input")
        if uncached is None:
            uncached = values["uncached_input"] = total_input - cached
    if cached is not None and uncached is not None:
        require(total_input is None or total_input == cached + uncached, "Inconsistent input token totals")
        total_input = values["total_input"] = cached + uncached
    if total_input is not None and output is not None:
        require(values["total"] is None or values["total"] == total_input + output, "Inconsistent total tokens")
        values["total"] = total_input + output
    return values


def timestamp(value):
    if value is None:
        return None
    require(isinstance(value, str), "Timestamp must be ISO-8601 text or null")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "Timestamp needs a timezone")
    return parsed


def timing(raw):
    start, end = raw.get("started_at"), raw.get("finished_at")
    a, b = timestamp(start), timestamp(end)
    elapsed = number(raw.get("duration_ms"), "duration_ms", integer=True)
    if a is not None and b is not None:
        require(b >= a, "Finish precedes start")
        derived = round((b - a).total_seconds() * 1000)
        require(elapsed is None or abs(elapsed - derived) <= 1, "Duration disagrees with timestamps")
        elapsed = derived
    return {"started_at": start, "finished_at": end, "duration_ms": elapsed,
            "agent_duration_ms": number(raw.get("agent_duration_ms"), "agent_duration_ms", integer=True)}


def normalize(raw, kind="canonical"):
    require(isinstance(raw, dict), "Resource measurement must be an object")
    if kind == "harbor":
        usage = raw.get("agent_result") or {}
        execution = raw.get("agent_execution") or {}
        agent_time = timing({"started_at": execution.get("started_at"), "finished_at": execution.get("finished_at")})
        measured = {"cost_usd": usage.get("cost_usd"), "tokens": tokens(usage, "harbor"),
                    "started_at": raw.get("started_at"), "finished_at": raw.get("finished_at"),
                    "agent_duration_ms": agent_time["duration_ms"]}
    elif kind == "penguin":
        # These are native cost-summary/token buckets, never a cumulative session
        # counter to add on top of request-level token records.
        measured = {**raw, "cost_usd": None if raw.get("hasUncosted") else raw.get("cost"),
                    "tokens": tokens(raw.get("tokens", raw), "penguin")}
    else:
        require(kind == "canonical", "Unknown resource source format")
        measured = {**raw, "tokens": tokens(raw.get("tokens", {}))}
    return {"cost_usd": number(measured.get("cost_usd"), "cost_usd"),
            **timing(measured), "tokens": measured["tokens"]}


def total(values, coverage):
    known = [v for v in values if v is not None]
    complete = coverage == "complete" and len(known) == len(values)
    return {"total": sum(known) if complete else None, "known_total": sum(known),
            "unknown_records": len(values) - len(known), "coverage": coverage}


def summarize(records, coverage="partial"):
    require(coverage in ("complete", "partial", "unknown"), "Invalid resource coverage")
    starts = [timestamp(r.get("started_at")) for r in records]
    ends = [timestamp(r.get("finished_at")) for r in records]
    complete_time = bool(records) and all(x is not None for x in starts + ends) and coverage == "complete"
    return {"records": len(records), "coverage": coverage,
            "cost_usd": total([r["cost_usd"] for r in records], coverage),
            "summed_duration_ms": total([r["duration_ms"] for r in records], coverage),
            "wall_time_ms": round((max(ends) - min(starts)).total_seconds() * 1000) if complete_time else None,
            "tokens": {k: total([r["tokens"][k] for r in records], coverage) for k in TOKEN_KEYS}}


def ledger(raw):
    require(isinstance(raw, dict) and type(raw.get("schema_version")) is int and raw["schema_version"] == 1,
            "Unsupported measurement ledger")
    require(isinstance(raw.get("records"), list), "Measurement records must be a list")
    coverage = {phase: raw.get("coverage", {}).get(phase, "unknown") for phase in PHASES}
    require(all(c in ("complete", "partial", "unknown") for c in coverage.values()), "Invalid resource coverage")
    ids, usage_ids, records = set(), set(), []
    for row in raw["records"]:
        key = row["record_id"]
        require(isinstance(key, str) and key.strip() and key not in ids, "Duplicate or empty measurement id")
        require(row["phase"] in PHASES, "Invalid measurement phase")
        strings(row["usage_ids"], "disjoint usage ids")
        require(not usage_ids.intersection(row["usage_ids"]), "Overlapping usage: request or parent/child counted twice")
        strings(row["artifact_paths"], "measurement source artifacts")
        require(row.get("status") in ("completed", "failed", "interrupted", "not_started", "unknown"),
                "Invalid measurement status")
        ids.add(key)
        usage_ids.update(row["usage_ids"])
        measured = normalize(row.get("usage", {}), row.get("format", "canonical"))
        records.append({**{k: row.get(k) for k in ("record_id", "phase", "case_id", "variant", "run",
                         "session_id", "status", "usage_ids", "artifact_paths")}, **measured})
    return {"coverage": coverage, "records": records, "experiment_time": timing(raw.get("experiment_time", {}))}


def collect_construction(out, state):
    """Read existing isolated role logs only; request counts exclude resumed history."""
    import experiment
    out = Path(out)
    records = []
    for case_id in state["config"]["case_ids"]:
        directory = out / ".executor" / case_id
        for receipt_file in sorted(directory.glob("**/launcher.process.json")):
            relative = receipt_file.relative_to(out).as_posix()
            receipt = read_json(experiment.report_path(out, relative))
            messages = receipt_file.with_name("messages.jsonl")
            parts, usage_ids = [], []
            artifacts = [relative]
            if messages.exists():
                path = messages.relative_to(out).as_posix()
                payload = experiment.report_path(out, path).read_bytes()
                file_hash = hashlib.sha256(payload).hexdigest()
                artifacts.append(path)
                for index, line in enumerate(payload.splitlines()):
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue  # An interrupted final line is unmeasured; coverage stays partial.
                    event = entry.get("payload", {})
                    if event.get("type") == "token_usage" and isinstance(event.get("request"), dict):
                        parts.append(tokens(event["request"], "penguin"))
                        usage_ids.append("request:" + str(entry.get("id") or f"{file_hash}:{index}"))
            result_path = receipt_file.with_name("result.json")
            result = {}
            if result_path.exists():
                path = result_path.relative_to(out).as_posix()
                result = read_json(experiment.report_path(out, path))
                artifacts.append(path)
            counts = {k: sum(p[k] for p in parts) if parts and all(p[k] is not None for p in parts) else None
                      for k in TOKEN_KEYS}
            records.append({"record_id": relative, "phase": "train", "case_id": case_id,
                            "session_id": result.get("session_id"), "status": receipt["execution_status"],
                            "usage_ids": usage_ids or ["invocation:" + str(receipt_file.resolve())],
                            "artifact_paths": artifacts, "format": "canonical",
                            "usage": {"cost_usd": None, "tokens": counts,
                                      "started_at": receipt["started_at"], "finished_at": receipt["finished_at"]}})
    # Research, controller calls and unreported interrupted requests require reconciliation.
    return {"schema_version": 1, "coverage": {"train": "partial", "test": "unknown", "controller": "unknown"},
            "records": records, "experiment_time": {"started_at": None, "finished_at": None}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    convert = sub.add_parser("normalize")
    convert.add_argument("format", choices=("harbor", "penguin", "canonical"))
    convert.add_argument("source", type=Path)
    collect = sub.add_parser("collect-construction")
    collect.add_argument("out", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "normalize":
            result = normalize(read_json(args.source), args.format)
        else:
            import experiment
            result = collect_construction(args.out, experiment.load(args.out)[0])
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        print(json.dumps({"status": "failed", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
