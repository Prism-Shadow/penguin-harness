"""Derive construction decisions from recorded evidence, without launching any role."""

from datetime import datetime, timedelta

from artifacts import require, strings
import recovery
import skill_review


def text(value, name):
    require(isinstance(value, str) and value.strip(), f"Missing {name}")


def bounded_evidence(config):
    # Opt-in for new journals only. Historical experiments keep their recorded
    # policy; this does not change accepted, migrate records or reopen a STOP.
    return config.get("feedback_policy") in ("bounded-evidence-v1", "bounded-evidence-v2")


def reviewable(case):
    return (case["attempts"] and case["attempts"][-1].get("finished")
            and measured(case["attempts"][-1]) and not case["attempts"][-1].get("feedback")
            and case["attempts"][-1]["revision"] == case["revisions"][-1]["revision"]
            and not case.get("pending"))


def review_due(case, config):
    return skill_review.enabled(config) and reviewable(case) and not skill_review.current(case)


def case_issues(case):
    return issues(case["attempts"][-1]) + (["skill_behavior"] if skill_review.findings(case) else [])


def evidence_limited(attempt):
    summary = attempt.get("evidence_summary", {})
    return (issues(attempt) == ["coverage_gap"] and summary.get("supported_checks_passed") is True
            and bool(summary.get("unverified")) and attempt["result"]["pass_rate"] == 1)


def fallback_available(case, config):
    decision = feedback(case)
    searches = [s for s in case["searches"] if s["attempt"] == case["attempts"][-1]["number"]]
    return (bounded_evidence(config) and decision["classification"] == "NEEDS-DR"
            and decision["next_action"] == "revise_skill"
            and not any(a.get("research_fallback") for a in case["attempts"])
            and all("result" in s for s in searches)
            and not any(s["result"]["outcome"] == "retrieved" for s in searches)
            and (bool(searches) or len(case["searches"]) >= config["max_targeted_searches"]))


def clock(case, config, current):
    deadline = datetime.fromisoformat(case["started_at"]) + timedelta(
        minutes=config["construction_timeout_minutes"])
    return {"deadline_at": deadline.isoformat(),
            "remaining_seconds": max(0, (deadline - current).total_seconds())}


def issues(attempt):
    found = []
    if verifier_failed(attempt):
        found.append("verifier_error")
    if measured(attempt) and attempt["result"]["failed"]:
        found.append("assertion_failure")
    if not attempt["structure_valid"]:
        found.append("skill_structure")
    if not attempt["coverage_complete"]:
        found.append("coverage_gap")
    return found


def measured(attempt):
    return (attempt.get("execution_status") == "completed"
            and attempt.get("result", {}).get("status") == "ok"
            and "suite.py" in attempt.get("evidence", {}))


def verifier_failed(attempt):
    # Preserve a completed pytest measurement even when its coverage protocol is
    # invalid. Such evidence still cannot authorize acceptance or strict continuation.
    return not measured(attempt) or attempt.get("coverage_error") is not None


def feedback(case):
    require(case["attempts"] and case["attempts"][-1].get("finished")
            and (not case["attempts"][-1]["accepted"] or skill_review.findings(case)),
            "Feedback requires an unsuccessful attempt or an observed skill defect")
    result = case["attempts"][-1].get("feedback")
    require(result is not None, "Record feedback for the latest attempt before continuing")
    return result


def validate_feedback(case, request, config=None):
    last = case["attempts"][-1]
    require(last.get("finished") and (not last["accepted"] or skill_review.findings(case)),
            "Diagnose a finished unsuccessful attempt or an observed skill defect")
    require(not review_due(case, config or {}), "Review the current skills before choosing feedback")
    require(request["attempt"] == last["number"], "Feedback refers to another attempt")
    require("feedback" not in last, "Feedback is sealed; continue its recorded action")
    require(request["classification"] in ("SELF-FIXABLE", "NEEDS-DR"), "Invalid gap-versus-bug classification")
    require(request["next_action"] in ("revise_skill", "repair_verifier", "repeat_practice", "finish_evidence_limited"),
            "Feedback must name a recovery action")
    strings(request["issues"], "diagnosed issues")
    require(set(request["issues"]) == set(case_issues(case)), "Diagnose every observed failure and coverage gap")
    for key in ("diagnosis", "expected_change"):
        text(request[key], key)
    if request["next_action"] == "finish_evidence_limited":
        skill_review.require_clear(case, config or {})
        require(bounded_evidence(config or {}) and evidence_limited(last),
                "Evidence-limited closure requires valid passing supported checks and only unknown evidence")
    known = skill_review.findings(case)
    if known:
        require(request["next_action"] == "revise_skill" or
                (request["next_action"] == "repair_verifier" and
                 (verifier_failed(last) or request.get("oracle_correction"))),
                "Repair the known skill defect; verifier work needs its own evidence")
        if request["next_action"] == "revise_skill":
            require(request.get("skill_findings") == known, "Include every unresolved skill finding in feedback")
    if (bounded_evidence(config or {}) and request["next_action"] == "revise_skill"
            and not {"assertion_failure", "skill_structure"}.intersection(request["issues"])):
        findings = request.get("skill_findings")
        require(isinstance(findings, list) and findings, "A coverage gap alone is not an observed skill defect")
        for finding in findings:
            for key in ("observation", "planned_change", "validation"):
                text(finding.get(key), key)
            strings(finding.get("evidence"), "observed skill finding evidence")
            require(set(finding["evidence"]).issubset(request["evidence"]),
                    "Seal the evidence for every observed skill finding")
    if "skill_structure" in request["issues"]:
        require(request["next_action"] == "revise_skill", "Invalid skill structure needs a skill revision")
    if request["next_action"] == "repair_verifier" and "assertion_failure" in request["issues"]:
        text(request.get("oracle_correction"), "independent evidence that the previous expectation was wrong")
    if request["next_action"] == "repeat_practice":
        text(request.get("execution_issue"), "execution or delivery fault to repair without editing skills")


def research_ready(case, config=None):
    decision = feedback(case)
    if decision["classification"] == "NEEDS-DR":
        searches = [s for s in case["searches"] if s["attempt"] == case["attempts"][-1]["number"]]
        if bounded_evidence(config or {}) and case["attempts"][-1].get("research_fallback"):
            require(all("result" in s for s in searches), "Collect pending searches before refinement")
            return decision
        require(searches and all("result" in s for s in searches),
                "Complete and record the issued gap searches before continuing")
        require(any(s["result"]["outcome"] == "retrieved" for s in searches),
                "No retrieved evidence for the knowledge gap; record a blocker instead of inventing a rule")
    return decision


def guidance(state, current):
    result = {"phase": state["phase"], "observed_at": current.isoformat(), "cases": {}}
    for cid, case in state["cases"].items():
        timing = clock(case, state["config"], current)
        attempts = case["attempts"]
        revisions = case["revisions"]
        last = attempts[-1] if attempts else None
        count = len(attempts)
        remaining = max(0, state["config"]["max_refinement_retries"] - count)
        if case.get("finished"):
            action = "closed"
        elif case.get("pending"):
            action = ("abort_and_collect_verification" if not timing["remaining_seconds"] else
                      "review_verification_plan" if last.get("planning") and not last.get("oracle_review") else
                      "collect_verification")
        elif not timing["remaining_seconds"]:
            action = "stop_writers_then_finish_time_budget"
        elif "execution_pending" in case:
            action = ("repair_execution" if recovery.remaining(case, state["config"])["execution_repairs"]
                      else "stop_execution_repair_budget")
        elif "skills" not in case:
            action = "research_and_plan"
        elif not revisions:
            action = "initial_practice"
        elif last is None or last["revision"] != revisions[-1]["revision"]:
            action = "begin_verification" if remaining else "finish_max_refinement_retries"
        elif review_due(case, state["config"]):
            action = "review_skills"
        elif last["accepted"] and not skill_review.findings(case):
            action = "finish_surrogate_pass"
        elif "feedback" not in last:
            action = "record_feedback"
        else:
            decision = last["feedback"]
            searches = [s for s in case["searches"] if s["attempt"] == last["number"]]
            if decision["next_action"] == "repair_verifier" and not remaining:
                action = "finish_max_refinement_retries"
            elif decision["next_action"] == "repair_verifier" and recovery.policy(state["config"]) and not recovery.remaining(case, state["config"])["verifier_repairs"]:
                action = "stop_verifier_repair_budget"
            elif any("result" not in s for s in searches):
                action = "collect_search_result"
            elif decision["next_action"] == "finish_evidence_limited":
                action = "finish_evidence_limited"
            elif bounded_evidence(state["config"]) and last.get("research_fallback"):
                action = decision["next_action"]
            elif fallback_available(case, state["config"]):
                action = "record_research_fallback"
            elif decision["classification"] == "NEEDS-DR" and not any(
                    s.get("result", {}).get("outcome") == "retrieved" for s in searches):
                action = ("targeted_search" if len(case["searches"]) < state["config"]["max_targeted_searches"]
                          else "document_unresolved_gap")
            else:
                action = decision["next_action"]
        result["cases"][cid] = {**timing, "next_action": action,
            "verification_attempts_remaining": remaining,
            "targeted_searches_remaining": max(0, state["config"]["max_targeted_searches"] - len(case["searches"])),
            "practice_executions": len(revisions),
            "skill_changes_after_feedback": sum(r.get("change_kind") == "revise_skill" for r in revisions),
            "valid_virtual_measurements": sum(measured(a) for a in attempts),
            "latest_issues": case_issues(case) if last and last.get("finished") else []}
        if skill_review.enabled(state["config"]):
            result["cases"][cid].update(open_skill_findings=skill_review.findings(case),
                                       skill_review_record=(skill_review.latest(case) or {}).get("record"))
        if recovery.policy(state["config"]):
            result["cases"][cid]["recovery"] = recovery.remaining(case, state["config"])
        if bounded_evidence(state["config"]):
            result["cases"][cid].update(
                research_fallbacks_remaining=1 - sum(bool(a.get("research_fallback")) for a in attempts),
                evidence_summary=last.get("evidence_summary") if last else None,
                evidence_limited_eligible=bool(last and last.get("finished") and evidence_limited(last)
                    and (not skill_review.enabled(state["config"]) or
                         (skill_review.current(case) and not skill_review.findings(case)))))
    return result
