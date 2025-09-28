# scripts/ci_acceptance_checks.py
import json, sys, re, glob

bad = []

def check_packet(p):
    with open(p, encoding='utf-8') as f:
        j = json.load(f)
    for k in ["as_of","clusters","events_update","post"]:
        assert k in j, f"missing key {k}"
    evs = j.get("events_update") or []
    assert evs, "no events_update items"
    for i, ev in enumerate(evs):
        assert ev.get("uid"), f"event[{i}] missing uid"
        b = ev.get("brief") or {}
        for bk in ["slug","title","content"]:
            assert b.get(bk), f"event[{i}].brief missing {bk}"
        # voice guard
        assert not re.search(r"\b(we|our)\b", b.get("content",""), flags=re.I), f"event[{i}].brief contains 'we/our'"
    # if top-level briefings exist, mirror count & uids
    briefs = j.get("briefings") or []
    if briefs:
        assert len(briefs) == len(evs), "briefings count != events_update count"
        uids = {ev["uid"] for ev in evs}
        assert {b.get("event_uid") for b in briefs} == uids, "briefings event_uids mismatch"

def main():
    for p in glob.glob("data/llm/*.packet.json"):
        try:
            check_packet(p)
        except AssertionError as e:
            bad.append(f"{p}: {e}")
    if bad:
        print("\n".join(bad))
        sys.exit(1)
    print("Acceptance checks passed.")

if __name__ == "__main__":
    main()
