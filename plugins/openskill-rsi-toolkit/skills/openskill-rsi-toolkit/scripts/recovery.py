"""Explicit engineering budgets for new runs; historical policies are never rewritten."""

from artifacts import require


DEFAULTS = {"version": 1, "max_tool_recoveries": 3, "max_same_error_recoveries": 1,
            "recovery_seconds": 120, "max_execution_repairs": 1, "max_verifier_repairs": 1}
V2_DEFAULTS = {**DEFAULTS, "version": 2, "max_tool_recoveries": 6,
               "max_same_error_recoveries": 2, "recovery_seconds": 180, "max_execution_repairs": 2}


def policy(config):
    value = config.get("recovery_policy")
    if value is None:
        return None
    require(isinstance(value, dict) and not set(value) - set(DEFAULTS), "Unknown recovery policy field")
    # Keep sealed v1 journals reproducible. New runs explicitly select version 2.
    version = value.get("version", 1)
    require(type(version) is int and version in (1, 2), "Unsupported recovery policy")
    result = {**(V2_DEFAULTS if version == 2 else DEFAULTS), **value}
    require(not config.get("stop_on_recurrence"), "Choose graded recovery or strict stop, not both")
    for key in DEFAULTS.keys() - {"version"}:
        require(type(result[key]) is int and result[key] >= 0, f"Invalid recovery budget: {key}")
    require(0 < result["recovery_seconds"] <= 600, "Recovery window must be 1–600 seconds")
    require(result["max_same_error_recoveries"] <= result["max_tool_recoveries"],
            "Same-error budget exceeds total tool recovery budget")
    return result


def tool_usage(case):
    return case.get("tool_recovery", {"used": 0, "families": {}})


def verifier_repairs(case):
    # An unsuccessful measurement spends a verification attempt. Only a new
    # dispatch following repair_verifier spends the separate engineering cap.
    return sum(a.get("engineering_repair", False) for a in case["attempts"])


def remaining(case, config):
    limits = policy(config)
    if limits is None:
        return None
    return {"tool_recoveries": max(0, limits["max_tool_recoveries"] - tool_usage(case)["used"]),
            "tool_families_used": tool_usage(case)["families"],
            "execution_repairs": max(0, limits["max_execution_repairs"] - len(case.get("execution_repairs", []))),
            "verifier_repairs": max(0, limits["max_verifier_repairs"] - verifier_repairs(case)),
            "limits": limits}


def validate_tool_report(report, case, config):
    limits = policy(config)
    require(limits is not None and report["prior"] == tool_usage(case), "Tool recovery usage changed")
    used, families = report["prior"]["used"], dict(report["prior"]["families"])
    grants = {}
    for entry in report["events"]:
        if limits["version"] == 2:
            require(entry["decision"] in ("recover", "coalesced", "stop"), "Invalid recovery decision")
            request = entry["request"]
            require(type(request) is int and request >= 0, "Invalid recovery request")
            key = (request, entry.get("family"))
            if entry["decision"] == "coalesced":
                grant = grants.get(key)
                require(request > 0 and grant is not None and
                        entry["recovery_tool_call_id"] == grant["tool_call_id"] and
                        entry["deadline"] == grant["deadline"], "Invalid coalesced recovery")
            elif entry["decision"] == "recover" and request > 0:
                require(key not in grants, "Duplicate recovery grant for the same request")
                grants[key] = entry
        else:
            require(entry["decision"] in ("recover", "stop"), "Invalid recovery decision")
        if entry["decision"] == "recover":
            family = entry["family"]
            families[family] = families.get(family, 0) + 1
            used += 1
            require(used <= limits["max_tool_recoveries"] and
                    families[family] <= limits["max_same_error_recoveries"], "Tool recovery budget exceeded")
    require(report["usage"] == {"used": used, "families": families}, "Invalid tool recovery accounting")
    return report["usage"]
