"""Validate verifier evidence records, not the truth of natural-language claims.

Only the trusted controller supplies a semantic review. A matching quotation proves
source membership; it does not prove that the source entails an expected answer.
"""

import hashlib
from pathlib import Path

from artifacts import digest, identifier, read_json, require, strings, tree
from isolation import regular


def text(value, label):
    require(isinstance(value, str) and value.strip(), f"Missing {label}")


def validate_plan(plan, view):
    require(isinstance(plan, dict) and plan.get("schema_version") == 1, "Invalid verification plan version")
    checks = plan.get("requirements")
    require(isinstance(checks, list) and checks, "Verification plan must list requirements")
    seen, sources = set(), {}
    for entry in checks:
        key = identifier(entry["id"])
        require(key not in seen, "Duplicate verification requirement id")
        seen.add(key)
        text(entry.get("requirement"), "public requirement")
        require(entry.get("required") is True, "Keep every public requirement required")
        require(entry.get("basis") in ("source", "derived", "hypothesis"), "Invalid expectation basis")
        text(entry.get("expectation"), "expected behavior or unresolved question")
        text(entry.get("reasoning"), "independent derivation or evidence gap")
        refs = entry.get("sources")
        require(isinstance(refs, list), "Sources must be a list")
        require(refs or entry["basis"] == "hypothesis", "Supported expectations need source excerpts")
        for ref in refs:
            name = ref["path"]
            require(Path(name).parts and Path(name).parts[0] in ("public", "research", "additional-research"),
                    "Oracle sources must be public inputs or independent research, never outputs or creator files")
            source = regular(view, name)
            text(ref.get("quote"), "exact source excerpt")
            require(ref["quote"] in source.read_text(encoding="utf-8"), "Source excerpt does not occur in its cited file")
            sources[name] = hashlib.sha256(source.read_bytes()).hexdigest()
    return {"plan_sha256": digest(plan), "inputs_sha256": digest(tree(view)), "sources": sources}


def validate_review(plan, seal, review):
    require(digest(plan) == seal["plan_sha256"], "Verification differs from the sealed plan")
    require(isinstance(review, dict) and review.get("plan_sha256") == seal["plan_sha256"]
            and review.get("inputs_sha256") == seal["inputs_sha256"], "Review must bind the exact plan and independent inputs")
    text(review.get("reviewer"), "controller reviewer")
    require(review.get("scope") == "independent_evidence", "Review must assess evidence, not agreement with candidate outputs")
    decisions = review.get("decisions")
    require(isinstance(decisions, list), "Review must decide every requirement")
    expected = {entry["id"]: entry for entry in plan["requirements"]}
    seen = {}
    for decision in decisions:
        key = decision["id"]
        require(key in expected and key not in seen, "Unknown or duplicate review requirement")
        require(decision.get("status") in ("supported", "unverified"), "Invalid evidence review status")
        text(decision.get("finding"), "independent evidence finding")
        if decision["status"] == "supported":
            require(expected[key]["basis"] != "hypothesis", "A hypothesis cannot be approved without a new evidence-backed plan")
            require(expected[key]["sources"], "Supported requirement has no sources")
        seen[key] = decision
    require(set(seen) == set(expected), "Review omitted a public requirement")
    return seen


def coverage_rows(coverage, *, reviewed):
    """Use the declared protocol's identity, never infer it from model-written rows."""
    require(isinstance(coverage, list) and coverage, "Coverage must list public requirements")
    seen = set()
    for entry in coverage:
        require(isinstance(entry, dict), "Coverage entries must be objects")
        text(entry.get("requirement"), "coverage requirement")
        key = identifier(entry.get("requirement_id")) if reviewed else entry["requirement"]
        require(key not in seen, "Duplicate coverage requirement identity")
        seen.add(key)
        require(type(entry.get("required")) is bool, "Coverage required must be boolean")
        require(entry.get("status") in ("covered", "unverified"), "Invalid coverage status")
        strings(entry.get("tests"), "coverage test ids", allow_empty=True)
    return coverage


def measured_coverage(coverage, result):
    if result["status"] != "ok":
        return False
    tests = {f'{item["classname"]}::{item["name"]}': item["status"] for item in result["tests"]}
    complete = True
    for entry in coverage:
        # Check all mappings, including rows after an unresolved requirement. A real
        # failed assertion is an algorithm finding; an invented test id is a protocol fault.
        require(set(entry["tests"]).issubset(tests), "Coverage test id is not present in JUnit")
        if entry["required"]:
            complete &= (entry["status"] == "covered" and isinstance(entry.get("source"), str)
                         and bool(entry["source"].strip()) and bool(entry["tests"])
                         and all(tests[key] == "passed" for key in entry["tests"]))
    return bool(complete and any(entry["required"] for entry in coverage))


def validate_coverage(plan, seal, review, coverage, result=None):
    decisions = validate_review(plan, seal, review)
    coverage_rows(coverage, reviewed=True)
    expected = {entry["id"]: entry for entry in plan["requirements"]}
    seen = set()
    for entry in coverage:
        key = entry.get("requirement_id")
        require(key in expected and key not in seen, "Coverage omitted, duplicated or invented a planned requirement")
        seen.add(key)
        require(entry.get("requirement") == expected[key]["requirement"] and entry.get("required") is True,
                "Coverage changed a planned public requirement")
        require(entry.get("expectation_sha256") == digest(expected[key]), "Coverage is not bound to its reviewed expectation")
        if decisions[key]["status"] == "unverified":
            require(entry["status"] == "unverified" and not entry["tests"],
                    "Unsupported expectation cannot be promoted to covered or asserted as an oracle")
        elif entry["status"] == "covered":
            text(entry.get("source"), "coverage source")
            require(entry["tests"], "Covered requirement has no tests")
    require(seen == set(expected), "Coverage omitted a planned public requirement")
    complete = all(entry["status"] == "covered" for entry in coverage)
    measured = measured_coverage(coverage, result) if result is not None else True
    return complete and measured


def coverage_complete(path, result, *, reviewed=False):
    """Shared by journal collection, development replay and offline evidence replay.

    Existing manual journals keep their explicit text-based protocol. Isolated runs
    always select the reviewed ID-based protocol through their recorded configuration.
    """
    coverage = read_json(path)
    if reviewed:
        folder = path.parent / "oracle"
        return validate_coverage(read_json(folder / "plan.json"), read_json(folder / "seal.json"),
                                 read_json(folder / "review.json"), coverage, result)
    return measured_coverage(coverage_rows(coverage, reviewed=False), result)


def evidence_summary(path, result):
    """Separate unknown semantics from missing/failed checks of supported claims.

    Validate the entire map first: filtering unsupported rows must never hide a
    malformed mapping or an invented test. This is not a benchmark accuracy score.
    """
    coverage = read_json(path)
    folder = path.parent / "oracle"
    plan, seal, review = (read_json(folder / name) for name in ("plan.json", "seal.json", "review.json"))
    validate_coverage(plan, seal, review, coverage, result)
    supported = {d["id"] for d in review["decisions"] if d["status"] == "supported"}
    rows = [row for row in coverage if row["requirement_id"] in supported]
    return {"supported": sorted(supported),
            "unverified": [row["requirement_id"] for row in coverage if row["requirement_id"] not in supported],
            "supported_checks_passed": bool(rows) and measured_coverage(rows, result)}


def load_review(operation, review_path):
    oracle = operation / "oracle"
    plan, seal = read_json(oracle / "plan.json"), read_json(oracle / "seal.json")
    require(validate_plan(plan, operation / "plan-view") == seal, "Pinned verification plan or independent inputs changed")
    review = read_json(review_path)
    validate_review(plan, seal, review)
    return plan, seal, review


def coverage_template(plan, seal, review):
    """The host computes mechanical bindings; authoring must still supply real test ids."""
    validate_review(plan, seal, review)
    return [{"requirement_id": entry["id"], "requirement": entry["requirement"],
             "required": True, "expectation_sha256": digest(entry),
             "source": "; ".join(ref["path"] for ref in entry["sources"]),
             "status": "unverified", "tests": []} for entry in plan["requirements"]]


def plan_prompt(work):
    return (f"Prepare an independent verification plan using {work}/inputs/public, inputs/research and "
        f"inputs/additional-research if present. Write {work}/verification-plan.json only. "
        "Candidate outputs and creator code are withheld during this stage. Do not write or run tests yet. "
        "Schema: {schema_version:1, requirements:[{id, requirement, required:true, "
        "basis:'source'|'derived'|'hypothesis', expectation, reasoning, sources:[{path,quote}]}]}. "
        "All text fields are nonempty strings; ids are unique ASCII identifiers. Source paths are relative "
        "to inputs, starting public/, research/ or additional-research/; quote is an exact excerpt in that file. "
        "Map all public OUTPUT requirements, including unresolved business decisions. Separate a recorded "
        "fact or independently computable subclaim from unresolved policy: use separate stable requirement "
        "ids for each. For example, a documented quantity times unit price is testable even when charges for "
        "other operations are unknown. Check substantive joins, arithmetic and cross-field consistency, not "
        "only JSON shape. Preserve the unresolved remainder; splitting a claim must not erase it. "
        "Across revisions retain earlier requirements and valid expectations; explain any semantic correction. "
        "Distinguish a recorded "
        "fact, a derivation using a documented rule, and an unsupported hypothesis. A list of users or an enum "
        "does not establish their permissions; measured diagnostics do not establish policy thresholds. "
        "General conventions and plausible defaults are hypotheses unless supported by the task's public rules. "
        "For missing evidence keep the requirement, set basis=hypothesis and explain the gap; sources may be empty. "
        "Process isolation and skill packaging are checked separately by the controller. Do not call a grader, "
        "read hidden answers, infer an expectation from candidate output, or claim that a citation proves entailment. "
        "The controller must review this plan before test authoring, within the same attempt and deadline.")


def suite_prompt(work, maximum):
    return (f"Use public inputs and candidate outputs under {work}/inputs. "
        f"Read the immutable reviewed oracle at {work}/oracle (plan.json, review.json, coverage-template.json). "
        f"Write {work}/suite.py with at most {maximum} deterministic pytest tests and {work}/coverage.json. "
        "Start coverage.json by copying oracle/coverage-template.json: its top level is a JSON ARRAY, "
        "not an object or a schema_version/requirements wrapper. Keep every row and its requirement_id, "
        "requirement, required and expectation_sha256 exactly as supplied. The host already computed and "
        "validated all hashes; do not recompute them or reverse-engineer the seal. Only fill source notes, "
        "status (covered or unverified) and tests (JUnit ids) for supported requirements you actually test. "
        "JUnit ids use suite::test_function, including parameters. "
        "For every review decision marked unverified, keep status=unverified and tests=[]; never assert its "
        "hypothesis as a correct answer or omit the requirement. Supported checks must implement the reviewed "
        "expectation, without introducing new policy defaults. Cite the original source and derivation. "
        "Official pytest supplies these environment roots: OPENSKILL_INPUTS is inputs/public, "
        "OPENSKILL_RESEARCH is inputs/research, OPENSKILL_ADDITIONAL_RESEARCH is inputs/additional-research "
        "(an empty directory when no retrieved evidence was selected), OPENSKILL_OUTPUTS is inputs/outputs, "
        "and OPENSKILL_ORACLE contains the read-only reviewed records. Read each category from its own "
        "environment root at measurement time; for source research/business/data.json use "
        "Path(os.environ['OPENSKILL_RESEARCH'])/'business/data.json'. OPENSKILL_INPUTS is not the whole "
        "input view. Never fall back to public inputs, the working directory or an author-time absolute path "
        "when research is missing. At least 60% of tests should validate actual deliverables. "
        "Wrong or missing outputs are assertion failures; import/setup errors are verifier failures. "
        "No network, randomness, LLM judgment, skip, xfail or deselection. Do not weaken an expectation to "
        "match the answer. A correction requires independently justified feedback and a new budgeted attempt. "
        "The executor runs official pytest once. Do not write report.xml or claim formal success. "
        "You cannot see creator skills or history; process/packaging checks remain with the controller.")
