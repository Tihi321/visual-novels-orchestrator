"""JSON in, JSON out, for the tests now and for the engine in phase 2.

    python cli.py generate [--kind murdle] [--size 3] [--seed N] [--band easy|medium|hard]
    python cli.py solve < puzzle.json        unique, deducible, band, steps, score
    python cli.py check < {"puzzle": ..., "accusation": {...}, "marks": {...}}
    python cli.py check-text < {"puzzle": ..., "readBack": [...], "text": {...}}   does the prose mean the same clues?
    python cli.py render-text < {"puzzle": ..., "names": {...}}                      the canonical sentences for these names
"""

import argparse
import json
import os
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vno_puzzles import check_accusation, check_marks, check_text, generate, render_text, solve  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vno_puzzles")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--kind", default="murdle")
    g.add_argument("--size", type=int, default=3)
    g.add_argument("--seed", type=int, default=1)
    g.add_argument("--band", default="medium")
    sub.add_parser("solve")
    sub.add_parser("check")
    sub.add_parser("check-text")
    sub.add_parser("render-text")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "generate":
            out = generate(args.kind, args.size, args.seed, args.band)
        elif args.cmd == "solve":
            out = solve(json.load(sys.stdin))
        elif args.cmd == "check-text":
            data = json.load(sys.stdin)
            out = check_text(data["puzzle"], data["readBack"], data.get("text"))
        elif args.cmd == "render-text":
            data = json.load(sys.stdin)
            out = render_text(data["puzzle"], data.get("names"))
        else:
            data = json.load(sys.stdin)
            out = {"accusation": check_accusation(data["puzzle"], data.get("accusation", {})), "wrong_marks": check_marks(data["puzzle"], data.get("marks", {}))}
    except (ValueError, KeyError, TypeError) as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
