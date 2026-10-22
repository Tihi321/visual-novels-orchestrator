"""JSON in, JSON out, for the tests now and for the engine in phase 2.

    python cli.py generate [--kind murdle] [--size 3] [--seed N] [--band easy|medium|hard]
    python cli.py solve < puzzle.json        unique, deducible, band, steps, score
    python cli.py check < {"puzzle": ..., "accusation": {...}, "marks": {...}}
"""

import argparse
import json
import os
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vno_puzzles import check_accusation, check_marks, generate, solve  # noqa: E402


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
    args = ap.parse_args(argv)
    try:
        if args.cmd == "generate":
            out = generate(args.kind, args.size, args.seed, args.band)
        elif args.cmd == "solve":
            out = solve(json.load(sys.stdin))
        else:
            data = json.load(sys.stdin)
            out = {"accusation": check_accusation(data["puzzle"], data.get("accusation", {})), "wrong_marks": check_marks(data["puzzle"], data.get("marks", {}))}
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
