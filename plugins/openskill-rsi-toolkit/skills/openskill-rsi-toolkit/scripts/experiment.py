#!/usr/bin/env python3
"""Record OpenSkill construction and guard phase changes; never run or score an agent."""

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
from artifacts import check_case, check_library, digest, identifier, read_json, require, strings, tree
import workflow
import oracle
import recovery
import skill_review
import evaluation_results
from native_benchmark import validate_binding

spec = importlib.util.spec_from_file_location("virtual_results", Path(__file__).with_name("virtual-results.py"))
virtual_results = importlib.util.module_from_spec(spec)
spec.loader.exec_module(virtual_results)


def now():
    return datetime.now(timezone.utc).isoformat()


def positive(value, label):
    require(type(value) is int and value > 0, f"{label} must be a positive integer")


def nonempty(value, label):
    require(isinstance(value, str) and value.strip(), f"Missing {label}")


def load(out):
    require(not (out / "journal").is_symlink(), "Journal must not be a symlink")
    records = sorted((out / "journal").glob("*.json"))
    require(records, "No journal: use init for a new experiment")
    previous = None
    for number, path in enumerate(records, 1):
        require(not path.is_symlink() and path.name == f"{number:06d}.json", "Broken journal sequence")
        record = read_json(path)
        require(record["sequence"] == number and record["previous"] == previous, "Broken journal chain")
        previous = digest(record)
    return copy.deepcopy(record["state"]), len(records), previous


@contextmanager
def locked(out):
    require(out.is_dir() and not out.is_symlink(), "Expected a real experiment directory")
    lock = out / ".journal.lock"
    try:
        lock.mkdir()
    except FileExistsError:
        raise ValueError("Journal is locked; verify the owner stopped before recovering the lock") from None
    try:
        yield
    finally:
        lock.rmdir()


def append(out, state, request, sequence, previous):
    folder = out / "journal"
    require(not folder.is_symlink(), "Journal must not be a symlink")
    folder.mkdir(exist_ok=True)
    record = {"sequence": sequence + 1, "previous": previous, "time": now(),
              "request": request, "state": state}
    # Publish a complete file without replacing any earlier event, even after a crash.
    fd, name = tempfile.mkstemp(prefix=".event-", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.link(name, folder / f"{sequence + 1:06d}.json")
    finally:
        os.unlink(name)


def validate_feedback_policy(config):
    require(config.get("feedback_policy") in (None, "strict", "bounded-evidence-v1", "bounded-evidence-v2"),
            "Invalid feedback_policy")
    if workflow.bounded_evidence(config):
        require(config.get("verification_plan_required") is True, "Bounded evidence needs reviewed verification")


def initialize(config):
    config = copy.deepcopy(config)
    config.setdefault("experiment_version", "openskill-" + now())
    nonempty(config["experiment_version"], "experiment_version")
    config.setdefault("reporting_metric", {"name": "benchmark_score", "definition": "Native Benchmark score on 0..100"})
    require(config["reporting_metric"].get("name") in ("benchmark_score", "accuracy"), "Invalid reporting metric")
    nonempty(config["reporting_metric"].get("definition"), "metric definition")
    versions = config.setdefault("component_versions", {})
    require(isinstance(versions, dict), "component_versions must be an object")
    for key in ("harness", "runner", "toolkit", "model_revision"):
        versions.setdefault(key, None)
    skill = Path(__file__).parents[1] / "SKILL.md"
    source = skill.read_bytes()
    version = re.search(r"^version:\s*(\S+)", source.decode(), re.M)
    versions.setdefault("skill", version[1] if version else None)
    versions.setdefault("skill_sha256", hashlib.sha256(source).hexdigest())
    package_path = Path(__file__).parents[3] / "package.json"
    if versions["toolkit"] is None and package_path.is_file():
        package = read_json(package_path)
        if package.get("name") == "@penguinharness/openskill-rsi-toolkit":
            versions["toolkit"] = package.get("version")
    validate_feedback_policy(config)
    if recovery.policy(config) is not None:
        config["recovery_policy"] = recovery.policy(config)
    identifier(config["benchmark_id"])
    identifier(config["test_agent_id"])
    strings(config["case_ids"], "construction cases")
    for case in config["case_ids"]:
        identifier(case)
    test = config.get("test_benchmark_id")
    if test is not None:
        identifier(test)
        require(test != config["benchmark_id"], "Held-out Benchmark must differ from construction Benchmark")
        strings(config.get("test_case_ids"), "test cases")
        for case in config["test_case_ids"]:
            identifier(case)
    else:
        require(not config.get("test_case_ids"), "test_case_ids needs test_benchmark_id")
    defaults = {"runs": 3, "max_refinement_retries": 3, "max_targeted_searches": 3,
                "max_virtual_tests": 60, "construction_timeout_minutes": 360,
                "include_baseline": True, "include_reader_control": False}
    for key, value in defaults.items():
        config.setdefault(key, value)
        if key in ("include_baseline", "include_reader_control"):
            require(type(config[key]) is bool, f"{key} must be boolean")
        else:
            positive(config[key], key)
    validate_binding(config)
    require(config["max_virtual_tests"] <= 60, "At most 60 virtual tests")
    for role in ("construction", "target"):
        for key in ("provider", "model_id", "thinking_level"):
            nonempty(config["runtime"][role][key], f"{role}.{key}")
    return {"schema_version": 2, "phase": "construction", "config": config, "cases": {}}


def case_root(out, case_id):
    path = out / "tasks" / identifier(case_id)
    require(path.resolve().is_relative_to(out.resolve()), "Case path escapes experiment")
    return path


def prefixes(out, state):
    extra = state["config"].get("practice_prefixes", [])
    strings(extra, "practice prefixes", allow_empty=True)
    return ["/opt/openskill-skills", str(out.resolve()), *extra]


def continuation_practice(out, case_id, relative):
    """A stopped practice may be continued only from its own Case directory."""
    rel = Path(relative)
    require(not rel.is_absolute() and rel.parts and ".." not in rel.parts,
            "Continuation practice must be a relative path")
    path = (out / rel).resolve()
    require(path.is_dir() and path.is_relative_to((out / ".executor" / case_id).resolve()),
            "Continuation practice is outside its Case")
    return path


def expired(case, config):
    return workflow.clock(case, config, datetime.now(timezone.utc))["remaining_seconds"] == 0


coverage_complete = oracle.coverage_complete


def evaluation_plan(state):
    config = state["config"]
    benchmark = config.get("test_benchmark_id") or config["benchmark_id"]
    cases = config.get("test_case_ids") if config.get("test_benchmark_id") else config["case_ids"]
    variants = ["baseline", "final"] if config["include_baseline"] else ["final"]
    if config["include_reader_control"]:
        variants.insert(-1, "reader_control")
    return [{"variant": variant, "benchmark_id": benchmark, "case_id": case, "run": run}
            for variant in variants for case in cases for run in range(1, config["runs"] + 1)]


def verify_history(out, root, case):
    for record in case.get("tool_recovery_records", []):
        verify_evidence(out, record)
    for failure in case.get("execution_failures", []):
        verify_evidence(out, failure["evidence"])
    for continuation in case.get("continuations", []):
        verify_evidence(out, continuation["evidence"])
    if case.get("process_review"):
        verify_evidence(out, case["process_review"]["evidence"])
    for revision in case["revisions"]:
        for review in revision.get("skill_review_history", []):
            verify_evidence(out, review["evidence"])
        if revision.get("skill_review"):
            verify_evidence(out, revision["skill_review"]["evidence"])
        number = revision["revision"]
        require(digest(tree(root / "revisions" / f"revision-{number}")) == revision["skills_sha256"],
                "Historical skill revision changed")
        require(digest(tree(root / "practice" / f"revision-{number}")) == revision["outputs_sha256"],
                "Historical practice output changed")
        verify_evidence(out, revision["execution_evidence"])
    for attempt in case["attempts"]:
        if attempt.get("research_fallback"):
            verify_evidence(out, attempt["research_fallback"]["evidence"])
        if attempt.get("planning"):
            verify_evidence(out, attempt["planning"]["evidence"])
        if attempt.get("oracle_review"):
            verify_evidence(out, attempt["oracle_review"])
        if not attempt.get("finished"):
            continue
        folder = Path(attempt["directory"])
        actual = tree(folder, allow_empty=True) if folder.exists() else {}
        require(actual == attempt["evidence"], "Historical verification evidence changed")
        if "feedback" in attempt:
            verify_evidence(out, attempt["feedback"]["evidence"])
    for search in case["searches"]:
        if "result" in search:
            verify_evidence(out, search["result"]["evidence"])
    if "termination_evidence" in case:
        verify_evidence(out, case["termination_evidence"])


def report_path(out, relative):
    path = out / relative
    require(not Path(relative).is_absolute() and ".." not in Path(relative).parts
            and path.resolve().is_relative_to(out.resolve()) and path.is_file()
            and not path.is_symlink(), "Report must exist as a regular file inside OUT")
    return path


def seal_evidence(out, paths):
    strings(paths, "evidence paths")
    result = {}
    for relative in paths:
        payload = report_path(out, relative).read_bytes()
        require(payload.strip(), "Evidence file is empty")
        result[relative] = hashlib.sha256(payload).hexdigest()
    return result


def verify_evidence(out, evidence):
    require(seal_evidence(out, list(evidence)) == evidence, "Recorded execution or recovery evidence changed")


def execution_receipt(out, root, case, config, revision, skills, relative):
    path = report_path(out, relative)
    require(path.resolve().is_relative_to(root.resolve()), "Execution receipt must belong to its Case")
    record = read_json(path)
    require(record["creator_session_id"] == case["creator_session_id"], "Execution used another creator")
    require(record["skills_sha256"] == digest(skills), "Execution receipt describes different skills")
    expected = root / "practice" / f"revision-{revision}"
    require(record["output_directory"] == expected.relative_to(out).as_posix(),
            "Execution receipt describes another practice directory")
    strings(record["commands"], "executed commands")
    require(type(record["exit_code"]) is int, "Execution receipt needs the actual process exit code")
    started, finished = (datetime.fromisoformat(record[k]) for k in ("started_at", "finished_at"))
    require(started.tzinfo is not None and finished.tzinfo is not None, "Execution timestamps need a timezone")
    earliest = (case["attempts"][-1]["feedback"]["recorded_at"] if revision else case["started_at"])
    require(datetime.fromisoformat(earliest) <= started <= finished <= datetime.now(timezone.utc),
            "Practice execution must follow its feedback and cannot be in the future")
    deadline = workflow.clock(case, config, datetime.now(timezone.utc))["deadline_at"]
    require(finished <= datetime.fromisoformat(deadline), "Practice execution exceeded the construction deadline")
    evidence = seal_evidence(out, record["evidence"])
    evidence.update(seal_evidence(out, [relative]))
    return evidence


def stop_record(out, case, reason, request):
    record = read_json(report_path(out, request["record"]))
    require(record["reason"] == reason, "Stop evidence names another reason")
    require(record["workers_stopped"] is True, "Stop role writes before closing the Case")
    nonempty(record["cause"], "stop cause")
    evidence = seal_evidence(out, record["evidence"])
    evidence.update(seal_evidence(out, [request["record"]]))
    if reason in ("verifier_failure", "environment_failure"):
        require(record["recoverable"] is False, "Recoverable failures must continue within the budget")
        strings(record.get("recovery_attempts", []), "recovery attempts", allow_empty=True)
        if not record.get("recovery_attempts"):
            nonempty(record.get("why_recovery_impossible"), "why recovery cannot be attempted")
    if reason == "verifier_failure":
        decision = workflow.feedback(case)
        last = case["attempts"][-1]
        require(decision["next_action"] == "repair_verifier", "Skill/practice faults need their recorded recovery")
        require("skill_structure" not in workflow.issues(last), "A skill structural fault is not a verifier failure")
        if "assertion_failure" in workflow.issues(last):
            nonempty(decision.get("oracle_correction"), "independent evidence of an incorrect verifier")
    if reason == "evidence_limited":
        require(record.get("unresolved") == case["attempts"][-1]["evidence_summary"]["unverified"],
                "Retain every unresolved requirement in the closure record")
    if reason == "context_budget":
        used, limit = record["context_used"], record["context_limit"]
        require(type(used) is int and type(limit) is int and limit > 0 and used >= .9 * limit,
                "Context stop requires an observed usage at or above 90%")
    if reason == "interrupted":
        require(record["interruption"] in ("user_stop", "creator_unavailable", "host_interruption"),
                "Interruption needs an external cause; time exhaustion uses time_budget")
    case["termination_evidence"] = evidence


def validate_matrices(out, state, relative):
    matrices = read_json(report_path(out, relative))
    evaluation_results.validate_matrices(state, matrices)
    return digest(matrices)


def apply_event(out, state, request):
    require(state["schema_version"] == 2,
            "Historical journal is read-only here; resume with its recorded Skill version, never migrate it")
    kind = request["action"]
    config = state["config"]
    if kind in ("freeze", "begin-evaluation", "finish-evaluation"):
        if kind == "freeze":
            require(state["phase"] == "construction", "Freeze only from construction")
            require(set(state["cases"]) == set(config["case_ids"]), "Not every construction Case started")
            require(all(c.get("finished") and c.get("deployable") for c in state["cases"].values()),
                    "Every Case must finish with a valid, uncontaminated last revision")
            plans = {key: case["skills"] for key, case in state["cases"].items()}
            library = check_library(out / "library", plans, prefixes(out, state))
            for case_id, case in state["cases"].items():
                verify_history(out, case_root(out, case_id), case)
                require(library["cases"][case_id]["sha256"] == case["final_sha256"],
                        "Library is not the last recorded revision")
            state.update(phase="frozen", library=library, frozen_at=now())
            state["evaluation_plan"] = evaluation_plan(state)
        else:
            require(state["phase"] in ("frozen", "evaluation"), "Evaluation requires global freeze")
            require(digest(tree(out / "library")) == state["library"]["sha256"], "Frozen library changed")
            if kind == "begin-evaluation":
                require(state["phase"] == "frozen", "Evaluation requires global freeze")
                variants = {p["variant"] for p in state["evaluation_plan"]}
                require(set(request["states"]) == variants, "Snapshot variants differ from evaluation plan")
                for snapshot in request["states"].values():
                    positive(snapshot["version"], "State version")
                    require(isinstance(snapshot["sha256"], str) and
                            re.fullmatch(r"[0-9a-f]{64}", snapshot["sha256"]), "Invalid State SHA-256 digest")
                state["measured_states"] = request["states"]
                state["phase"] = "evaluation"
            else:
                require(state["phase"] == "evaluation", "No evaluation is in progress")
                require(request["outcome"] in ("complete", "incomplete"), "Invalid evaluation outcome")
                nonempty(request["record"], "evaluation matrix/report path")
                report_path(out, request["record"])
                if request["outcome"] == "complete":
                    state["matrix_sha256"] = validate_matrices(out, state, request["record"])
                state.update(phase="evaluated", evaluation_outcome=request["outcome"],
                             evaluation_record=request["record"])
        return

    require(state["phase"] == "construction", "Construction is closed after freeze")
    case_id = identifier(request["case_id"])
    require(case_id in config["case_ids"], "Case is not in the construction set")
    root = case_root(out, case_id)
    if kind == "start-case":
        require(case_id not in state["cases"], "Case already started; resume its recorded state")
        state["cases"][case_id] = {"started_at": now(), "attempts": [], "revisions": [], "searches": []}
        return
    case = state["cases"][case_id]
    require(not case.get("finished"), "Case is closed")
    if kind not in ("revision", "finish-verification", "search-result", "finish-case", "tool-recovery", "execution-failure"):
        require(not expired(case, config), "Construction time budget exhausted")
    if kind == "tool-recovery":
        record = read_json(report_path(out, request["record"]))
        case["tool_recovery"] = recovery.validate_tool_report(record, case, config)
        case.setdefault("tool_recovery_records", []).append(seal_evidence(out, [request["record"]]))
    elif kind == "execution-failure":
        require(recovery.policy(config) is not None and not case.get("pending"), "No recoverable practice phase")
        record = read_json(report_path(out, request["record"]))
        require(record["category"] in ("skill_execution", "delivery"), "Not a recoverable practice failure")
        require(record["revision"] == len(case["revisions"]), "Failure belongs to another practice revision")
        evidence = seal_evidence(out, [request["record"], *record["evidence"]])
        case.setdefault("execution_failures", []).append({**record, "evidence": evidence})
        case["execution_pending"] = len(case["execution_failures"]) - 1
    elif kind == "begin-execution-repair":
        require("execution_pending" in case, "No execution failure to repair")
        limits = recovery.policy(config)
        repairs = case.setdefault("execution_repairs", [])
        require(len(repairs) < limits["max_execution_repairs"], "Execution repair budget exhausted")
        require(not repairs or repairs[-1]["failure"] != case["execution_pending"], "Repair already reserved")
        decision = request["decision"]
        require(decision["action"] in ("revise_skill", "repeat_practice"), "Invalid execution repair action")
        for key in ("diagnosis", "expected_change"):
            nonempty(decision[key], key)
        failure = case["execution_failures"][case["execution_pending"]]
        require(failure["category"] != "skill_execution" or decision["action"] == "revise_skill",
                "Frozen skill failure needs authoring repair")
        repairs.append({"failure": case["execution_pending"], "decision": decision, "started_at": now()})
    elif kind == "plan":
        require("skills" not in case, "Skill plan and creator are fixed")
        strings(request["skills"], "planned skills")
        require(1 <= len(request["skills"]) <= 4, "Plan must contain 1–4 skills")
        for name in request["skills"]:
            identifier(name)
        nonempty(request["creator_session_id"], "creator session")
        case.update(skills=request["skills"], creator_session_id=request["creator_session_id"])
    elif kind == "revision":
        require(request["creator_session_id"] == case["creator_session_id"], "Resume the same creator")
        require(not case.get("pending"), "Cannot revise while verification is active")
        if case["revisions"]:
            require(case["attempts"] and case["attempts"][-1].get("finished"), "Verify before another revision")
            last = case["attempts"][-1]
            require(last["revision"] == len(case["revisions"]) - 1, "Current revision has not been verified")
            require(not last["accepted"] or skill_review.findings(case), "Stop on a complete virtual pass")
            decision = workflow.research_ready(case, config)
            require(decision["next_action"] in ("revise_skill", "repeat_practice"),
                    "Repair the verifier in a new attempt without inventing a practice revision")
        require(len(case["revisions"]) <= config["max_refinement_retries"], "Practice budget exhausted")
        revision = len(case["revisions"])
        skills = tree(root / "skills")
        outputs = tree(root / "practice" / f"revision-{revision}")
        change = "initial" if not revision else decision["next_action"]
        if revision and "execution_pending" in case and case["execution_repairs"][-1]["decision"]["action"] == "revise_skill":
            change = "revise_skill"
        if revision:
            changed = digest(skills) != case["revisions"][-1]["skills_sha256"]
            require(changed == (change == "revise_skill"),
                    "Skill repair must change skills; unchanged skills are repeat_practice, not refinement")
            if change == "revise_skill":
                skill_review.check_change(case, tree(root / "revisions" / f"revision-{revision - 1}"), skills)
        nonempty(request["hypothesis"], "revision hypothesis")
        execution = execution_receipt(out, root, case, config, revision, skills, request["execution_record"])
        snapshot = root / "revisions" / f"revision-{revision}"
        if snapshot.exists():
            require(tree(snapshot) == skills, "Revision snapshot exists with different content")
        else:
            shutil.copytree(root / "skills", snapshot)
        case["revisions"].append({"revision": revision, "skills_sha256": digest(skills),
                                  "outputs_sha256": digest(outputs), "hypothesis": request["hypothesis"],
                                  "change_kind": change, "execution_evidence": execution})
        if "execution_pending" in case:
            case["execution_failures"][case.pop("execution_pending")]["recovered_revision"] = revision
    elif kind == "continuation-delivery":
        require(not case.get("continuations"), "One controlled delivery continuation is allowed")
        require(not case.get("pending"), "Cannot continue while verification is active")
        record_path = report_path(out, request["record"])
        require(record_path.resolve().is_relative_to((root / "review").resolve()),
                "Continuation record belongs under Case review")
        record = read_json(record_path)
        require(record.get("schema_version") == 1, "Invalid continuation record")
        require(record.get("case_id") == case_id, "Continuation belongs to another Case")
        require(record.get("role_success_claimed") is False, "A fenced role is not a completed role")
        stopped = record.get("stopped_role")
        require(isinstance(stopped, dict) and stopped.get("completed") is False,
                "Continuation requires a role that did not complete")
        nonempty(stopped.get("error_code"), "stopped role error code")
        nonempty(stopped.get("diagnosis"), "stopped role diagnosis")
        strings(stopped.get("evidence"), "stopped role evidence")
        revision = record.get("revision")
        require(type(revision) is int and revision == len(case["revisions"]),
                "Continuation revision is not the next practice revision")
        require(len(case["revisions"]) <= config["max_refinement_retries"], "Practice budget exhausted")
        practice_rel = record.get("practice")
        practice = continuation_practice(out, case_id, practice_rel)
        if request.get("practice"):
            require(request["practice"] == practice_rel, "Continuation practice differs from its record")
        plan = read_json(out / ".executor" / case_id / "plan.json")
        skills_sha, outputs_sha = record.get("skills_sha256"), record.get("outputs_sha256")
        require(isinstance(skills_sha, str) and isinstance(outputs_sha, str), "Continuation hashes are missing")
        live_skills = digest(tree(root / "skills"))
        adopt_skills = live_skills != skills_sha
        if adopt_skills:
            require(live_skills == case["revisions"][-1]["skills_sha256"],
                    "Continuation skills differ from the last registered revision")
            source = record.get("skills_source")
            require(isinstance(source, dict) and source.get("imported") is True
                    and source.get("previous_sha256") == live_skills
                    and source.get("sha256") == skills_sha
                    and source.get("source") == practice_rel + "/skills",
                    "Continuation skill import is not recorded")
        target = root / "practice" / f"revision-{revision}"
        require(digest(tree(target)) == outputs_sha, "Continuation outputs changed")
        integrity = record.get("integrity")
        require(isinstance(integrity, dict) and integrity.get("status") == "passed", "Continuation integrity failed")
        require(integrity.get("skills_expected") == integrity.get("skills_actual") == skills_sha,
                "Continuation skill hashes differ")
        require(integrity.get("inputs_expected") == integrity.get("inputs_actual")
                == record.get("inputs_sha256"), "Continuation input hashes differ")
        require(digest(tree(practice / "skills")) == skills_sha, "Stopped practice skills differ")
        require(digest(tree(practice / "view")) == record["inputs_sha256"], "Stopped practice inputs differ")
        actual = tree(target)
        require(actual == record.get("outputs"), "Continuation output map changed")
        require(set(actual) == set(plan["outputs"]), "Continuation delivery is incomplete")
        answers = record.get("answers")
        require(isinstance(answers, dict) and answers, "Continuation must seal its preserved answers")
        require(set(answers).issubset(plan["outputs"]), "Answer path is not a declared output")
        require(all(actual.get(name) == sha for name, sha in answers.items()),
                "A delivered answer changed")
        repair = record.get("repair")
        require(isinstance(repair, dict) and repair.get("actor") in ("controller", "delivery-repair"),
                "Continuation repair owner is missing")
        require(repair.get("answer_files_preserved") is True, "Answer preservation is not asserted")
        strings(repair.get("required_probes"), "required probes", allow_empty=True)
        for probe in repair.get("required_probes", []):
            require(repair.get("probe_status", {}).get(probe) == "pass",
                    f"Required probe did not pass: {probe}")
        nonempty(request.get("hypothesis"), "revision hypothesis")
        evidence = seal_evidence(out, [request["record"], *record.get("evidence", [])])
        failure = {"category": "delivery", "error_code": stopped["error_code"], "revision": revision,
                   "skills_sha256": skills_sha, "diagnosis": stopped["diagnosis"],
                   "evidence": seal_evidence(out, stopped["evidence"]),
                   "recovered_revision": revision, "continuation": True}
        case.setdefault("execution_failures", []).append(failure)
        if "execution_pending" in case:
            pending = case["execution_failures"][case["execution_pending"]]
            pending["recovered_revision"] = revision
            pending["recovered_by"] = "continuation-delivery"
            case.pop("execution_pending")
        if adopt_skills:
            shutil.rmtree(root / "skills")
            shutil.copytree(practice / "skills", root / "skills")
            require(digest(tree(root / "skills")) == skills_sha, "Imported continuation skills changed")
        changed = not case["revisions"] or skills_sha != case["revisions"][-1]["skills_sha256"]
        change = "initial" if not case["revisions"] else ("revise_skill" if changed else "repeat_practice")
        snapshot = root / "revisions" / f"revision-{revision}"
        if snapshot.exists():
            require(tree(snapshot) == tree(root / "skills"), "Revision snapshot exists with different content")
        else:
            shutil.copytree(root / "skills", snapshot)
        case["revisions"].append({
            "revision": revision, "skills_sha256": skills_sha, "outputs_sha256": outputs_sha,
            "hypothesis": request["hypothesis"], "change_kind": change,
            "delivery_kind": "continuation", "execution_evidence": evidence,
            "continuation": {"record": request["record"], "practice": practice_rel,
                             "repair_actor": repair["actor"], "stopped_role": stopped}})
        case.setdefault("continuations", []).append({
            "revision": revision, "record": request["record"], "practice": practice_rel,
            "evidence": evidence, "role_success_claimed": False})
    elif kind == "begin-verification":
        require("execution_pending" not in case, "Repair the failed practice before verification")
        require(case["revisions"] and not case.get("pending"), "Need a revision and no active verification")
        require(len(case["attempts"]) < config["max_refinement_retries"], "Verification budget exhausted")
        require(not case["attempts"] or not case["attempts"][-1]["accepted"] or skill_review.findings(case),
                "Stop on a complete virtual pass")
        revision = case["revisions"][-1]
        if case["attempts"] and case["attempts"][-1]["revision"] == revision["revision"]:
            require(workflow.research_ready(case, config)["next_action"] == "repair_verifier",
                    "Apply feedback and re-execute practice before another verification")
        require(digest(tree(root / "skills")) == revision["skills_sha256"], "Unrecorded skill revision")
        require(digest(tree(root / "practice" / f'revision-{revision["revision"]}')) == revision["outputs_sha256"],
                "Practice outputs changed after revision registration")
        number = len(case["attempts"]) + 1
        repairing = bool(case["attempts"] and (workflow.verifier_failed(case["attempts"][-1]) or
                         case["attempts"][-1].get("feedback", {}).get("next_action") == "repair_verifier"))
        if repairing and recovery.policy(config):
            require(recovery.remaining(case, config)["verifier_repairs"] > 0, "Verifier repair budget exhausted")
        folder = root / "verify" / f"attempt-{number}"
        require(not folder.exists(), "Attempt directory already exists; do not overwrite evidence")
        verifier = request.get("verifier_session_id")
        if verifier is not None:
            nonempty(verifier, "verifier session")
            require(verifier != case["creator_session_id"], "Verifier must be a separate session")
        case["attempts"].append({"number": number, "revision": revision["revision"],
                                 "skill_sha256": revision["skills_sha256"],
                                 "directory": str(folder), "verifier_session_id": verifier,
                                 "finished": False, "engineering_repair": repairing})
        case["pending"] = number
    elif kind == "record-verification-plan":
        require(config.get("verification_plan_required") and case.get("pending"), "No planned verification is active")
        attempt = case["attempts"][-1]
        require("planning" not in attempt, "Do not overwrite a reserved verification plan")
        nonempty(request["verifier_session_id"], "verifier session")
        require(request["verifier_session_id"] != case["creator_session_id"], "Verifier must be a separate session")
        expected = f".executor/{case_id}/verify-{attempt['number']}"
        require(request["operation"] == expected, "Plan belongs to another operation")
        operation = out / expected
        plan = read_json(operation / "oracle/plan.json")
        require(oracle.validate_plan(plan, operation / "plan-view") == read_json(operation / "oracle/seal.json"),
                "Verification plan does not match sealed inputs")
        attempt["planning"] = {"operation": expected, "evidence": seal_evidence(out, request["evidence"])}
        attempt["verifier_session_id"] = request["verifier_session_id"]
    elif kind == "record-verification-review":
        require(case.get("pending"), "No verification is active")
        attempt = case["attempts"][-1]
        require("planning" in attempt and "oracle_review" not in attempt, "Plan must be reviewed exactly once")
        verify_evidence(out, attempt["planning"]["evidence"])
        operation = out / attempt["planning"]["operation"]
        oracle.load_review(operation, operation / "oracle/review.json")
        attempt["oracle_review"] = seal_evidence(out, request["evidence"])
    elif kind == "finish-verification":
        require(case.get("pending"), "No verification is active")
        attempt = case["attempts"][-1]
        verifier = request.get("verifier_session_id") or attempt["verifier_session_id"]
        nonempty(verifier, "verifier session")
        require(verifier != case["creator_session_id"] and
                (attempt["verifier_session_id"] is None or verifier == attempt["verifier_session_id"]),
                "Verification session differs from its reservation or creator isolation")
        revision = case["revisions"][attempt["revision"]]
        require(digest(tree(root / "skills")) == attempt["skill_sha256"], "Skills changed during verification")
        require(digest(tree(root / "practice" / f'revision-{attempt["revision"]}')) == revision["outputs_sha256"],
                "Verifier changed practice outputs")
        folder = Path(attempt["directory"])
        require(folder.resolve().is_relative_to(root.resolve()), "Verification path escapes Case")
        execution_status = request["execution_status"]
        require(execution_status in ("completed", "interrupted", "not_started"), "Invalid verification execution status")
        if execution_status == "completed":
            require(type(request["pytest_exit_code"]) is int, "pytest_exit_code must be an integer")
            result = virtual_results.read_result(folder / "report.xml", request["pytest_exit_code"], config["max_virtual_tests"])
        else:
            require(request.get("pytest_exit_code") is None, "Uncompleted pytest has no completed exit code")
            result = virtual_results.failed("verification_" + execution_status, "No completed virtual measurement")
        evidence = tree(folder, allow_empty=True) if folder.exists() else {}
        coverage_error = None
        evidence_summary = None
        try:
            reviewed = bool(config.get("verification_plan_required"))
            if reviewed and execution_status == "completed":
                require(attempt.get("planning") and attempt.get("oracle_review"), "Missing reviewed verification plan")
                verify_evidence(out, attempt["planning"]["evidence"])
                verify_evidence(out, attempt["oracle_review"])
            coverage = coverage_complete(folder / "coverage.json", result, reviewed=reviewed)
            if reviewed and workflow.bounded_evidence(config):
                evidence_summary = oracle.evidence_summary(folder / "coverage.json", result)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            coverage, coverage_error = False, str(exc)
        structure_error = None
        try:
            check_case(root / "skills", case_id, case["skills"], prefixes(out, state))
            structure = True
        except (OSError, ValueError, KeyError, TypeError) as exc:
            structure, structure_error = False, str(exc)
        accepted = (result["status"] == "ok" and result["pass_rate"] == 1 and coverage and structure
                    and "suite.py" in evidence)
        attempt.update(finished=True, execution_status=execution_status, result=result, evidence=evidence, coverage_complete=coverage,
                       coverage_error=coverage_error, structure_valid=structure, structure_error=structure_error,
                       accepted=accepted,
                       verifier_session_id=verifier)
        if workflow.bounded_evidence(config):
            attempt["evidence_summary"] = evidence_summary
        case.pop("pending")
    elif kind == "skill-review":
        require(skill_review.enabled(config) and workflow.reviewable(case),
                "Review the current measured revision before its feedback is sealed")
        relative = request["record"]
        path = report_path(out, relative)
        require(path.resolve().is_relative_to((root / "review").resolve()), "Skill review belongs under Case review")
        record = read_json(path)
        paths = skill_review.validate(out, root, case, record)
        evidence = seal_evidence(out, [relative, *paths])
        revision = case["revisions"][-1]
        if revision.get("skill_review"):
            revision.setdefault("skill_review_history", []).append(revision["skill_review"])
        revision["skill_review"] = {**record, "evidence": evidence, "record": relative, "recorded_at": now()}
    elif kind == "feedback":
        require(case["attempts"] and not case.get("pending"), "Finish verification before diagnosing it")
        workflow.validate_feedback(case, request, config)
        evidence = seal_evidence(out, request["evidence"])
        case["attempts"][-1]["feedback"] = {**request, "evidence": evidence, "recorded_at": now()}
    elif kind == "research-fallback":
        require(not case.get("pending") and workflow.fallback_available(case, config),
                "Fallback needs completed unavailable research, skill feedback and an unused allowance")
        last = case["attempts"][-1]
        require(request["attempt"] == last["number"] and last["revision"] == len(case["revisions"]) - 1,
                "Fallback must precede the current feedback-driven revision")
        for key in ("reason", "planned_change", "validation"):
            nonempty(request.get(key), key)
        strings(request.get("unresolved"), "unresolved knowledge gaps")
        last["research_fallback"] = {**request, "evidence": seal_evidence(out, request["evidence"]),
                                    "recorded_at": now()}
    elif kind == "targeted-search":
        require(case["attempts"] and case["attempts"][-1].get("finished")
                and not case["attempts"][-1]["accepted"], "Gap retrieval follows failed virtual verification")
        require(request["classification"] == "NEEDS-DR", "Only knowledge gaps trigger targeted retrieval")
        require(workflow.feedback(case)["classification"] == "NEEDS-DR", "Search must follow the recorded gap diagnosis")
        require(not case["attempts"][-1].get("research_fallback") and
                workflow.feedback(case)["next_action"] != "finish_evidence_limited",
                "Follow the recorded fallback or closure instead of reopening retrieval")
        require(case["attempts"][-1]["revision"] == case["revisions"][-1]["revision"],
                "Verify the new practice execution before diagnosing another gap")
        require(len(case["searches"]) < config["max_targeted_searches"], "Targeted search budget exhausted")
        nonempty(request["query"], "sanitized query")
        forbidden = [config["benchmark_id"], config.get("test_benchmark_id"), *config["case_ids"],
                     *config.get("test_case_ids", [])]
        require(not any(word and word.lower() in request["query"].lower() for word in forbidden),
                "Query contains a Benchmark/Case identifier")
        case["searches"].append({"query": request["query"], "time": now(),
                                "attempt": case["attempts"][-1]["number"]})
    elif kind == "search-result":
        positive(request["search"], "Search index")
        require(request["search"] <= len(case["searches"]), "No such reserved search")
        search = case["searches"][request["search"] - 1]
        require("result" not in search, "Search result is sealed")
        require(not case.get("pending") and search["attempt"] == case["attempts"][-1]["number"],
                "Collect the search result before the next attempt")
        require(request["outcome"] in ("retrieved", "unavailable"), "Invalid retrieval outcome")
        nonempty(request["summary"], "retrieval finding or failure")
        if request["outcome"] == "retrieved":
            strings(request["sources"], "retrieved source URLs")
        search["result"] = {**request, "evidence": seal_evidence(out, request["evidence"])}
    elif kind == "finish-case":
        require(not case.get("pending"), "Finish the active verification record first")
        reason = request["reason"]
        if reason in ("surrogate_pass", "evidence_limited"):
            skill_review.require_clear(case, config)
        require("execution_pending" not in case or reason not in ("surrogate_pass", "max_refinement_retries"),
                "An unresolved execution failure cannot close as a successful or completed refinement")
        require(reason in ("surrogate_pass", "max_refinement_retries", "time_budget", "context_budget",
                           "verifier_failure", "environment_failure", "contaminated", "interrupted",
                           "construction_failed", "evidence_limited"), "Invalid termination reason")
        if reason == "evidence_limited":
            require(workflow.bounded_evidence(config) and not expired(case, config)
                    and workflow.evidence_limited(case["attempts"][-1])
                    and workflow.feedback(case)["next_action"] == "finish_evidence_limited",
                    "Evidence-limited closure needs reviewed passing checks, unknowns and an explicit decision")
            require(case["attempts"][-1]["revision"] == case["revisions"][-1]["revision"],
                    "Evidence-limited closure must describe the current practice revision")
        if reason == "surrogate_pass":
            require(not expired(case, config) and case["attempts"] and case["attempts"][-1]["accepted"],
                    "Surrogate success requires passing assertions, coverage, structure and remaining time")
        if reason == "max_refinement_retries":
            require(len(case["attempts"]) == config["max_refinement_retries"], "Verification budget not exhausted")
            last = case["attempts"][-1]
            require(not last["accepted"] or skill_review.findings(case),
                    "A complete pass without skill findings must finish as surrogate_pass")
            decision = workflow.feedback(case)
            if decision["next_action"] != "repair_verifier":
                require(case["revisions"][-1]["revision"] > last["revision"],
                        "Apply the final failure-driven practice revision before exporting; use time_budget if expired")
        if reason == "time_budget":
            require(expired(case, config), "Time budget not exhausted")
        if reason not in ("surrogate_pass", "max_refinement_retries", "time_budget"):
            stop_record(out, case, reason, request)
        deployable = (reason not in ("contaminated", "construction_failed") and bool(case["revisions"])
                      and "execution_pending" not in case)
        if deployable:
            current = check_case(root / "skills", case_id, case["skills"], prefixes(out, state))
            require(current["sha256"] == case["revisions"][-1]["skills_sha256"], "Unrecorded final revision")
            if config.get("process_review_required"):
                review_path = report_path(out, request.get("process_review", ""))
                require(review_path.resolve().is_relative_to((root / "review").resolve()),
                        "Process review must be a controller record under the Case review directory")
                review = read_json(review_path)
                revision = case["revisions"][-1]
                require(review.get("skills_sha256") == revision["skills_sha256"] and
                        review.get("outputs_sha256") == revision["outputs_sha256"],
                        "Process review must describe the final registered skills and outputs")
                checks = review.get("checks", {})
                require(isinstance(checks, dict) and set(checks) ==
                        {"delivery", "portable_content", "construction_isolation"},
                        "Review delivery, portable content and construction isolation separately")
                evidence = [request["process_review"]]
                for check in checks.values():
                    require(check.get("status") == "passed", "Unresolved process review prevents deployment")
                    nonempty(check.get("finding"), "process review finding")
                    strings(check.get("evidence"), "process review evidence")
                    evidence.extend(check["evidence"])
                case["process_review"] = {"evidence": seal_evidence(out, list(dict.fromkeys(evidence))),
                                          "record": request["process_review"]}
            last = case["attempts"][-1] if case["attempts"] else None
            if reason == "surrogate_pass":
                require(current["sha256"] == last["skill_sha256"], "Passing tests describe another revision")
            valid = [a for a in case["attempts"] if workflow.measured(a)]
            tested = valid[-1] if valid else None
            current_attempts = [a for a in valid if a["revision"] == case["revisions"][-1]["revision"]]
            case.update(final_sha256=current["sha256"], last_tested_sha256=tested["skill_sha256"] if tested else None,
                        last_valid_verification_attempt=tested["number"] if tested else None,
                        final_was_tested=bool(current_attempts and current["sha256"] == current_attempts[-1]["skill_sha256"]),
                        final_verification_issues=(workflow.issues(last) if last and
                            last["revision"] == case["revisions"][-1]["revision"] else ["not_run"]))
        if skill_review.enabled(config):
            case["unresolved_skill_findings"] = skill_review.findings(case)
        case.update(finished=True, reason=reason, deployable=deployable)
    else:
        raise ValueError(f"Unknown action: {kind}")


def run(command, out, payload=None, *, executor=False):
    out = Path(out)
    if command == "status":
        return load(out)[0]
    if command == "next":
        state = load(out)[0]
        require(state["schema_version"] == 2, "Use the recorded Skill version for a historical journal")
        return workflow.guidance(state, datetime.now(timezone.utc))
    if command == "init":
        require(payload.get("execution_mode") in (None, "isolated-v1"), "Unknown execution mode")
        require(payload.get("execution_mode") != "isolated-v1" or executor,
                "Initialize isolated runs through executor.py")
        state = initialize(payload)
        out.mkdir(parents=True, exist_ok=True)
        with locked(out):
            require(not (out / "journal").exists() and not (out / "experiment.yaml").exists(),
                    "Existing experiment: never initialize or migrate it implicitly")
            append(out, state, {"action": "init"}, 0, None)
        return state
    with locked(out):
        state, sequence, previous = load(out)
        require(state["config"].get("execution_mode") != "isolated-v1" or executor,
                "Isolated runs accept mutations only through executor.py; role receipts cannot be self-reported")
        apply_event(out, state, payload)
        append(out, state, payload, sequence, previous)
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "event", "status", "next"))
    parser.add_argument("out", type=Path)
    parser.add_argument("request", type=Path, nargs="?")
    args = parser.parse_args()
    try:
        require(args.command in ("status", "next") or args.request is not None, "A JSON request file is required")
        result = run(args.command, args.out, read_json(args.request) if args.request else None)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as exc:
        print(json.dumps({"status": "failed", "message": str(exc)}, ensure_ascii=False))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
