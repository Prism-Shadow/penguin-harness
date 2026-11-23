import re, sys

def read_lines(p):
    with open(p) as f:
        return f.readlines()

pre = read_lines("pnpm-lock.yaml")
fin = read_lines("/tmp/lock-final.yaml")

def find_snap(lines, key):
    """Return (start, end) of snapshots entry for key (quoted YAML key)."""
    pat = re.compile(r"^  '" + re.escape(key) + r"':\n$")
    for i, l in enumerate(lines):
        if pat.match(l):
            j = i + 1
            while j < len(lines) and not re.match(r"^  \S.*:\n$", lines[j]):
                j += 1
            while j > i and lines[j-1].strip() == "":
                j -= 1
            return i, j
    return None

key_agent = "'@prismshadow/penguin-library-agent@file:library/agent(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)"
key_bench = "'@prismshadow/penguin-library-benchmark@file:library/benchmark(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)"
key_ws = "'@prismshadow/penguin-library-workspace@file:library/workspace(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)"

blocks = {}
for key in (key_agent, key_bench, key_ws):
    s = find_snap(fin, key)
    if s is None:
        sys.exit(f"final: snapshot {key} not found")
    blocks[key] = fin[s[0]:s[1]]

ag = [l for l in blocks[key_agent] if not l.startswith("      tar: ")]
assert "tar" not in "".join(ag)
blocks[key_agent] = ag

for ref in (
    "file:packages/core(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)",
    "file:library/http(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)",
    "file:library/session(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)",
    "file:library/trace(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)",
):
    assert any(ref in l for l in pre), f"prefix lacks snapshot ref {ref}"

def insert_after(lines, after_key, block):
    s = find_snap(lines, after_key)
    if s is None:
        sys.exit(f"prefix: snapshot {after_key} not found")
    end = s[1]
    b = list(block)
    if end < len(lines) and lines[end].strip() == "":
        b.append("\n")
    else:
        b.append("\n\n")
    lines[end:end] = b
    return lines

pre = insert_after(pre, "'@prismshadow/penguin-library-agent-api@file:library/agent-api(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)", blocks[key_agent])
pre = insert_after(pre, "'@prismshadow/penguin-library-auth@file:library/auth(supports-color@10.2.2)(ws@8.21.0)(zod@4.6.7)", blocks[key_bench])
pre = insert_after(pre, "'@prismshadow/penguin-library-workbench@file:library/workbench", blocks[key_ws])

with open("pnpm-lock.yaml", "w") as f:
    f.writelines(pre)
print("ok")
for i, l in enumerate(pre):
    if "penguin-library-agent@" in l or "penguin-library-benchmark@" in l or "penguin-library-workspace@" in l:
        print(i + 1, l.strip()[:110])
