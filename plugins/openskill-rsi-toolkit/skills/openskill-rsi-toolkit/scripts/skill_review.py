"""Keep observed skill defects distinct from unknown business rules and proxy scores."""

from pathlib import Path

from artifacts import identifier, require, strings
from isolation import regular


def enabled(config):
    return config.get("feedback_policy") == "bounded-evidence-v2"


def latest(case):
    return next((r["skill_review"] for r in reversed(case["revisions"]) if r.get("skill_review")), None)


def findings(case):
    return (latest(case) or {}).get("findings", [])


def current(case):
    return bool(case["revisions"] and case["revisions"][-1].get("skill_review"))


def text(value, label):
    require(isinstance(value, str) and value.strip(), f"Missing {label}")


def validate(out, root, case, record):
    revision = case["revisions"][-1]
    for key in ("revision", "skills_sha256", "outputs_sha256"):
        require(record.get(key) == revision[key], "Skill review must bind the current revision and outputs")
    text(record.get("assessment"), "review of documented skill behavior")
    rows, resolved = record.get("findings"), record.get("resolved")
    require(isinstance(rows, list) and isinstance(resolved, list), "Review needs findings and resolved lists")
    evidence, seen = [], set()
    for row in rows:
        key = identifier(row["id"])
        require(key not in seen, "Duplicate skill finding")
        seen.add(key)
        for field in ("observation", "planned_change", "validation"):
            text(row.get(field), field)
        strings(row.get("affected_resources"), "affected skill resources")
        for resource in row["affected_resources"]:
            regular(root / "revisions" / f"revision-{revision['revision']}", resource)
        strings(row.get("evidence"), "observed finding evidence")
        evidence.extend(row["evidence"])
    previous = {row["id"]: row for row in findings(case)}
    closed = set()
    for row in resolved:
        key = row["id"]
        require(key in previous and key not in seen and key not in closed, "Unknown or duplicate resolved finding")
        require(revision["change_kind"] == "revise_skill", "Resolve a finding only after actual skill revision")
        text(row.get("finding"), "independent resolution finding")
        strings(row.get("evidence"), "resolution evidence")
        # An old log or a creator's claim cannot stand in for current independent checks.
        attempt = case["attempts"][-1]
        report = f"tasks/{root.name}/verify/attempt-{attempt['number']}/report.xml"
        require(report in row["evidence"] and attempt["result"].get("failed") == 0,
                "Resolve with current passing independent verification evidence")
        strings(row.get("tests"), "independent regression test ids")
        passed = {f"{test['classname']}::{test['name']}" for test in attempt["result"].get("tests", [])
                  if test["status"] == "passed"}
        require(set(row["tests"]).issubset(passed), "Resolution tests must have actually passed in this measurement")
        evidence.extend(row["evidence"])
        closed.add(key)
    require(set(previous).issubset(seen | closed), "Retain or independently resolve every previous skill finding")
    if current(case):
        require(seen - set(previous) or closed,
                "A supplemental review must add a finding or independently resolve one")
    for key in set(previous) & seen:
        require(next(r for r in rows if r["id"] == key) == previous[key],
                "Retain an unresolved finding verbatim; record new defects separately")
    selected = record.get("feedback_files", {})
    require(isinstance(selected, dict), "feedback_files must be an explicit file map")
    for name, source in selected.items():
        require(isinstance(name, str) and name and not Path(name).is_absolute()
                and ".." not in Path(name).parts and name != ".", "Invalid feedback destination")
        require(source in evidence, "Feedback files must belong to the reviewed finding evidence")
        require(regular(out, source).resolve().is_relative_to((root / "diagnoses").resolve()),
                "Share only reviewed public diagnostic files from this Case's diagnoses directory")
    for source in evidence:
        require(regular(out, source).resolve().is_relative_to(root.resolve()),
                "Skill review evidence must belong to this Case")
    return list(dict.fromkeys(evidence))


def check_change(case, before, after):
    known = findings(case)
    require(not known or any(before.get(name) != after.get(name)
                            for finding in known for name in finding["affected_resources"]),
            "Revise an affected skill resource; unrelated edits cannot count as defect repair")


def require_clear(case, config):
    if enabled(config):
        require(current(case), "Review the current skills before successful or evidence-limited closure")
        require(not findings(case), "Unresolved skill findings require repair or an evidenced budget stop")
