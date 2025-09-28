
#!/usr/bin/env python3
"""
check_and_fix_packet.py
Validates a Deep Research packet. If invalid, attempts to auto-fix and re-validate.
Usage:
  python check_and_fix_packet.py <input_file> [-o OUTPUT_FILE]
Exit codes:
  0 on success (valid JSON, with or without fixes)
  1 on failure (could not parse even after fix)
"""
import argparse, json, sys, tempfile, os, subprocess, shutil

def try_json_load(path):
    try:
        with open(path, encoding="utf-8") as f:
            json.load(f)
        return True, ""
    except Exception as e:
        return False, str(e)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="Path to the packet JSON")
    ap.add_argument("-o","--output", help="Write valid (possibly fixed) JSON to this path")
    args = ap.parse_args()

    inp = args.input

    ok, err = try_json_load(inp)
    if ok:
        # Already valid JSON. Copy to output if requested.
        if args.output and os.path.abspath(inp) != os.path.abspath(args.output):
            shutil.copyfile(inp, args.output)
        print("JSON valid ✅")
        sys.exit(0)

    print("JSON invalid ❌ — attempting auto-fix…")
    # Call the fixer script that normalizes and repairs common LLM glitches.
    fixer = os.path.join(os.path.dirname(__file__), "validate_and_fix_llm_packet.py")
    if not os.path.exists(fixer):
        print("Fixer script not found:", fixer, file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as td:
        fixed_tmp = os.path.join(td, "fixed.json")
        try:
            # Run the fixer
            subprocess.check_call([sys.executable, fixer, inp, "-o", fixed_tmp])
        except subprocess.CalledProcessError as e:
            print("Fixer failed:", e, file=sys.stderr)
            sys.exit(1)

        ok2, err2 = try_json_load(fixed_tmp)
        if not ok2:
            print("Still invalid after fix ❌", file=sys.stderr)
            print(err2, file=sys.stderr)
            sys.exit(1)

        # Success
        if args.output:
            os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
            shutil.copyfile(fixed_tmp, args.output)
        print("Fixed and valid ✅")
        sys.exit(0)

if __name__ == "__main__":
    main()
