#!/usr/bin/env python3
"""Validate frozen-State evaluation matrices and report repeated-test statistics.

Read-only: no model calls, target execution, journal changes or scoreboard writes.
Scores use the native Evaluation Center's 0..100 scale and equal Case weighting.
"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import statistics
import sys

sys.dont_write_bytecode = True
from artifacts import digest, read_json, require, strings, tree
import resource_usage
import workflow


def nonempty(value, label):
    require(isinstance(value, str) and value.strip(), f"Missing {label}")


def positive(value, label):
    require(type(value) is int and value > 0, f"{label} must be a positive integer")


def finite(value, label, maximum=None):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0
            and (maximum is None or value <= maximum), f"Invalid {label}")


def validate_matrices(state, matrices):
    """Bind complete, unique trials to the journal's frozen plan and State versions."""
    require(state["phase"] in ("evaluation", "evaluated"), "Evaluation requires recorded frozen States")
    require(isinstance(matrices, list) and matrices, "Matrix record must be a nonempty list")
    expected = {(p["variant"], p["benchmark_id"], p["case_id"], p["run"])
                for p in state["evaluation_plan"]}
    expected_groups = {(variant, benchmark) for variant, benchmark, _, _ in expected}
    seen, sessions, groups = set(), set(), set()
    config = state["config"]
    for matrix in matrices:
        require(isinstance(matrix, dict), "Invalid matrix")
        variant, benchmark = matrix["variant"], matrix["benchmark_id"]
        nonempty(variant, "variant")
        nonempty(benchmark, "benchmark_id")
        group = (variant, benchmark)
        require(group in expected_groups and group not in groups, "Unexpected or duplicate matrix")
        groups.add(group)
        snapshot = state["measured_states"][variant]
        positive(snapshot["version"], "State version")
        require(isinstance(snapshot["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", snapshot["sha256"]),
                "Invalid frozen State digest")
        # The ordinary worker protocol has no digest field; the controller checks the
        # archive/live State around each dispatch. Reject conflicting optional metadata.
        if "state_sha256" in matrix:
            require(matrix["state_sha256"] == snapshot["sha256"], "Frozen State digest mismatch")
        require(isinstance(matrix["cells"], list), "Matrix cells must be a list")
        for cell in matrix["cells"]:
            require(isinstance(cell, dict), "Invalid scored cell")
            require(type(cell.get("protocol_version")) is int and cell["protocol_version"] == 1,
                    "Invalid evaluation protocol")
            positive(cell["run"], "Run index")
            positive(cell["expected_version"], "Measured State version")
            nonempty(cell["case_id"], "case_id")
            key = (variant, benchmark, cell["case_id"], cell["run"])
            require(key in expected and key not in seen, "Unexpected or duplicate evaluation cell")
            require(cell["status"] == "ok" and cell["agent_id"] == config["test_agent_id"], "Invalid scored cell")
            require(cell["expected_version"] == snapshot["version"], "State version mismatch")
            require(all(cell[k] == config["runtime"]["target"][k]
                        for k in ("provider", "model_id", "thinking_level")), "Evaluation runtime mismatch")
            finite(cell["score"], "score", 100)
            require("cost" in cell, "Missing cost; use null for unknown usage")
            if cell["cost"] is not None:
                finite(cell["cost"], "cost")
            require(type(cell.get("duration_ms")) is int and cell["duration_ms"] >= 0, "Invalid duration_ms")
            nonempty(cell["session_id"], "evaluation session id")
            require(cell["session_id"] not in sessions, "A trial/session cannot score multiple cells or States")
            sessions.add(cell["session_id"])
            seen.add(key)
    require(groups == expected_groups and seen == expected, "Incomplete evaluation matrix")
    return sessions


def statistics_for(scores):
    """The sampling unit is a complete evaluation repetition, not a pooled Case."""
    std = statistics.stdev(scores) if len(scores) > 1 else None
    return {"repetition_scores": scores, "mean": statistics.mean(scores), "std": std,
            "sample_std": std,
            "sample_variance": statistics.variance(scores) if len(scores) > 1 else None}


def known_mean(values):
    known = [value for value in values if value is not None]
    return round(statistics.mean(known), 6) if known else None


def comparison(matrices):
    indexed = {m["variant"]: m for m in matrices}
    return {"baseline": {k: indexed["baseline"][k] for k in ("mean", "std", "repetition_scores")}
            if "baseline" in indexed else None,
            "final": {k: indexed["final"][k] for k in ("mean", "std", "repetition_scores")},
            "final_minus_baseline": statistics_for([f - b for f, b in zip(
                indexed["final"]["repetition_scores"], indexed["baseline"]["repetition_scores"], strict=True)])
            if "baseline" in indexed else None,
            "baseline_timing": "Pre-training State saved before construction; measured only after global freeze"}


def training_record(state):
    units = []
    for case_id, case in state["cases"].items():
        curve = []
        for attempt in case.get("attempts", []):
            valid = workflow.measured(attempt)
            result = attempt.get("result", {})
            feedback = attempt.get("feedback", {})
            curve.append({"attempt": attempt["number"], "revision": attempt["revision"],
                          "virtual_pass_rate": result.get("pass_rate") if valid else None,
                          "valid_measurement": bool(valid), "execution_status": attempt.get("execution_status"),
                          "passed": result.get("passed") if valid else None,
                          "total": result.get("total") if valid else None,
                          "coverage_complete": attempt.get("coverage_complete"),
                          "accepted": attempt.get("accepted", False),
                          "feedback_action": feedback.get("next_action"), "classification": feedback.get("classification"),
                          "artifact_path": attempt.get("directory")})
        units.append({"case_id": case_id, "skill_ids": [f"{case_id}/{name}" for name in case.get("skills", [])],
                      "skills_sha256": case.get("final_sha256"), "stop_reason": case.get("reason"),
                      "final_was_tested": case.get("final_was_tested"),
                      "virtual_curve": curve, "practice_revisions": len(case.get("revisions", [])),
                      "revision_history": [{k: revision.get(k) for k in
                                            ("revision", "skills_sha256", "outputs_sha256", "hypothesis")}
                                           for revision in case.get("revisions", [])],
                      "cost_allocation": "Joint construction of the listed skills; count shared operations once"})
    return {"benchmark_score_curve": None, "accuracy": None, "std": None,
            "reason": "OpenSkill uses virtual feedback; target Train scores are not collected during construction",
            "units": units}


def resources(state, matrices, measurements):
    data = resource_usage.ledger(measurements or {"schema_version": 1, "records": []})
    records = data["records"]
    cells = {c["session_id"]: (m["variant"], c) for m in matrices for c in m["cells"]}
    bound = set()
    expected = {(p["variant"], p["case_id"], p["run"]) for p in state["evaluation_plan"]}
    for row in records:
        if row["phase"] == "train":
            require(row["case_id"] in state["config"]["case_ids"], "Training usage belongs to another Case")
        if row["phase"] != "test":
            continue
        require(type(row["run"]) is int and (row["variant"], row["case_id"], row["run"]) in expected,
                "Test usage differs from the evaluation plan")
        session = row["session_id"]
        require(isinstance(session, str) and session.strip(), "Test usage needs a native trial/session id")
        if session not in cells:
            require(row["status"] != "completed", "Completed test usage has no matching scored cell")
            continue  # Failed attempts remain in resource totals, never in the score matrix.
        variant, cell = cells[session]
        require(row["status"] == "completed", "Scored trial resource status must be completed")
        require(session not in bound and row["variant"] == variant and row["case_id"] == cell["case_id"]
                and row["run"] == cell["run"], "Test resource identity mismatch or duplicate")
        if cell["cost"] is not None and row["cost_usd"] is not None:
            require(math.isclose(cell["cost"], row["cost_usd"], abs_tol=1e-6), "Test cost disagrees with scored cell")
        if row["cost_usd"] is None:
            row["cost_usd"] = cell["cost"]
        bound.add(session)
    for session, (variant, cell) in cells.items():
        if session in bound:
            continue
        records.append({"record_id": "test:" + session, "phase": "test", "case_id": cell["case_id"],
                        "variant": variant, "run": cell["run"], "session_id": session, "status": "completed",
                        "usage_ids": ["session:" + session], "artifact_paths": [],
                        **resource_usage.normalize({"cost_usd": cell["cost"], "duration_ms": cell["duration_ms"]})})
        data["coverage"]["test"] = "partial"
    seen = set()
    for row in records:
        require(not seen.intersection(row["usage_ids"]), "Usage overlaps a scored trial or controller summary")
        seen.update(row["usage_ids"])
    covered_train = {r["case_id"] for r in records if r["phase"] == "train"}
    if covered_train != set(state["config"]["case_ids"]):
        data["coverage"]["train"] = "partial" if covered_train else "unknown"
    totals = {phase: resource_usage.summarize([r for r in records if r["phase"] == phase], data["coverage"][phase])
              for phase in resource_usage.PHASES}
    complete = all(v == "complete" for v in data["coverage"].values())
    return {"records": records, "totals": totals,
            "experiment_total": resource_usage.summarize(records, "complete" if complete else "partial"),
            "experiment_time": data["experiment_time"]}


def report(state, matrices, time, summary, measurements=None):
    validate_matrices(state, matrices)
    nonempty(time, "time")
    timestamp = datetime.fromisoformat(time.replace("Z", "+00:00"))
    require(timestamp.tzinfo is not None and timestamp.utcoffset() == timezone.utc.utcoffset(timestamp),
            "Measurement time must include the UTC timezone")
    nonempty(summary, "public summary")
    config = state["config"]
    runs = config["runs"]
    runtime = config["runtime"]["target"]
    usage = resources(state, matrices, measurements)
    metric = config.get("reporting_metric", {"name": "benchmark_score", "definition": "Native 0..100 score"})
    case_ids = config["test_case_ids"] if config.get("test_benchmark_id") else config["case_ids"]
    indexed = {(m["variant"], m["benchmark_id"]): m for m in matrices}
    ordered = list(dict.fromkeys((p["variant"], p["benchmark_id"]) for p in state["evaluation_plan"]))
    results = []
    for variant, benchmark in ordered:
        matrix = indexed[variant, benchmark]
        cells = {(c["case_id"], c["run"]): c for c in matrix["cells"]}
        repeated = [statistics.mean(cells[case, run]["score"] for case in case_ids)
                    for run in range(1, runs + 1)]
        scores = statistics_for(repeated)
        cases, scoreboard_cases = [], []
        for case in case_ids:
            trials = [{key: cells[case, run][key] for key in ("score", "cost", "duration_ms", "session_id")}
                      for run in range(1, runs + 1)]
            case_stats = statistics_for([trial["score"] for trial in trials])
            detailed_trials = []
            for run in range(1, runs + 1):
                cell = cells[case, run]
                resource = next(r for r in usage["records"] if r["phase"] == "test" and r["session_id"] == cell["session_id"])
                detailed_trials.append({"run": run, "score": cell["score"], "accuracy": cell["score"]
                                        if metric["name"] == "accuracy" else None, "resources": resource})
            case_resources = [r for r in usage["records"] if r["phase"] == "test"
                              and r["variant"] == variant and r["case_id"] == case]
            cases.append({"case_id": case, **case_stats, "trials": detailed_trials,
                          "resources": resource_usage.summarize(case_resources, usage["totals"]["test"]["coverage"])})
            scoreboard_cases.append({"case": case, "score": case_stats["mean"],
                                     "cost": known_mean(t["cost"] for t in trials),
                                     "duration_ms": round(statistics.mean(t["duration_ms"] for t in trials)),
                                     "runs": trials})
        snapshot = state["measured_states"][variant]
        deviation = (f"sample SD {scores['sample_std']:.2f} percentage points"
                     if scores["sample_std"] is not None else "sample SD unavailable for one repetition")
        scoreboard = {"time": timestamp.isoformat().replace("+00:00", "Z"),
                      "agent_id": config["test_agent_id"], "version": snapshot["version"],
                      **{key: runtime[key] for key in ("provider", "model_id", "thinking_level")},
                      "summary_title": f"OpenSkill {variant}: {runs} frozen-State test repetitions",
                      "summary": f"{summary} Complete-test mean {scores['mean']:.2f}/100; {deviation}.",
                      "score": round(scores["mean"], 2),
                      "cost": known_mean(c["cost"] for c in scoreboard_cases),
                      "duration_ms": round(statistics.mean(c["duration_ms"] for c in scoreboard_cases)),
                      "cases": scoreboard_cases}
        known = [c["cost"] for c in matrix["cells"] if c["cost"] is not None]
        unknown = len(matrix["cells"]) - len(known)
        results.append({"variant": variant, "benchmark_id": benchmark,
                        "agent_id": config["test_agent_id"], "version": snapshot["version"],
                        "state_sha256": snapshot["sha256"], "runtime": runtime, "runs": runs,
                        "case_ids": case_ids, **scores, "cases": cases,
                        "resources": resource_usage.summarize([r for r in usage["records"] if r["phase"] == "test"
                                                               and r["variant"] == variant], usage["totals"]["test"]["coverage"]),
                        "accuracy": {"mean": scores["mean"], "std": scores["std"], "scale": "0..100"}
                        if metric["name"] == "accuracy" else None,
                        "mean_case_sample_variance": statistics.mean(c["sample_variance"] for c in cases)
                        if runs > 1 else None,
                        "scored_trial_cost": {"known_total": sum(known), "unknown_trials": unknown,
                                              "total": None if unknown else sum(known)},
                        "summed_trial_duration_ms": sum(c["duration_ms"] for c in matrix["cells"]),
                        "scoreboard_record": scoreboard})
    train = training_record(state)
    for unit in train["units"]:
        rows = [r for r in usage["records"] if r["phase"] == "train" and r["case_id"] == unit["case_id"]]
        unit["resources"] = resource_usage.summarize(rows, usage["totals"]["train"]["coverage"] if rows else "unknown")
        unit["resource_record_ids"] = [r["record_id"] for r in rows]
    binding = config.get("benchmark_binding", {})
    return {"report_schema_version": "openskill-results/v1", "experiment_version": config.get("experiment_version"),
            "versions": {"declared": config.get("component_versions", {}),
                         "runtime": config["runtime"], "benchmark_source": binding.get("source_pin"),
                         "benchmark_packages": {k: {f: binding[k].get(f) for f in ("id", "version", "manifest_sha256")}
                                                for k in ("construction", "evaluation") if k in binding},
                         "states": state["measured_states"], "library_sha256": state.get("library", {}).get("sha256")},
            "metric": metric, "comparison": comparison(results), "training": train, "resources": usage,
            "protocol": "single-construction-repeated-evaluation", "score_scale": "0..100",
            "standard_deviation": "sample, ddof=1", "aggregation": "equal Case mean within each repetition",
            "matrix_sha256": digest(matrices), "matrices": results}


def aggregate(reports, benchmark_ids):
    """Equal benchmark weighting within each repeat, then sample SD across repeats."""
    strings(benchmark_ids, "selected benchmark ids")
    require(isinstance(reports, list) and reports, "No reports to aggregate")
    indexed, seen_benchmarks, sessions = {}, set(), set()
    first = reports[0]["matrices"]
    variants = [matrix["variant"] for matrix in first]
    runs, runtime = first[0]["runs"], first[0]["runtime"]
    for item in reports:
        require(item["metric"]["name"] == reports[0]["metric"]["name"], "Benchmark metric kinds differ")
        matrices = item["matrices"]
        require(matrices and {m["variant"] for m in matrices} == set(variants), "Comparison variants differ")
        benchmark = matrices[0]["benchmark_id"]
        require(benchmark in benchmark_ids and benchmark not in seen_benchmarks,
                "Unexpected or repeated benchmark; independent training runs cannot be pooled")
        seen_benchmarks.add(benchmark)
        for matrix in matrices:
            require(matrix["benchmark_id"] == benchmark and matrix["runs"] == runs
                    and matrix["runtime"] == runtime, "Benchmarks must share repetition count and runtime")
            trial_ids = {t["session_id"] for c in matrix["scoreboard_record"]["cases"] for t in c["runs"]}
            require(not sessions & trial_ids, "Trial/session reused across benchmarks")
            sessions.update(trial_ids)
            indexed[benchmark, matrix["variant"]] = matrix
    require(seen_benchmarks == set(benchmark_ids), "Selected benchmarks are incomplete")
    combined, usage_ids = [], set()
    for item in reports:
        for row in item["resources"]["records"]:
            require(not usage_ids.intersection(row["usage_ids"]), "Resource usage reused across benchmarks")
            usage_ids.update(row["usage_ids"])
            combined.append(row)
    totals = {phase: resource_usage.summarize([r for r in combined if r["phase"] == phase],
              "complete" if all(p["resources"]["totals"][phase]["coverage"] == "complete" for p in reports) else "partial")
              for phase in resource_usage.PHASES}
    variants_stats = [{"variant": variant, **statistics_for([
        statistics.mean(indexed[b, variant]["repetition_scores"][r] for b in benchmark_ids)
        for r in range(runs)])} for variant in variants]
    return {"benchmark_ids": benchmark_ids, "runs": runs, "runtime": runtime, "score_scale": "0..100",
            "aggregation": "equal benchmark mean within each repetition", "standard_deviation": "sample, ddof=1",
            "variants": variants_stats, "comparison": comparison(variants_stats), "resource_totals": totals,
            "experiment_resource_total": resource_usage.summarize(combined,
                "complete" if all(t["coverage"] == "complete" for t in totals.values()) else "partial"),
            "metric": reports[0]["metric"]["name"]}


def from_journal(out, record, time, summary, measurements=None):
    # Import here to keep experiment.py's use of the shared matrix validator acyclic.
    import experiment
    out = Path(out)
    state = experiment.load(out)[0]
    require(state["phase"] in ("evaluation", "evaluated") and "measured_states" in state,
            "Statistics require global freeze and recorded evaluation States")
    require(digest(tree(out / "library")) == state["library"]["sha256"], "Frozen library changed")
    matrices = read_json(experiment.report_path(out, record))
    if state["phase"] == "evaluated":
        require(state.get("evaluation_outcome") == "complete" and digest(matrices) == state["matrix_sha256"],
                "Report differs from the completed evaluation record")
    usage = read_json(experiment.report_path(out, measurements)) if measurements else None
    result = report(state, matrices, time, summary, usage)
    # Report lifecycle timing from journal events, without mutating historical state.
    finished = {}
    for file in sorted((out / "journal").glob("*.json")):
        event = read_json(file)
        if event["request"].get("action") == "finish-case":
            finished[event["request"]["case_id"]] = event["time"]
    for unit in result["training"]["units"]:
        unit["construction_time"] = resource_usage.timing({
            "started_at": state["cases"][unit["case_id"]].get("started_at"),
            "finished_at": finished.get(unit["case_id"])})
        unit["skills"] = []
        for skill_id in unit["skill_ids"]:
            directory = out / "library/tasks" / skill_id
            text = (directory / "SKILL.md").read_text(encoding="utf-8")
            frontmatter = text.split("---", 2)[1]
            version = re.search(r"^version:\s*(.+)$", frontmatter, re.M)
            unit["skills"].append({"id": skill_id, "version": version[1].strip().strip("\"'") if version else None,
                                   "sha256": digest(tree(directory))})
    if measurements:
        result["measurements_sha256"] = digest(usage)
    result["source"] = {"out": str(out.resolve()), "record": record, "frozen_at": state["frozen_at"]}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    single = sub.add_parser("report", help="report complete matrices from one frozen experiment")
    single.add_argument("out", type=Path)
    single.add_argument("record", help="matrix JSON path relative to OUT")
    single.add_argument("--measurements", help="resource ledger JSON path relative to OUT")
    multiple = sub.add_parser("aggregate", help="aggregate every benchmark declared in a campaign manifest")
    multiple.add_argument("manifest", type=Path)
    for command in (single, multiple):
        command.add_argument("--time", required=True)
        command.add_argument("--summary", required=True, help="public summary without grading details")
    args = parser.parse_args()
    try:
        if args.command == "report":
            result = from_journal(args.out, args.record, args.time, args.summary, args.measurements)
        else:
            manifest = read_json(args.manifest)
            entries = manifest["experiments"]
            require(isinstance(entries, list) and entries, "No campaign experiments")
            reports = [from_journal(e["out"], e["record"], args.time, args.summary, e.get("measurements")) for e in entries]
            result = {"overall": aggregate(reports, manifest["benchmark_ids"]), "benchmarks": reports}
            result["experiment_time"] = resource_usage.timing(manifest.get("experiment_time", {}))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        print(json.dumps({"status": "failed", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
