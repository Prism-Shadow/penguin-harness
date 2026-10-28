#!/usr/bin/env python3
"""Read a fresh pytest JUnit report without turning verifier failures into scores."""

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def failed(code, message):
    return {"status": "failed", "failure_code": code, "message": message}


def read_result(report, pytest_exit_code, max_tests=60):
    try:
        root = ET.parse(report).getroot()
    except (OSError, ET.ParseError) as exc:
        return failed("invalid_report", str(exc))

    if root.tag not in ("testsuites", "testsuite"):
        return failed("invalid_report", "Expected a JUnit testsuite or testsuites root.")
    cases = list(root.iter("testcase"))
    if not cases:
        return failed("no_tests", "The report contains no test cases.")
    if len(cases) > max_tests:
        return failed("too_many_tests", f"Collected {len(cases)} tests; limit is {max_tests}.")

    seen = set()
    results = []
    for case in cases:
        name = case.get("name", "")
        identity = (case.get("classname", ""), name)
        if not name or identity in seen:
            return failed("invalid_report", "Missing or repeated test identity.")
        seen.add(identity)
        outcomes = [child for child in case if child.tag in ("failure", "error", "skipped")]
        # Pytest can emit both call failure and teardown error for a single test.
        # Such an execution is unscored, even though the call itself was a failure.
        if any(child.tag == "error" for child in outcomes):
            return failed("verifier_error", f"Verifier error in {identity}: " +
                          "\n".join(child.text or child.get("message", "") for child in outcomes))
        if len(outcomes) > 1:
            return failed("invalid_report", f"Ambiguous outcome for {identity}.")
        outcome = outcomes[0] if outcomes else None
        if outcome is not None and outcome.get("type") == "pytest.xfail":
            return failed("invalid_report", "Expected-failure markers cannot validate virtual checks.")
        status = {"failure": "failed", "skipped": "skipped"}.get(
            outcome.tag if outcome is not None else "", "passed"
        )
        item = {"classname": identity[0], "name": name, "status": status}
        if outcome is not None:
            item["message"] = outcome.get("message", "")
            item["detail"] = outcome.text or ""
        results.append(item)

    # A collection/runner error outside a testcase also invalidates the report.
    if any(True for _ in root.iter("error")):
        return failed("verifier_error", "JUnit reports a verifier or collection error.")
    if pytest_exit_code not in (0, 1):
        return failed("pytest_failed", f"pytest exited with code {pytest_exit_code}.")
    passed = sum(item["status"] == "passed" for item in results)
    failures = sum(item["status"] == "failed" for item in results)
    skipped = sum(item["status"] == "skipped" for item in results)
    total = passed + failures
    if total == 0:
        return failed("no_tests", "Every test was skipped; there is no virtual measurement.")
    if pytest_exit_code != (1 if failures else 0):
        return failed("inconsistent_exit", "pytest exit code disagrees with the reported outcomes.")
    return {
        "status": "ok",
        "passed": passed,
        "failed": failures,
        "skipped": skipped,
        "total": total,
        "pass_rate": passed / total,
        "tests": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--pytest-exit-code", required=True, type=int)
    parser.add_argument("--max-tests", type=int, choices=range(1, 61), default=60)
    args = parser.parse_args()
    result = read_result(args.report, args.pytest_exit_code, args.max_tests)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "ok" else 2


if __name__ == "__main__":
    sys.exit(main())
